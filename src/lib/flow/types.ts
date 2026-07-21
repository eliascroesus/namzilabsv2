import { z } from "zod";

/** All node types in the builder. M1 implements the core four; the rest arrive in M3. */
export const NODE_TYPES = [
  "app",
  "filter",
  "aggregate",
  "output",
  "combine",
  "paths",
  "group",
  "formula",
  "formatter",
  "time",
  // "calculate" merges Aggregate + Formula + Group into one step. The three legacy
  // types remain in the engine so existing flows keep loading/running unchanged.
  "calculate",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Nodes the engine can execute today (M1/M2 core). */
export const CORE_NODE_TYPES = ["app", "filter", "aggregate", "output"] as const;

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

/** Everyday operators shown first; the rest appear under a "More" divider. */
export const PRIMARY_FILTER_OPS: FlowFilterOp[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "lt",
  "is_empty",
  "is_not_empty",
];

/** Operators that take no value input (the value box is hidden for these). */
export const NO_VALUE_FILTER_OPS: FlowFilterOp[] = ["is_empty", "is_not_empty"];

/** How a comparison value is supplied: a literal, or a mapped upstream field. */
export const VALUE_KINDS = ["fixed", "field"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

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
export type FilterDateRange = z.infer<typeof FilterDateRangeSchema>;

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
  identityField: z.string().nullable().default("subject"),
  /**
   * Flow-level resource selection (which spreadsheet + tab, which calendar…).
   * The connection holds only auth; this config identifies the synced stream the
   * step reads (events tagged with its hash). Empty for connection-scoped sources.
   */
  sourceConfig: z.record(z.string(), z.unknown()).default({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---------- Aggregate ----------
export const AGGREGATIONS = ["count", "count_distinct", "sum", "avg", "min", "max"] as const;
export const TIME_UNITS = ["day", "week", "month", "quarter", "year"] as const;

export const GroupBySchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("time"), unit: z.enum(TIME_UNITS) }),
    z.object({ type: z.literal("field"), field: z.string().min(1) }),
  ])
  .nullable()
  .default(null);

export const AggregateConfigSchema = z.object({
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

// ---------- Formula (advanced) ----------
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
] as const;
export const FormulaConfigSchema = z.object({
  op: z.enum(FORMULA_OPS).default("percentage"),
});
export type FormulaConfig = z.infer<typeof FormulaConfigSchema>;

// ---------- Combine (advanced) ----------
export const CombineConfigSchema = z.object({
  mode: z.enum(["stack", "dedupe", "match"]).default("stack"),
  identityField: z.string().default("subject"),
  keep: z.enum(["all", "matched", "unmatched"]).default("all"),
  sourceWins: z.enum(["first", "last"]).default("first"),
  /** Match mode: id of the connected source node whose records are the base set. */
  baseSourceId: z.string().nullable().default(null),
});
export type CombineConfig = z.infer<typeof CombineConfigSchema>;

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
});
export type CalculateConfig = z.infer<typeof CalculateConfigSchema>;

// ---------- Formatter (advanced) ----------
export const FORMATTER_OPS = [
  "to_number",
  "to_text",
  "round",
  "uppercase",
  "lowercase",
  "trim",
  "normalize_email",
  "normalize_phone",
  "date_only",
  "year_month",
  "replace",
  "default",
  "multiply",
  "divide",
] as const;
export const FormatterConfigSchema = z.object({
  field: z.string().default("value"),
  op: z.enum(FORMATTER_OPS).default("round"),
  decimals: z.number().int().min(0).max(6).default(2),
  find: z.string().optional(),
  // "Replace with" and "Value for empty" support a fixed literal or a mapped field.
  replaceWith: z.string().optional(),
  replaceWithKind: z.enum(VALUE_KINDS).default("fixed"),
  replaceWithField: z.string().optional(),
  defaultValue: z.string().optional(),
  defaultValueKind: z.enum(VALUE_KINDS).default("fixed"),
  defaultValueField: z.string().optional(),
  factor: z.number().optional(),
  outputField: z.string().optional(),
});
export type FormatterConfig = z.infer<typeof FormatterConfigSchema>;

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

export function parseGraph(value: unknown): FlowGraph {
  return FlowGraphSchema.parse(value ?? { nodes: [], edges: [] });
}

// ---------- Engine shapes ----------
import type { FlowRecord } from "./records";

export type Dataset = { kind: "dataset"; records: FlowRecord[] };
export type Scalar = { kind: "scalar"; value: number; label?: string };
export type Series = { kind: "series"; series: Array<{ bucket: string; value: number }> };
export type Grouped = { kind: "grouped"; groups: Array<{ label: string; value: number }> };
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
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  groups?: Array<{ label: string; value: number }>;
  sample?: FlowRecord[];
};
