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

export const FilterRuleSchema = z.object({
  field: z.string().min(1),
  op: z.enum(FLOW_FILTER_OPS),
  value: z.string().default(""),
  value2: z.string().optional(), // for "between"
  valueField: z.string().optional(), // compare against another field instead of a literal
});
export const FilterConfigSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  rules: z.array(FilterRuleSchema).default([]),
});
export type FilterConfig = z.infer<typeof FilterConfigSchema>;

// ---------- App ----------
export const AppConfigSchema = z.object({
  connectionId: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  eventType: z.string().nullable().default(null),
  identityField: z.string().nullable().default("subject"),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---------- Aggregate ----------
export const AGGREGATIONS = ["count", "count_distinct", "sum", "avg", "min", "max"] as const;
export const TIME_UNITS = ["day", "week", "month", "quarter", "year"] as const;
/** Dashboard visualization types (used by calculation nodes and the legacy Output). */
export const VIZ_TYPES = ["number", "line", "bar", "category", "table", "progress", "funnel"] as const;

export const GroupBySchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("time"), unit: z.enum(TIME_UNITS) }),
    z.object({ type: z.literal("field"), field: z.string().min(1) }),
  ])
  .nullable()
  .default(null);

/**
 * Dashboard display settings. Calculation nodes (Aggregate / Formula / Group) can
 * be shown on the dashboard directly — no separate Output node — so they carry the
 * tile's name, visualization, and number formatting. `format`/`precision`/`viz`
 * are optional so `metricDisplay` can pick smart defaults (e.g. % for percentages).
 */
export const DisplayShape = {
  name: z.string().default(""),
  viz: z.enum(VIZ_TYPES).optional(),
  format: z.enum(["number", "percent", "currency"]).optional(),
  precision: z.number().int().min(0).max(6).optional(),
  currency: z.string().default("USD"),
  unit: z.string().optional(),
  target: z.number().nullable().default(null),
  /** Show this node on the dashboard even when it isn't the final step. */
  addToDashboard: z.boolean().default(false),
};

export const AggregateConfigSchema = z.object({
  aggregation: z.enum(AGGREGATIONS).default("count"),
  field: z.string().default("value"),
  distinctField: z.string().default("subject"),
  groupBy: GroupBySchema,
  ...DisplayShape,
});
export type AggregateConfig = z.infer<typeof AggregateConfigSchema>;

// ---------- Output (legacy — no longer addable; calc nodes carry the tile) ----------
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
  ...DisplayShape,
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
  ...DisplayShape,
});
export type GroupConfig = z.infer<typeof GroupConfigSchema>;

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
  replaceWith: z.string().optional(),
  defaultValue: z.string().optional(),
  factor: z.number().optional(),
  outputField: z.string().optional(),
});
export type FormatterConfig = z.infer<typeof FormatterConfigSchema>;

// ---------- Paths (advanced) ----------
export const PathsConfigSchema = z.object({
  paths: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), filters: FilterConfigSchema })).default([]),
  fallbackId: z.string().default("fallback"),
  fallbackLabel: z.string().default("Fallback"),
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

export const FlowGraphSchema = z.object({
  nodes: z.array(FlowNodeSchema).default([]),
  edges: z.array(FlowEdgeSchema).default([]),
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
