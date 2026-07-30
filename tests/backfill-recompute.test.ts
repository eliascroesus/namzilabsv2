import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { backfillJobs, connections, flowResults, flowVersions, flows, sourceStreams } from "@/db/schema";
import { importProgressByStreamRef, requestBackfill, checkpointJob, finishJob, startJob } from "@/lib/backfill/jobs";
import { markStaleForSource, resultsVersion } from "@/lib/flow/materialize";
import { importProgressNote } from "@/lib/sync/streams";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import type { DB } from "@/db/types";

/**
 * Phases 7 and 8 — what a number MEANS while its history is still arriving.
 *
 * Two properties carry the risk. A number still growing has to say so, and
 * several flows on one importing stream have to say the SAME thing — which is
 * why the state is read live rather than baked into each flow's stored result.
 */

const ORG = "org_p78";
const NOW = new Date("2026-07-01T00:00:00Z");
const back = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const CFG = { scope: "user" };
const HASH = streamConfigHash(CFG, "calendly");

let db: DB;
let close: () => Promise<void>;
let connId = "";
let streamId = "";

async function publishedFlow(name: string) {
  const graph = {
    nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source: "calendly", sourceConfig: CFG } } }],
    edges: [],
    metrics: [],
  };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name, draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph });
  await db.insert(flowResults).values({
    orgId: ORG,
    flowId: flow.id,
    version: 1,
    outputNodeId: "o1",
    tile: { name, value: 5 },
    status: "fresh",
    // What materializeFlow records: the streams this number came from.
    provenance: { asOf: NOW.toISOString(), streams: [{ connectionId: connId, configHash: HASH }] },
    computedAt: NOW,
  });
  return flow.id;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "calendly" });
  const [s] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId: connId, configHash: HASH, config: CFG })
    .returning();
  streamId = s.id;
});
afterEach(async () => {
  await close();
});

const ask = () =>
  requestBackfill(db, { id: streamId, orgId: ORG, connectionId: connId, configHash: HASH }, "calendly", back(90));

describe("Phase 8 — a tile whose history is still arriving says so", () => {
  it("reports progress against the keys a flow knows a stream by", async () => {
    const { job } = await ask();
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(12), rowsImported: 100 }, NOW);

    const progress = await importProgressByStreamRef(db, ORG, [{ connectionId: connId, configHash: HASH }], NOW);

    const p = progress.get(`${connId}:${HASH}`)!;
    expect(p.coveredMs).toBe(12 * 86_400_000);
    expect(p.targetMs).toBe(90 * 86_400_000);
  });

  /**
   * THE requirement. `materializeFlow` writes each flow's tiles in its own
   * call, so a note stored on the row would freeze whatever the import had
   * reached at that moment — and two flows materialized minutes apart would
   * disagree about one import. Reading live gives the state one home.
   */
  it("gives every flow on one importing stream the same answer — the CURRENT one", async () => {
    const { job } = await ask();
    await startJob(db, job.id, NOW);

    // Flow A is materialized when the import has reached 20 days back…
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(20), rowsImported: 50 }, NOW);
    await publishedFlow("Flow A");
    const atA = (await importProgressByStreamRef(db, ORG, [{ connectionId: connId, configHash: HASH }], NOW)).get(
      `${connId}:${HASH}`,
    )!.coveredMs;
    expect(atA).toBe(20 * 86_400_000);

    // …and Flow B only after it has reached 60. A note STORED on each row would
    // freeze those two different moments, and the two flows would disagree about
    // one import forever.
    await checkpointJob(db, job.id, { checkpoint: "c2", oldestSeen: back(60), rowsImported: 90 }, NOW);
    await publishedFlow("Flow B");

    const rows = await db.select().from(flowResults).where(eq(flowResults.orgId, ORG));
    const refs = rows.flatMap((r) => (r.provenance as { streams: Array<{ connectionId: string; configHash: string }> }).streams);
    const progress = await importProgressByStreamRef(db, ORG, refs, NOW);
    const answers = rows.map((r) => {
      const s = (r.provenance as { streams: Array<{ connectionId: string; configHash: string }> }).streams[0];
      return progress.get(`${s.connectionId}:${s.configHash}`)!.coveredMs;
    });

    expect(answers).toHaveLength(2);
    // Both agree…
    expect(new Set(answers).size).toBe(1);
    // …and on the import's depth NOW, not on either flow's materialize moment.
    // That second assertion is the one with teeth: agreement alone is satisfied
    // by any two reads of one value, including a stale one.
    expect(answers[0]).toBe(60 * 86_400_000);
    expect(answers[0]).not.toBe(atA);
  });

  /**
   * Tenant isolation. The connection ids fed to this query come from
   * `flow_results.provenance` — graph CONTENT, not a validated foreign key — so a
   * graph naming another org's connection would read that org's import state if
   * the query trusted the id alone.
   */
  it("does not answer for another org's connection, even named exactly", async () => {
    const { job } = await ask();
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(20), rowsImported: 50 }, NOW);

    // A different org asking about OUR connection and hash gets nothing.
    const leaked = await importProgressByStreamRef(db, "org_other", [{ connectionId: connId, configHash: HASH }], NOW);
    expect(leaked.size).toBe(0);
    // …while the owning org still gets its answer.
    expect((await importProgressByStreamRef(db, ORG, [{ connectionId: connId, configHash: HASH }], NOW)).size).toBe(1);
  });

  it("says nothing once the import has finished", async () => {
    const { job } = await ask();
    await startJob(db, job.id, NOW);
    await finishJob(db, job.id, { status: "complete" }, NOW);

    expect(await importProgressByStreamRef(db, ORG, [{ connectionId: connId, configHash: HASH }])).toEqual(new Map());
  });

  /**
   * The connection filter is the indexable half of the lookup; the hash has to
   * be checked too, or one importing stream would label every other stream on
   * the same connection as importing.
   */
  it("does not leak a sibling stream's import into a flow that does not read it", async () => {
    // The sibling has its OWN running job, so the connection-scoped half of the
    // query returns it. Only the hash check keeps it out of the answer — and a
    // sibling with no job at all could never have detected that.
    const otherCfg = { scope: "organization" };
    const otherHash = streamConfigHash(otherCfg, "calendly");
    const [sibling] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: connId, configHash: otherHash, config: otherCfg })
      .returning();
    const mine = await ask();
    await startJob(db, mine.job.id, NOW);
    const theirs = await requestBackfill(
      db,
      { id: sibling.id, orgId: ORG, connectionId: connId, configHash: otherHash },
      "calendly",
      back(365),
    );
    await startJob(db, theirs.job.id, NOW);

    // A flow that reads only the FIRST stream asks only for that key.
    const progress = await importProgressByStreamRef(db, ORG, [{ connectionId: connId, configHash: HASH }], NOW);

    expect(progress.size).toBe(1);
    expect(progress.has(`${connId}:${HASH}`)).toBe(true);
    expect(progress.get(`${connId}:${HASH}`)!.targetMs).toBe(90 * 86_400_000);
  });

  it("costs one query for an empty dashboard, and asks nothing with no refs", async () => {
    expect(await importProgressByStreamRef(db, ORG, [])).toEqual(new Map());
  });
});

describe("Phase 8 — the freshness beacon notices an import deepening", () => {
  /**
   * An import going from 12 days to 30 changes no `flow_results` column — same
   * tiles, same status, same computed_at. If the beacon ignored it, an open
   * dashboard would sit on "covering 12 of 90" until an unrelated recompute
   * happened to bump the ETag.
   */
  it("moves when the import reaches further back", async () => {
    await publishedFlow("Flow A");
    const { job } = await ask();
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(12), rowsImported: 10 }, NOW);
    const before = await resultsVersion(db, ORG);

    await checkpointJob(db, job.id, { checkpoint: "c2", oldestSeen: back(30), rowsImported: 10 }, NOW);
    const after = await resultsVersion(db, ORG);

    expect(after).not.toBe(before);
  });

  /**
   * `reached_floor` moves BACKWARDS as an import deepens, so an aggregate built on
   * `max` is pinned by whichever running job is SHALLOWEST. With two jobs, the
   * deep one could reach further back every slice while the beacon never moved —
   * and the label this component exists to refresh would freeze on an open
   * dashboard, which is the whole failure it was added to prevent.
   */
  it("moves when the DEEPEST of two imports deepens, not just the shallowest", async () => {
    await publishedFlow("Flow A");
    const shallow = await ask();
    await startJob(db, shallow.job.id, NOW);
    // A second stream on the same connection, importing much deeper.
    const deepCfg = { scope: "organization" };
    const deepHash = streamConfigHash(deepCfg, "calendly");
    const [deepStream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: connId, configHash: deepHash, config: deepCfg })
      .returning();
    const deep = await requestBackfill(
      db,
      { id: deepStream.id, orgId: ORG, connectionId: connId, configHash: deepHash },
      "calendly",
      back(365),
    );
    await startJob(db, deep.job.id, NOW);

    // The shallow job is parked where it is; only the deep one advances.
    await checkpointJob(db, shallow.job.id, { checkpoint: "s1", oldestSeen: back(5), rowsImported: 10 }, NOW);
    await checkpointJob(db, deep.job.id, { checkpoint: "d1", oldestSeen: back(100), rowsImported: 10 }, NOW);
    const before = await resultsVersion(db, ORG);

    await checkpointJob(db, deep.job.id, { checkpoint: "d2", oldestSeen: back(200), rowsImported: 10 }, NOW);

    // max(reached_floor) is unchanged — it is still the shallow job's back(5).
    expect(await resultsVersion(db, ORG)).not.toBe(before);
  });

  it("moves when an import finishes, even though no tile changed", async () => {
    await publishedFlow("Flow A");
    const { job } = await ask();
    await startJob(db, job.id, NOW);
    const during = await resultsVersion(db, ORG);

    await finishJob(db, job.id, { status: "complete" }, NOW);
    expect(await resultsVersion(db, ORG)).not.toBe(during);
  });
});

describe("Phase 7 — recompute batches during an import", () => {
  /**
   * Staleness is idempotent, and that IS the batching: however many checkpoints
   * land between two runs of the ten-minute recompute cron, they collapse into
   * one pass. Emitting a recompute per checkpoint instead would not coalesce —
   * the debounce window is ten seconds and slices are five minutes apart.
   */
  it("collapses many checkpoints into one pending recompute", async () => {
    const flowId = await publishedFlow("Flow A");

    for (let i = 0; i < 5; i++) {
      const marked = await markStaleForSource(db, ORG, "calendly", connId, [HASH]);
      expect(marked).toEqual([flowId]);
    }

    const rows = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
    // One pending recompute, not five — the tile is stale, once.
    expect(rows.every((r) => r.status === "stale")).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it("only marks flows that actually read the importing stream", async () => {
    await publishedFlow("Flow A");
    const otherConn = await seedConnection(db, { orgId: ORG, source: "close" });

    const marked = await markStaleForSource(db, ORG, "close", otherConn, null);

    // A Close import must not invalidate a Calendly flow's number.
    expect(marked).toEqual([]);
  });

  it("returns the flows a completion recompute must target", async () => {
    const flowId = await publishedFlow("Flow A");
    const other = await publishedFlow("Flow B");

    const marked = await markStaleForSource(db, ORG, "calendly", connId, [HASH]);

    // Both read the stream, so the authoritative pass covers both — and it is
    // driven by this list rather than by the stale flag, which a concurrent
    // cron pass may already have cleared.
    expect(marked.sort()).toEqual([flowId, other].sort());
  });
});

/**
 * The mapping half. Everything above reads `provenance.streams`; this is the
 * only test that proves anything WRITES it — without which the whole read path
 * is exercised against a fixture and the feature is dead in production.
 */
describe("Phase 8 — materializing records which streams a number came from", () => {
  it("stores the stream refs alongside the result", async () => {
    const { createFlow, saveDraft, publishFlow } = await import("@/lib/flow/store");
    const { materializeFlow } = await import("@/lib/flow/materialize");

    const flow = await createFlow(db, ORG);
    await saveDraft(db, ORG, flow.id, {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: connId, source: "calendly", sourceConfig: CFG } } },
        { id: "c", type: "calculate", data: { config: { mode: "number", aggregation: "count" } } },
      ],
      edges: [{ id: "a->c", source: "a", target: "c" }],
      metrics: [{ nodeId: "c", enabled: true, name: "Bookings", viz: "number", format: "number" }],
    });
    await publishFlow(db, ORG, flow.id);

    expect((await materializeFlow(db, ORG, flow.id)).ok).toBe(true);

    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    const streams = (row.provenance as { streams?: Array<{ connectionId: string; configHash: string }> }).streams;
    // Recorded at materialize time, where the published graph is already loaded
    // — deriving this at render would cost a whole flow_versions row per tile.
    expect(streams).toEqual([{ connectionId: connId, configHash: HASH }]);
  });
});

/**
 * The sentence itself. Both numbers are honest quantities, and the ROUNDING is
 * where honesty can still be lost.
 */
describe("the import note cannot claim more than it holds", () => {
  const DAY = 86_400_000;

  it("floors the numerator, so it never reads as finished while importing", async () => {
    // 29.6 of 30 days. Rounding the numerator prints "covering 30 of 30 days" —
    // a sentence stating the import is complete, inside a note whose only job is
    // to say it is not. Flooring can only ever understate.
    const note = importProgressNote({ coveredMs: 29.6 * DAY, targetMs: 30 * DAY });
    expect(note).toContain("covering 29 of 30 days");
    expect(note).not.toContain("30 of 30");
  });

  it("never exceeds the target, and never goes negative", async () => {
    // A span wider than the window asked for (a provider returning a record
    // outside the bound) must clamp rather than print 31 of 30.
    expect(importProgressNote({ coveredMs: 40 * DAY, targetMs: 30 * DAY })).toContain("covering 30 of 30 days");
    expect(importProgressNote({ coveredMs: -1, targetMs: 30 * DAY })).toContain("covering 0 of 30 days");
  });

  it("says something honest when there are no numbers at all", () => {
    expect(importProgressNote()).toContain("can still grow");
    expect(importProgressNote()).not.toContain("covering");
  });
});
