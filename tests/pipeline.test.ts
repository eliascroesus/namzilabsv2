import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { storeRawEvent } from "@/ingestion/raw-store";
import { processRawEvent } from "@/ingestion/pipeline";
import { events, deliveryLog, connections } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function storeAndGetId(connectionId: string, payload: unknown) {
  const raw = await storeRawEvent(db, {
    orgId: "org_test",
    connectionId,
    source: "webhook",
    headers: {},
    payload,
    signatureValid: true,
  });
  return raw.id;
}

describe("ingestion pipeline: dedup + idempotency", () => {
  it("inserts a new canonical event and logs success", async () => {
    const connectionId = await seedConnection(db);
    const rawId = await storeAndGetId(connectionId, { id: "e1", type: "booked", email: "a@b.com" });

    const res = await processRawEvent(db, rawId);
    expect(res).toEqual({ inserted: 1, updated: 0, deduped: 0, total: 1 });

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("booked");
    expect(rows[0].eventId).toBe(`webhook:${connectionId}:e1`);

    const logs = await db.select().from(deliveryLog).where(eq(deliveryLog.status, "success"));
    expect(logs).toHaveLength(1);
  });

  it("is idempotent: re-processing the same raw event refreshes, never duplicates", async () => {
    const connectionId = await seedConnection(db);
    const rawId = await storeAndGetId(connectionId, { id: "e1", type: "booked" });

    await processRawEvent(db, rawId);
    const second = await processRawEvent(db, rawId);
    expect(second).toEqual({ inserted: 0, updated: 1, deduped: 1, total: 1 });
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("dedups across separate deliveries carrying the same natural id — the LATEST payload wins, first-seen receivedAt stays", async () => {
    const connectionId = await seedConnection(db);
    const rawA = await storeAndGetId(connectionId, { id: "same", type: "booked", status: "pending" });
    const rawB = await storeAndGetId(connectionId, { id: "same", type: "booked", status: "confirmed" });

    await processRawEvent(db, rawA);
    const [before] = await db.select().from(events);
    const res = await processRawEvent(db, rawB);
    expect(res.inserted).toBe(0);
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    // Redelivery refreshes the mutable payload (source truth wins)...
    expect((rows[0].properties as Record<string, unknown>).status).toBe("confirmed");
    // ...but provenance fields are insert-only: first delivery's receivedAt/rawEventId stand.
    expect(rows[0].receivedAt.toISOString()).toBe(before.receivedAt.toISOString());
    expect(rows[0].rawEventId).toBe(before.rawEventId);
  });

  it("canonicalizes date-looking property values at ingest (automatic date cleanup)", async () => {
    const connectionId = await seedConnection(db);
    const rawId = await storeAndGetId(connectionId, {
      id: "e-dates",
      type: "booked",
      ts: "7/21/2026 14:23:45",
      scheduled_on: "Jan 5, 2026",
      amount: "1250",
      note: "call on 7/21",
    });
    await processRawEvent(db, rawId);
    const [row] = await db.select().from(events).where(eq(events.eventId, `webhook:${connectionId}:e-dates`));
    const props = row.properties as Record<string, unknown>;
    expect(props.ts).toBe("2026-07-21T14:23:45.000Z");
    expect(props.scheduled_on).toBe("2026-01-05");
    expect(props.amount).toBe("1250"); // non-dates stay byte-identical
    expect(props.note).toBe("call on 7/21");
  });

  it("updates the connection's lastEventAt on insert", async () => {
    const connectionId = await seedConnection(db);
    const rawId = await storeAndGetId(connectionId, { id: "e1" });
    await processRawEvent(db, rawId);
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.lastEventAt).not.toBeNull();
  });

  it("throws for a raw event whose source has no connector (drives retry/DLQ)", async () => {
    const connectionId = await seedConnection(db, { source: "webhook" });
    const raw = await storeRawEvent(db, {
      orgId: "org_test",
      connectionId,
      source: "does-not-exist",
      headers: {},
      payload: { id: "x" },
      signatureValid: true,
    });
    await expect(processRawEvent(db, raw.id)).rejects.toThrow(/no connector/);
  });
});
