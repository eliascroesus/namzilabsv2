import type { NodeType } from "@/lib/flow/types";
import type { Edge } from "@xyflow/react";
import type { FNode, NodeData } from "./graph-utils";
import { isValidFlowConnection } from "./graph-utils";
import { ADDABLE_TYPES, defaultConfig, formatResult, formulaExpression } from "./node-meta";

// ---------- Plain-language step names ----------

export const STEP_LABEL: Record<NodeType, string> = {
  app: "Data source",
  time: "Date range",
  filter: "Filter records",
  formatter: "Transform field",
  combine: "Combine data",
  paths: "Split into paths",
  group: "Breakdown",
  aggregate: "Summarize",
  formula: "Calculate metric",
  output: "Dashboard metric",
};

// ---------- Four stages ----------

export type Stage = "Data" | "Conditions" | "Calculation" | "Dashboard";
export const STAGES: Stage[] = ["Data", "Conditions", "Calculation", "Dashboard"];
export const STAGE_BLURB: Record<Stage, string> = {
  Data: "Where the records come from",
  Conditions: "Narrow and shape the records",
  Calculation: "Turn records into a number",
  Dashboard: "Show it on your dashboard",
};

const STAGE_OF: Record<NodeType, Stage> = {
  app: "Data",
  time: "Conditions",
  filter: "Conditions",
  formatter: "Conditions",
  combine: "Conditions",
  paths: "Conditions",
  aggregate: "Calculation",
  formula: "Calculation",
  group: "Calculation",
  output: "Dashboard",
};
export function stageOf(type: NodeType): Stage {
  return STAGE_OF[type];
}

// ---------- Sentence cards ----------

const AGG_VERB: Record<string, string> = {
  count: "Count",
  count_distinct: "Count distinct",
  sum: "Sum",
  avg: "Average",
  min: "Minimum of",
  max: "Maximum of",
};

/** A one-line, business-readable sentence describing what a step does. */
export function sentenceFor(type: NodeType, data: NodeData): string {
  const c = data.config as Record<string, unknown>;
  switch (type) {
    case "app": {
      const app = (c.connectionName as string) || "a source";
      const kind = (c.eventType as string) || "records";
      return `Load ${app} ${kind}`;
    }
    case "filter": {
      const n = ((c.rules as unknown[]) ?? []).length;
      return n === 0 ? "Keep all records" : `Keep records matching ${n} rule${n === 1 ? "" : "s"}`;
    }
    case "time": {
      const mode = (c.mode as string) ?? "preset";
      if (mode === "preset") return `Keep records from ${String(c.preset ?? "last_30_days").replace(/_/g, " ")}`;
      if (mode === "rolling") return `Keep records from the last ${c.days ?? 30} days`;
      return "Keep records between two dates";
    }
    case "formatter":
      return `Transform ${String(c.field ?? "value")} (${String(c.op ?? "round").replace(/_/g, " ")})`;
    case "combine":
      return `Combine data (${String(c.mode ?? "stack")})`;
    case "paths":
      return `Split into ${((c.paths as unknown[]) ?? []).length} paths`;
    case "group":
      return `Break down by ${String(c.mode) === "categories" ? "custom categories" : String(c.field ?? "source")}`;
    case "aggregate": {
      const agg = String(c.aggregation ?? "count");
      const gb = c.groupBy as { type?: string; unit?: string; field?: string } | null;
      const by = gb ? ` by ${gb.type === "time" ? gb.unit : gb.field}` : "";
      if (agg === "count") return `Count matching records${by}`;
      const field = agg === "count_distinct" ? c.distinctField : c.field;
      return `${AGG_VERB[agg] ?? "Summarize"} ${String(field ?? "value")}${by}`;
    }
    case "formula":
      return `Calculate ${formulaExpression(String(c.op ?? "percentage"), "A", "B")}`;
    case "output": {
      const name = (c.name as string) || "this metric";
      return `Show "${name}" as a ${String(c.viz ?? "number")}`;
    }
  }
}

// ---------- Valid next actions (library filtering) ----------

const ADVANCED_NEXT = new Set<NodeType>(["paths", "group"]);

/**
 * The step types that may follow `srcType`, split into the everyday ones and the
 * advanced ones. Mirrors the engine's shape rules (isValidFlowConnection) but
 * hides Dashboard metric until there is something to summarize/calculate.
 */
export function nextOptions(srcType: NodeType): { common: NodeType[]; advanced: NodeType[] } {
  const valid = ADDABLE_TYPES.filter((t) => t !== "app" && isValidFlowConnection(srcType, t));
  const advanced = valid.filter((t) => ADVANCED_NEXT.has(t));
  const common = valid.filter((t) => !ADVANCED_NEXT.has(t));
  return { common, advanced };
}

// ---------- Outcome templates ----------

export const OUTCOMES = [
  { key: "count", label: "Count records", blurb: "How many things happened", icon: "🔢" },
  { key: "sum", label: "Sum a value", blurb: "Total up an amount", icon: "➕" },
  { key: "rate", label: "Conversion rate", blurb: "One number ÷ another, as a %", icon: "📈" },
  { key: "breakdown", label: "Breakdown", blurb: "Split by a category", icon: "🗂️" },
  { key: "trend", label: "Trend over time", blurb: "Change by day / week / month", icon: "📅" },
  { key: "custom", label: "Custom", blurb: "Start from a data source", icon: "🧩" },
] as const;
export type OutcomeKey = (typeof OUTCOMES)[number]["key"];

type GNode = { id: string; type: NodeType; position: { x: number; y: number }; data: { config: Record<string, unknown> } };

function node(type: NodeType, x: number, y: number, override: Record<string, unknown> = {}): GNode {
  let n = 0;
  const id = `${type}_${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { id, type, position: { x, y }, data: { config: { ...defaultConfig(type), ...override } } };
}
function edge(source: string, target: string, targetHandle?: string): Edge {
  return { id: `e_${Math.random().toString(36).slice(2, 9)}`, type: "insert", source, target, targetHandle };
}

/** Generate the minimum steps for a chosen outcome. */
export function buildOutcome(key: OutcomeKey): { nodes: GNode[]; edges: Edge[] } {
  switch (key) {
    case "count": {
      const a = node("app", 60, 80);
      const agg = node("aggregate", 360, 80, { aggregation: "count", name: "New count", viz: "number" });
      return { nodes: [a, agg], edges: [edge(a.id, agg.id)] };
    }
    case "sum": {
      const a = node("app", 60, 80);
      const agg = node("aggregate", 360, 80, { aggregation: "sum", field: "value", name: "New total", viz: "number" });
      return { nodes: [a, agg], edges: [edge(a.id, agg.id)] };
    }
    case "rate": {
      const a = node("app", 60, 120);
      const filter = node("filter", 360, 40, { combinator: "and", rules: [] });
      const num = node("aggregate", 660, 40, { aggregation: "count" });
      const den = node("aggregate", 360, 220, { aggregation: "count" });
      const calc = node("formula", 960, 120, { op: "percentage", name: "Conversion rate", format: "percent", precision: 2 });
      return {
        nodes: [a, filter, num, den, calc],
        edges: [edge(a.id, filter.id), edge(filter.id, num.id), edge(a.id, den.id), edge(num.id, calc.id, "a"), edge(den.id, calc.id, "b")],
      };
    }
    case "breakdown": {
      const a = node("app", 60, 80);
      const grp = node("group", 360, 80, { mode: "field", field: "source", aggregation: "count", name: "Breakdown", viz: "category" });
      return { nodes: [a, grp], edges: [edge(a.id, grp.id)] };
    }
    case "trend": {
      const a = node("app", 60, 80);
      const agg = node("aggregate", 360, 80, { aggregation: "count", groupBy: { type: "time", unit: "day" }, name: "Trend", viz: "line" });
      return { nodes: [a, agg], edges: [edge(a.id, agg.id)] };
    }
    case "custom":
    default: {
      const a = node("app", 60, 80);
      return { nodes: [a], edges: [] };
    }
  }
}

// ---------- Review & publish summary ----------

export type ReviewSummary = {
  metrics: Array<{ name: string; value?: string; format?: string }>;
  sources: string[];
  dateRules: string[];
  calculations: string[];
  untested: Array<{ step?: number; title: string }>;
  stale: Array<{ step?: number; title: string }>;
};

const CALC = new Set<string>(["aggregate", "formula", "group"]);

/** Summarize a flow for the Review & publish step. */
export function buildReview(nodes: FNode[], edges: Edge[], stepNoById: Map<string, number>, titleOf: (n: FNode) => string): ReviewSummary {
  const metrics: ReviewSummary["metrics"] = [];
  const sources = new Set<string>();
  const dateRules: string[] = [];
  const calculations: string[] = [];
  const untested: ReviewSummary["untested"] = [];
  const stale: ReviewSummary["stale"] = [];
  const hasOutgoing = new Set(edges.map((e) => e.source));

  for (const n of nodes) {
    const type = n.type as NodeType;
    const c = n.data.config as Record<string, unknown>;
    const t = n.data.lastTest;
    const ref = { step: stepNoById.get(n.id), title: titleOf(n) };

    // A calc node that ends a branch (or is opted in) is a dashboard metric.
    const isDashboard = type === "output" || (CALC.has(type) && (!hasOutgoing.has(n.id) || c.addToDashboard === true));
    if (isDashboard) {
      metrics.push({
        name: (c.name as string) || titleOf(n),
        value: t?.status === "ok" ? formatResult(t.tile as never, t.recordsOut) : undefined,
        format: c.format as string,
      });
    }
    if (type === "app") sources.add(`${(c.connectionName as string) || (c.source as string) || "a source"} · ${(c.eventType as string) || "all records"}`);
    if (type === "time") dateRules.push(sentenceFor("time", n.data));
    if (CALC.has(type)) calculations.push(sentenceFor(type, n.data));

    if (!t || t.status !== "ok") untested.push(ref);
    else if (n.data.dirty) stale.push(ref);
  }

  return { metrics, sources: [...sources], dateRules, calculations, untested, stale };
}
