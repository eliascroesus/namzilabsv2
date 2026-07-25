import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import { markStaleForSource } from "@/lib/flow/materialize";
import type { Connector, CanonicalEvent } from "@/connectors/types";
import { syncState, events, flows, flowVersions, flowResults } from "@/db/schema";
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
    expect(res).toEqual({ inserted: 2, updated: 0, softDeleted: 0, deduped: 0, polled: true, orgId: "org_test", source: "test-poller" });

    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId));
    expect(state.cursor).toBe("cursor-1");
    expect(state.lastPolledAt).not.toBeNull();
  });

  it("dedups on the next sweep (gap-fill is idempotent)", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    await reconcileConnection(db, connectionId);
    const second = await reconcileConnection(db, connectionId);
    expect(second).toEqual({ inserted: 0, updated: 0, softDeleted: 0, deduped: 2, polled: true, orgId: "org_test", source: "test-poller" });
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("no-ops for a push-only source with no poll()", async () => {
    const connectionId = await seedConnection(db, { source: "webhook" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toEqual({ inserted: 0, updated: 0, softDeleted: 0, deduped: 0, polled: false, orgId: "org_test", source: "webhook" });
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
