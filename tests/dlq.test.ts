import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { storeRawEvent } from "@/ingestion/raw-store";
import { deadLetterRawEvent, replayRawEvent } from "@/ingestion/pipeline";
import { deadLetter, deliveryLog, connections, events } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("dead-letter queue + replay", () => {
  it("parks an exhausted event in the DLQ and keeps the connection in the sweep", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });

    await deadLetterRawEvent(db, raw.id, 6, "processing blew up");

    const dlq = await db.select().from(deadLetter).where(isNull(deadLetter.resolvedAt));
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error).toBe("processing blew up");

    const failed = await db.select().from(deliveryLog).where(eq(deliveryLog.status, "failed"));
    expect(failed).toHaveLength(1);

    /**
     * THE CONNECTION MUST STAY ACTIVE. `status = "error"` has no expiry and no
     * probe — `dueConnectionsForSweep` selects only active, and the only writer
     * back to active runs inside the sweep — so the old behaviour (flip to
     * error here) meant one malformed webhook body silently ended polling
     * forever on a connection whose poll path was healthy. The DLQ row plus
     * `lastError` is the record; the sweep keeps running.
     */
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("active");
    expect(conn.lastError).toContain("processing blew up");
    expect(conn.lastError).toContain("dead-lettered");
  });

  it("a successful replay un-parks a connection stuck at status=error from the old behaviour", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 6, "was parked by the pre-fix code");
    // Simulate a row written by the OLD dead-letter path, which set status=error.
    await db.update(connections).set({ status: "error" }).where(eq(connections.id, connectionId));

    await replayRawEvent(db, raw.id, "org_test");

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("active");
    expect(conn.lastError).toBeNull();
  });

  it("a replay never flips a DISABLED connection back on", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 6, "boom");
    // The user's off switch is not ours to flip on a replay.
    await db.update(connections).set({ status: "disabled" }).where(eq(connections.id, connectionId));

    await replayRawEvent(db, raw.id, "org_test");

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("disabled");
  });

  it("replays a dead-lettered event: it processes and the DLQ row resolves", async () => {
    const connectionId = await seedConnection(db);
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    await deadLetterRawEvent(db, raw.id, 6, "transient outage");

    const res = await replayRawEvent(db, raw.id, "org_test");
    expect(res.inserted).toBe(1);
    expect(await db.select().from(events)).toHaveLength(1);

    const unresolved = await db.select().from(deadLetter).where(isNull(deadLetter.resolvedAt));
    expect(unresolved).toHaveLength(0);
  });

  it("refuses a cross-tenant replay (organization isolation)", async () => {
    const connectionId = await seedConnection(db, { orgId: "org_a" });
    const raw = await storeRawEvent(db, {
      orgId: "org_a",
      connectionId,
      source: "webhook",
      headers: {},
      payload: { id: "e1", type: "booked" },
      signatureValid: true,
    });
    // A caller from a different org must not be able to replay this event.
    await expect(replayRawEvent(db, raw.id, "org_b")).rejects.toThrow(/forbidden/);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});
