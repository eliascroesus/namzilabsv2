import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { storeRawEvent } from "@/ingestion/raw-store";
import { processRawEvent, upsertEvents } from "@/ingestion/pipeline";
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

  it("is idempotent: re-processing the same raw event does not duplicate", async () => {
    const connectionId = await seedConnection(db);
    const rawId = await storeAndGetId(connectionId, { id: "e1", type: "booked" });

    await processRawEvent(db, rawId);
    const second = await processRawEvent(db, rawId);
    // Identical redelivery is a true no-op: not an insert, not an update —
    // occurred_at is pinned at first write, so synthetic timestamps can't drift.
    expect(second).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("a webhook redelivery arriving AFTER a higher-generation poll refresh cannot regress the row", async () => {
    const connectionId = await seedConnection(db);
    const rawId = await storeAndGetId(connectionId, { id: "e1", type: "booked", stage: "old" });
    await processRawEvent(db, rawId); // gen 0 insert

    // A poll later refreshes the SAME event_id at generation 3 with newer data.
    await upsertEvents(
      db,
      { orgId: "org_test", connectionId, source: "webhook", generation: 3 },
      [{ eventId: `webhook:${connectionId}:e1`, eventType: "booked", subject: null, occurredAt: new Date("2026-02-01T00:00:00Z"), properties: { id: "e1", type: "booked", stage: "fresh" } }],
    );

    // The provider redelivers the ORIGINAL webhook (gen 0) afterwards.
    const redelivery = await processRawEvent(db, rawId);
    expect(redelivery).toEqual({ inserted: 0, updated: 0, deduped: 1, total: 1 });

    const [row] = await db.select().from(events).where(eq(events.eventId, `webhook:${connectionId}:e1`));
    expect((row.properties as Record<string, unknown>).stage).toBe("fresh"); // no content regression
    expect(row.syncGeneration).toBe(3); // no downgrade
  });

  it("dedups across separate deliveries carrying the same natural id", async () => {
    const connectionId = await seedConnection(db);
    const rawA = await storeAndGetId(connectionId, { id: "same", type: "booked" });
    const rawB = await storeAndGetId(connectionId, { id: "same", type: "booked" });

    await processRawEvent(db, rawA);
    const res = await processRawEvent(db, rawB);
    expect(res.inserted).toBe(0);
    expect(await db.select().from(events)).toHaveLength(1);
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
