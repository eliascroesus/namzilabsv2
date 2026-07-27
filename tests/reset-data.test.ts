import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, events, flowResults, flows, metrics, rawEvents, sourceStreams, syncState } from "@/db/schema";
import { resetData } from "@/lib/reset-data";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import type { DB } from "@/db/types";

/**
 * The reset is the only hard-delete path in the product, so the tests are about
 * what SURVIVES as much as what goes.
 */

const ORG = "org_reset";
let db: DB;
let close: () => Promise<void>;
let connId = "";
let flowId = "";

const CFG = { spreadsheetId: "SHEET_A", range: "Tab1" };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "gsheets" });

  // A connection parked deep in the idle ladder and paused by the breaker.
  await db
    .update(connections)
    .set({
      syncGeneration: 7,
      consecutiveNoOpSweeps: 44,
      nextSweepAt: new Date(Date.now() + 6 * 3_600_000),
      pausedUntil: new Date(Date.now() + 3_600_000),
      pausedReason: "provider limit",
      consecutiveFailures: 3,
      lastError: "boom",
      syncStatus: "error",
    })
    .where(eq(connections.id, connId));

  const graph = {
    nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source: "gsheets", sourceConfig: CFG } } }],
    edges: [],
  };
  const [flow] = await db.insert(flows).values({ orgId: ORG, name: "F", draftGraph: graph }).returning({ id: flows.id });
  flowId = flow.id;

  await db.insert(sourceStreams).values({
    orgId: ORG,
    connectionId: connId,
    configHash: streamConfigHash(CFG, "gsheets"),
    config: CFG,
    cursor: "SOME_CURSOR",
  });
  await db.insert(syncState).values({ connectionId: connId, cursor: "CONN_CURSOR" });
  await db.insert(events).values({
    eventId: "gsheets:row:1",
    orgId: ORG,
    connectionId: connId,
    source: "gsheets",
    eventType: "row_added",
    occurredAt: new Date(),
    properties: {},
  });
  await db.insert(rawEvents).values({ orgId: ORG, connectionId: connId, source: "gsheets", payload: {} });
  await db.insert(flowResults).values({ orgId: ORG, flowId, version: 1, outputNodeId: "o1", tile: {}, status: "fresh" });
  await db.insert(metrics).values({ orgId: ORG, name: "M", kind: "aggregate", definition: {} });
});

afterEach(async () => {
  await close();
});

describe("reset-data — inspect", () => {
  it("counts without deleting anything", async () => {
    const r = await resetData(db);
    expect(r.dryRun).toBe(true);
    expect(r.tables.find((t) => t.table === "events")!.rows).toBe(1);
    expect((await db.select().from(events)).length).toBe(1); // still there
    expect(r.streamsReRegistered).toBe(0);
  });
});

describe("reset-data — level=data", () => {
  it("clears derived data and keeps everything a user authored", async () => {
    await resetData(db, { apply: true });

    expect((await db.select().from(events)).length).toBe(0);
    expect((await db.select().from(rawEvents)).length).toBe(0);
    expect((await db.select().from(syncState)).length).toBe(0);
    expect((await db.select().from(flowResults)).length).toBe(0);

    // Kept: the account's own configuration.
    expect((await db.select().from(connections)).length).toBe(1);
    expect((await db.select().from(flows)).length).toBe(1);
    expect((await db.select().from(metrics)).length).toBe(1);
  });

  /**
   * `source_streams` is cleared and then rebuilt from flow config. Without the
   * rebuild, stream-scoped connections stay dark: the sweep iterates
   * `activeStreams` and does nothing with no rows, and only a flow save or a
   * Test creates one.
   */
  it("re-registers streams from flow config, with a fresh cursor", async () => {
    const r = await resetData(db, { apply: true });
    expect(r.streamsReRegistered).toBe(1);

    const [stream] = await db.select().from(sourceStreams);
    expect(stream.configHash).toBe(streamConfigHash(CFG, "gsheets"));
    expect(stream.cursor).toBeNull(); // the whole point: next poll is a first sync
    expect(stream.status).toBe("active");
  });

  it("re-arms the connection so it sweeps again, without touching credentials", async () => {
    const before = (await db.select().from(connections).where(eq(connections.id, connId)))[0];
    await resetData(db, { apply: true });
    const after = (await db.select().from(connections).where(eq(connections.id, connId)))[0];

    expect(after.pausedUntil).toBeNull();
    expect(after.consecutiveFailures).toBe(0);
    expect(after.consecutiveNoOpSweeps).toBe(0);
    expect(after.nextSweepAt).toBeNull();
    expect(after.status).toBe("active");
    expect(after.lastError).toBeNull();
    // Untouched: what the user actually configured.
    expect(after.credentialsEncrypted).toBe(before.credentialsEncrypted);
    expect(after.name).toBe(before.name);
  });

  /**
   * `sync_generation` must keep climbing. Resetting it while ANY event row
   * survived — a partial run, an interrupted delete — would leave those rows
   * above the connection's current generation, where the upsert guard
   * (`excluded >= stored`) no-ops against them and the resync retire
   * (`stored < gen`) never matches. Permanent, un-updatable duplicates.
   */
  it("leaves sync_generation climbing rather than resetting it", async () => {
    await resetData(db, { apply: true });
    const [after] = await db.select().from(connections).where(eq(connections.id, connId));
    expect(after.syncGeneration).toBe(7);
  });

  /**
   * Idempotent in the sense that matters: the END STATE is identical after one
   * run and after two. The only row a second run finds is the `source_streams`
   * registration the FIRST run rebuilt — it is deleted and rebuilt again, which
   * is the same state, not an accumulation.
   */
  it("is idempotent — a second run reaches the same end state", async () => {
    const first = await resetData(db, { apply: true });
    expect(first.tables.find((t) => t.table === "events")!.rows).toBe(1);

    const second = await resetData(db, { apply: true });
    const nonStream = second.tables.filter((t) => t.table !== "source_streams");
    expect(nonStream.every((t) => t.rows === 0)).toBe(true);
    expect(second.tables.find((t) => t.table === "source_streams")!.rows).toBe(1);

    // Same end state as after run one.
    expect(second.streamsReRegistered).toBe(1);
    const streams = await db.select().from(sourceStreams);
    expect(streams).toHaveLength(1);
    expect(streams[0].cursor).toBeNull();
    expect((await db.select().from(events)).length).toBe(0);
  });
});

describe("reset-data — level=all", () => {
  it("also clears connections, flows and metrics", async () => {
    await resetData(db, { level: "all", apply: true });
    expect((await db.select().from(connections)).length).toBe(0);
    expect((await db.select().from(flows)).length).toBe(0);
    expect((await db.select().from(metrics)).length).toBe(0);
  });

  it("does not try to re-register or re-arm what it just deleted", async () => {
    const r = await resetData(db, { level: "all", apply: true });
    expect(r.streamsReRegistered).toBe(0);
    expect(r.connectionsRearmed).toBe(0);
  });
});
