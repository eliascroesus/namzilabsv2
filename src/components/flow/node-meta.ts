import { FILTER_OP_LABELS, PRIMARY_FILTER_OPS, type NodeType, type FlowFilterOp } from "@/lib/flow/types";
import type { NodeData } from "./graph-utils";

export const NODE_META: Record<NodeType, { label: string; blurb: string; accent: string; icon: string; category: string; keywords: string }> = {
  app: { label: "App", blurb: "Pull records from a connected app", accent: "border-blue-300", icon: "🔌", category: "Sources", keywords: "integration source connect data" },
  time: { label: "Time", blurb: "Limit records to a time window", accent: "border-sky-300", icon: "🕒", category: "Transform", keywords: "date range window period" },
  filter: { label: "Filter", blurb: "Keep only matching records", accent: "border-amber-300", icon: "🔎", category: "Transform", keywords: "condition where keep only match" },
  formatter: { label: "Formatter", blurb: "Clean & reshape field values", accent: "border-teal-300", icon: "✨", category: "Transform", keywords: "format clean text number round" },
  combine: { label: "Combine", blurb: "Merge records from multiple inputs", accent: "border-cyan-300", icon: "🔗", category: "Combine", keywords: "merge join dedupe union" },
  paths: { label: "Paths", blurb: "Split records into branches", accent: "border-pink-300", icon: "🔀", category: "Branch", keywords: "split branch route condition" },
  group: { label: "Group", blurb: "Group records into categories", accent: "border-orange-300", icon: "🗂️", category: "Branch", keywords: "category breakdown segment" },
  aggregate: { label: "Aggregate", blurb: "Turn records into a number", accent: "border-violet-300", icon: "Σ", category: "Math", keywords: "count sum average metric number" },
  formula: { label: "Formula", blurb: "Calculate with two numbers", accent: "border-indigo-300", icon: "🧮", category: "Math", keywords: "percentage ratio divide rate calculate" },
  output: { label: "Output", blurb: "Save a metric to the dashboard", accent: "border-green-300", icon: "📊", category: "Output", keywords: "dashboard tile metric result" },
};
export const LIBRARY_ORDER = ["Sources", "Transform", "Combine", "Branch", "Math", "Output"];
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

/** Filter operators shown under the "More" divider (everything not in the common set). */
export const MORE_FILTER_OPS = (Object.keys(FILTER_OP_LABELS) as FlowFilterOp[]).filter((o) => !PRIMARY_FILTER_OPS.includes(o));

/** Canonical (system) fields the picker groups under a collapsed "System fields" section. */
export const STD_META: Record<string, { label: string; type: string }> = {
  subject: { label: "Subject / person", type: "text" },
  source: { label: "Source app", type: "text" },
  eventType: { label: "Event type", type: "text" },
  value: { label: "Value / amount", type: "number" },
  currency: { label: "Currency", type: "text" },
  occurredAt: { label: "Occurred at", type: "date" },
  id: { label: "Record id", type: "text" },
};

export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "app":
      return { identityField: "subject" };
    case "filter":
      return { combinator: "and", rules: [] };
    case "aggregate":
      return { aggregation: "count", field: "value", distinctField: "subject", groupBy: null };
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

export function nodeIcon(type: NodeType, data: NodeData): string {
  if (type === "app") return SOURCE_ICON[String(data.config.source ?? "")] ?? NODE_META.app.icon;
  return NODE_META[type].icon;
}

export function defaultTitle(type: NodeType, data: NodeData): string {
  const c = data.config;
  if (type === "app") return (c.connectionName as string) || "New app step";
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
  if (type === "combine") return `${String(c.mode ?? "stack")} on ${String(c.identityField ?? "subject")}`;
  if (type === "group") return String(c.mode) === "field" ? `by ${String(c.field ?? "source")}` : `${((c.categories as unknown[]) ?? []).length} categories`;
  if (type === "formatter") return `${String(c.op ?? "round")} · ${String(c.field ?? "value")}`;
  if (type === "paths") return `${((c.paths as unknown[]) ?? []).length} path(s) + fallback`;
  return "";
}

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
