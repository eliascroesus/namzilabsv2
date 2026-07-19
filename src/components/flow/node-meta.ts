import { FILTER_OP_LABELS, PRIMARY_FILTER_OPS, type NodeType, type FlowFilterOp } from "@/lib/flow/types";
import type { NodeData } from "./graph-utils";

/** The four visible stages a metric flows through, in order. */
export const STAGES = ["Data", "Conditions", "Calculation", "Dashboard"] as const;
export type Stage = (typeof STAGES)[number];

/** Plain-English node metadata. Labels read like instructions, not jargon. */
export const NODE_META: Record<NodeType, { label: string; blurb: string; stage: Stage; advanced: boolean; keywords: string; hidden?: boolean }> = {
  app: { label: "Get data", blurb: "Pull records from a connected app", stage: "Data", advanced: false, keywords: "integration source connect data app get" },
  combine: { label: "Combine data", blurb: "Merge records from multiple steps", stage: "Data", advanced: true, keywords: "merge join dedupe union combine sources" },
  filter: { label: "Filter records", blurb: "Keep only the records you want", stage: "Conditions", advanced: false, keywords: "condition where keep only match date range filter" },
  paths: { label: "Split into paths", blurb: "Send records down different branches", stage: "Conditions", advanced: true, keywords: "split branch route condition paths" },
  calculate: { label: "Calculate a number", blurb: "Count, compare, or break down", stage: "Calculation", advanced: false, keywords: "count sum average metric number compare rate ratio break down group calculate" },
  formatter: { label: "Clean up values", blurb: "Fix text, numbers, and dates", stage: "Calculation", advanced: true, keywords: "format clean text number round date formatter" },
  // Output is replaced by "Review & publish" (metrics are chosen there). Kept so old
  // flows with an Output node still render + run; hidden from the picker.
  output: { label: "Show on dashboard", blurb: "Save the metric as a dashboard tile", stage: "Dashboard", advanced: false, keywords: "dashboard tile metric result output show", hidden: true },
  // Legacy steps — merged into Calculate / Filter. Kept so old flows still render + run,
  // but hidden from the picker (new flows use Calculate + Filter's date range).
  time: { label: "Date range", blurb: "Limit records to a time window", stage: "Conditions", advanced: true, keywords: "date range window period time", hidden: true },
  aggregate: { label: "Calculate a number", blurb: "Count, sum, or average records", stage: "Calculation", advanced: false, keywords: "count sum average aggregate", hidden: true },
  formula: { label: "Compare two numbers", blurb: "Rates, ratios, and % change", stage: "Calculation", advanced: false, keywords: "percentage ratio formula compare", hidden: true },
  group: { label: "Group into categories", blurb: "Break records into groups", stage: "Calculation", advanced: true, keywords: "category breakdown segment group", hidden: true },
};
export const ALL_TYPES = Object.keys(NODE_META) as NodeType[];

export const SOURCE_ICON: Record<string, string> = {
  calendly: "📅",
  close: "💼",
  instantly: "✉️",
  sendblue: "💬",
  gsheets: "📄",
  gcal: "📆",
  webhook: "🪝",
};

/**
 * A basic, brand-coloured badge for a data source. Deliberately app-agnostic: any
 * known connector gets its brand colour + short label, and any future/unknown
 * source falls back to a neutral badge derived from its key — so the data browser
 * and data pills work for every app, not just today's connectors.
 */
export type SourceStyle = { label: string; color: string; short: string };
const SOURCE_STYLE: Record<string, SourceStyle> = {
  calendly: { label: "Calendly", color: "#006BFF", short: "Ca" },
  close: { label: "Close", color: "#1E88E5", short: "Cl" },
  instantly: { label: "Instantly", color: "#7C3AED", short: "In" },
  sendblue: { label: "Sendblue", color: "#2563EB", short: "Sb" },
  gsheets: { label: "Google Sheets", color: "#0F9D58", short: "Sh" },
  gcal: { label: "Google Calendar", color: "#4285F4", short: "GC" },
  webhook: { label: "Webhook", color: "#64748B", short: "Wh" },
};
export function sourceStyle(source?: string | null): SourceStyle {
  if (source && SOURCE_STYLE[source]) return SOURCE_STYLE[source];
  const key = (source ?? "").trim();
  return { label: key || "App", color: "#64748B", short: (key || "ap").slice(0, 2).replace(/^\w/, (c) => c.toUpperCase()) };
}

/** Filter operators shown under the "More" divider (everything not in the common set). */
export const MORE_FILTER_OPS = (Object.keys(FILTER_OP_LABELS) as FlowFilterOp[]).filter((o) => !PRIMARY_FILTER_OPS.includes(o));

export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "app":
      return { identityField: "subject" };
    case "filter":
      return { combinator: "and", rules: [] };
    case "aggregate":
      return { aggregation: "count", field: "value", distinctField: "subject", groupBy: null };
    case "calculate":
      return { mode: "number", aggregation: "count", field: "value", distinctField: "subject", groupBy: null, breakdownMode: "field", breakdownField: "source", categories: [], fallbackLabel: "Other", op: "percentage" };
    case "output":
      return { name: "New metric", viz: "number", format: "number", precision: 0, target: null };
    case "time":
      return { dateField: "occurredAt", mode: "preset", preset: "last_30_days", days: 30 };
    case "formula":
      return { op: "percentage" };
    case "combine":
      return { mode: "stack", identityField: "subject", keep: "all", sourceWins: "first" };
    case "group":
      return { mode: "field", field: "source", aggregation: "count", valueField: "value", distinctField: "subject", categories: [], fallbackLabel: "Other" };
    case "formatter":
      return { field: "value", op: "round", decimals: 2 };
    case "paths":
      return { paths: [{ id: "p1", label: "Path 1", filters: { combinator: "and", rules: [] } }], fallbackId: "fallback", fallbackLabel: "Fallback" };
    default:
      return {};
  }
}

export function defaultTitle(type: NodeType, data: NodeData): string {
  const c = data.config;
  if (type === "app") return (c.connectionName as string) || "Get data";
  if (type === "output") return (c.name as string) || "New metric";
  return NODE_META[type].label;
}
export function nodeTitle(type: NodeType, data: NodeData): string {
  const custom = typeof data.label === "string" ? data.label.trim() : "";
  return custom || defaultTitle(type, data);
}

/** Labels for the Formula's two named input handles, by operation. */
export function formulaHandleLabels(op: string): { a: string; b: string } {
  switch (op) {
    case "percentage":
    case "ratio":
    case "divide":
      return { a: "Numerator", b: "Denominator" };
    case "percent_change":
      return { a: "Current", b: "Previous" };
    case "subtract":
    case "difference":
      return { a: "A (from)", b: "B (subtract)" };
    default:
      return { a: "A", b: "B" };
  }
}

/** A one-line human expression for a Formula, using upstream titles when known. */
export function formulaExpression(op: string, aName: string, bName: string): string {
  switch (op) {
    case "percentage":
      return `${aName} ÷ ${bName} × 100`;
    case "ratio":
    case "divide":
      return `${aName} ÷ ${bName}`;
    case "percent_change":
      return `(${aName} − ${bName}) ÷ ${bName} × 100`;
    case "add":
      return `${aName} + ${bName}`;
    case "subtract":
    case "difference":
      return `${aName} − ${bName}`;
    case "multiply":
      return `${aName} × ${bName}`;
    case "average":
      return `(${aName} + ${bName}) ÷ 2`;
    default:
      return `${aName} ${op} ${bName}`;
  }
}

export function summary(type: string, data: NodeData): string {
  const c = data.config;
  if (type === "app") return `${(c.connectionName as string) ?? "Choose app"} · ${(c.eventType as string) ?? "all events"}`;
  if (type === "filter") return `${((c.rules as unknown[]) ?? []).length} rule(s)`;
  if (type === "aggregate") {
    const agg = String(c.aggregation ?? "count");
    const gb = c.groupBy as { type?: string; unit?: string; field?: string } | null;
    const by = gb ? ` by ${gb.type === "time" ? gb.unit : gb.field}` : "";
    return `${agg}${by}`;
  }
  if (type === "output") return `${(c.viz as string) ?? "number"} · ${(c.format as string) ?? "number"}`;
  if (type === "time") {
    const mode = String(c.mode ?? "preset");
    return mode === "preset" ? String(c.preset ?? "last_30_days").replace(/_/g, " ") : mode === "rolling" ? `last ${c.days ?? 30} days` : "between dates";
  }
  if (type === "formula") return formulaExpression(String(c.op ?? "percentage"), "A", "B");
  if (type === "calculate") {
    const mode = String(c.mode ?? "number");
    if (mode === "compare") return formulaExpression(String(c.op ?? "percentage"), "First", "Second");
    if (mode === "breakdown") return String(c.breakdownMode) === "field" ? `break down by ${String(c.breakdownField ?? "source")}` : `${((c.categories as unknown[]) ?? []).length} categories`;
    const agg = String(c.aggregation ?? "count");
    const gb = c.groupBy as { type?: string; unit?: string; field?: string } | null;
    return `${agg}${gb ? ` by ${gb.type === "time" ? gb.unit : gb.field}` : ""}`;
  }
  if (type === "combine") return `${String(c.mode ?? "stack")} on ${String(c.identityField ?? "subject")}`;
  if (type === "group") return String(c.mode) === "field" ? `by ${String(c.field ?? "source")}` : `${((c.categories as unknown[]) ?? []).length} categories`;
  if (type === "formatter") return `${String(c.op ?? "round")} · ${String(c.field ?? "value")}`;
  if (type === "paths") return `${((c.paths as unknown[]) ?? []).length} path(s) + fallback`;
  return "";
}

/** Node-specific wording for a successful test result. */
export function resultLabel(type: string, test: { recordsIn: number; recordsOut: number; tile?: unknown }): string {
  const { recordsIn, recordsOut, tile } = test;
  const val = tile != null ? String((tile as { value?: unknown }).value ?? "—") : String(recordsOut);
  switch (type) {
    case "app":
      return `${recordsOut} records loaded`;
    case "filter":
      return `${recordsOut} of ${recordsIn} records matched`;
    case "time":
      return `${recordsOut} of ${recordsIn} within window`;
    case "formatter":
      return `${recordsOut} records formatted`;
    case "combine":
      return `${recordsOut} records combined`;
    case "paths":
      return `${recordsOut} records routed`;
    case "group":
      return `${recordsOut} groups`;
    case "aggregate":
    case "formula":
    case "calculate":
      return `Result: ${val}`;
    case "output":
      return `Dashboard value: ${val}`;
    default:
      return `${recordsOut} of ${recordsIn} records`;
  }
}

/** User-facing step status vocabulary (what the user should understand, not internals). */
export type NodeStatus = "ready" | "setup" | "updating" | "error";
export const STATUS_META: Record<NodeStatus, { label: string; cls: string; border: string }> = {
  ready: { label: "Ready", cls: "bg-green-100 text-green-700", border: "border-green-300" },
  setup: { label: "Needs setup", cls: "bg-neutral-100 text-neutral-600", border: "border-neutral-300" },
  updating: { label: "Updating", cls: "bg-blue-100 text-blue-700", border: "border-blue-300" },
  error: { label: "Error", cls: "bg-red-100 text-red-700", border: "border-red-300" },
};

export function statusOf(data: NodeData): { label: string; cls: string } {
  if (data.dirty) return { label: "Retest", cls: "bg-amber-100 text-amber-700" };
  if (!data.lastTest) return { label: "Not tested", cls: "bg-neutral-100 text-neutral-500" };
  if (data.lastTest.status === "error") return { label: "Error", cls: "bg-red-100 text-red-700" };
  return { label: "Tested", cls: "bg-green-100 text-green-700" };
}

export function pathHandles(data: NodeData): Array<{ id: string; label: string }> {
  const paths = (data.config.paths as Array<{ id: string; label: string }>) ?? [];
  return [...paths, { id: String(data.config.fallbackId ?? "fallback"), label: String(data.config.fallbackLabel ?? "Fallback") }];
}
