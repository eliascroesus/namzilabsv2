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
  it("parks an exhausted event in the DLQ and flags the connection", async () => {
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

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.status).toBe("error");
    expect(conn.lastError).toBe("processing blew up");
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

    const res = await replayRawEvent(db, raw.id);
    expect(res.inserted).toBe(1);
    expect(await db.select().from(events)).toHaveLength(1);

    const unresolved = await db.select().from(deadLetter).where(isNull(deadLetter.resolvedAt));
    expect(unresolved).toHaveLength(0);
  });
});
