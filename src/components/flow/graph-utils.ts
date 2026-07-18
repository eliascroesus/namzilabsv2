import type { Node, Edge } from "@xyflow/react";
import { STANDARD_FIELDS } from "@/lib/flow/records";
import type { NodeTestDTO } from "@/app/dashboard/flows/actions";

// ---------- Shared editor types ----------

export type ConnMeta = { id: string; name: string; source: string; eventTypes: string[]; syncStatus?: string };

export type NodeData = {
  config: Record<string, unknown>;
  label?: string;
  lastTest?: NodeTestDTO | null;
  dirty?: boolean;
  // Transient (display-only) fields injected before render — never persisted:
  stepNo?: number;
  onAddFrom?: (sourceNodeId: string, sourceHandle?: string | null) => void;
  [k: string]: unknown;
};
export type FNode = Node<NodeData>;

export type Rule = { field: string; op: string; value: string; value2?: string };
export type Filters = { combinator: string; rules: Rule[] };

export type PickField = { path: string; label: string; type?: string; example?: unknown };
export type FieldGroup = { from: string; stepNo?: number; system?: boolean; fields: PickField[] };

export type Graph = {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
};

export type LibraryCtx = { fromNodeId?: string; sourceHandle?: string | null; onEdge?: Edge } | null;

// ---------- Pure graph algorithms ----------

/** Assign 1-based step numbers in topological (top-to-bottom, left-to-right) order. */
export function computeStepNumbers(nodes: FNode[], edges: Edge[]): Map<string, number> {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const roots = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).sort((a, b) => a.position.y - b.position.y).map((n) => n.id);
  const queue = [...roots];
  const order = new Map<string, number>();
  let step = 1;
  while (queue.length) {
    const id = queue.shift()!;
    if (order.has(id)) continue;
    order.set(id, step++);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  for (const n of nodes) if (!order.has(n.id)) order.set(n.id, step++);
  return order;
}

/** Simple layered left-to-right layout for the "Auto layout" button. */
export function computeLayout(nodes: FNode[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const layer = new Map<string, number>();
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    layer.set(n.id, 0);
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of byLayer) {
    ids.forEach((idv, i) => pos.set(idv, { x: 60 + l * 300, y: 60 + i * 150 }));
  }
  return pos;
}

/** All nodes reachable downstream from `start` (excluding start). */
export function descendantsOf(start: string, edges: Edge[]): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of edges) if (e.source === id && !out.has(e.target)) { out.add(e.target); stack.push(e.target); }
  }
  return out;
}

// ---------- Delete & reconnect ----------

/**
 * The bridge edge that reconnects a node's single predecessor to its single
 * successor when the node is removed. Returns null unless the node has exactly
 * one incoming and one outgoing edge (multi-in/out nodes are deleted normally).
 */
export function bridgeEdgeFor(nodeId: string, edges: Edge[]): Edge | null {
  const incoming = edges.filter((e) => e.target === nodeId);
  const outgoing = edges.filter((e) => e.source === nodeId);
  if (incoming.length !== 1 || outgoing.length !== 1) return null;
  const i = incoming[0];
  const o = outgoing[0];
  return {
    id: `e_${Math.random().toString(36).slice(2, 9)}`,
    type: "insert",
    source: i.source,
    sourceHandle: i.sourceHandle ?? undefined,
    target: o.target,
    targetHandle: o.targetHandle ?? undefined,
  };
}

// ---------- Connection validity (shape compatibility) ----------

const DATASET_PRODUCERS = new Set(["app", "filter", "time", "formatter", "combine", "paths"]);
const SCALAR_PRODUCERS = new Set(["aggregate", "formula"]);
const VALUE_PRODUCERS = new Set(["aggregate", "formula", "group"]);

/** Whether a source→target connection is shape-compatible (mirrors validate.ts). */
export function isValidFlowConnection(sourceType: string, targetType: string): boolean {
  if (targetType === "app") return false; // App has no inputs.
  if (targetType === "formula") return SCALAR_PRODUCERS.has(sourceType); // A/B need scalars.
  if (targetType === "output") return DATASET_PRODUCERS.has(sourceType) || VALUE_PRODUCERS.has(sourceType);
  return DATASET_PRODUCERS.has(sourceType); // dataset consumers
}

// ---------- Variable picker fields ----------

/** Canonical (system) fields, grouped under a collapsed "System fields" section. */
export const STD_META: Record<string, { label: string; type: string }> = {
  subject: { label: "Subject / person", type: "text" },
  source: { label: "Source app", type: "text" },
  eventType: { label: "Event type", type: "text" },
  value: { label: "Value / amount", type: "number" },
  currency: { label: "Currency", type: "text" },
  occurredAt: { label: "Occurred at", type: "date" },
  id: { label: "Record id", type: "text" },
};

/** Resolve a field path against a sample record (client mirror of records.getField). */
export function resolveSampleField(rec: unknown, path: string): unknown {
  if (!rec || typeof rec !== "object") return undefined;
  const r = rec as Record<string, unknown>;
  switch (path) {
    case "subject":
    case "source":
    case "eventType":
    case "value":
    case "currency":
    case "occurredAt":
    case "id":
      return r[path];
    default: {
      const props = r.properties as Record<string, unknown> | undefined;
      const key = path.startsWith("properties.") ? path.slice("properties.".length) : path;
      return props?.[key];
    }
  }
}

/**
 * Build the variable-picker groups for the selected node: the actual fields
 * returned by each upstream source come first (with sample values from the
 * chosen sample record), and the canonical/system fields go last in their own
 * collapsible group.
 */
export function buildFieldGroups(opts: {
  selectedId: string | null;
  nodes: FNode[];
  edges: Edge[];
  stepNoById: Map<string, number>;
  titleOf: (n: FNode) => string;
  sampleIndexOf?: (n: FNode) => number;
}): FieldGroup[] {
  const { selectedId, nodes, edges, stepNoById, titleOf, sampleIndexOf } = opts;
  const stdSet = new Set<string>(STANDARD_FIELDS);
  const systemFields: PickField[] = STANDARD_FIELDS.map((p) => ({ path: p, label: STD_META[p]?.label ?? p, type: STD_META[p]?.type }));
  const groups: FieldGroup[] = [];

  if (selectedId) {
    const sourceIds = edges.filter((e) => e.target === selectedId).map((e) => e.source);
    for (const sid of sourceIds) {
      const sn = nodes.find((n) => n.id === sid);
      if (!sn) continue;
      const schema = sn.data.lastTest?.outputSchema ?? [];
      const sample = (sn.data.lastTest?.sample ?? []) as unknown[];
      const idx = sampleIndexOf ? sampleIndexOf(sn) : 0;
      const chosen = sample[idx] ?? sample[0];
      const custom: PickField[] = [];
      for (const f of schema) {
        const ex = chosen !== undefined ? resolveSampleField(chosen, f.path) : f.example;
        if (stdSet.has(f.path)) {
          const sys = systemFields.find((s) => s.path === f.path);
          if (sys && sys.example === undefined) sys.example = ex;
        } else {
          custom.push({ path: f.path, label: f.label, type: f.type, example: ex });
        }
      }
      if (custom.length) groups.push({ from: titleOf(sn), stepNo: stepNoById.get(sid), fields: custom });
    }
  }

  // Source fields first; canonical/system fields last (rendered collapsed).
  return [...groups, { from: "System fields", system: true, fields: systemFields }];
}

// ---------- Input descriptors (Combine / Formula config panels) ----------

export type InputDescriptor = {
  nodeId: string;
  targetHandle: string | null;
  stepNo?: number;
  title: string;
  type: string;
  status: "ok" | "error" | "dirty" | "untested";
  recordCount?: number;
  value?: unknown;
  calc?: string;
  appSource?: string;
  account?: string;
  eventType?: string;
  chain: string[];
  sample: unknown[];
  fieldPaths: string[];
};

function calcOf(node: FNode): string | undefined {
  const c = node.data.config as Record<string, unknown>;
  if (node.type === "aggregate") {
    const agg = String(c.aggregation ?? "count");
    if (agg === "count") return "Count";
    if (agg === "count_distinct") return `Distinct ${String(c.distinctField ?? "subject")}`;
    if (agg === "sum") return `Sum of ${String(c.field ?? "value")}`;
    if (agg === "avg") return `Average of ${String(c.field ?? "value")}`;
    if (agg === "min") return `Min of ${String(c.field ?? "value")}`;
    if (agg === "max") return `Max of ${String(c.field ?? "value")}`;
  }
  if (node.type === "formula") return "Formula";
  return undefined;
}

function statusFor(node: FNode): InputDescriptor["status"] {
  const t = node.data.lastTest;
  if (!t) return "untested";
  if (node.data.dirty) return "dirty";
  return t.status === "error" ? "error" : "ok";
}

/** Describe each connected input of a node, in connection order (for Combine/Formula panels). */
export function describeInputs(opts: { selectedId: string; nodes: FNode[]; edges: Edge[]; titleOf: (n: FNode) => string }): InputDescriptor[] {
  const { selectedId, nodes, edges, titleOf } = opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inEdges = edges.filter((e) => e.target === selectedId);

  return inEdges.map((e) => {
    const sn = byId.get(e.source);
    const desc: InputDescriptor = {
      nodeId: e.source,
      targetHandle: e.targetHandle ?? null,
      title: sn ? titleOf(sn) : e.source,
      type: sn ? String(sn.type) : "?",
      status: sn ? statusFor(sn) : "untested",
      recordCount: sn?.data.lastTest?.recordsOut,
      value: sn?.data.lastTest?.tile != null ? (sn.data.lastTest!.tile as { value?: unknown }).value : undefined,
      calc: sn ? calcOf(sn) : undefined,
      chain: [],
      sample: (sn?.data.lastTest?.sample ?? []) as unknown[],
      fieldPaths: (sn?.data.lastTest?.outputSchema ?? []).map((f) => f.path).filter((p) => !(p in STD_META)),
    };

    // Walk upstream to the nearest App ancestor, building the chain of titles.
    const chain: string[] = [];
    const guard = new Set<string>();
    let cur = sn;
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.unshift(titleOf(cur));
      if (cur.type === "app") {
        const c = cur.data.config as Record<string, unknown>;
        desc.appSource = (c.source as string) ?? undefined;
        desc.account = (c.connectionName as string) ?? undefined;
        desc.eventType = (c.eventType as string) ?? undefined;
        break;
      }
      const up = edges.find((x) => x.target === cur!.id);
      cur = up ? byId.get(up.source) : undefined;
    }
    desc.chain = chain;
    return desc;
  });
}

/** Field paths that appear in more than one input (Combine overwrite warning). */
export function collidingFields(inputs: InputDescriptor[]): string[] {
  const seen = new Map<string, number>();
  for (const i of inputs) for (const p of new Set(i.fieldPaths)) seen.set(p, (seen.get(p) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p);
}
