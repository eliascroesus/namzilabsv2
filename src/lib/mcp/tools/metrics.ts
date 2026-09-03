import { z } from "zod";
import { publishedFlowTiles, unpublishedFlowIds, calendarFlowTiles } from "@/lib/flow/materialize";
import { listFlowNames } from "@/lib/flow/store";
import { listMetrics, getMetric } from "@/lib/metrics/store";
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
  /** A classic metric's `display` (number|trend|bar|funnel — a CHART SHAPE, see `vizOf`). */
  display?: string;
  /** A classic metric's own `unit` column (flows read `tile.unit` directly instead). */
  unit?: string | null;
  dashboardUrl: string;
};

/**
 * A flow tile carries a genuine NUMBER FORMAT (number|percent|currency|
 * duration). A classic metric's only stored vocabulary is `display`
 * (number|trend|bar|funnel) — a CHART SHAPE, not a number format, and the
 * dashboard always renders a classic headline as a plain number — so classic
 * answers "number" unconditionally here. `display` surfaces for real under
 * `viz` (see `vizOf`), which is where a caller actually learns the chart shape.
 */
export function formatOf(e: CatalogEntry): string | null {
  return e.kind === "flow" ? ((e.tile?.format as string | undefined) ?? null) : "number";
}

/** Which chart shape backs this metric: a flow tile's own `viz`, or a classic metric's `display` — the same vocabulary under a different column name. */
export function vizOf(e: CatalogEntry): string | null {
  return e.kind === "flow" ? ((e.tile?.viz as string | undefined) ?? null) : (e.display ?? null);
}

/** A classic metric's `unit` column; a flow tile's lives on `tile.unit` directly. */
export function unitOf(e: CatalogEntry): string | null {
  return e.kind === "flow" ? ((e.tile?.unit as string | undefined) ?? null) : (e.unit ?? null);
}

type PublishedTileRow = Awaited<ReturnType<typeof publishedFlowTiles>>[number];
type ClassicMetricRow = Awaited<ReturnType<typeof listMetrics>>[number];

/** One flow-tile row, in `CatalogEntry` shape. Shared by the full catalog and the single-id path so the two can never disagree about what a row means. */
function flowEntryOf(t: PublishedTileRow, editedSincePublish: boolean, fallbackName: string): CatalogEntry {
  const id = tileKeyOfFlow(t.flowId, t.outputNodeId);
  const tile = (t.tile ?? null) as Record<string, unknown> | null;
  const streams = (t.provenance as { streams?: Array<{ connectionId?: string; source?: string }> } | null)?.streams ?? [];
  return {
    id,
    kind: "flow",
    flowId: t.flowId,
    outputNodeId: t.outputNodeId,
    name: (tile?.name as string) ?? fallbackName,
    tile,
    status: t.status,
    computedAt: t.computedAt,
    editedSincePublish,
    sources: [...new Set(streams.map((s) => s.source).filter((s): s is string => typeof s === "string"))],
    streams,
    dashboardUrl: `${APP()}/dashboard/flows/${t.flowId}`,
  };
}

/** One classic-metric row, in `CatalogEntry` shape. Shared the same way as `flowEntryOf`. */
function classicEntryOf(m: ClassicMetricRow): CatalogEntry {
  const def = m.definition as Record<string, unknown>;
  return {
    id: tileKeyOfMetric(m.id),
    kind: "classic",
    metricId: m.id,
    name: m.name,
    editedSincePublish: false,
    sources: typeof def.source === "string" ? [def.source] : [],
    streams: [],
    definition: def,
    display: m.display,
    unit: m.unit,
    dashboardUrl: `${APP()}/dashboard/metrics/${m.id}`,
  };
}

/**
 * Every metric on the workspace's dashboard, flow tiles and classic metrics
 * together, filtered to what the caller's rank may see. Used by `list_metrics`
 * ONLY — a question about every metric genuinely needs every row. `get_metric`
 * and `get_metric_days` ask about exactly one id and use `entryFor` below
 * instead, which costs one row read rather than this whole-org catalog.
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
  for (const t of tiles) out.push(flowEntryOf(t, edited.has(t.flowId), nameOf.get(t.flowId) ?? "Untitled"));
  for (const m of classic) out.push(classicEntryOf(m));
  return out.filter((e) => {
    const k = visibilityKeyOf(e.id);
    return k ? ctx.access.canSeeMetric(k) : false;
  });
}

/** `flow:<flowId>:<outputNodeId>` or `metric:<metricId>`, parsed — the inverse of `tileKeyOfFlow`/`tileKeyOfMetric`. */
function parseTileId(id: string): { kind: "flow"; flowId: string; outputNodeId: string } | { kind: "classic"; metricId: string } | null {
  const flow = /^flow:([^:]+):(.+)$/.exec(id);
  if (flow) return { kind: "flow", flowId: flow[1], outputNodeId: flow[2] };
  if (/^metric:.+$/.test(id)) return { kind: "classic", metricId: id.slice("metric:".length) };
  return null;
}

/**
 * The visible entry for exactly ONE id, at the cost of one row read — not
 * `metricCatalog`'s four whole-org queries. Permission is checked BEFORE any
 * tile or metric row is fetched: a hidden id costs nothing beyond parsing the
 * string and one `canSeeMetric` check.
 *
 * `editedSincePublish` and a flow's own stored name (the `unpublishedFlowIds`
 * / `listFlowNames` whole-org reads) are not computed here — neither
 * `get_metric` nor `get_metric_days` ever return them, and fetching either
 * would reintroduce the whole-org cost this function exists to avoid.
 */
async function entryFor(ctx: McpCallContext, id: string): Promise<CatalogEntry | null> {
  const visKey = visibilityKeyOf(id);
  if (!visKey || !ctx.access.canSeeMetric(visKey)) return null;
  const parsed = parseTileId(id);
  if (!parsed) return null;
  if (parsed.kind === "classic") {
    const m = await getMetric(ctx.orgId, parsed.metricId);
    return m ? classicEntryOf(m) : null;
  }
  const tiles = await publishedFlowTiles(ctx.db, ctx.orgId, { flowId: parsed.flowId });
  const t = tiles.find((r) => r.outputNodeId === parsed.outputNodeId);
  return t ? flowEntryOf(t, false, "Untitled") : null;
}

/** The one calendar tile a flow-scoped read needs — shared by `get_metric`'s day branch and `get_metric_days`. */
async function calendarTileFor(ctx: McpCallContext, flowId: string | undefined, outputNodeId: string | undefined) {
  if (!flowId || !outputNodeId) return null;
  const tiles = await calendarFlowTiles(ctx.db, ctx.orgId, { flowId });
  return tiles.find((t) => t.outputNodeId === outputNodeId) ?? null;
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
        viz: z.string().nullable(),
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
        viz: vizOf(e),
        unit: unitOf(e),
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

/**
 * A flow tile's groups turned into ordered funnel stages, mirroring
 * `computeFunnel` (src/lib/metrics/compute.ts) on all three points a classic
 * funnel already follows: the bottleneck is the stage with the LARGEST
 * ABSOLUTE DROP from the one before it (not the smallest conversion ratio);
 * `conversionFromPrev` is 0, not null, when the previous stage's count was 0;
 * and with fewer than two stages there is no drop to compare, so the
 * bottleneck stays null. One definition of "worst stage", not two.
 */
function funnelStagesOf(groups: Array<{ label: string; value: number }>): {
  stages: Array<{ label: string; count: number; conversionFromPrev: number }>;
  bottleneckIndex: number | null;
} {
  let bottleneckIndex: number | null = null;
  let worstDrop = -1;
  const stages = groups.map((g, i) => {
    const prev = i === 0 ? g.value : groups[i - 1].value;
    if (i > 0) {
      const drop = groups[i - 1].value - g.value;
      if (drop > worstDrop) {
        worstDrop = drop;
        bottleneckIndex = i;
      }
    }
    return { label: g.label, count: g.value, conversionFromPrev: prev > 0 ? g.value / prev : 0 };
  });
  return { stages, bottleneckIndex };
}

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
      // The zod `.refine` above is enforced by this handler's own caller in
      // tests, but an MCP SDK need not run zod refinements at all — so the
      // same rule is re-checked here, before any read, rather than trusted.
      if (args.range && args.day) return fail("Give either range or day, not both.");

      const e = await entryFor(ctx, args.id);
      if (!e) return fail("That isn't a metric you can see in this workspace; call list_metrics for the ids.");
      const base = {
        workspace: { id: ctx.orgId, name: ctx.workspaceName },
        id: e.id,
        name: e.name,
        kind: e.kind,
        format: formatOf(e),
        viz: vizOf(e),
        unit: unitOf(e),
        currency: (e.tile?.currency as string) ?? null,
        dashboardUrl: e.dashboardUrl,
        asOf: new Date().toISOString(),
      };

      if (e.kind === "flow") {
        const tile = e.tile ?? {};
        if (args.day) {
          const cal = await calendarTileFor(ctx, e.flowId, e.outputNodeId);
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
        // THE DASHBOARD'S OWN RULE (src/components/flow-tile.tsx,
        // `tileValueForRange`): an unavailable slot means null, full stop —
        // no fallback to the tile's top-level value, even for "all". Every
        // number that does come back is checked with `Number.isFinite`, the
        // same guard the dashboard applies, so a malformed stored value never
        // reaches a caller as if it were real.
        const rawValue = slot.unavailable ? undefined : ((slot.value as number | undefined) ?? (range === "all" ? (tile.value as number | undefined) : undefined));
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
        // The tile's top-level `groups` is the ALL-TIME breakdown: it stands
        // in only for range "all", exactly like `value` and `series` do. A
        // narrower range with no `byRange[range].groups` of its own has no
        // breakdown at all — it must NOT borrow the all-time one.
        const groupsAll =
          (slot.groups as Array<{ label: string; value: number }> | undefined) ?? (range === "all" ? (tile.groups as Array<{ label: string; value: number }> | undefined) : undefined);
        const groups = args.includeGroups && groupsAll ? [...groupsAll].sort((a, b) => b.value - a.value).slice(0, 100) : undefined;
        const funnel = tile.viz === "funnel" && groupsAll ? funnelStagesOf(groupsAll) : undefined;
        const partial: Record<string, unknown> = {};
        if (groupsAll && groupsAll.length > 100 && groups) partial.groupsOmitted = groupsAll.length - 100;
        // A stored series is capped to its most recent 400 buckets for
        // transport, the same marker the classic path uses below — a flow
        // tile's series (the calendar-derived trend, or a bucketed metric's
        // own) is otherwise unbounded and would ride uncapped on every call.
        let series: Array<{ bucket: string; value: number }> | undefined;
        if (args.includeSeries) {
          series = (slot.series as Array<{ bucket: string; value: number }> | undefined) ?? (range === "all" ? (tile.series as Array<{ bucket: string; value: number }> | undefined) : undefined);
          if (series && series.length > 400) {
            partial.truncated = true;
            partial.keptBuckets = 400;
            partial.totalBuckets = series.length;
            series = series.slice(-400);
          }
        }
        return ok({
          ...base,
          range,
          value,
          unavailable: slot.unavailable,
          undated: slot.undated,
          includesFutureDated: true,
          series,
          groups,
          stages: funnel?.stages,
          bottleneckIndex: funnel ? funnel.bottleneckIndex : undefined,
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

export const getMetricDaysTool = {
  name: "get_metric_days",
  title: "Get metric by day",
  description: describe(
    "Returns a flow metric's value for each calendar day between two dates (at most 62 days), from the calendar store, so day-over-day and week-over-week comparisons are simple arithmetic. Days with no stored value are listed under missing.",
  ),
  inputSchema: z.object({ id: z.string().min(1), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  outputSchema: z.object({}).passthrough(),
  handler: withToolContext<{ id: string; from: string; to: string }>("get_metric_days", {}, async (ctx, args) => {
    const e = await entryFor(ctx, args.id);
    if (!e) return fail("That isn't a metric you can see in this workspace; call list_metrics for the ids.");
    if (e.kind !== "flow") return fail("Classic metrics have no per-day store; ask get_metric for a range instead.");
    const from = Date.parse(`${args.from}T00:00:00Z`);
    const to = Date.parse(`${args.to}T00:00:00Z`);
    if (!(from <= to) || (to - from) / 86_400_000 > 61) return fail("Give a from and to at most 62 days apart, from before to.");
    const cal = await calendarTileFor(ctx, e.flowId, e.outputNodeId);
    const byDay = (cal?.tile as { byDay?: Record<string, { value: number }> } | null)?.byDay ?? {};
    const days: Array<{ day: string; value: number }> = [];
    const missing: string[] = [];
    for (let t = from; t <= to; t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (byDay[d]) days.push({ day: d, value: byDay[d].value });
      else missing.push(d);
    }
    return ok({
      workspace: { id: ctx.orgId, name: ctx.workspaceName },
      id: e.id,
      name: e.name,
      days,
      missing,
      rows: days.length,
      computedAt: cal?.computedAt?.toISOString() ?? null,
      dashboardUrl: e.dashboardUrl,
    });
  }),
};
