import { type NodeType } from "@/lib/flow/types";
import type { NodeData } from "./graph-utils";

/** The four visible stages a metric flows through, in order. */
export const STAGES = ["Data", "Conditions", "Calculation", "Dashboard"] as const;
export type Stage = (typeof STAGES)[number];

/** Plain-English node metadata. Labels read like instructions, not jargon. */
export const NODE_META: Record<NodeType, { label: string; blurb: string; stage: Stage; keywords: string; hidden?: boolean }> = {
  app: { label: "Get data", blurb: "Pull records from a connected app", stage: "Data", keywords: "integration source connect data app get duplicates dedupe" },
  unite: { label: "Unite data", blurb: "Join lanes back into one line", stage: "Data", keywords: "unite merge join together branches lanes sources union bring back" },
  filter: { label: "Filter records", blurb: "Keep only the records you want", stage: "Conditions", keywords: "condition where keep only match date range filter" },
  paths: { label: "Split into paths", blurb: "Send records down different branches", stage: "Conditions", keywords: "split branch route condition paths" },
  // The one Calculation step: it aggregates records into a number (count/sum/avg/…,
  // the former Count node) OR compares two numbers (rate, ratio, % change).
  formula: { label: "Calculate", blurb: "Count, sum, or compare — rate, ratio, % change", stage: "Calculation", keywords: "calculate count sum average total maximum minimum distinct compare rate ratio percentage change difference formula divide aggregate number" },
  // Output is replaced by "Review & publish" (metrics are chosen there). Kept so old
  // flows with an Output node still render + run; hidden from the picker.
  output: { label: "Show on dashboard", blurb: "Save the metric as a dashboard tile", stage: "Dashboard", keywords: "dashboard tile metric result output show", hidden: true },
  // Retired from the picker but kept so old flows still render + run.
  calculate: { label: "Calculate a number", blurb: "Count, compare, or break down", stage: "Calculation", keywords: "count sum average metric number compare rate ratio break down group calculate", hidden: true },
  time: { label: "Date range", blurb: "Limit records to a time window", stage: "Conditions", keywords: "date range window period time", hidden: true },
  group: { label: "Group into categories", blurb: "Break records into groups", stage: "Calculation", keywords: "category breakdown segment group", hidden: true },
};
export const ALL_TYPES = Object.keys(NODE_META) as NodeType[];

// (Source badge styling lives in controls/source-style.ts — the one copy.)

export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "app":
      return {};
    case "filter":
      return { combinator: "and", rules: [] };
    case "calculate":
      return { mode: "number", aggregation: "count", field: "value", distinctField: "subject", groupBy: null, breakdownMode: "field", breakdownField: "source", categories: [], fallbackLabel: "Other", op: "percentage" };
    case "output":
      return { name: "New metric", viz: "number", format: "number", precision: 0, target: null };
    case "time":
      return { dateField: "occurredAt", mode: "preset", preset: "last_30_days", days: 30 };
    case "formula":
      return { op: "percentage" };
    case "unite":
      return {};
    case "group":
      return { mode: "field", field: "source", aggregation: "count", valueField: "value", distinctField: "subject", categories: [], fallbackLabel: "Other" };
    case "paths":
      return { paths: [{ id: "p1", label: "Path A" }, { id: "p2", label: "Path B" }] };
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

/** A one-line human expression for a dataset Calculate (count/sum/avg/…). */
export function datasetCalcExpression(op: string, fieldLabel: string): string {
  switch (op) {
    case "count":
      return "Count of records";
    case "count_distinct":
      return `Unique values of ${fieldLabel}`;
    case "sum":
      return `Sum of ${fieldLabel}`;
    case "avg":
      return `Average of ${fieldLabel}`;
    case "min":
      return `Lowest ${fieldLabel}`;
    case "max":
      return `Highest ${fieldLabel}`;
    default:
      return op;
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

/** Minimal wording for a successful test result — just the number + a short verb. */
export function resultLabel(type: string, test: { recordsIn: number; recordsOut: number; tile?: unknown; value?: number }): string {
  const { recordsOut, tile, value } = test;
  const tileVal = (tile as { value?: unknown } | undefined)?.value;
  const val = value != null ? String(value) : tileVal != null ? String(tileVal) : String(recordsOut);
  switch (type) {
    case "app":
      return `${recordsOut} loaded`;
    case "filter":
      return `${recordsOut} passed`;
    case "time":
      return `${recordsOut} kept`;
    case "unite":
      return `${recordsOut} united`;
    case "paths":
      return `${recordsOut} routed`;
    case "group":
      return `${recordsOut} groups`;
    case "formula":
    case "calculate":
    case "output":
      return `${val}`;
    default:
      return `${recordsOut}`;
  }
}

/** User-facing step status vocabulary (what the user should understand, not internals). */
export type NodeStatus = "ready" | "setup" | "untested" | "updating" | "error";
export const STATUS_META: Record<NodeStatus, { label: string; cls: string; border: string }> = {
  ready: { label: "Ready", cls: "bg-green-100 text-green-700", border: "border-green-300" },
  setup: { label: "Needs setup", cls: "bg-neutral-100 text-neutral-600", border: "border-neutral-300" },
  untested: { label: "Ready to test", cls: "bg-neutral-100 text-neutral-500", border: "border-neutral-300" },
  updating: { label: "Testing…", cls: "bg-blue-100 text-blue-700", border: "border-blue-300" },
  error: { label: "Error", cls: "bg-red-100 text-red-700", border: "border-red-300" },
};

export function pathHandles(data: NodeData): Array<{ id: string; label: string }> {
  const paths = (data.config.paths as Array<{ id: string; label: string }>) ?? [];
  const handles = paths.map((p) => ({ id: p.id, label: p.label }));
  const fbId = data.config.fallbackId as string | undefined; // the "everything else" lane
  if (fbId) handles.push({ id: fbId, label: String(data.config.fallbackLabel ?? "Everything else") });
  return handles;
}
