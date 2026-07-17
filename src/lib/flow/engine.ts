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
  type FlowGraph,
  type FlowNode,
  type FilterConfig,
  type AggregateConfig,
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

export type RunResult = {
  nodes: Map<string, NodeExec>;
  outputs: Array<{ nodeId: string; tile: TileSpec }>;
};

const APP_LOAD_CAP = 20_000;

/**
 * Execute a flow graph over the org's synced events. Topologically ordered;
 * when `untilNodeId` is set, only that node and its ancestors run (so testing a
 * single node doesn't touch unrelated branches).
 */
export async function runFlow(ctx: EngineCtx, graph: FlowGraph, opts: { untilNodeId?: string } = {}): Promise<RunResult> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>(); // node -> source node ids (in edge order)
  for (const e of graph.edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }

  const wanted = opts.untilNodeId ? ancestorsOf(opts.untilNodeId, incoming) : new Set(graph.nodes.map((n) => n.id));
  const order = topoSort(graph).filter((id) => wanted.has(id));

  const nodes = new Map<string, NodeExec>();
  const outputs: RunResult["outputs"] = [];

  for (const id of order) {
    const node = nodeById.get(id);
    if (!node) continue;
    const inputExecs = (incoming.get(id) ?? []).map((src) => nodes.get(src)).filter(Boolean) as NodeExec[];
    const exec = await execNode(ctx, node, inputExecs);
    nodes.set(id, exec);
    if (node.type === "output" && exec.status === "ok" && exec.tile) {
      outputs.push({ nodeId: id, tile: exec.tile });
    }
  }

  return { nodes, outputs };
}

async function execNode(ctx: EngineCtx, node: FlowNode, inputs: NodeExec[]): Promise<NodeExec> {
  const err = (message: string): NodeExecErr => ({
    status: "error",
    nodeType: node.type,
    error: message,
    recordsIn: 0,
    recordsOut: 0,
    sample: [],
    outputSchema: [],
  });

  try {
    switch (node.type) {
      case "app":
        return await execApp(ctx, node);
      case "filter":
        return execFilter(node, inputs);
      case "aggregate":
        return execAggregate(node, inputs);
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
  return {
    status: "ok",
    nodeType: "app",
    shape: { kind: "dataset", records },
    recordsIn: 0,
    recordsOut: records.length,
    sample: records.slice(0, 3),
    outputSchema: inferSchema(records),
  };
}

// ---------- Filter ----------
function execFilter(node: FlowNode, inputs: NodeExec[]): NodeExec {
  const cfg = FilterConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Filter");
  const passed = input.records.filter((r) => evalRules(r, cfg));
  return {
    status: "ok",
    nodeType: "filter",
    shape: { kind: "dataset", records: passed },
    recordsIn: input.records.length,
    recordsOut: passed.length,
    sample: passed.slice(0, 3),
    outputSchema: inferSchema(passed),
  };
}

function evalRules(rec: FlowRecord, cfg: FilterConfig): boolean {
  if (cfg.rules.length === 0) return true;
  const results = cfg.rules.map((rule) => evalRule(rec, rule));
  return cfg.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

function evalRule(rec: FlowRecord, rule: { field: string; op: string; value: string; value2?: string }): boolean {
  const raw = getField(rec, rule.field);
  const str = raw == null ? "" : String(raw);
  const v = rule.value;
  switch (rule.op) {
    case "equals":
      return str === v;
    case "not_equals":
      return str !== v;
    case "contains":
      return str.toLowerCase().includes(v.toLowerCase());
    case "not_contains":
      return !str.toLowerCase().includes(v.toLowerCase());
    case "gt":
      return num(raw) != null && Number(v) != null && (num(raw) as number) > Number(v);
    case "lt":
      return num(raw) != null && (num(raw) as number) < Number(v);
    case "gte":
      return num(raw) != null && (num(raw) as number) >= Number(v);
    case "lte":
      return num(raw) != null && (num(raw) as number) <= Number(v);
    case "is_empty":
      return raw == null || str === "";
    case "is_not_empty":
      return raw != null && str !== "";
    case "is_one_of":
      return splitList(v).includes(str);
    case "is_not_one_of":
      return !splitList(v).includes(str);
    case "before":
      return dateMs(raw) != null && (dateMs(raw) as number) < (dateMs(v) ?? Infinity);
    case "after":
      return dateMs(raw) != null && (dateMs(raw) as number) > (dateMs(v) ?? -Infinity);
    case "between": {
      const t = dateMs(raw);
      const a = dateMs(v);
      const b = dateMs(rule.value2 ?? "");
      return t != null && a != null && b != null && t >= a && t <= b;
    }
    default:
      return false;
  }
}

// ---------- Aggregate ----------
function execAggregate(node: FlowNode, inputs: NodeExec[]): NodeExec {
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

function aggregate(records: FlowRecord[], cfg: AggregateConfig): Scalar | Series | Grouped {
  if (!cfg.groupBy) {
    return { kind: "scalar", value: computeAgg(records, cfg) };
  }
  if (cfg.groupBy.type === "time") {
    const unit = cfg.groupBy.unit;
    const buckets = new Map<string, FlowRecord[]>();
    for (const r of records) {
      const key = bucketKey(r.occurredAt, unit);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    const series = [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([bucket, recs]) => ({ bucket, value: computeAgg(recs, cfg) }));
    return { kind: "series", series };
  }
  // group by field
  const field = cfg.groupBy.field;
  const groups = new Map<string, FlowRecord[]>();
  for (const r of records) {
    const key = String(getField(r, field) ?? "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return {
    kind: "grouped",
    groups: [...groups.entries()]
      .map(([label, recs]) => ({ label, value: computeAgg(recs, cfg) }))
      .sort((a, b) => b.value - a.value),
  };
}

function computeAgg(records: FlowRecord[], cfg: AggregateConfig): number {
  switch (cfg.aggregation) {
    case "count":
      return records.length;
    case "count_distinct": {
      const set = new Set<string>();
      for (const r of records) {
        const v = getField(r, cfg.distinctField);
        if (v != null && v !== "") set.add(String(v));
      }
      return set.size;
    }
    case "sum":
    case "avg":
    case "min":
    case "max": {
      const nums = records.map((r) => num(getField(r, cfg.field))).filter((n): n is number => n != null);
      if (nums.length === 0) return 0;
      if (cfg.aggregation === "sum") return round(nums.reduce((a, b) => a + b, 0));
      if (cfg.aggregation === "avg") return round(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (cfg.aggregation === "min") return Math.min(...nums);
      return Math.max(...nums);
    }
  }
}

// ---------- Output ----------
function execOutput(node: FlowNode, inputs: NodeExec[]): NodeExec {
  const cfg = OutputConfigSchema.parse(node.data.config ?? {});
  const input = inputs[0];
  if (!input || input.status !== "ok") {
    return {
      status: "error",
      nodeType: "output",
      error: "Output needs one connected input.",
      recordsIn: 0,
      recordsOut: 0,
      sample: [],
      outputSchema: [],
    };
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
    sample: input.sample,
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
    recordsIn: input.recordsOut,
    recordsOut: 1,
    sample: input.sample,
    outputSchema: [],
    tile,
  };
}

// ---------- helpers ----------
function requireDataset(inputs: NodeExec[], nodeName: string): Dataset {
  const input = inputs[0];
  if (!input) throw new Error(`${nodeName} needs a connected input.`);
  if (input.status !== "ok") throw new Error(`${nodeName}'s input has an error.`);
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
      const week = isoWeek(d);
      return `${week.year}-W${String(week.week).padStart(2, "0")}`;
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

/** Kahn topological sort; ignores nodes in cycles (validation catches those). */
function topoSort(graph: FlowGraph): string[] {
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

function ancestorsOf(target: string, incoming: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    for (const src of incoming.get(id) ?? []) {
      if (!seen.has(src)) {
        seen.add(src);
        stack.push(src);
      }
    }
  }
  return seen;
}
