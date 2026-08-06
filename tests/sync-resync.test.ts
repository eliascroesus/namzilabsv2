import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNull, and, gt } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { runSync, reprocessConnection } from "@/lib/sync/resync";
import { registerConnector } from "@/connectors/registry";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { storeRawEvent } from "@/ingestion/raw-store";
import { events, usageLedger } from "@/db/schema";
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

/**
 * DECLARED A MIRROR, because that is what this fixture actually is — `POLL` is
 * the entire upstream dataset on every read — and the declaration is now
 * load-bearing. The full re-sync's retire is gated on `isMirrorSource`:
 * absence licenses deletion only where the read covered the whole resource. An
 * undeclared source defaults to webhook-only, whose full re-sync deliberately
 * retires nothing, and the "removes upstream-deleted ones" assertion below is
 * exactly the behaviour the gate reserves for mirrors.
 */
CONNECTOR_CATALOG.push({
  source: "resync-poller",
  name: "Resync fixture",
  description: "test stub",
  connect: "apiKey",
  instant: false,
  poll: true,
  sync: "mirror",
  autoWebhook: false,
  credentialFields: [],
});

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
  it("imports, then on the next full sync updates changed records, removes upstream-deleted ones, keeps new (mirror-class)", async () => {
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

  /**
   * F.1 — a full re-sync's provider calls reach the ledger.
   *
   * `pollAll` was the one walk in the system that claimed NOTHING: up to 200
   * pages of real provider requests, invisible to the per-connection bucket
   * and to the fleet bucket every Google customer shares — and it fires
   * automatically on every new connection. This asserts the walk now leaves
   * usage_ledger evidence, which is what makes it deniable at all.
   */
  it("a full re-sync claims provider budget through the usage ledger", async () => {
    const conn = await seedConnection(db, { source: "resync-poller" });
    POLL = [rec("A", 10)];
    await runSync(db, conn, "full");

    const charged = await db
      .select()
      .from(usageLedger)
      .where(and(eq(usageLedger.connectionId, conn), gt(usageLedger.calls, 0)));
    expect(charged.length).toBeGreaterThan(0);
  });

  /**
   * A budget-denied walk is a TRUNCATED walk: what it wrote is a prefix, so
   * the retire that absence licenses must not run — same semantics as the
   * PAGE_CAP ceiling (tests/resync-truncated-walk.test.ts), arrived at
   * through the budget instead of the page count.
   */
  it("a budget-denied full re-sync never retires rows on the strength of a prefix", async () => {
    const conn = await seedConnection(db, { source: "resync-poller" });
    POLL = [rec("A", 10), rec("B", 20)];
    await runSync(db, conn, "full");
    expect(await activeIds(conn)).toEqual(["resync-poller:conn:A", "resync-poller:conn:B"]);

    // Exhaust this connection's minute window so the next walk's first claim
    // is denied. budgetFor(default 60rpm) * 0.7 = 42; background lane cap is
    // 42 - ceil(42*0.25) = 31. A pre-charged bucket of 1000 denies anything.
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await db
      .insert(usageLedger)
      .values({
        orgId: "org_test",
        connectionId: conn,
        provider: "resync-poller",
        operation: "*",
        windowStart,
        calls: 1000,
      })
      // The first full sync above already charged this minute's bucket —
      // which is itself the claim-per-page fix working — so pre-charging
      // must update the existing row rather than insert a duplicate.
      .onConflictDoUpdate({
        target: [usageLedger.connectionId, usageLedger.operation, usageLedger.windowStart],
        set: { calls: 1000 },
      });

    POLL = []; // upstream claims empty — but the walk never gets to ask
    const r = await runSync(db, conn, "full");
    expect(r.softDeleted).toBe(0);
    expect(r.incomplete).toBe(true);
    // Nothing was tombstoned: the walk was denied, not the data deleted.
    expect(await activeIds(conn)).toEqual(["resync-poller:conn:A", "resync-poller:conn:B"]);
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
