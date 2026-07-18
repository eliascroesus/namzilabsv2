import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNull, and } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { runSync, reprocessConnection } from "@/lib/sync/resync";
import { registerConnector } from "@/connectors/registry";
import { storeRawEvent } from "@/ingestion/raw-store";
import { events } from "@/db/schema";
import type { Connector, CanonicalEvent } from "@/connectors/types";
import type { DB } from "@/db/types";

// Mock poll connector whose returned records we can change between syncs.
let POLL: CanonicalEvent[] = [];
const rec = (id: string, value: number): CanonicalEvent => ({
  eventId: `resync-poller:conn:${id}`,
  eventType: "lead",
  subject: id,
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  value,
  properties: {},
});
const resyncConnector: Connector = {
  source: "resync-poller",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async () => ({ records: POLL, nextCursor: null }),
};
registerConnector(resyncConnector);

let db: DB;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  POLL = [];
});
afterEach(async () => {
  await close();
});

async function activeIds(connectionId: string): Promise<string[]> {
  const rows = await db.select().from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)));
  return rows.map((r) => r.eventId).sort();
}

describe("full re-sync (versioned, safe replacement)", () => {
  it("imports, then on the next full sync updates changed records, removes upstream-deleted ones, keeps new", async () => {
    const conn = await seedConnection(db, { source: "resync-poller" });

    POLL = [rec("A", 10), rec("B", 20), rec("C", 30)];
    const r1 = await runSync(db, conn, "full");
    expect(r1.generation).toBe(1);
    expect(r1.upserted).toBe(3);
    expect(await activeIds(conn)).toEqual(["resync-poller:conn:A", "resync-poller:conn:B", "resync-poller:conn:C"]);

    // Upstream: A removed, B changed (value), D added.
    POLL = [rec("B", 25), rec("C", 30), rec("D", 40)];
    const r2 = await runSync(db, conn, "full");
    expect(r2.generation).toBe(2);
    expect(r2.softDeleted).toBe(1);
    expect(await activeIds(conn)).toEqual(["resync-poller:conn:B", "resync-poller:conn:C", "resync-poller:conn:D"]);

    const rows = await db.select().from(events).where(eq(events.connectionId, conn));
    const a = rows.find((r) => r.eventId.endsWith(":A"))!;
    const b = rows.find((r) => r.eventId.endsWith(":B"))!;
    expect(a.deletedAt).not.toBeNull(); // removed upstream -> soft-deleted
    expect(b.deletedAt).toBeNull();
    expect(b.value).toBe("25"); // changed upstream -> updated
    expect(b.syncGeneration).toBe(2);
  });

  it("never soft-deletes append-only (webhook, generation 0) rows", async () => {
    const conn = await seedConnection(db, { source: "resync-poller" });
    // A webhook-captured event lives at generation 0.
    await db.insert(events).values({
      eventId: "webhook:wh1",
      orgId: "org_test",
      connectionId: conn,
      source: "resync-poller",
      eventType: "message",
      subject: "wh",
      occurredAt: new Date(),
      syncGeneration: 0,
      properties: {},
    });

    POLL = [rec("X", 1)];
    await runSync(db, conn, "full");

    const [wh] = await db.select().from(events).where(eq(events.eventId, "webhook:wh1"));
    expect(wh.deletedAt).toBeNull(); // survived the full re-sync
  });

  it("incremental sync is additive and does not soft-delete", async () => {
    const conn = await seedConnection(db, { source: "resync-poller" });
    POLL = [rec("A", 1), rec("B", 2)];
    await runSync(db, conn, "full");
    POLL = [rec("C", 3)];
    const r = await runSync(db, conn, "incremental");
    expect(r.softDeleted).toBe(0);
    expect(await activeIds(conn)).toEqual(["resync-poller:conn:A", "resync-poller:conn:B", "resync-poller:conn:C"]);
  });
});

describe("reprocess", () => {
  it("re-normalizes canonical events from raw_events", async () => {
    const conn = await seedConnection(db, { source: "webhook" });
    await storeRawEvent(db, { orgId: "org_test", connectionId: conn, source: "webhook", headers: {}, payload: { id: "r1", type: "booked" }, signatureValid: true });
    await storeRawEvent(db, { orgId: "org_test", connectionId: conn, source: "webhook", headers: {}, payload: { id: "r2", type: "booked" }, signatureValid: true });

    const { processed } = await reprocessConnection(db, "org_test", conn);
    expect(processed).toBe(2);
    expect((await db.select().from(events).where(eq(events.connectionId, conn))).length).toBe(2);
  });
});
