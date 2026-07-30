import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { backfillJobs, connections, flowResults, flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { hasStreamConfig, streamConfigHash } from "@/lib/sync/stream-hash";
import { runFlow, buildTile, type CompileProvenance } from "./engine";
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
    const { nodes, outputs } = await runFlow({ db, orgId, provenance }, graph);

    // Tiles come from Output nodes (legacy flows) and/or endpoint metrics chosen at
    // Review & publish (new flows) — one tile per enabled metric.
    const tiles: Array<{ nodeId: string; tile: TileSpec }> = outputs.map((o) => ({ nodeId: o.nodeId, tile: o.tile }));
    for (const m of graph.metrics) {
      if (!m.enabled) continue;
      const ex = nodes.get(m.nodeId);
      if (ex && ex.status === "ok") tiles.push({ nodeId: m.nodeId, tile: buildTile(m, ex.shape, ex.sample) });
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
    // Drop results for tiles that no longer exist in the published flow.
    const keep = tiles.map((t) => t.nodeId);
    await db
      .delete(flowResults)
      .where(keep.length ? and(eq(flowResults.flowId, flowId), notInArray(flowResults.outputNodeId, keep)) : eq(flowResults.flowId, flowId));
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
    const graph = parseGraph(ver.graph);
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

/** Recompute every flow that currently has stale results (scheduled + on-demand). */
export async function materializeStaleAll(db: DB): Promise<number> {
  const stale = await db
    .selectDistinct({ orgId: flowResults.orgId, flowId: flowResults.flowId })
    .from(flowResults)
    .where(eq(flowResults.status, "stale"));
  for (const s of stale) await materializeFlow(db, s.orgId, s.flowId);
  return stale.length;
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
