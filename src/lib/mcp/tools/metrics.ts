import { z } from "zod";
import { publishedFlowTiles, unpublishedFlowIds } from "@/lib/flow/materialize";
import { listFlowNames } from "@/lib/flow/store";
import { listMetrics } from "@/lib/metrics/store";
import { tileKeyOfFlow, tileKeyOfMetric, visibilityKeyOf } from "@/lib/board/types";
import { withToolContext, type McpCallContext } from "@/lib/mcp/context";
import { describe, ok } from "@/lib/mcp/result";

const APP = () => (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");

export type CatalogEntry = {
  id: string;
  name: string;
  kind: "flow" | "classic";
  flowId?: string;
  outputNodeId?: string;
  metricId?: string;
  tile?: Record<string, unknown> | null;
  status?: string;
  computedAt?: Date | null;
  editedSincePublish: boolean;
  sources: string[];
  definition?: Record<string, unknown>;
  display?: string;
  dashboardUrl: string;
};

/** Flow tiles carry `format`; classic metrics carry `display` (number, currency, percent…). Both answer `format`. */
export function formatOf(e: CatalogEntry): string | null {
  return e.kind === "flow" ? ((e.tile?.format as string | undefined) ?? null) : (e.display ?? null);
}

/**
 * Every metric on the workspace's dashboard, flow tiles and classic metrics
 * together, filtered to what the caller's rank may see. Shared by all three
 * metric tools so `list_metrics`, `get_metric` and `get_metric_days` agree on
 * exactly which ids exist and which are visible.
 */
export async function metricCatalog(ctx: McpCallContext): Promise<CatalogEntry[]> {
  const [tiles, edited, names, classic] = await Promise.all([
    publishedFlowTiles(ctx.db, ctx.orgId),
    unpublishedFlowIds(ctx.db, ctx.orgId),
    listFlowNames(ctx.db, ctx.orgId),
    listMetrics(ctx.orgId),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const out: CatalogEntry[] = [];
  for (const t of tiles) {
    const id = tileKeyOfFlow(t.flowId, t.outputNodeId);
    const tile = (t.tile ?? null) as Record<string, unknown> | null;
    const streams = (t.provenance as { streams?: Array<{ connectionId?: string; source?: string }> } | null)?.streams ?? [];
    out.push({
      id,
      kind: "flow",
      flowId: t.flowId,
      outputNodeId: t.outputNodeId,
      name: (tile?.name as string) ?? nameOf.get(t.flowId) ?? "Untitled",
      tile,
      status: t.status,
      computedAt: t.computedAt,
      editedSincePublish: edited.has(t.flowId),
      sources: [...new Set(streams.map((s) => s.source).filter((s): s is string => typeof s === "string"))],
      dashboardUrl: `${APP()}/dashboard/flows/${t.flowId}`,
    });
  }
  for (const m of classic) {
    const def = m.definition as Record<string, unknown>;
    out.push({
      id: tileKeyOfMetric(m.id),
      kind: "classic",
      metricId: m.id,
      name: m.name,
      editedSincePublish: false,
      sources: typeof def.source === "string" ? [def.source] : [],
      definition: def,
      display: m.display,
      dashboardUrl: `${APP()}/dashboard/metrics/${m.id}`,
    });
  }
  return out.filter((e) => {
    const k = visibilityKeyOf(e.id);
    return k ? ctx.access.canSeeMetric(k) : false;
  });
}

export const listMetricsTool = {
  name: "list_metrics",
  title: "List metrics",
  description: describe(
    "Lists every metric on this workspace's dashboard that you may see, with its id (use it in get_metric), format, sources, freshness and current headline. Flow metrics are precomputed; classic metrics show no headline until you call get_metric.",
  ),
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({
    workspace: z.object({ id: z.string(), name: z.string() }),
    asOf: z.string(),
    metrics: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(["flow", "classic"]),
        format: z.string().nullable(),
        unit: z.string().nullable(),
        currency: z.string().nullable(),
        sources: z.array(z.string()),
        status: z.string().nullable(),
        computedAt: z.string().nullable(),
        headline: z.number().nullable(),
        editedSincePublish: z.boolean(),
        dashboardUrl: z.string(),
      }),
    ),
  }),
  handler: withToolContext<Record<string, never>>("list_metrics", {}, async (ctx) => {
    const cat = await metricCatalog(ctx);
    return ok({
      workspace: { id: ctx.orgId, name: ctx.workspaceName },
      asOf: new Date().toISOString(),
      metrics: cat.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        format: formatOf(e),
        unit: (e.tile?.unit as string) ?? null,
        currency: (e.tile?.currency as string) ?? null,
        sources: e.sources,
        status: e.status ?? null,
        computedAt: e.computedAt ? e.computedAt.toISOString() : null,
        headline: e.kind === "flow" ? ((e.tile?.byRange as Record<string, { value?: number }> | undefined)?.all?.value ?? (e.tile?.value as number) ?? null) : null,
        editedSincePublish: e.editedSincePublish,
        dashboardUrl: e.dashboardUrl,
      })),
      rows: cat.length,
    });
  }),
};
