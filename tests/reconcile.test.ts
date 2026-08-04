import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import { markStaleForSource } from "@/lib/flow/materialize";
import type { Connector, CanonicalEvent } from "@/connectors/types";
import { syncState, events, flows, flowVersions, flowResults, connections, deliveryLog, usageLedger } from "@/db/schema";
import { recordRejectedDelivery } from "@/lib/webhooks/rejections";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

// A deterministic poll-only connector: always returns the same two records so
// we can prove reconciliation dedups and advances the cursor.
const record = (id: string): CanonicalEvent => ({
  eventId: `test-poller:conn:${id}`,
  eventType: "row_added",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  properties: { id },
});

const pollConnector: Connector = {
  source: "test-poller",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async () => ({ records: [record("a"), record("b")], nextCursor: "cursor-1" }),
};
registerConnector(pollConnector);

// A connector with provider-side webhook verification (the D.6 sweep hook).
let WEBHOOK_HEALTH: { healthy: boolean; reregistered: boolean; detail?: string } = { healthy: true, reregistered: false };
/** What the sweep told the connector about this endpoint's recent refusals. */
let SEEN_RECENTLY_REJECTING: boolean | undefined;
const hookedConnector: Connector = {
  source: "hooked-poller",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async () => ({ records: [], nextCursor: null }),
  verifyWebhookSubscription: async (args) => {
    SEEN_RECENTLY_REJECTING = args.recentlyRejecting;
    return WEBHOOK_HEALTH;
  },
};
registerConnector(hookedConnector);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("reconciliation / backfill", () => {
  it("polls, inserts new records, and stores the next cursor", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toEqual({ inserted: 2, updated: 0, softDeleted: 0, deduped: 0, polled: true, changedStreamHashes: [], heldContinuation: false, orgId: "org_test", source: "test-poller" });

    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId));
    expect(state.cursor).toBe("cursor-1");
    expect(state.lastPolledAt).not.toBeNull();
  });

  it("dedups on the next sweep (gap-fill is idempotent)", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    await reconcileConnection(db, connectionId);
    const second = await reconcileConnection(db, connectionId);
    expect(second).toEqual({ inserted: 0, updated: 0, softDeleted: 0, deduped: 2, polled: true, changedStreamHashes: [], heldContinuation: false, orgId: "org_test", source: "test-poller" });
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("no-ops for a push-only source with no poll()", async () => {
    const connectionId = await seedConnection(db, { source: "webhook" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toEqual({ inserted: 0, updated: 0, softDeleted: 0, deduped: 0, polled: false, changedStreamHashes: [], orgId: "org_test", source: "webhook" });
  });
});

describe("webhook subscription health (D.6) runs with the sweep", () => {
  it("reports ok / reregistered states on the reconcile result", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: false };
    expect((await reconcileConnection(db, connectionId)).webhook).toBe("ok");

    WEBHOOK_HEALTH = { healthy: true, reregistered: true };
    expect((await reconcileConnection(db, connectionId)).webhook).toBe("reregistered");
  });

  it("a failed check surfaces on the connection without blocking the poll", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: false, reregistered: false, detail: "provider 500" };
    const res = await reconcileConnection(db, connectionId);
    expect(res.webhook).toBe("failed");
    expect(res.polled).toBe(true); // the poll still ran

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.lastError).toContain("Webhook subscription check failed");
    expect(conn.lastError).toContain("provider 500");
  });
});

/**
 * A HEALTHY SUBSCRIPTION WIDENS THE POLL FLOOR FROM TEN MINUTES TO SIXTY, so
 * "healthy" has to mean deliveries are arriving.
 *
 * The widening is backwards on its own: if deliveries land, the connection is
 * held at base anyway and it never bites; if they do not, nothing promotes it
 * and freshness silently drops by 6x. It fires exactly when the instant path is
 * broken. Close is the proof — a subscription reporting `status: "active"` was
 * enough, and `active` is the state that connection held for months while
 * rejecting every POST with a 401.
 *
 * So one reading of `delivery_log` gates both decisions: whether a paused
 * subscription may be re-activated, and whether the poll may relax.
 */
describe("a refusing endpoint is not a healthy one", () => {
  const REJECTION_WINDOW_MS = 24 * 3_600_000;

  it("hands the connector the recent-refusal evidence", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: false };
    SEEN_RECENTLY_REJECTING = undefined;
    await reconcileConnection(db, connectionId);
    expect(SEEN_RECENTLY_REJECTING).toBe(false);

    await recordRejectedDelivery(db, { id: connectionId, orgId: "org_test", source: "hooked-poller" }, "invalid-signature");
    SEEN_RECENTLY_REJECTING = undefined;
    await reconcileConnection(db, connectionId);
    expect(SEEN_RECENTLY_REJECTING).toBe(true);
  });

  it("does NOT widen the poll floor while deliveries are being refused", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: false };

    // Clean endpoint: the backstop applies and the floor goes to an hour.
    await reconcileConnection(db, connectionId);
    const [relaxed] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(relaxed.webhookHealthyAt).not.toBeNull();
    const relaxedGap = relaxed.nextSweepAt!.getTime() - Date.now();
    expect(relaxedGap).toBeGreaterThan(30 * 60_000);

    // Same "ok" from the provider, but this endpoint is refusing deliveries —
    // so the instant path is carrying nothing and the poll is not a backstop.
    await db.update(connections).set({ webhookHealthyAt: null }).where(eq(connections.id, connectionId));
    await recordRejectedDelivery(db, { id: connectionId, orgId: "org_test", source: "hooked-poller" }, "invalid-signature");
    const res = await reconcileConnection(db, connectionId);
    expect(res.webhook).toBe("ok"); // the provider still says the subscription is fine

    const [held] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(held.webhookHealthyAt).toBeNull();
    const heldGap = held.nextSweepAt!.getTime() - Date.now();
    expect(heldGap).toBeLessThan(30 * 60_000);
  });

  it("forgets a refusal older than the memory window", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: false };
    await recordRejectedDelivery(db, { id: connectionId, orgId: "org_test", source: "hooked-poller" }, "invalid-signature");
    await db
      .update(deliveryLog)
      .set({ createdAt: new Date(Date.now() - REJECTION_WINDOW_MS - 60_000) })
      .where(eq(deliveryLog.connectionId, connectionId));

    SEEN_RECENTLY_REJECTING = undefined;
    await reconcileConnection(db, connectionId);
    expect(SEEN_RECENTLY_REJECTING).toBe(false);
  });
});

/**
 * THE HEALTH CHECK IS A PROVIDER CALL. One GET per connection per sweep, plus a
 * PUT on re-activation, all of it previously invisible to the budget — requests
 * leaving the process that our model of our own traffic did not contain.
 */
describe("the health check is on the ledger", () => {
  it("claims and settles against the poll's own bucket", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: false };
    await reconcileConnection(db, connectionId);

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    // One for the health GET, one for the poll. A ledger holding only the poll's
    // call is the bug: the GET happened either way.
    expect(rows.reduce((n, r) => n + r.calls, 0)).toBeGreaterThanOrEqual(2);
  });

  /**
   * A backstop that can starve the thing it backs up is worse than one that
   * occasionally does not run. When the budget refuses the claim the check is
   * SKIPPED — and a skipped check must read as neither failure nor health: no
   * scary `lastError` for a request never sent, and no widened poll floor on the
   * strength of a question never asked.
   */
  it("skips the check when the budget refuses, without calling it a failure", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: false };
    // Burn the window's allowance so the health claim cannot be afforded.
    await db.insert(usageLedger).values({
      orgId: "org_test",
      connectionId,
      provider: "hooked-poller",
      operation: "*",
      windowStart: new Date(Math.floor(Date.now() / 60_000) * 60_000),
      calls: 100_000,
    });

    SEEN_RECENTLY_REJECTING = undefined;
    const res = await reconcileConnection(db, connectionId);
    expect(SEEN_RECENTLY_REJECTING).toBeUndefined(); // never asked
    expect(res.webhook).toBeUndefined(); // not "failed"

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.lastError ?? "").not.toContain("Webhook subscription check failed");
    expect(conn.webhookHealthyAt).toBeNull();
  });

  it("a re-activation settles the PUT as well as the GET", async () => {
    const connectionId = await seedConnection(db, { source: "hooked-poller" });
    WEBHOOK_HEALTH = { healthy: true, reregistered: true };
    await reconcileConnection(db, connectionId);

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(rows.reduce((n, r) => n + r.calls, 0)).toBeGreaterThanOrEqual(3);
  });
});

describe("reconcile → stale wiring (poll-discovered changes refresh dashboards)", () => {
  it("a reconcile that inserts rows marks dependent published flows stale", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });

    // A published flow whose graph pulls from this source, with a fresh result.
    const [flow] = await db
      .insert(flows)
      .values({ orgId: "org_test", name: "F", status: "published", publishedVersion: 1 })
      .returning({ id: flows.id });
    await db.insert(flowVersions).values({
      orgId: "org_test",
      flowId: flow.id,
      version: 1,
      graph: { nodes: [{ id: "a1", type: "app", data: { config: { connectionId, source: "test-poller" } } }], edges: [] },
    });
    await db.insert(flowResults).values({
      orgId: "org_test",
      flowId: flow.id,
      version: 1,
      outputNodeId: "a1",
      tile: {},
      status: "fresh",
      computedAt: new Date(),
    });

    // The sweep: reconcile, then (as the Inngest layer does via flow/data.changed)
    // mark flows of that source stale when rows actually landed.
    const r = await reconcileConnection(db, connectionId);
    expect(r.inserted).toBe(2);
    const affected = await markStaleForSource(db, r.orgId, r.source, connectionId);
    expect(affected).toEqual([flow.id]);

    const [result] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(result.status).toBe("stale");
  });
});
