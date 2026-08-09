import { z } from "zod";
import { catalogEntry, fieldAppliesToEventType } from "@/connectors/catalog";

/**
 * All node types in the builder. Three former types no longer exist and are
 * migrated on load by {@link parseGraph}:
 *  - "combine"   → de-duplication now lives ON the Get data step (a checkbox);
 *                  stored combine nodes become pass-through Filters.
 *  - "formatter" → date cleanup is automatic on the backend (normalize-dates);
 *                  stored formatter nodes become pass-through Filters.
 *  - "aggregate" (Count) → merged into "formula" (Calculate), which now also
 *                  aggregates records (count/sum/avg/min/max) directly.
 */
export const NODE_TYPES = [
  "app",
  "filter",
  "output",
  "paths",
  // Unite is the opposite of Split into paths: it joins several lanes (branches,
  // extra data sources) back into ONE line, so every later step can use all of
  // their records and fields.
  "unite",
  "group",
  "formula",
  "time",
  // Time between pairs two record types per key (a lead and its first call)
  // and emits one record per match carrying the gap as a real numeric field —
  // the primitive that makes speed-to-lead computable. New graphs only.
  "time_between",
  // "calculate" is the legacy merged node; it remains in the engine so existing
  // flows keep loading/running unchanged (hidden from the picker).
  "calculate",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Plain-English step names — the ONLY vocabulary user-facing messages may
 * use for a node type. Lives here (not in components) so lib-level
 * validation can speak it; node-meta's picker labels stay in sync by test.
 */
export const NODE_LABELS: Record<NodeType, string> = {
  app: "Get data",
  filter: "Filter records",
  output: "Show on dashboard",
  paths: "Split into paths",
  unite: "Combine data",
  group: "Group into categories",
  formula: "Calculate",
  time: "Date range",
  time_between: "Time between",
  calculate: "Calculate a number",
};

// ---------- Filter ----------
export const FLOW_FILTER_OPS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "lt",
  "gte",
  "lte",
  "is_empty",
  "is_not_empty",
  "is_one_of",
  "is_not_one_of",
  "before",
  "after",
  "between",
] as const;
export type FlowFilterOp = (typeof FLOW_FILTER_OPS)[number];

/** Human-readable operator names shown in the builder (never the raw keys). */
export const FILTER_OP_LABELS: Record<FlowFilterOp, string> = {
  equals: "Exactly matches",
  not_equals: "Does not match",
  contains: "Contains",
  not_contains: "Does not contain",
  starts_with: "Starts with",
  ends_with: "Ends with",
  gt: "Greater than",
  lt: "Less than",
  gte: "Greater than or equal",
  lte: "Less than or equal",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
  is_one_of: "Is one of",
  is_not_one_of: "Is not one of",
  before: "Before (date)",
  after: "After (date)",
  between: "Between (dates)",
};

/** Operators that take no value input (the value box is hidden for these). */
export const NO_VALUE_FILTER_OPS: FlowFilterOp[] = ["is_empty", "is_not_empty"];

/** How a comparison value is supplied: a literal, or a mapped upstream field. */
const VALUE_KINDS = ["fixed", "field"] as const;

export const FilterRuleSchema = z.object({
  field: z.string().min(1),
  op: z.enum(FLOW_FILTER_OPS),
  value: z.string().default(""),
  value2: z.string().optional(), // for "between"
  /**
   * Dynamic value mapping (Zapier-style). Defaults keep every pre-existing rule a
   * fixed literal, so old graphs are byte-for-byte unchanged.
   */
  valueKind: z.enum(VALUE_KINDS).default("fixed"),
  /** When valueKind === "field": the upstream field path resolved per-record at runtime. */
  valueField: z.string().optional(),
});
/**
 * A prominent "Date range" quick section lives inside Filter (a time window is a
 * condition, not a separate concept). Internally it reuses the Time executor's
 * window logic. The standalone Time node remains available under advanced steps.
 */
export const FilterDateRangeSchema = z.object({
  enabled: z.boolean().default(false),
  dateField: z.string().default("occurredAt"),
  mode: z.enum(["preset", "rolling", "between"]).default("preset"),
  preset: z.string().default("last_30_days"),
  days: z.number().int().positive().default(30),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const FilterConfigSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  rules: z.array(FilterRuleSchema).default([]),
  dateRange: FilterDateRangeSchema.optional(),
});
export type FilterConfig = z.infer<typeof FilterConfigSchema>;

// ---------- App ----------
export const AppConfigSchema = z.object({
  connectionId: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  eventType: z.string().nullable().default(null),
  /**
   * Flow-level resource selection (which spreadsheet + tab, which calendar…).
   * The connection holds only auth; this config identifies the synced stream the
   * step reads (events tagged with its hash). Empty for connection-scoped sources.
   */
  sourceConfig: z.record(z.string(), z.unknown()).default({}),
  /**
   * Remove duplicates at the source: the FIRST thing that happens to loaded
   * records, before any later step runs. Records sharing the same `dedupeField`
   * value collapse to the newest one; records with an empty value always pass
   * (they can't be duplicates of anything). Replaces the old Combine node.
   */
  dedupe: z.boolean().default(false),
  dedupeField: z.string().default("subject"),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
// (identityField, an M1 leftover nothing read, was removed from AppConfigSchema —
// zod strips it from any stored config on parse, so old graphs are unaffected.)

// ---------- Aggregate ----------
export const AGGREGATIONS = ["count", "count_distinct", "sum", "avg", "median", "min", "max"] as const;
export const TIME_UNITS = ["day", "week", "month", "quarter", "year"] as const;

const GroupBySchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("time"), unit: z.enum(TIME_UNITS) }),
    z.object({ type: z.literal("field"), field: z.string().min(1) }),
  ])
  .nullable()
  .default(null);

// Not a node type anymore — kept (unexported) to type the shared aggregate machinery.
const AggregateConfigSchema = z.object({
  aggregation: z.enum(AGGREGATIONS).default("count"),
  field: z.string().default("value"),
  distinctField: z.string().default("subject"),
  groupBy: GroupBySchema,
});
export type AggregateConfig = z.infer<typeof AggregateConfigSchema>;

// ---------- Output ----------
export const VIZ_TYPES = ["number", "line", "bar", "category", "table", "progress", "funnel"] as const;
export const OutputConfigSchema = z.object({
  name: z.string().default("Untitled metric"),
  description: z.string().optional(),
  viz: z.enum(VIZ_TYPES).default("number"),
  format: z.enum(["number", "percent", "currency"]).default("number"),
  unit: z.string().optional(),
  currency: z.string().default("USD"),
  precision: z.number().int().min(0).max(6).default(0),
  target: z.number().nullable().default(null),
});
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

// ---------- Time (advanced) ----------
export const TIME_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "last_365_days",
] as const;
export const TimeConfigSchema = z.object({
  dateField: z.string().default("occurredAt"),
  mode: z.enum(["preset", "between", "rolling"]).default("preset"),
  preset: z.enum(TIME_PRESETS).default("last_30_days"),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.number().int().positive().default(30),
});
export type TimeConfig = z.infer<typeof TimeConfigSchema>;

// ---------- Time between ----------
export const TIME_BETWEEN_UNITS = ["seconds", "minutes", "hours", "days"] as const;
/**
 * Pairs two record types PER KEY and measures the gap. For each distinct
 * value of `keyField`: take the earliest `fromType` record, then the first
 * `toType` record at-or-after it (`mode: "first"`) or the latest (`"last"`);
 * unmatched keys emit nothing. The result is one record per match with the
 * duration as a plain number in `unit` — which is the entire trick: the
 * engine's aggregates already know how to average a number, they just never
 * had a duration to chew on (dates are not numbers anywhere else).
 */
export const TimeBetweenConfigSchema = z.object({
  keyField: z.string().default(""),
  /**
   * Which records start the clock, and which stop it — the SAME condition
   * model Filter, Paths and Group use, evaluated by the same `evalRules`.
   *
   * This was two bespoke record-type dropdowns comparing `eventType`
   * directly, the last place in the engine that addressed data by raw column
   * instead of by picked variable. Conditions also make things sayable that
   * a type list never could: "the first OUTBOUND call", "moved to Won".
   *
   * Named start/end, not from/to: `from`/`to` already mean ISO date bounds
   * in TimeConfigSchema and FilterDateRangeSchema.
   */
  start: FilterConfigSchema.default({ combinator: "and", rules: [] }),
  end: FilterConfigSchema.default({ combinator: "and", rules: [] }),
  mode: z.enum(["first", "last"]).default("first"),
  unit: z.enum(TIME_BETWEEN_UNITS).default("minutes"),
});
export type TimeBetweenConfig = z.infer<typeof TimeBetweenConfigSchema>;

// ---------- Formula / Calculate ----------
/**
 * The unified Calculate step. The first nine ops compare TWO NUMBERS (its a/b
 * inputs — wired steps or typed literals). The dataset ops (the former Count
 * node, merged in here) aggregate the RECORDS flowing in through the chain
 * edge instead — no numerator/denominator, just a field to aggregate.
 */
export const FORMULA_OPS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "percentage",
  "percent_change",
  "difference",
  "ratio",
  "average",
  // Dataset aggregations (across the records flowing in):
  "count",
  "count_distinct",
  "sum",
  "avg",
  "median",
  "min",
  "max",
] as const;

/** Ops that aggregate the incoming records (vs. comparing two numbers). */
export const DATASET_FORMULA_OPS = ["count", "count_distinct", "sum", "avg", "median", "min", "max"] as const;

/** Ops that read a NUMBER out of each record — every one needs a field picked. */
export const NUMERIC_FIELD_OPS = ["sum", "avg", "median", "min", "max"] as const;

/**
 * Which field pickers an aggregation needs on screen.
 *
 * ONE definition because there were four, hand-rolled, and three of them
 * were wrong: `median` was missing from every numeric list (so choosing it
 * offered no field and silently aggregated the default `value` — null on
 * paired records, i.e. a confident 0), and both category panels offered
 * `count_distinct` with nowhere to say what "distinct" meant.
 */
export function aggregationInputs(op: string): { numberField: boolean; distinctField: boolean } {
  return {
    numberField: (NUMERIC_FIELD_OPS as readonly string[]).includes(op),
    distinctField: op === "count_distinct",
  };
}
export function isDatasetFormulaOp(op: unknown): boolean {
  return (DATASET_FORMULA_OPS as readonly string[]).includes(String(op ?? ""));
}

export const FormulaConfigSchema = z.object({
  op: z.enum(FORMULA_OPS).default("percentage"),
  /** Typed-in literal numbers for the A/B inputs — used when no step is wired in. */
  aFixed: z.number().nullable().optional(),
  bFixed: z.number().nullable().optional(),
  // Dataset ops: which field to aggregate (sum/avg/min/max read numbers from it,
  // count_distinct counts its unique values), plus an optional time split.
  field: z.string().default("value"),
  distinctField: z.string().default("subject"),
  groupBy: GroupBySchema,
});
export type FormulaConfig = z.infer<typeof FormulaConfigSchema>;

// ---------- Group / Category (advanced) ----------
export const GroupConfigSchema = z.object({
  mode: z.enum(["field", "categories"]).default("field"),
  field: z.string().default("source"),
  aggregation: z.enum(["count", "sum", "count_distinct"]).default("count"),
  valueField: z.string().default("value"),
  distinctField: z.string().default("subject"),
  categories: z.array(z.object({ label: z.string().min(1), filters: FilterConfigSchema })).default([]),
  fallbackLabel: z.string().default("Other"),
});
export type GroupConfig = z.infer<typeof GroupConfigSchema>;

// ---------- Calculate (merged Aggregate + Formula + Group) ----------
export const CALC_MODES = ["number", "breakdown", "compare"] as const;
export type CalcMode = (typeof CALC_MODES)[number];

export const CalculateConfigSchema = z.object({
  mode: z.enum(CALC_MODES).default("number"),
  // number (aggregate): count/sum/avg/… with an optional time trend
  aggregation: z.enum(AGGREGATIONS).default("count"),
  field: z.string().default("value"),
  distinctField: z.string().default("subject"),
  groupBy: GroupBySchema,
  // breakdown (group): by a field or custom categories
  breakdownMode: z.enum(["field", "categories"]).default("field"),
  breakdownField: z.string().default("source"),
  categories: z.array(z.object({ label: z.string().min(1), filters: FilterConfigSchema })).default([]),
  fallbackLabel: z.string().default("Other"),
  // compare (formula): a rate/ratio/… over two numbers chosen as pills (handles a/b)
  op: z.enum(FORMULA_OPS).default("percentage"),
  /** Typed-in literal numbers for the A/B inputs — used when no step is wired in. */
  aFixed: z.number().nullable().optional(),
  bFixed: z.number().nullable().optional(),
});
export type CalculateConfig = z.infer<typeof CalculateConfigSchema>;

// ---------- Paths ----------
// New model: the hub just splits (fan-out); each branch is its own "Path conditions"
// step (a Filter). Legacy nodes carried per-path filters + a fallback — both optional
// here so old published flows keep routing exactly as before.
/**
 * How records enter one branch — set per branch (in its Path-conditions step), never
 * on the hub:
 *  - "custom": only records matching the branch's own conditions continue.
 *  - "always": every record continues down this branch.
 *  - "fallback": records that matched no custom branch's conditions continue here.
 */
export const PATH_MODES = ["custom", "always", "fallback"] as const;
export type PathMode = (typeof PATH_MODES)[number];

export const PathsConfigSchema = z.object({
  paths: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        mode: z.enum(PATH_MODES).default("custom"),
        filters: FilterConfigSchema.optional(), // legacy hubs stored conditions here
      }),
    )
    .default([]),
  // Legacy fallback lane (old hubs). New flows mark a branch with mode "fallback" instead.
  fallbackId: z.string().optional(),
  fallbackLabel: z.string().optional(),
});
export type PathsConfig = z.infer<typeof PathsConfigSchema>;

// ---------- Graph ----------
export const FlowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  data: z
    .object({
      config: z.unknown().default({}),
      label: z.string().optional(),
      lastTest: z.unknown().optional(),
    })
    .default({ config: {} }),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  target: z.string().min(1),
  targetHandle: z.string().nullable().optional(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

/**
 * The presentation of one published metric, chosen at "Review & publish". Each entry
 * targets a flow endpoint (a node with no next step) — so a flow with un-recombined
 * Paths branches can publish several metrics. Replaces the Output node for new flows;
 * old flows keep their Output nodes and simply have no metrics[] entries.
 */
export const MetricSpecSchema = z.object({
  nodeId: z.string().min(1),
  enabled: z.boolean().default(true),
  name: z.string().default("Untitled metric"),
  viz: z.enum(VIZ_TYPES).default("number"),
  format: z.enum(["number", "percent", "currency"]).default("number"),
  unit: z.string().optional(),
  currency: z.string().default("USD"),
  precision: z.number().int().min(0).max(6).default(0),
  target: z.number().nullable().default(null),
  /** Optional dashboard time axis for line/bar charts: which date field to bucket by. */
  timeField: z.string().optional(),
  timeUnit: z.enum(TIME_UNITS).default("month"),
});
export type MetricSpec = z.infer<typeof MetricSpecSchema>;

export const FlowGraphSchema = z.object({
  nodes: z.array(FlowNodeSchema).default([]),
  edges: z.array(FlowEdgeSchema).default([]),
  /** Per-endpoint published metrics (Review & publish). Empty for Output-node flows. */
  metrics: z.array(MetricSpecSchema).default([]),
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

/**
 * Migrate a stored graph from before the combine/formatter/aggregate removal.
 * Runs inside {@link parseGraph} — the single choke point every load path uses
 * (editor, publish, materializer) — so no stored flow ever fails to parse:
 *  - "aggregate" (Count) → "formula" with the matching dataset op (lossless:
 *    the unified Calculate runs the exact same aggregation, incl. time splits).
 *  - "combine" / "formatter" → pass-through Filters (no rules). Their jobs
 *    moved to the Get data step's Remove-duplicates checkbox and the automatic
 *    backend date normalization respectively.
 *  - A combine's picked-source ("src") reference edges are dropped with it.
 */
function migrateLegacyGraph(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object") return raw;
  const g = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(g.nodes)) return raw;

  type RawNode = { id?: unknown; type?: unknown; data?: { config?: unknown; [k: string]: unknown }; [k: string]: unknown };
  const combineIds = new Set<string>();
  let changed = false;

  const nodes = (g.nodes as RawNode[]).map((n) => {
    const type = n?.type;
    if (type === "aggregate") {
      changed = true;
      const c = (n.data?.config ?? {}) as Record<string, unknown>;
      const op = typeof c.aggregation === "string" && (FORMULA_OPS as readonly string[]).includes(c.aggregation) ? c.aggregation : "count";
      return {
        ...n,
        type: "formula",
        data: {
          ...(n.data ?? {}),
          config: {
            op,
            field: typeof c.field === "string" ? c.field : "value",
            distinctField: typeof c.distinctField === "string" ? c.distinctField : "subject",
            groupBy: c.groupBy ?? null,
          },
        },
      };
    }
    if (type === "combine" || type === "formatter") {
      changed = true;
      if (type === "combine" && typeof n.id === "string") combineIds.add(n.id);
      return { ...n, type: "filter", data: { ...(n.data ?? {}), config: { combinator: "and", rules: [] } } };
    }
    /**
     * Time between used to name two record TYPES; it now takes the same
     * conditions every other step takes. One equals-rule per side is exactly
     * what the old fields meant, so a saved flow keeps computing the
     * identical number — pinned by test.
     */
    if (type === "time_between") {
      const c = (n.data?.config ?? {}) as Record<string, unknown>;
      if ("fromType" in c || "toType" in c) {
        changed = true;
        const typeRule = (t: unknown) => ({
          combinator: "and" as const,
          rules: typeof t === "string" && t ? [{ field: "eventType", op: "equals" as const, value: t, valueKind: "fixed" as const }] : [],
        });
        return {
          ...n,
          data: {
            ...(n.data ?? {}),
            config: { keyField: c.keyField ?? "", start: typeRule(c.fromType), end: typeRule(c.toType), mode: c.mode ?? "first", unit: c.unit ?? "minutes" },
          },
        };
      }
    }
    /**
     * Drop a source setting that belongs to a record kind this step no longer
     * reads — a Close Pipeline still stored after the step was switched to
     * leads, or to "All record types".
     *
     * The engine already ignores such a value (`readFilterConds`), so this
     * changes no number. What it fixes is the gap between what the graph SAYS
     * and what it does: the panel correctly hides a control that cannot
     * apply, which left the stale value invisible and unclearable, and a
     * config that quietly means something other than it reads is how the next
     * confusing "0 loaded" gets built.
     */
    if (type === "app") {
      const cfg = (n.data?.config ?? {}) as { source?: unknown; eventType?: unknown; sourceConfig?: unknown };
      const sc = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
      const source = typeof cfg.source === "string" ? cfg.source : "";
      if (!source || Object.keys(sc).length === 0) return n;
      const eventType = typeof cfg.eventType === "string" ? cfg.eventType : null;
      const stale = (catalogEntry(source)?.flowFields ?? []).filter((f) => f.key in sc && !fieldAppliesToEventType(f, eventType));
      if (stale.length === 0) return n;
      changed = true;
      const sourceConfig = { ...sc };
      for (const f of stale) delete sourceConfig[f.key];
      return { ...n, data: { ...(n.data ?? {}), config: { ...cfg, sourceConfig } } };
    }
    return n;
  });

  if (!changed) return raw;

  type RawEdge = { target?: unknown; targetHandle?: unknown };
  const edges = Array.isArray(g.edges)
    ? (g.edges as RawEdge[]).filter((e) => !(e?.targetHandle === "src" && typeof e?.target === "string" && combineIds.has(e.target)))
    : g.edges;
  return { ...g, nodes, edges };
}

export function parseGraph(value: unknown): FlowGraph {
  return FlowGraphSchema.parse(migrateLegacyGraph(value ?? { nodes: [], edges: [] }));
}

// ---------- Engine shapes ----------
import type { FlowRecord } from "./records";

export type Dataset = { kind: "dataset"; records: FlowRecord[] };
export type Scalar = { kind: "scalar"; value: number; label?: string };
/**
 * A split metric, and `total` is the METRIC — the aggregation applied to the
 * whole record set, not to the buckets.
 *
 * A tile renders one headline above its bars, and that headline used to be the
 * sum of the bucket values whatever produced them. For a sum or a count that is
 * the same number; for anything else it is nonsense with a plausible shape — an
 * average deal size split by month rendered the sum of twelve monthly averages,
 * roughly twelve times the answer, above bars that were each correct.
 *
 * It has to be carried rather than derived: a consumer holding only the buckets
 * cannot recover it. Averaging the averages is wrong too, and differently — it
 * weights a month with three deals like one with three hundred — and a distinct
 * count over the whole set is not the sum of the per-bucket distinct counts.
 *
 * Optional, so a shape built by a path that has no records in hand degrades to
 * the old sum rather than to `undefined`.
 */
export type Series = { kind: "series"; series: Array<{ bucket: string; value: number }>; total?: number };
export type Grouped = { kind: "grouped"; groups: Array<{ label: string; value: number }>; total?: number };
export type Shape = Dataset | Scalar | Series | Grouped;

/** The saved presentation of one Output node. */
export type TileSpec = {
  name: string;
  description?: string;
  viz: (typeof VIZ_TYPES)[number];
  format: "number" | "percent" | "currency";
  unit?: string;
  currency?: string;
  precision: number;
  target: number | null;
  /** The metric's time reference (which field says WHEN each record happened) —
   * carried onto the tile so dashboard time-range controls can use it. */
  timeField?: string;
  timeUnit?: string;
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  groups?: Array<{ label: string; value: number }>;
  sample?: FlowRecord[];
};
