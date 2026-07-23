import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection, sweepConnection } from "@/ingestion/reconcile";
import { mirrorStream } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import type { Connector, CanonicalEvent } from "@/connectors/types";
import { connections, syncState, events, sourceStreams, flows, flowVersions, flowResults } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

// A deterministic poll-only connector: always returns the same two records so
// we can prove reconciliation refreshes (never duplicates) and advances the cursor.
const record = (id: string): CanonicalEvent => ({
  eventId: `test-poller:conn:${id}`,
  eventType: "row_added",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  properties: { id },
});

const pollConnector: Connector = {
  source: "test-poller",
  syncStrategy: "incremental",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async () => ({ records: [record("a"), record("b")], nextCursor: "cursor-1" }),
};
registerConnector(pollConnector);

// A MIRROR fake: serves whatever `MIRROR_DATA` currently holds — a living
// source we mutate between passes to prove 1:1 reconciliation.
let MIRROR_DATA: Array<{ id: string; name: string }> = [];
const mirrorConnector: Connector = {
  source: "test-mirror",
  syncStrategy: "mirror",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async (args) => ({
    records: MIRROR_DATA.map((r) => ({
      eventId: `test-mirror:${args.streamHash}:${r.id}`,
      eventType: "row",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      properties: { ...r },
    })),
    nextCursor: null,
  }),
};
registerConnector(mirrorConnector);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  MIRROR_DATA = [];
});
afterEach(async () => {
  await close();
});

async function seedMirrorStream(source = "test-mirror"): Promise<{ connectionId: string; streamHash: string; conn: typeof connections.$inferSelect }> {
  const connectionId = await seedConnection(db, { source });
  const streamHash = "hashA";
  await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: streamHash, config: { resource: "A" } });
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
  return { connectionId, streamHash, conn };
}

const streamByHash = async (hash: string) => (await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, hash)))[0];

describe("reconciliation / backfill (incremental, connection-scoped)", () => {
  it("polls, inserts new records, and stores the next cursor", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toMatchObject({ inserted: 2, updated: 0, polled: true, changed: true, softDeleted: 0 });

    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId));
    expect(state.cursor).toBe("cursor-1");
    expect(state.lastPolledAt).not.toBeNull();
  });

  it("refreshes (never duplicates) on the next sweep — gap-fill is idempotent in effect", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    await reconcileConnection(db, connectionId);
    const second = await reconcileConnection(db, connectionId);
    expect(second).toMatchObject({ inserted: 0, updated: 2, deduped: 2, polled: true });
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("keeps connection-scoped sweep rows at generation 0 (never delete-eligible)", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    await reconcileConnection(db, connectionId);
    const rows = await db.select().from(events);
    expect(rows.every((r) => r.syncGeneration === 0)).toBe(true);
  });

  it("no-ops for a push-only source with no poll()", async () => {
    const connectionId = await seedConnection(db, { source: "webhook" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toMatchObject({ inserted: 0, updated: 0, polled: false, changed: false });
  });
});

describe("sweepConnection — sweep changes mark dependent flows stale", () => {
  it("marks a published flow's stored results stale after a changed sweep", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller", orgId: "org_test" });
    const [flow] = await db
      .insert(flows)
      .values({ orgId: "org_test", name: "F", status: "published", publishedVersion: 1, draftGraph: { nodes: [], edges: [] } })
      .returning();
    await db.insert(flowVersions).values({
      flowId: flow.id,
      orgId: "org_test",
      version: 1,
      graph: { nodes: [{ id: "a", type: "app", position: { x: 0, y: 0 }, data: { config: { connectionId, source: "test-poller" } } }], edges: [], metrics: [] },
    });
    await db.insert(flowResults).values({ orgId: "org_test", flowId: flow.id, version: 1, outputNodeId: "a", status: "fresh" });

    await sweepConnection(db, connectionId); // inserts 2 → changed
    const [res] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(res.status).toBe("stale");
  });
});

describe("mirror passes — the 1:1 invariant", () => {
  it("every pass converges live rows to the current source (edits, deletes, re-adds)", async () => {
    const { connectionId, streamHash, conn } = await seedMirrorStream();

    const live = async () =>
      (await db.select().from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt))))
        .map((r) => ({ id: (r.properties as { id: string }).id, name: (r.properties as { name: string }).name }))
        .sort((a, b) => a.id.localeCompare(b.id));

    // Pass 1: two rows.
    MIRROR_DATA = [
      { id: "r1", name: "alice" },
      { id: "r2", name: "bob" },
    ];
    await mirrorStream(db, conn, await streamByHash(streamHash));
    expect(await live()).toEqual(MIRROR_DATA);

    // Pass 2: EDIT r1, DELETE r2, ADD r3 — live rows must be exactly the source.
    MIRROR_DATA = [
      { id: "r1", name: "alice-edited" },
      { id: "r3", name: "carol" },
    ];
    const r2 = await mirrorStream(db, conn, await streamByHash(streamHash));
    expect(r2).toMatchObject({ updated: 1, inserted: 1, softDeleted: 1, complete: true });
    expect(await live()).toEqual(MIRROR_DATA);

    // Pass 3: r2 comes BACK — its soft-deleted row must resurrect.
    MIRROR_DATA = [
      { id: "r1", name: "alice-edited" },
      { id: "r2", name: "bob-returns" },
      { id: "r3", name: "carol" },
    ];
    await mirrorStream(db, conn, await streamByHash(streamHash));
    expect(await live()).toEqual(MIRROR_DATA);
    // Nothing was ever hard-deleted — history is preserved as soft-deletes.
    expect(await db.select().from(events).where(eq(events.connectionId, connectionId))).toHaveLength(3);
  });

  it("legacy generation-0 stream rows are cleaned by the first mirror pass; webhook rows (no streamHash) survive", async () => {
    const { connectionId, streamHash, conn } = await seedMirrorStream();

    // A stale legacy row the source no longer has (gen 0 but stream-tagged)...
    await db.insert(events).values({
      eventId: `test-mirror:${streamHash}:ghost`,
      orgId: "org_test",
      connectionId,
      source: "test-mirror",
      eventType: "row",
      occurredAt: new Date("2025-01-01T00:00:00Z"),
      properties: { id: "ghost" },
      streamHash,
      syncGeneration: 0,
    });
    // ...and a webhook-captured row (no streamHash) that must NEVER be touched.
    await db.insert(events).values({
      eventId: "test-mirror:webhook:wh1",
      orgId: "org_test",
      connectionId,
      source: "test-mirror",
      eventType: "row",
      occurredAt: new Date("2025-01-01T00:00:00Z"),
      properties: { id: "wh1" },
      streamHash: null,
      syncGeneration: 0,
    });

    MIRROR_DATA = [{ id: "r1", name: "alice" }];
    const res = await mirrorStream(db, conn, await streamByHash(streamHash));
    expect(res.softDeleted).toBe(1); // the ghost

    const [ghost] = await db.select().from(events).where(eq(events.eventId, `test-mirror:${streamHash}:ghost`));
    expect(ghost.deletedAt).not.toBeNull();
    const [webhook] = await db.select().from(events).where(eq(events.eventId, "test-mirror:webhook:wh1"));
    expect(webhook.deletedAt).toBeNull();
  });

  it("a failing stream records its error and never blocks the others (per-stream isolation)", async () => {
    registerConnector({
      source: "test-mirror-flaky",
      syncStrategy: "mirror",
      authType: "none",
      verifySignature: () => true,
      normalize: () => [],
      poll: async (args) => {
        if (args.streamHash === "bad") throw new Error("boom");
        return { records: [{ eventId: `flaky:${args.streamHash}:ok`, eventType: "row", occurredAt: new Date(), properties: {} }], nextCursor: null };
      },
    });
    const connectionId = await seedConnection(db, { source: "test-mirror-flaky" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "bad", config: {} });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "good", config: {} });
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));

    await expect(mirrorStream(db, conn, await streamByHash("bad"))).rejects.toThrow("boom");
    const r = await mirrorStream(db, conn, await streamByHash("good"));
    expect(r.inserted).toBe(1);

    expect((await streamByHash("bad")).status).toBe("error");
    expect((await streamByHash("bad")).lastError).toContain("boom");
    expect((await streamByHash("good")).status).toBe("active");
    expect((await streamByHash("good")).syncGeneration).toBe(1);
  });

  it("a partial (budget-capped) scan refreshes but NEVER deletes or bumps the generation", async () => {
    // A paginating mirror source: 2 pages; budget of 1 page → incomplete.
    registerConnector({
      source: "test-mirror-paged",
      syncStrategy: "mirror",
      authType: "none",
      verifySignature: () => true,
      normalize: () => [],
      poll: async (args) => {
        if (!args.cursor) return { records: [{ eventId: "paged:p1", eventType: "row", occurredAt: new Date(), properties: { id: "p1" } }], nextCursor: "2" };
        return { records: [{ eventId: "paged:p2", eventType: "row", occurredAt: new Date(), properties: { id: "p2" } }], nextCursor: null };
      },
    });
    const connectionId = await seedConnection(db, { source: "test-mirror-paged" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "pg", config: {} });
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));

    // A pre-existing row the incomplete scan does not see: it must survive.
    await db.insert(events).values({
      eventId: "paged:old",
      orgId: "org_test",
      connectionId,
      source: "test-mirror-paged",
      eventType: "row",
      occurredAt: new Date("2025-01-01T00:00:00Z"),
      properties: { id: "old" },
      streamHash: "pg",
      syncGeneration: 0,
    });

    const partial = await mirrorStream(db, conn, await streamByHash("pg"), { pageBudget: 1 });
    expect(partial).toMatchObject({ complete: false, softDeleted: 0 });
    expect((await streamByHash("pg")).syncGeneration).toBe(0); // no bump
    const [old] = await db.select().from(events).where(eq(events.eventId, "paged:old"));
    expect(old.deletedAt).toBeNull(); // untouched

    // A complete pass then applies the full 1:1 semantics.
    const full = await mirrorStream(db, conn, await streamByHash("pg"));
    expect(full.complete).toBe(true);
    expect(full.softDeleted).toBe(1); // "old" is gone from the source
    expect((await streamByHash("pg")).syncGeneration).toBe(1);
  });
});
