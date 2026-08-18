import { z } from "zod";
import { DURATION_DISPLAYS } from "@/lib/format";
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
  // `equals` compares exactly; `contains` ignores case. Both were offered by
  // one dropdown with nothing to say so, and "Outbound" vs "outbound" silently
  // returned zero rows. The labels carry the difference; the semantics are
  // untouched, because changing them would move every published number.
  equals: "Exactly matches (case-sensitive)",
  not_equals: "Does not match (case-sensitive)",
  contains: "Contains (any case)",
  not_contains: "Does not contain (any case)",
  starts_with: "Starts with",
  ends_with: "Ends with",
  gt: "Greater than",
  lt: "Less than",
  gte: "Greater than or equal",
  lte: "Less than or equal",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
  is_one_of: "Is one of (comma-separated)",
  is_not_one_of: "Is not one of (comma-separated)",
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

/** Which record survives when several share an identity. Always stated, never inferred. */
export const KEEP_DIRECTIONS = ["earliest", "latest"] as const;
export type KeepDirection = (typeof KEEP_DIRECTIONS)[number];

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
   * Keep one record per identity value, at the source — the FIRST thing that
   * happens to loaded records, before any later step runs. Records with an
   * empty value always pass (they can't be duplicates of anything).
   *
   * WHICH ONE SURVIVES IS ASKED, NOT ASSUMED. This used to keep whichever
   * record came first out of the database, which happened to be the newest —
   * a sort order that was invisible, unstated and unaskable. A user wanting
   * "the first call to each lead" ticked the box and silently got the last
   * one, and their speed-to-lead read 24 hours instead of 5 minutes. The
   * defaults below reproduce the old behaviour exactly; the difference is
   * that both halves are now on screen next to each other.
   */
  dedupe: z.boolean().default(false),
  dedupeField: z.string().default("subject"),
  dedupeKeep: z.enum(KEEP_DIRECTIONS).default("latest"),
  dedupeOrderField: z.string().default("occurredAt"),
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
    // `field` tolerates "" so a draft saved while the withdrawn breakdown
    // control was on screen still LOADS. A parse failure here is not a
    // validation message, it is a flow that cannot be opened at all.
    z.object({ type: z.literal("field"), field: z.string().default("") }),
  ])
  .nullable()
  .default(null);

// Not a node type anymore — kept (unexported) to type the shared aggregate machinery.
const AggregateConfigSchema = z.object({
  aggregation: z.enum(AGGREGATIONS).default("count"),
  field: z.string().default("value"),
  /**
   * MORE COLUMNS ADDED INTO THE SAME NUMBER. A record's value becomes
   * `field` plus each of these, and the aggregation then runs over that
   * combined per-record total.
   *
   * This exists because a form writes one question per column: "how many did
   * you call (CRM)" and "how many did you call (your phone)" are two columns
   * that mean one thing. Expressing that used to require two Get-data steps
   * reading the same sheet twice, two Calculates and a third to add them —
   * and the canvas offers no way to branch a step, so nobody found it.
   *
   * Empty for every saved flow, which then behaves exactly as before.
   */
  extraFields: z.array(z.string()).default([]),
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
  format: z.enum(["number", "percent", "currency", "duration"]).default("number"),
  /** For a duration: the unit the NUMBER is counted in (never a display choice). */
  unit: z.string().optional(),
  /** For a duration: how finely to break it down when read. */
  durationDisplay: z.enum(DURATION_DISPLAYS).default("auto"),
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
/**
 * Measures the gap between two moments, per key — and it is configured the
 * way every other step is: by PICKING VARIABLES.
 *
 * `startField`/`endField` are field paths holding a moment. `startStep`/
 * `endStep` are the id of the step whose records carry that moment, which is
 * what makes the flagship shape expressible: after a Combine, leads and calls
 * BOTH carry `occurredAt`, so the path alone cannot say which is which. The
 * picker already groups fields by the step that produced them, so choosing
 * "Step 1 › occurredAt" as the start and "Step 2 › occurredAt" as the stop is
 * the whole configuration. An empty step means "any record that has it",
 * which is also the within-one-record case (created_at → answered_at).
 *
 * What this replaced, twice over: two bespoke record-type dropdowns that
 * compared `eventType` by raw column, then two full Filter-style condition
 * builders. Both made the one step in the builder that did not work like the
 * others.
 *
 * The output carries the gap as PLAIN NUMBERS in four units, so a downstream
 * Calculate can average or take a median of it — the aggregates already knew
 * how to read a number, they had just never been handed a duration.
 */
export const TimeBetweenConfigSchema = z.object({
  keyField: z.string().default(""),
  startField: z.string().default(""),
  startStep: z.string().default(""),
  endField: z.string().default(""),
  endStep: z.string().default(""),
});
export type TimeBetweenConfig = z.infer<typeof TimeBetweenConfigSchema>;

// ---------- Combine (unite) ----------
/** Keep records that appear in the other step's list — or only those that don't. */
const CROSS_REF_MODES = ["appears", "missing"] as const;
export type CrossRefMode = (typeof CROSS_REF_MODES)[number];
/**
 * Combine data has two modes. "stack" (the default, and what every stored
 * `{}` config means) puts all lanes' records on one line. "match" is the join
 * primitive: exactly two inputs, keep one side's records only when their
 * field value appears (or doesn't) among the other side's values.
 *
 * Matching names which input's records CONTINUE (`keepNodeId`) — the other
 * becomes the list they are checked against. Naming the side is what makes a
 * "only keep matches" option answerable at all: a symmetric checkbox cannot
 * say which records come out, and that ambiguity is exactly what let
 * Combine + a field-vs-field Filter pass 8 no-email records as "matches".
 * The match fields default to empty so a matching Combine reads "Needs
 * setup" until each question is answered — no hidden side, no assumed field.
 */
export const UniteConfigSchema = z.object({
  mode: z.enum(["stack", "match"]).default("stack"),
  /** match: the input node whose records continue downstream. */
  keepNodeId: z.string().default(""),
  /** match: field on the kept records whose value is looked up. */
  keyField: z.string().default(""),
  /** match: field on the other input's records that supplies the list of values. */
  lookupField: z.string().default(""),
  matchMode: z.enum(CROSS_REF_MODES).default("appears"),
});

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

/**
 * What a Calculate step is measuring. A bare number and a length of time
 * are read differently by a human — "285.195783" as a speed-to-lead is
 * meaningless until it says minutes — so the step asks up front and the
 * rest of its configuration follows from the answer.
 */
export const RESULT_KINDS = ["number", "duration"] as const;
/** The units a duration NUMBER can be counted in. A fact about the data. */
export const DURATION_UNITS = ["seconds", "minutes", "hours", "days"] as const;

/**
 * What unit a field's numbers are counted in, read off the field itself.
 *
 * Time between publishes its gap as `properties.time_between.<unit>`, so the
 * field NAMES its unit and there is nothing to ask and nothing to get wrong.
 * `stored` is the fallback for a field that does not say — the only case
 * where the step has to ask the person.
 */
export function durationValueUnit(field: string, stored: string): string {
  const last = String(field).split(".").pop() ?? "";
  return (DURATION_UNITS as readonly string[]).includes(last) ? last : stored;
}

/**
 * The presentation a step's own config implies for its published tile.
 *
 * A hand-built speed-to-lead read "4h 45m" in the builder and published a
 * tile reading "285": the seeding hardcoded format "number" and never looked
 * at the step, so only the Close template — which ships its metric
 * pre-seeded — ever got this right.
 */
export function seedMetricFormat(cfg: Record<string, unknown>): { format: "number" | "duration"; unit?: string; durationDisplay?: string } {
  if (cfg.resultKind !== "duration") return { format: "number" };
  return {
    format: "duration",
    unit: durationValueUnit(String(cfg.field ?? ""), String(cfg.durationUnit ?? "minutes")),
    durationDisplay: String(cfg.durationDisplay ?? "auto"),
  };
}

/** True when the field names its own unit, so the step must not ask. */
export function fieldNamesItsUnit(field: string): boolean {
  return durationValueUnit(field, "") !== "";
}

export const FormulaConfigSchema = z.object({
  op: z.enum(FORMULA_OPS).default("percentage"),
  /** Number (default, unchanged for every saved config) or a length of time. */
  resultKind: z.enum(RESULT_KINDS).default("number"),
  /**
   * The unit the incoming numbers are counted in. Only consulted when the
   * field does not name its own unit — see `durationValueUnit`.
   */
  durationUnit: z.enum(DURATION_UNITS).default("minutes"),
  /**
   * How finely to break the length of time down for reading. Never changes
   * the duration itself; "auto" picks the two units that carry information.
   */
  durationDisplay: z.enum(DURATION_DISPLAYS).default("auto"),
  /** Typed-in literal numbers for the A/B inputs — used when no step is wired in. */
  aFixed: z.number().nullable().optional(),
  bFixed: z.number().nullable().optional(),
  /**
   * A FIELD an A/B input reads off its wired step, instead of that step's
   * record count. "Count this" used to offer exactly one thing per step —
   * its Output number — so a spreadsheet cell holding a precomputed total
   * was unreachable from a Calculate. The value is the field on the step's
   * NEWEST record: for the one-row summary tab this exists for, that is the
   * cell; for a multi-row step it is the current value, same as every
   * preview. Unset means the record count, unchanged for every saved flow.
   */
  aField: z.string().nullable().optional(),
  bField: z.string().nullable().optional(),
  // Dataset ops: which field to aggregate (sum/avg/min/max read numbers from it,
  // count_distinct counts its unique values), plus an optional time split.
  field: z.string().default("value"),
  /** Columns added into the same number as `field` — see AggregateConfigSchema. */
  extraFields: z.array(z.string()).default([]),
  distinctField: z.string().default("subject"),
  groupBy: GroupBySchema,
});
export type FormulaConfig = z.infer<typeof FormulaConfigSchema>;

/**
 * Every column an aggregation reads, primary first. One list so the engine,
 * the summary line and the field pickers cannot disagree about how many
 * columns a step is actually totalling.
 */
export function aggregationFields(cfg: { field?: unknown; extraFields?: unknown }): string[] {
  const primary = String(cfg.field ?? "value");
  const out = [primary];
  // DEDUPED, because the same column picked twice would be COUNTED twice: a
  // sheet totalling 13 would read 26, which is a plausible number and a wrong
  // one. Two pickers open on the same list makes that a slip, not an edge case.
  if (Array.isArray(cfg.extraFields)) {
    for (const raw of cfg.extraFields) {
      const f = String(raw);
      if (f.trim() !== "" && !out.includes(f)) out.push(f);
    }
  }
  return out;
}

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
  /** A field read off the wired step instead of its record count — see FormulaConfigSchema. */
  aField: z.string().nullable().optional(),
  bField: z.string().nullable().optional(),
  /** Columns added into the same number as `field` — see AggregateConfigSchema. */
  extraFields: z.array(z.string()).default([]),
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
  format: z.enum(["number", "percent", "currency", "duration"]).default("number"),
  /** For a duration: the unit the NUMBER is counted in (never a display choice). */
  unit: z.string().optional(),
  /** For a duration: how finely to break it down when read. */
  durationDisplay: z.enum(DURATION_DISPLAYS).default("auto"),
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
  /** Which app step reads which record type — how a legacy Time between recovers its lanes. */
  const appByEventType = new Map<string, string>();
  for (const n of g.nodes as RawNode[]) {
    if (n?.type !== "app" || typeof n.id !== "string") continue;
    const et = (n.data?.config as { eventType?: unknown } | undefined)?.eventType;
    if (typeof et === "string" && et && !appByEventType.has(et)) appByEventType.set(et, n.id);
  }
  /** Migrated Time between nodes → the unit their old `properties.duration` was in. */
  const migratedTimeBetween = new Map<string, string>();

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
     * "cross_reference" lived one release as its own step before matching
     * became a mode on Combine data — where the person building "only the
     * leads that are in the spreadsheet" actually looks for it. The config
     * keys map one-to-one; nothing about the semantics moved.
     */
    if (type === "cross_reference") {
      changed = true;
      const c = (n.data?.config ?? {}) as Record<string, unknown>;
      return {
        ...n,
        type: "unite",
        data: {
          ...(n.data ?? {}),
          config: {
            mode: "match",
            keepNodeId: typeof c.keepNodeId === "string" ? c.keepNodeId : "",
            keyField: typeof c.keyField === "string" ? c.keyField : "",
            lookupField: typeof c.lookupField === "string" ? c.lookupField : "",
            matchMode: c.mode === "missing" ? "missing" : "appears",
          },
        },
      };
    }
    /**
     * Time between is configured by picking variables now, so both older
     * shapes — two record-type names, then two Filter-style rule sets — have
     * to name a step and a time field instead.
     *
     * Both old shapes said "records of type X start the clock". The step that
     * READS type X is the app node configured for it, so the lane is
     * recoverable from the graph itself rather than guessed. If no app node
     * claims that type, the step is left needing setup and says so, which is
     * the honest outcome — better than silently timing the wrong records.
     */
    if (type === "time_between") {
      const c = (n.data?.config ?? {}) as Record<string, unknown>;
      const legacyType = (side: "from" | "start"): string => {
        if (side === "from") return typeof c.fromType === "string" ? c.fromType : "";
        const rules = (c.start as { rules?: Array<Record<string, unknown>> } | undefined)?.rules ?? [];
        const r = rules.find((x) => x.field === "eventType" && x.op === "equals");
        return typeof r?.value === "string" ? r.value : "";
      };
      const legacyEndType = (): string => {
        if (typeof c.toType === "string") return c.toType;
        const rules = (c.end as { rules?: Array<Record<string, unknown>> } | undefined)?.rules ?? [];
        const r = rules.find((x) => x.field === "eventType" && x.op === "equals");
        return typeof r?.value === "string" ? r.value : "";
      };
      if ("fromType" in c || "toType" in c || "start" in c || "end" in c || "mode" in c || "unit" in c) {
        changed = true;
        const from = legacyType("fromType" in c ? "from" : "start");
        const to = legacyEndType();
        if (typeof n.id === "string") migratedTimeBetween.set(n.id, typeof c.unit === "string" ? c.unit : "minutes");
        return {
          ...n,
          data: {
            ...(n.data ?? {}),
            config: {
              keyField: c.keyField ?? "",
              startField: from ? "occurredAt" : "",
              startStep: appByEventType.get(from) ?? "",
              endField: to ? "occurredAt" : "",
              endStep: appByEventType.get(to) ?? "",
            },
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

  type RawEdge = { source?: unknown; target?: unknown; targetHandle?: unknown };
  const edges = Array.isArray(g.edges)
    ? (g.edges as RawEdge[]).filter((e) => !(e?.targetHandle === "src" && typeof e?.target === "string" && combineIds.has(e.target)))
    : g.edges;
  return { ...g, nodes: repointDurationRefs(nodes, edges, migratedTimeBetween), edges };
}

/**
 * A migrated Time between publishes its gap at `properties.time_between.<unit>`;
 * it used to publish `properties.duration`. Any saved step BELOW it that
 * aggregated the old name has to follow, or it silently averages a field that
 * no longer exists and the tile reads 0 with no error.
 *
 * Only steps actually downstream are touched, and that restriction is the
 * whole point: `properties.duration` is a real Close call-duration column, so
 * a blanket rename would corrupt a genuine reference somewhere else in the
 * graph.
 */
function repointDurationRefs(
  nodes: Array<{ id?: unknown; type?: unknown; data?: { config?: unknown; [k: string]: unknown }; [k: string]: unknown }>,
  edges: unknown,
  migrated: Map<string, string>,
): unknown[] {
  if (migrated.size === 0) return nodes;
  const es = Array.isArray(edges) ? (edges as Array<{ source?: unknown; target?: unknown }>) : [];
  const below = new Map<string, string>(); // node id → the unit to repoint to
  const queue = [...migrated.entries()];
  while (queue.length > 0) {
    const [id, unit] = queue.pop()!;
    for (const e of es) {
      if (e.source !== id || typeof e.target !== "string" || below.has(e.target)) continue;
      below.set(e.target, unit);
      queue.push([e.target, unit]);
    }
  }
  if (below.size === 0) return nodes;
  return nodes.map((n) => {
    const unit = typeof n.id === "string" ? below.get(n.id) : undefined;
    if (!unit) return n;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const stale = new Set(["properties.duration", `properties.duration_${unit}`]);
    const next = { ...cfg };
    let hit = false;
    for (const k of ["field", "distinctField"]) {
      if (typeof next[k] === "string" && stale.has(next[k] as string)) {
        next[k] = `properties.time_between.${unit}`;
        hit = true;
      }
    }
    return hit ? { ...n, data: { ...(n.data ?? {}), config: next } } : n;
  });
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
  format: "number" | "percent" | "currency" | "duration";
  durationDisplay?: string;
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
  /**
   * The same metric computed over each dashboard range, keyed by range key.
   *
   * Lives inside the tile rather than in its own column so this needed no
   * migration, and so a tile written before the feature simply has no
   * `byRange` and renders exactly as it always did.
   *
   * Every range the dashboard offers has an entry, ALWAYS — a range that could
   * not be answered says so in `unavailable` rather than going missing. A
   * missing key would be indistinguishable from a tile written before this
   * existed, and the dashboard would quietly show the flow's own all-time
   * number under a narrower pill.
   */
  byRange?: Record<
    string,
    {
      value?: number;
      series?: Array<{ bucket: string; value: number }>;
      groups?: Array<{ label: string; value: number }>;
      /** Why this range has no number — shown instead of one, never in place of one. */
      unavailable?: string;
      /** Records carrying no date in the metric's time reference, so counted in no period. */
      undated?: number;
    }
  >;
  /**
   * The earliest moment these numbers can change WITHOUT new data arriving —
   * a record falling out of a rolling window, a future-dated one reaching
   * "Today", or the next UTC midnight, whichever comes first (ISO). The
   * refresh loop recomputes the tile then and not before; recomputing on a
   * blind timer re-read the whole history 144 times a day to reproduce an
   * identical tile. New data still marks it stale immediately via the sweep.
   */
  nextChangeAt?: string;
};
