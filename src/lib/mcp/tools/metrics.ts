import { z } from "zod";
import { publishedFlowTiles, unpublishedFlowIds, calendarFlowTiles } from "@/lib/flow/materialize";
import { listFlowNames } from "@/lib/flow/store";
import { listMetrics } from "@/lib/metrics/store";
import { computeAggregate, computeFunnel } from "@/lib/metrics/compute";
import { resolveRange } from "@/lib/metrics/range";
import { parseDefinition } from "@/lib/metrics/types";
import { tileKeyOfFlow, tileKeyOfMetric, visibilityKeyOf } from "@/lib/board/types";
import { withToolContext, type McpCallContext } from "@/lib/mcp/context";
import { describe, fail, ok } from "@/lib/mcp/result";

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
  /**
   * The raw stream refs this number was computed from (flow tiles only;
   * classic metrics carry none). `get_metric`'s provenance reads THIS, not
   * `tile.provenance` — `flow_results.provenance` is its own database column,
   * never nested inside the `tile` jsonb, so a lookup at `tile.provenance`
   * would always answer undefined.
   */
  streams: Array<{ connectionId?: string; source?: string }>;
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
      streams,
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
      streams: [],
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

const RANGES = ["today", "yesterday", "7d", "30d", "90d", "all"] as const;

export const getMetricTool = {
  name: "get_metric",
  title: "Get metric",
  description: describe(
    "Returns one metric for a range (today, yesterday, 7d, 30d, 90d, all; default 30d) or for a single day (YYYY-MM-DD), with the value, optional series and groups, funnel stages when the metric is a funnel, and provenance. Flow metrics come from stored results and their \"all\" includes future-dated meetings; classic metrics are computed now and their \"all\" ends tonight.",
  ),
  inputSchema: z
    .object({
      id: z.string().min(1),
      range: z.enum(RANGES).optional(),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      includeSeries: z.boolean().optional(),
      includeGroups: z.boolean().optional(),
    })
    .strict()
    .refine((v) => !(v.range && v.day), { message: "Give either range or day, not both." }),
  outputSchema: z.object({}).passthrough(),
  handler: withToolContext<{ id: string; range?: (typeof RANGES)[number]; day?: string; includeSeries?: boolean; includeGroups?: boolean }>(
    "get_metric",
    {},
    async (ctx, args) => {
      const cat = await metricCatalog(ctx);
      const e = cat.find((c) => c.id === args.id);
      if (!e) return fail("That isn't a metric you can see in this workspace; call list_metrics for the ids.");
      const base = {
        workspace: { id: ctx.orgId, name: ctx.workspaceName },
        id: e.id,
        name: e.name,
        kind: e.kind,
        format: formatOf(e),
        unit: (e.tile?.unit as string) ?? null,
        currency: (e.tile?.currency as string) ?? null,
        dashboardUrl: e.dashboardUrl,
        asOf: new Date().toISOString(),
      };

      if (e.kind === "flow") {
        const tile = e.tile ?? {};
        if (args.day) {
          const cal = (await calendarFlowTiles(ctx.db, ctx.orgId)).find((t) => t.flowId === e.flowId && t.outputNodeId === e.outputNodeId);
          const slot = ((cal?.tile as { byDay?: Record<string, { value: number }> } | null)?.byDay ?? {})[args.day];
          return ok({
            ...base,
            day: args.day,
            value: slot?.value ?? null,
            unavailable: slot ? undefined : "No stored value for that day.",
            includesFutureDated: true,
            computedAt: e.computedAt?.toISOString() ?? null,
            provenance: { streams: e.streams, engine: "stored" },
          });
        }
        const range = args.range ?? "30d";
        const slot = ((tile.byRange as Record<string, Record<string, unknown>> | undefined) ?? {})[range] ?? {};
        // The tile's top-level `groups` is the ALL-TIME breakdown: it stands
        // in only for range "all", exactly like `value` and `series` do. A
        // narrower range with no `byRange[range].groups` of its own has no
        // breakdown at all — it must NOT borrow the all-time one.
        const groupsAll =
          (slot.groups as Array<{ label: string; value: number }> | undefined) ?? (range === "all" ? (tile.groups as Array<{ label: string; value: number }> | undefined) : undefined);
        const groups = args.includeGroups && groupsAll ? [...groupsAll].sort((a, b) => b.value - a.value).slice(0, 100) : undefined;
        const stages =
          tile.viz === "funnel" && groupsAll
            ? groupsAll.map((g, i, arr) => ({ label: g.label, count: g.value, conversionFromPrev: i === 0 ? 1 : arr[i - 1].value > 0 ? g.value / arr[i - 1].value : null }))
            : undefined;
        const partial: Record<string, unknown> = {};
        if (groupsAll && groupsAll.length > 100 && groups) partial.groupsOmitted = groupsAll.length - 100;
        return ok({
          ...base,
          range,
          value: (slot.value as number) ?? (range === "all" ? ((tile.value as number) ?? null) : null),
          unavailable: slot.unavailable,
          undated: slot.undated,
          includesFutureDated: true,
          series: args.includeSeries ? ((slot.series as unknown[]) ?? (range === "all" ? (tile.series as unknown[]) : undefined)) : undefined,
          groups,
          stages,
          bottleneckIndex: stages
            ? stages.reduce((worst, s, i) => (i > 0 && (s.conversionFromPrev ?? 1) < (stages[worst].conversionFromPrev ?? 1) ? i : worst), 0)
            : undefined,
          partial: Object.keys(partial).length ? partial : undefined,
          status: e.status,
          computedAt: e.computedAt?.toISOString() ?? null,
          provenance: { streams: e.streams, engine: "stored" },
        });
      }

      if (args.day) return fail("Classic metrics have no per-day store; ask for a range instead.");
      const { key, range } = resolveRange(args.range ?? "30d");
      const parsed = parseDefinition(e.definition);
      if (parsed.kind === "funnel") {
        const f = await computeFunnel(ctx.db, ctx.orgId, parsed, range);
        return ok({
          ...base,
          range: key,
          value: f.stages[0]?.count ?? null,
          stages: f.stages.map((s) => ({ label: s.label, count: s.count, conversionFromPrev: s.conversionFromPrev })),
          bottleneckIndex: f.bottleneckIndex,
          includesFutureDated: false,
          provenance: { streams: [], engine: "classic" },
        });
      }
      const a = await computeAggregate(ctx.db, ctx.orgId, parsed, range);
      // THE SAME NUMBER THE DASHBOARD DRILL-IN SHOWS
      // (src/app/dashboard/metrics/[id]/page.tsx): a scalar result IS the
      // value; a bucketed series' value is the sum over EVERY bucket the
      // query returned. That sum is taken BEFORE the 400-bucket cap below —
      // never over the (possibly shorter) slice this tool actually returns
      // under `series` — or a metric with a long history would silently
      // report a partial sum that disagreed with its own dashboard page.
      const fullSeries = a.kind === "series" ? a.series : undefined;
      const value = a.kind === "scalar" ? a.value : fullSeries ? fullSeries.reduce((s, b) => s + b.value, 0) : null;
      let series = fullSeries;
      let partial: Record<string, unknown> | undefined;
      if (series && series.length > 400) {
        partial = { truncated: true, keptBuckets: 400, totalBuckets: series.length };
        series = series.slice(-400);
      }
      return ok({
        ...base,
        range: key,
        value,
        series: args.includeSeries ? series : undefined,
        partial,
        includesFutureDated: false,
        provenance: { streams: [], engine: "classic" },
      });
    },
  ),
};
