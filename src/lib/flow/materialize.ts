import { and, eq, notInArray } from "drizzle-orm";
import { flowResults, flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { runFlow } from "./engine";
import { getPublishedVersion } from "./store";
import { parseGraph, type TileSpec } from "./types";

/**
 * Compute the published version's Output results and store them in flow_results
 * (fast dashboard reads). Runs on publish, on a manual refresh, or when relevant
 * data changes. Never blocks the dashboard render.
 */
export async function materializeFlow(db: DB, orgId: string, flowId: string): Promise<void> {
  const published = await getPublishedVersion(db, orgId, flowId);
  if (!published) return;
  const { version, graph } = published;

  try {
    const { outputs } = await runFlow({ db, orgId }, graph);
    for (const o of outputs) {
      await upsertResult(db, orgId, flowId, version, o.nodeId, o.tile, "fresh", null);
    }
    // Drop results for Output nodes that no longer exist in the published flow.
    const keep = outputs.map((o) => o.nodeId);
    await db
      .delete(flowResults)
      .where(keep.length ? and(eq(flowResults.flowId, flowId), notInArray(flowResults.outputNodeId, keep)) : eq(flowResults.flowId, flowId));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(flowResults).set({ status: "error", error: message }).where(eq(flowResults.flowId, flowId));
  }
}

/** Mark a published flow's stored results stale (e.g. when new events land). */
export async function markFlowStale(db: DB, flowId: string): Promise<void> {
  await db.update(flowResults).set({ status: "stale" }).where(eq(flowResults.flowId, flowId));
}

/**
 * Mark stale every published flow whose graph pulls from `source` (or the given
 * connection). Called when new data lands so the dashboard shows freshness and a
 * later recompute refreshes only what changed.
 */
export async function markStaleForSource(db: DB, orgId: string, source: string, connectionId?: string | null): Promise<string[]> {
  const published = await db.select().from(flows).where(and(eq(flows.orgId, orgId), eq(flows.status, "published")));
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
      const c = (n.data.config ?? {}) as { source?: string; connectionId?: string };
      return c.source === source || (connectionId != null && c.connectionId === connectionId);
    });
    if (uses) {
      await db.update(flowResults).set({ status: "stale" }).where(eq(flowResults.flowId, f.id));
      affected.push(f.id);
    }
  }
  return affected;
}

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
): Promise<void> {
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
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [flowResults.flowId, flowResults.outputNodeId],
      set: { version, tile: tile as unknown as Record<string, unknown>, status, error, computedAt: new Date() },
    });
}
