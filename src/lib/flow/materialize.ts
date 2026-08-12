import { and, asc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { backfillJobs, connections, flowResults, flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { hasStreamConfig, streamConfigHash } from "@/lib/sync/stream-hash";
import { runFlow, buildTile, type CompileProvenance } from "./engine";
import { compileEnabled } from "./compile/flags";
import { getPublishedVersion } from "./store";
import { parseGraph, type TileSpec } from "./types";
import { streamRefsOfGraph } from "@/lib/sync/streams";

/**
 * Compute the published version's Output results and store them in flow_results
 * (fast dashboard reads). Runs on publish, on a manual refresh, or when relevant
 * data changes. Never blocks the dashboard render.
 */
export async function materializeFlow(db: DB, orgId: string, flowId: string): Promise<{ ok: boolean; error?: string }> {
  const published = await getPublishedVersion(db, orgId, flowId);
  if (!published) return { ok: false, error: "Flow is not published." };
  const { version, graph } = published;

  try {
    // E.5: collect provenance for this materialization — the SQL behind every
    // number, stored with the number itself.
    const provenance: CompileProvenance[] = [];
    const asOf = new Date();
    // E.4: compile is env-gated (default off) — see compile/flags.ts. This is
    // the call site that made `EngineCtx.compile` reachable in production at
    // all; before it, the parity-proven pushdown had exactly zero callers and
    // the provenance label `engine: "compiled"` below was dead code.
    const { nodes, outputs } = await runFlow({ db, orgId, provenance, compile: compileEnabled("materialize") }, graph);

    // Tiles come from Output nodes (legacy flows) and/or endpoint metrics chosen at
    // Review & publish (new flows) — one tile per enabled metric.
    const tiles: Array<{ nodeId: string; tile: TileSpec }> = outputs.map((o) => ({ nodeId: o.nodeId, tile: o.tile }));
    /**
     * Enabled metrics whose step FAILED. Tracked separately because the tidy-up
     * at the end deletes every stored row that is not in `tiles` — so a metric
     * that started failing had its row DELETED, vanished from the dashboard
     * without a trace, and this function still returned ok. The more metrics a
     * flow had, the quieter the loss: the honest path below only runs when
     * every single tile fails.
     */
    const failed: Array<{ nodeId: string; error: string }> = [];
    for (const m of graph.metrics) {
      if (!m.enabled) continue;
      const ex = nodes.get(m.nodeId);
      if (ex && ex.status === "ok") tiles.push({ nodeId: m.nodeId, tile: buildTile(m, ex.shape, ex.sample) });
      else failed.push({ nodeId: m.nodeId, error: ex && ex.status === "error" ? ex.error : "This step produced no result." });
    }

    if (tiles.length === 0) {
      // Nothing produced a result. Surface the earliest failing node's error
      // (topological order) — that's the root cause, not the downstream fallout.
      let message = "The flow produced no dashboard result.";
      for (const [, n] of nodes) {
        if (n.status === "error") {
          message = n.error;
          break;
        }
      }
      await db.update(flowResults).set({ status: "error", error: message }).where(eq(flowResults.flowId, flowId));
      return { ok: false, error: message };
    }
    /**
     * Which STREAMS this result was computed from.
     *
     * Recorded here because this is the one moment the published graph is
     * already in hand — deriving it at dashboard render would mean loading a
     * whole `flow_versions` row per tile per page load, which is exactly the
     * cost materialized results exist to avoid.
     *
     * It is a MAPPING and not a snapshot of import state: the state itself is
     * read live against these keys, so several flows on one backfilling stream
     * cannot drift apart between their materializations.
     *
     * Stored inside the existing `provenance` jsonb, so this needs no schema
     * change and no migration.
     */
    const conns = await db
      .select({ id: connections.id, source: connections.source })
      .from(connections)
      .where(eq(connections.orgId, orgId));
    const streams = streamRefsOfGraph(graph, (id) => conns.find((c) => c.id === id)?.source).map((r) => ({
      connectionId: r.connectionId,
      configHash: r.configHash,
    }));

    const record = {
      asOf: asOf.toISOString(),
      engine: provenance.some((p) => p.foldedFilterNodeIds.length > 0) ? "compiled" : "js",
      reads: provenance,
      streams,
    };
    for (const t of tiles) {
      await upsertResult(db, orgId, flowId, version, t.nodeId, t.tile, "fresh", null, record);
    }
    // A metric that broke keeps its row, its last good value, and gains the
    // reason — so the tile goes red and says why, instead of disappearing.
    for (const f of failed) {
      await db
        .update(flowResults)
        .set({ status: "error", error: f.error })
        .where(and(eq(flowResults.flowId, flowId), eq(flowResults.outputNodeId, f.nodeId)));
    }
    // Drop results for tiles that no longer exist in the published flow — the
    // failed ones are still part of it, so they are kept.
    const keep = [...tiles.map((t) => t.nodeId), ...failed.map((f) => f.nodeId)];
    await db
      .delete(flowResults)
      .where(keep.length ? and(eq(flowResults.flowId, flowId), notInArray(flowResults.outputNodeId, keep)) : eq(flowResults.flowId, flowId));
    if (failed.length > 0) return { ok: false, error: failed[0].error };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(flowResults).set({ status: "error", error: message }).where(eq(flowResults.flowId, flowId));
    return { ok: false, error: message };
  }
}

/**
 * Mark stale every published flow whose graph pulls from `source` (or the given
 * connection). Called when new data lands so the dashboard shows freshness and a
 * later recompute refreshes only what changed.
 *
 * G.1 — stream precision: when the caller knows WHICH streams changed
 * (`streamHashes` non-empty), a Get-data step with a chosen resource only
 * matches when ITS stream is among them — a change in spreadsheet A no longer
 * recomputes flows that read only spreadsheet B. A step with no chosen
 * resource reads the whole connection, so it matches any change there; callers
 * without stream knowledge (webhook path, full re-syncs) pass no hashes and
 * keep source/connection-level matching.
 */
export async function markStaleForSource(
  db: DB,
  orgId: string,
  source: string,
  connectionId?: string | null,
  streamHashes?: string[] | null,
): Promise<string[]> {
  const published = await db.select().from(flows).where(and(eq(flows.orgId, orgId), eq(flows.status, "published")));
  const changedHashes = streamHashes?.length ? new Set(streamHashes) : null;
  const affected: string[] = [];
  for (const f of published) {
    if (!f.publishedVersion) continue;
    const [ver] = await db
      .select()
      .from(flowVersions)
      .where(and(eq(flowVersions.flowId, f.id), eq(flowVersions.version, f.publishedVersion)))
      .limit(1);
    if (!ver) continue;
    // One unparseable stored graph must not kill staleness for every OTHER
    // flow in the org — parseGraph is designed never to throw (migrations run
    // inside it), but this loop is the org-wide freshness artery and a single
    // corrupt row taking it down would freeze every tile at once.
    let graph: ReturnType<typeof parseGraph>;
    try {
      graph = parseGraph(ver.graph);
    } catch {
      continue;
    }
    const uses = graph.nodes.some((n) => {
      if (n.type !== "app") return false;
      const c = (n.data.config ?? {}) as { source?: string; connectionId?: string; sourceConfig?: Record<string, unknown> };
      const matchesOrigin = c.source === source || (connectionId != null && c.connectionId === connectionId);
      if (!matchesOrigin) return false;
      // The NODE's source, falling back to the caller's: a node matched by
      // connection id alone may not name one, and the hash has to be taken the
      // same way the writer took it or a changed stream looks unchanged.
      const nodeSource = c.source ?? source;
      if (changedHashes && hasStreamConfig(c.sourceConfig ?? {}, nodeSource)) {
        return changedHashes.has(streamConfigHash(c.sourceConfig ?? {}, nodeSource));
      }
      return true; // whole-connection read, or caller without stream knowledge
    });
    if (uses) {
      await db.update(flowResults).set({ status: "stale" }).where(eq(flowResults.flowId, f.id));
      affected.push(f.id);
    }
  }
  return affected;
}

/**
 * The dashboard's tile read: every materialized result whose flow is still
 * published (the join guards orphans), WITH the stored error so a broken tile
 * can say why.
 *
 * THROWS TO THE CALLER, deliberately — this used to live inline on the
 * dashboard page behind a bare `catch {}` whose rationale ("flow_results may
 * not exist before migration 0002") died years of migrations ago. What that
 * catch actually did in production was render "No metrics yet." over a
 * customer's real published tiles whenever this one query hit a transient
 * failure — the empty state as a lie. The page turns a rejection into its
 * load-error banner; nothing below the page gets to decide that silence is
 * acceptable.
 */
export async function publishedFlowTiles(db: DB, orgId: string) {
  return db
    .select({
      flowId: flowResults.flowId,
      outputNodeId: flowResults.outputNodeId,
      tile: flowResults.tile,
      status: flowResults.status,
      error: flowResults.error,
      computedAt: flowResults.computedAt,
      // Which streams this number was computed from, recorded at materialize
      // time. Needed to answer "is any of it still importing".
      provenance: flowResults.provenance,
    })
    .from(flowResults)
    .innerJoin(flows, eq(flows.id, flowResults.flowId))
    .where(and(eq(flowResults.orgId, orgId), eq(flows.status, "published")));
}

/**
 * G.4 — the cheap freshness beacon the dashboard polls. One aggregate over the
 * org's flow_results (a handful of rows): any recompute, staleness flip, tile
 * add/remove or error changes the string. Clients poll this (visibility-gated,
 * 10–15s) and refetch tiles only when it moves — refresh cost scales with
 * data-change rate, not with viewers holding dashboards open.
 */
export async function resultsVersion(db: DB, orgId: string): Promise<string> {
  const [row] = await db
    .select({
      tiles: sql<number>`count(*)::int`,
      nonFresh: sql<number>`count(*) filter (where ${flowResults.status} <> 'fresh')::int`,
      maxComputedAt: sql<string | null>`max(${flowResults.computedAt})`,
    })
    .from(flowResults)
    .where(eq(flowResults.orgId, orgId));
  const maxMs = row?.maxComputedAt ? Date.parse(String(row.maxComputedAt)) : 0;
  /**
   * Import progress has to be part of this string, or the label it drives never
   * updates on an open dashboard.
   *
   * An import deepening from 12 days to 30 changes no `flow_results` column —
   * same tiles, same status, same `computed_at` — so the ETag would not move
   * and the poller would not refresh. The tile would sit on "covering 12 of 90"
   * until some unrelated recompute happened to bump it.
   *
   * BOTH ends of the reached range, because `reached_floor` moves BACKWARDS as an
   * import deepens. With two running jobs, `max` is pinned by whichever is
   * shallowest — so a deep import could reach further back every slice while this
   * aggregate never moved, and the label it exists to refresh would freeze on an
   * open dashboard. `min` tracks the deepening; `max` still catches a shallow job
   * advancing. The count catches an import starting or finishing.
   *
   * This is a CHANGE DETECTOR, not a displayed depth: any component moving is
   * enough, and none of these numbers is shown to anyone.
   */
  const [bf] = await db
    .select({
      running: sql<number>`count(*)::int`,
      maxReached: sql<string | null>`max(${backfillJobs.reachedFloor})`,
      minReached: sql<string | null>`min(${backfillJobs.reachedFloor})`,
    })
    .from(backfillJobs)
    .where(and(eq(backfillJobs.orgId, orgId), inArray(backfillJobs.status, ["queued", "running"])));
  const reachedMs = bf?.maxReached ? Date.parse(String(bf.maxReached)) : 0;
  const deepestMs = bf?.minReached ? Date.parse(String(bf.minReached)) : 0;
  return `${row?.tiles ?? 0}.${row?.nonFresh ?? 0}.${maxMs}.${bf?.running ?? 0}.${reachedMs}.${deepestMs}`;
}

/**
 * H.4 — recompute-skip. A tile whose freshly-computed value is byte-identical
 * to the stored one does not need its `computed_at` bumped… but it DOES, and
 * deliberately: the as-of marker is a statement about when the number was last
 * VERIFIED against the source, not when it last changed. What H.4 actually
 * skips is upstream: `reconcileChanged` gates staleness on real data changes,
 * so an unchanged sweep never marks anything stale and this function finds
 * nothing to do. The skip lives where the work originates, not here.
 */

/**
 * One recompute pass may hold its Inngest step this long. The serverless
 * ceiling is 60s (`maxDuration` in api/inngest/route.ts); the margin leaves
 * room for the work-list query and for the one flow allowed to START near the
 * deadline — the check runs between flows, so a single slow flow can overrun
 * its slice but the LOOP can no longer compound that across the fleet.
 */
const MATERIALIZE_BUDGET_MS = 45_000;

/**
 * Recompute flows that currently have stale results (scheduled + on-demand).
 *
 * `orgId` narrows the pass to one tenant, and the debounced recompute MUST
 * pass it: `recomputeStaleFlows` debounces and serializes per org
 * (`event.data.orgId`), and an unscoped body under a per-org key made both
 * halves of that config a lie — two orgs' events ran two concurrent fleet-wide
 * passes over the same rows, and "org A's burst collapses into one run" was
 * true while org A's run also recomputed every OTHER tenant's dashboards with
 * no lock against a sibling run doing the same. The nightly-style cron
 * backstop stays unscoped, which is its job.
 *
 * Longest-stale first, for the same reason `activeStreams` is LRU-first: the
 * budget below truncates the tail, and without an order that favours the
 * starved, the same tail is cut off every tick. A truncated flow keeps its old
 * `computed_at`, so the next pass sorts it ahead of everything just
 * recomputed; never-computed tiles (NULL) are the most starved of all.
 *
 * At least ONE flow always runs — a budget too small to matter must degrade to
 * slow progress, not to a stall that looks like a healthy no-op.
 */
/**
 * A published number ages even when no data arrives: "last 7 days" slides with
 * the clock, "this month" gains days, and data-driven staleness alone would
 * freeze such a tile at its last data change forever. Re-mark anything fresh
 * older than an hour so the cron behind this recomputes it — every tile's
 * "Updated N ago" is then bounded at roughly an hour, whatever its window.
 *
 * Only "fresh" rows: an "error" row recomputing on a timer would re-run a
 * known-broken flow every pass, and "stale"/"computing" are already in flight.
 */
const RESULT_MAX_AGE_MS = 60 * 60 * 1000;

export async function expireAgedResults(db: DB, maxAgeMs = RESULT_MAX_AGE_MS, orgId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const aged = and(eq(flowResults.status, "fresh"), lt(flowResults.computedAt, cutoff));
  const rows = await db
    .update(flowResults)
    .set({ status: "stale" })
    // Org-scoped when a per-tenant caller asks (the sweep): one org's sweep
    // must not write rows belonging to every other tenant.
    .where(orgId ? and(aged, eq(flowResults.orgId, orgId)) : aged)
    .returning({ flowId: flowResults.flowId });
  return rows.length;
}

export async function materializeStaleAll(
  db: DB,
  opts: { orgId?: string; budgetMs?: number } = {},
): Promise<{ recomputed: number; pending: number }> {
  const budgetMs = opts.budgetMs ?? MATERIALIZE_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const stale = await db
    .select({ orgId: flowResults.orgId, flowId: flowResults.flowId })
    .from(flowResults)
    .where(opts.orgId ? and(eq(flowResults.status, "stale"), eq(flowResults.orgId, opts.orgId)) : eq(flowResults.status, "stale"))
    .groupBy(flowResults.orgId, flowResults.flowId)
    .orderBy(sql`min(${flowResults.computedAt}) asc nulls first`, asc(flowResults.flowId));
  let recomputed = 0;
  for (const s of stale) {
    await materializeFlow(db, s.orgId, s.flowId);
    recomputed += 1;
    if (Date.now() >= deadline) break;
  }
  const pending = stale.length - recomputed;
  // A silent cap reads as "covered everything" when it didn't; the backstop
  // cron picks the tail up within 10 minutes, but the log must say there IS one.
  if (pending > 0) console.warn(`[materialize-truncated] budgetMs=${budgetMs} recomputed=${recomputed} pending=${pending}${opts.orgId ? ` org=${opts.orgId}` : ""}`);
  return { recomputed, pending };
}

async function upsertResult(
  db: DB,
  orgId: string,
  flowId: string,
  version: number,
  outputNodeId: string,
  tile: TileSpec,
  status: string,
  error: string | null,
  provenance?: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await db
    .insert(flowResults)
    .values({
      orgId,
      flowId,
      version,
      outputNodeId,
      tile: tile as unknown as Record<string, unknown>,
      status,
      error,
      provenance: provenance ?? null,
      computedAt: now,
    })
    .onConflictDoUpdate({
      target: [flowResults.flowId, flowResults.outputNodeId],
      set: { version, tile: tile as unknown as Record<string, unknown>, status, error, provenance: provenance ?? null, computedAt: now },
    });
}
