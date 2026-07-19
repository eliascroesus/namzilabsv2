import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";
import { eventToRecord, getField, toNumber, type FlowRecord } from "./records";
import { inferSchema, type FieldInfo } from "./schema-infer";
import {
  AppConfigSchema,
  FilterConfigSchema,
  AggregateConfigSchema,
  OutputConfigSchema,
  TimeConfigSchema,
  FormulaConfigSchema,
  CombineConfigSchema,
  GroupConfigSchema,
  CalculateConfigSchema,
  FormatterConfigSchema,
  PathsConfigSchema,
  type FlowGraph,
  type FlowNode,
  type FilterConfig,
  type AggregateConfig,
  type GroupConfig,
  type Shape,
  type Dataset,
  type Scalar,
  type Series,
  type Grouped,
  type TileSpec,
} from "./types";

export type EngineCtx = { db: DB; orgId: string };

export type NodeExecOk = {
  status: "ok";
  nodeType: string;
  shape: Shape;
  /** Extra outputs keyed by source-handle id (Paths uses this). */
  outputs?: Record<string, Shape>;
  recordsIn: number;
  recordsOut: number;
  sample: FlowRecord[];
  outputSchema: FieldInfo[];
  tile?: TileSpec;
};
export type NodeExecErr = {
  status: "error";
  nodeType: string;
  error: string;
  recordsIn: number;
  recordsOut: number;
  sample: FlowRecord[];
  outputSchema: FieldInfo[];
};
export type NodeExec = NodeExecOk | NodeExecErr;

type ResolvedInput = { shape: Shape; exec: NodeExecOk; targetHandle: string | null; sourceNodeId: string };

export type RunResult = {
  nodes: Map<string, NodeExec>;
  outputs: Array<{ nodeId: string; tile: TileSpec }>;
};

const APP_LOAD_CAP = 20_000;

export async function runFlow(ctx: EngineCtx, graph: FlowGraph, opts: { untilNodeId?: string } = {}): Promise<RunResult> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const incomingBy = new Map<string, FlowGraph["edges"]>();
  for (const e of graph.edges) {
    if (!incomingBy.has(e.target)) incomingBy.set(e.target, []);
    incomingBy.get(e.target)!.push(e);
  }

  const wanted = opts.untilNodeId ? ancestorsOf(opts.untilNodeId, incomingBy) : new Set(graph.nodes.map((n) => n.id));
  const order = topoSort(graph).filter((id) => wanted.has(id));

  const nodes = new Map<string, NodeExec>();
  const outputs: RunResult["outputs"] = [];

  for (const id of order) {
    const node = nodeById.get(id);
    if (!node) continue;

    const inputs: ResolvedInput[] = [];
    let inputError = false;
    for (const e of incomingBy.get(id) ?? []) {
      const se = nodes.get(e.source);
      if (!se || se.status !== "ok") {
        inputError = true;
        continue;
      }
      const shape = e.sourceHandle && se.outputs?.[e.sourceHandle] ? se.outputs[e.sourceHandle] : se.shape;
      inputs.push({ shape, exec: se, targetHandle: e.targetHandle ?? null, sourceNodeId: e.source });
    }

    const exec = await execNode(ctx, node, inputs, inputError);
    nodes.set(id, exec);
    if (node.type === "output" && exec.status === "ok" && exec.tile) {
      outputs.push({ nodeId: id, tile: exec.tile });
    }
  }

  return { nodes, outputs };
}

async function execNode(ctx: EngineCtx, node: FlowNode, inputs: ResolvedInput[], inputError: boolean): Promise<NodeExec> {
  const err = (message: string): NodeExecErr => ({
    status: "error",
    nodeType: node.type,
    error: message,
    recordsIn: 0,
    recordsOut: 0,
    sample: [],
    outputSchema: [],
  });

  if (node.type !== "app" && inputError) return err("An input node has an error — fix it first.");

  try {
    switch (node.type) {
      case "app":
        return await execApp(ctx, node);
      case "filter":
        return execFilter(node, inputs);
      case "time":
        return execTime(node, inputs);
      case "formatter":
        return execFormatter(node, inputs);
      case "combine":
        return execCombine(node, inputs);
      case "paths":
        return execPaths(node, inputs);
      case "group":
        return execGroup(node, inputs);
      case "aggregate":
        return execAggregate(node, inputs);
      case "formula":
        return execFormula(node, inputs);
      case "calculate":
        return execCalculate(node, inputs);
      case "output":
        return execOutput(node, inputs);
      default:
        return err(`The "${node.type}" node isn't available yet.`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// ---------- App ----------
async function execApp(ctx: EngineCtx, node: FlowNode): Promise<NodeExec> {
  const cfg = AppConfigSchema.parse(node.data.config ?? {});
  const conds: SQL[] = [sql`${events.orgId} = ${ctx.orgId}`, isNull(events.deletedAt)];
  if (cfg.connectionId) conds.push(eq(events.connectionId, cfg.connectionId));
  if (cfg.source) conds.push(eq(events.source, cfg.source));
  if (cfg.eventType) conds.push(eq(events.eventType, cfg.eventType));

  const rows = await ctx.db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(desc(events.occurredAt))
    .limit(APP_LOAD_CAP);

  const records = rows.map(eventToRecord);
  return datasetExec("app", records, 0);
}

// ---------- Filter ----------
function execFilter(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = FilterConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Filter");
  let recs = input.records;
  // Optional prominent "Date range" quick section (reuses the Time window logic).
  const dr = cfg.dateRange;
  if (dr?.enabled) {
    const { start, end } = timeWindow({ mode: dr.mode, preset: dr.preset, from: dr.from, to: dr.to, days: dr.days });
    recs = recs.filter((r) => {
      const t = dateMs(getField(r, dr.dateField));
      return t != null && t >= start && t <= end;
    });
  }
  const passed = recs.filter((r) => evalRules(r, cfg));
  return datasetExec("filter", passed, input.records.length);
}

// ---------- Time ----------
function execTime(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = TimeConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Time");
  const { start, end } = timeWindow(cfg);
  const passed = input.records.filter((r) => {
    const t = dateMs(getField(r, cfg.dateField));
    return t != null && t >= start && t <= end;
  });
  return datasetExec("time", passed, input.records.length);
}

// ---------- Formatter ----------
function execFormatter(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = FormatterConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Formatter");
  const out = cfg.outputField || cfg.field;
  const asStr = (v: unknown): string | undefined => (v == null ? undefined : String(v));
  const records = input.records.map((r) => {
    const copy: FlowRecord = { ...r, properties: { ...r.properties } };
    // Resolve mapped "replace with" / "value for empty" against this record.
    const eff = {
      ...cfg,
      replaceWith: cfg.replaceWithKind === "field" && cfg.replaceWithField ? asStr(getField(r, cfg.replaceWithField)) : cfg.replaceWith,
      defaultValue: cfg.defaultValueKind === "field" && cfg.defaultValueField ? asStr(getField(r, cfg.defaultValueField)) : cfg.defaultValue,
    };
    setField(copy, out, formatValue(getField(r, cfg.field), eff));
    return copy;
  });
  return datasetExec("formatter", records, input.records.length);
}

// ---------- Combine ----------
function execCombine(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = CombineConfigSchema.parse(node.data.config ?? {});
  // In Match mode the base source controls which records are retained/enriched.
  // Put the chosen base input first; otherwise keep the connection order.
  let ordered = inputs;
  if (cfg.mode === "match" && cfg.baseSourceId) {
    const base = inputs.filter((i) => i.sourceNodeId === cfg.baseSourceId);
    const rest = inputs.filter((i) => i.sourceNodeId !== cfg.baseSourceId);
    if (base.length) ordered = [...base, ...rest];
  }
  const datasets = ordered.map((i) => {
    if (i.shape.kind !== "dataset") throw new Error("Combine only accepts record inputs.");
    return i.shape.records;
  });
  const totalIn = datasets.reduce((a, d) => a + d.length, 0);

  let records: FlowRecord[];
  if (cfg.mode === "stack") {
    records = datasets.flat();
  } else if (cfg.mode === "dedupe") {
    records = dedupeBy(datasets.flat(), cfg.identityField, cfg.sourceWins);
  } else {
    records = matchJoin(datasets, cfg.identityField, cfg.keep, cfg.sourceWins);
  }
  return datasetExec("combine", records, totalIn);
}

// ---------- Paths ----------
function execPaths(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = PathsConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Paths");
  const outputs: Record<string, Shape> = {};
  const assigned = new Set<FlowRecord>();
  for (const p of cfg.paths) {
    const matched = input.records.filter((r) => {
      const ok = evalRules(r, p.filters);
      if (ok) assigned.add(r);
      return ok;
    });
    outputs[p.id] = { kind: "dataset", records: matched };
  }
  outputs[cfg.fallbackId] = { kind: "dataset", records: input.records.filter((r) => !assigned.has(r)) };

  return {
    status: "ok",
    nodeType: "paths",
    shape: { kind: "dataset", records: input.records },
    outputs,
    recordsIn: input.records.length,
    recordsOut: input.records.length,
    sample: input.records.slice(0, 3),
    outputSchema: inferSchema(input.records),
  };
}

// ---------- Group ----------
function execGroup(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = GroupConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Group");
  const groups = cfg.mode === "field" ? groupByField(input.records, cfg) : groupByCategories(input.records, cfg);
  return {
    status: "ok",
    nodeType: "group",
    shape: { kind: "grouped", groups },
    recordsIn: input.records.length,
    recordsOut: groups.length,
    sample: input.records.slice(0, 3),
    outputSchema: [],
  };
}

// ---------- Aggregate ----------
function execAggregate(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = AggregateConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Aggregate");
  const shape = aggregate(input.records, cfg);
  const recordsOut = shape.kind === "scalar" ? 1 : shape.kind === "series" ? shape.series.length : shape.groups.length;
  return {
    status: "ok",
    nodeType: "aggregate",
    shape,
    recordsIn: input.records.length,
    recordsOut,
    sample: input.records.slice(0, 3),
    outputSchema: [],
  };
}

// ---------- Formula ----------
// A Formula is a binary operation over two named inputs: handle "a" and handle "b".
// (No edge-order fallback — all pre-v2 flows are wiped in migration 0003.)
/** Read a single number from a named input handle (a/b). Shared by Formula + Calculate. */
function scalarAt(inputs: ResolvedInput[], handle: "a" | "b"): number {
  const found = inputs.find((i) => i.targetHandle === handle);
  if (!found) throw new Error(`Needs a number connected to input ${handle.toUpperCase()}.`);
  if (found.shape.kind !== "scalar") throw new Error("Inputs must be single numbers (connect Calculate steps).");
  return found.shape.value;
}

/** The binary calculation over two numbers. Shared by Formula + Calculate(compare). */
function formulaValue(op: string, a: number, b: number): number {
  const divGuard = (x: number, y: number) => {
    if (y === 0) throw new Error("Division by zero — check the second (denominator) number.");
    return x / y;
  };
  switch (op) {
    case "add":
      return a + b;
    case "average":
      return (a + b) / 2;
    case "subtract":
    case "difference":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
    case "ratio":
      return divGuard(a, b);
    case "percentage":
      return divGuard(a, b) * 100;
    case "percent_change":
      return divGuard(a - b, b) * 100;
    default:
      throw new Error(`Unknown calculation "${op}".`);
  }
}

function execFormula(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = FormulaConfigSchema.parse(node.data.config ?? {});
  const value = formulaValue(cfg.op, scalarAt(inputs, "a"), scalarAt(inputs, "b"));
  return { status: "ok", nodeType: "formula", shape: { kind: "scalar", value: round(value) }, recordsIn: 2, recordsOut: 1, sample: [], outputSchema: [] };
}

// ---------- Calculate (merged Aggregate + Formula + Group) ----------
function execCalculate(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = CalculateConfigSchema.parse(node.data.config ?? {});

  if (cfg.mode === "compare") {
    const value = formulaValue(cfg.op, scalarAt(inputs, "a"), scalarAt(inputs, "b"));
    return { status: "ok", nodeType: "calculate", shape: { kind: "scalar", value: round(value) }, recordsIn: 2, recordsOut: 1, sample: [], outputSchema: [] };
  }

  const input = requireDataset(inputs, "Calculate");

  if (cfg.mode === "breakdown") {
    const groupAgg = cfg.aggregation === "sum" || cfg.aggregation === "count_distinct" ? cfg.aggregation : "count";
    const gcfg: GroupConfig = {
      mode: cfg.breakdownMode,
      field: cfg.breakdownField,
      aggregation: groupAgg,
      valueField: cfg.field,
      distinctField: cfg.distinctField,
      categories: cfg.categories,
      fallbackLabel: cfg.fallbackLabel,
    };
    const groups = cfg.breakdownMode === "field" ? groupByField(input.records, gcfg) : groupByCategories(input.records, gcfg);
    return { status: "ok", nodeType: "calculate", shape: { kind: "grouped", groups }, recordsIn: input.records.length, recordsOut: groups.length, sample: input.records.slice(0, 3), outputSchema: [] };
  }

  // number
  const acfg: AggregateConfig = { aggregation: cfg.aggregation, field: cfg.field, distinctField: cfg.distinctField, groupBy: cfg.groupBy };
  const shape = aggregate(input.records, acfg);
  const recordsOut = shape.kind === "scalar" ? 1 : shape.kind === "series" ? shape.series.length : shape.groups.length;
  return { status: "ok", nodeType: "calculate", shape, recordsIn: input.records.length, recordsOut, sample: input.records.slice(0, 3), outputSchema: [] };
}

// ---------- Output ----------
function execOutput(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = OutputConfigSchema.parse(node.data.config ?? {});
  const input = inputs[0];
  if (!input) {
    return { status: "error", nodeType: "output", error: "Output needs one connected input.", recordsIn: 0, recordsOut: 0, sample: [], outputSchema: [] };
  }

  const tile: TileSpec = {
    name: cfg.name,
    description: cfg.description,
    viz: cfg.viz,
    format: cfg.format,
    unit: cfg.unit,
    currency: cfg.currency,
    precision: cfg.precision,
    target: cfg.target,
    sample: input.exec.sample,
  };
  const shape = input.shape;
  if (shape.kind === "scalar") tile.value = shape.value;
  else if (shape.kind === "series") {
    tile.series = shape.series;
    tile.value = round(shape.series.reduce((a, b) => a + b.value, 0));
  } else if (shape.kind === "grouped") {
    tile.groups = shape.groups;
    tile.value = round(shape.groups.reduce((a, b) => a + b.value, 0));
  } else {
    tile.value = shape.records.length;
    tile.sample = shape.records.slice(0, 5);
  }

  return {
    status: "ok",
    nodeType: "output",
    shape: input.shape,
    recordsIn: input.exec.recordsOut,
    recordsOut: 1,
    sample: input.exec.sample,
    outputSchema: [],
    tile,
  };
}

// ---------- shared executors helpers ----------
function datasetExec(nodeType: string, records: FlowRecord[], recordsIn: number): NodeExecOk {
  return {
    status: "ok",
    nodeType,
    shape: { kind: "dataset", records },
    recordsIn,
    recordsOut: records.length,
    sample: records.slice(0, 3),
    outputSchema: inferSchema(records),
  };
}

function evalRules(rec: FlowRecord, cfg: FilterConfig): boolean {
  if (cfg.rules.length === 0) return true;
  const results = cfg.rules.map((rule) => evalRule(rec, rule));
  return cfg.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

type Rule = { field: string; op: string; value: string; value2?: string; valueKind?: string; valueField?: string };

function evalRule(rec: FlowRecord, rule: Rule): boolean {
  const raw = getField(rec, rule.field);
  const str = raw == null ? "" : String(raw);
  // Comparison value: a mapped upstream field (resolved per-record) or a literal.
  const rhsRaw: unknown = rule.valueKind === "field" && rule.valueField ? getField(rec, rule.valueField) : rule.value;
  const v = rhsRaw == null ? "" : String(rhsRaw);
  const rhsNum = num(rhsRaw);
  const rhsDate = dateMs(rhsRaw);
  switch (rule.op) {
    case "equals":
      return str === v;
    case "not_equals":
      return str !== v;
    case "contains":
      return str.toLowerCase().includes(v.toLowerCase());
    case "not_contains":
      return !str.toLowerCase().includes(v.toLowerCase());
    case "starts_with":
      return str.toLowerCase().startsWith(v.toLowerCase());
    case "ends_with":
      return str.toLowerCase().endsWith(v.toLowerCase());
    case "gt":
      return num(raw) != null && rhsNum != null && (num(raw) as number) > rhsNum;
    case "lt":
      return num(raw) != null && rhsNum != null && (num(raw) as number) < rhsNum;
    case "gte":
      return num(raw) != null && rhsNum != null && (num(raw) as number) >= rhsNum;
    case "lte":
      return num(raw) != null && rhsNum != null && (num(raw) as number) <= rhsNum;
    case "is_empty":
      return raw == null || str === "";
    case "is_not_empty":
      return raw != null && str !== "";
    case "is_one_of":
      return splitList(v).includes(str);
    case "is_not_one_of":
      return !splitList(v).includes(str);
    case "before":
      return dateMs(raw) != null && (dateMs(raw) as number) < (rhsDate ?? Infinity);
    case "after":
      return dateMs(raw) != null && (dateMs(raw) as number) > (rhsDate ?? -Infinity);
    case "between": {
      const t = dateMs(raw);
      const lo = rhsDate;
      const hi = dateMs(rule.value2 ?? "");
      return t != null && lo != null && hi != null && t >= lo && t <= hi;
    }
    default:
      return false;
  }
}

function aggregate(records: FlowRecord[], cfg: AggregateConfig): Scalar | Series | Grouped {
  if (!cfg.groupBy) return { kind: "scalar", value: computeAgg(records, cfg.aggregation, cfg.field, cfg.distinctField) };
  if (cfg.groupBy.type === "time") {
    const unit = cfg.groupBy.unit;
    const buckets = new Map<string, FlowRecord[]>();
    for (const r of records) {
      const key = bucketKey(r.occurredAt, unit);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    return {
      kind: "series",
      series: [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([bucket, recs]) => ({ bucket, value: computeAgg(recs, cfg.aggregation, cfg.field, cfg.distinctField) })),
    };
  }
  const field = cfg.groupBy.field;
  const groups = new Map<string, FlowRecord[]>();
  for (const r of records) {
    const key = String(getField(r, field) ?? "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return { kind: "grouped", groups: [...groups.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.field, cfg.distinctField) })).sort((a, b) => b.value - a.value) };
}

function computeAgg(records: FlowRecord[], aggregation: string, field: string, distinctField: string): number {
  switch (aggregation) {
    case "count":
      return records.length;
    case "count_distinct": {
      const set = new Set<string>();
      for (const r of records) {
        const v = getField(r, distinctField);
        if (v != null && v !== "") set.add(String(v));
      }
      return set.size;
    }
    default: {
      const nums = records.map((r) => num(getField(r, field))).filter((n): n is number => n != null);
      if (nums.length === 0) return 0;
      if (aggregation === "sum") return round(nums.reduce((a, b) => a + b, 0));
      if (aggregation === "avg") return round(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (aggregation === "min") return Math.min(...nums);
      return Math.max(...nums);
    }
  }
}

function groupByField(records: FlowRecord[], cfg: GroupConfig): Array<{ label: string; value: number }> {
  const groups = new Map<string, FlowRecord[]>();
  for (const r of records) {
    const key = String(getField(r, cfg.field) ?? "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.valueField, cfg.distinctField) }))
    .sort((a, b) => b.value - a.value);
}

function groupByCategories(records: FlowRecord[], cfg: GroupConfig): Array<{ label: string; value: number }> {
  const buckets = new Map<string, FlowRecord[]>();
  for (const c of cfg.categories) buckets.set(c.label, []);
  buckets.set(cfg.fallbackLabel, []);
  for (const r of records) {
    const cat = cfg.categories.find((c) => evalRules(r, c.filters));
    buckets.get(cat ? cat.label : cfg.fallbackLabel)!.push(r);
  }
  return [...buckets.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.valueField, cfg.distinctField) }));
}

function dedupeBy(records: FlowRecord[], idField: string, sourceWins: "first" | "last"): FlowRecord[] {
  const map = new Map<string, FlowRecord>();
  for (const r of records) {
    const key = String(getField(r, idField) ?? "");
    if (key === "") continue;
    if (!map.has(key)) map.set(key, r);
    else if (sourceWins === "last") map.set(key, mergeRecords(map.get(key)!, r));
    else map.set(key, mergeRecords(r, map.get(key)!));
  }
  return [...map.values()];
}

function matchJoin(datasets: FlowRecord[][], idField: string, keep: "all" | "matched" | "unmatched", sourceWins: "first" | "last"): FlowRecord[] {
  const base = datasets[0] ?? [];
  const others = datasets.slice(1).flat();
  const otherKeys = new Map<string, FlowRecord[]>();
  for (const r of others) {
    const k = String(getField(r, idField) ?? "");
    if (!k) continue;
    if (!otherKeys.has(k)) otherKeys.set(k, []);
    otherKeys.get(k)!.push(r);
  }
  const out: FlowRecord[] = [];
  for (const r of base) {
    const k = String(getField(r, idField) ?? "");
    const matches = k ? (otherKeys.get(k) ?? []) : [];
    const hasMatch = matches.length > 0;
    if (keep === "matched" && !hasMatch) continue;
    if (keep === "unmatched" && hasMatch) continue;
    let merged = r;
    if (hasMatch && keep !== "unmatched") {
      for (const m of matches) merged = sourceWins === "last" ? mergeRecords(merged, m) : mergeRecords(m, merged);
    }
    out.push(merged);
  }
  return out;
}

/** winner's non-null fields/properties take precedence. */
function mergeRecords(winner: FlowRecord, loser: FlowRecord): FlowRecord {
  return {
    ...loser,
    ...winner,
    subject: winner.subject ?? loser.subject,
    value: winner.value ?? loser.value,
    properties: { ...loser.properties, ...winner.properties },
  };
}

function formatValue(raw: unknown, cfg: { op: string; decimals: number; find?: string; replaceWith?: string; defaultValue?: string; factor?: number }): unknown {
  const str = raw == null ? "" : String(raw);
  switch (cfg.op) {
    case "to_number":
      return num(raw) ?? 0;
    case "to_text":
      return str;
    case "round": {
      const n = num(raw);
      return n == null ? raw : Number(n.toFixed(cfg.decimals));
    }
    case "uppercase":
      return str.toUpperCase();
    case "lowercase":
      return str.toLowerCase();
    case "trim":
      return str.trim();
    case "normalize_email":
      return str.trim().toLowerCase();
    case "normalize_phone":
      return str.replace(/[^\d]/g, "");
    case "date_only": {
      const t = dateMs(raw);
      return t == null ? raw : new Date(t).toISOString().slice(0, 10);
    }
    case "year_month": {
      const t = dateMs(raw);
      return t == null ? raw : new Date(t).toISOString().slice(0, 7);
    }
    case "replace":
      return cfg.find != null ? str.split(cfg.find).join(cfg.replaceWith ?? "") : str;
    case "default":
      return raw == null || str === "" ? (cfg.defaultValue ?? "") : raw;
    case "multiply": {
      const n = num(raw);
      return n == null ? raw : round(n * (cfg.factor ?? 1));
    }
    case "divide": {
      const n = num(raw);
      return n == null || (cfg.factor ?? 0) === 0 ? raw : round(n / (cfg.factor ?? 1));
    }
    default:
      return raw;
  }
}

function setField(rec: FlowRecord, path: string, value: unknown): void {
  switch (path) {
    case "subject":
      rec.subject = value == null ? null : String(value);
      break;
    case "value":
      rec.value = typeof value === "number" ? value : num(value);
      break;
    case "source":
      rec.source = String(value);
      break;
    case "eventType":
      rec.eventType = String(value);
      break;
    default: {
      const key = path.startsWith("properties.") ? path.slice("properties.".length) : path;
      rec.properties[key] = value;
    }
  }
}

// ---------- time windows ----------
function timeWindow(cfg: { mode: string; preset: string; from?: string; to?: string; days: number }): { start: number; end: number } {
  const now = Date.now();
  if (cfg.mode === "between") return { start: dateMs(cfg.from ?? "") ?? 0, end: dateMs(cfg.to ?? "") ?? now };
  if (cfg.mode === "rolling") return { start: now - cfg.days * 86_400_000, end: now };

  const d = new Date();
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7; // Monday=0
  const startOfWeek = startOfDay - dow * 86_400_000;
  const startOfMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = 86_400_000;
  switch (cfg.preset) {
    case "today":
      return { start: startOfDay, end: now };
    case "yesterday":
      return { start: startOfDay - day, end: startOfDay - 1 };
    case "this_week":
      return { start: startOfWeek, end: now };
    case "last_week":
      return { start: startOfWeek - 7 * day, end: startOfWeek - 1 };
    case "this_month":
      return { start: startOfMonth, end: now };
    case "last_month": {
      const startPrev = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
      return { start: startPrev, end: startOfMonth - 1 };
    }
    case "last_7_days":
      return { start: now - 7 * day, end: now };
    case "last_30_days":
      return { start: now - 30 * day, end: now };
    case "last_90_days":
      return { start: now - 90 * day, end: now };
    case "last_365_days":
      return { start: now - 365 * day, end: now };
    default:
      return { start: 0, end: now };
  }
}

// ---------- generic helpers ----------
function requireDataset(inputs: ResolvedInput[], nodeName: string): Dataset {
  const input = inputs[0];
  if (!input) throw new Error(`${nodeName} needs a connected input.`);
  if (input.shape.kind !== "dataset") throw new Error(`${nodeName} expects records, not a ${input.shape.kind}.`);
  return input.shape;
}
function num(v: unknown): number | null {
  return toNumber(v);
}
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function splitList(v: string): string[] {
  return v.split(",").map((s) => s.trim());
}
function dateMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

function bucketKey(iso: string, unit: "day" | "week" | "month" | "quarter" | "year"): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  switch (unit) {
    case "year":
      return String(y);
    case "month":
      return iso.slice(0, 7);
    case "quarter":
      return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case "week": {
      const w = isoWeek(d);
      return `${w.year}-W${String(w.week).padStart(2, "0")}`;
    }
    case "day":
    default:
      return iso.slice(0, 10);
  }
}

function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function topoSort(graph: FlowGraph): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return order;
}

function ancestorsOf(target: string, incoming: Map<string, FlowGraph["edges"]>): Set<string> {
  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of incoming.get(id) ?? []) {
      if (!seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return seen;
}
