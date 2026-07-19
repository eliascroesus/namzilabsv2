import type { Node, Edge } from "@xyflow/react";
import { STANDARD_FIELDS, walkPath } from "@/lib/flow/records";
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
  status?: "ready" | "setup" | "updating" | "error";
  isTerminal?: boolean;
  issue?: string;
  freeHandles?: Array<{ id: string; label: string }>;
  onAddFrom?: (sourceNodeId: string, sourceHandle?: string | null) => void;
  [k: string]: unknown;
};
export type FNode = Node<NodeData>;

export type Rule = { field: string; op: string; value: string; value2?: string; valueKind?: "fixed" | "field"; valueField?: string };
export type Filters = { combinator: string; rules: Rule[] };

export type PickField = { path: string; label: string; type?: string; example?: unknown; container?: boolean };
export type FieldGroup = {
  from: string;
  stepNo?: number;
  system?: boolean;
  /** Source app key of this group's nearest App ancestor (drives icon + brand colour). */
  appSource?: string;
  /** The selected preview record this group's examples were resolved from (for lazy nested expansion). */
  sampleRecord?: unknown;
  fields: PickField[];
};

export type MetricSpecT = { nodeId: string; enabled: boolean; name: string; viz: string; format: string; unit?: string; currency?: string; precision: number; target: number | null };
export type Graph = {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
  metrics: MetricSpecT[];
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

/**
 * Managed top-to-bottom layout. Positions are always computed (users never place
 * nodes): depth flows downward via longest-path layering, and each layer is centred
 * horizontally so branches (Paths) fan out symmetrically.
 */
export function computeVerticalLayout(nodes: FNode[], edges: Edge[]): Map<string, { x: number; y: number }> {
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
  const depth = new Map<string, number>();
  const indeg2 = new Map(indeg);
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const nx of adj.get(id) ?? []) {
      depth.set(nx, Math.max(depth.get(nx) ?? 0, (depth.get(id) ?? 0) + 1));
      indeg2.set(nx, (indeg2.get(nx) ?? 0) - 1);
      if (indeg2.get(nx) === 0) queue.push(nx);
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }
  const COL = 288;
  const ROW = 168;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of byDepth) {
    const total = ids.length;
    ids.forEach((id, i) => pos.set(id, { x: (i - (total - 1) / 2) * COL, y: d * ROW }));
  }
  return pos;
}

/** Nodes with no outgoing edge — the "ends" of the flow (per branch). */
export function terminalIds(nodes: FNode[], edges: Edge[]): Set<string> {
  const hasOut = new Set(edges.map((e) => e.source));
  return new Set(nodes.filter((n) => !hasOut.has(n.id)).map((n) => n.id));
}

/** Whether a step still needs required setup before it can produce a result. */
export function nodeNeedsSetup(type: string, cfg: Record<string, unknown>, inputCount: number): boolean {
  if (type === "app") return !cfg.connectionId && !cfg.source;
  if (type === "formula") return inputCount < 2;
  if (type === "calculate") return String(cfg.mode ?? "number") === "compare" ? inputCount < 2 : inputCount === 0;
  if (type === "output") return inputCount === 0 || !String(cfg.name ?? "").trim();
  return inputCount === 0;
}

/** The single user-facing status for a step: Ready / Needs setup / Updating / Error. */
export function computeNodeStatus(opts: {
  type: string;
  cfg: Record<string, unknown>;
  inputCount: number;
  lastTest?: { status?: string } | null;
  dirty?: boolean;
  updating?: boolean;
}): "ready" | "setup" | "updating" | "error" {
  const { type, cfg, inputCount, lastTest, dirty, updating } = opts;
  if (nodeNeedsSetup(type, cfg, inputCount)) return "setup";
  if (updating) return "updating";
  if (lastTest?.status === "error") return "error";
  if (!lastTest || dirty) return "updating";
  return "ready";
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

/**
 * Resolve a field path against a sample record (client mirror of records.getField),
 * including nested objects/arrays via dotted segments + numeric indices.
 */
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
      if (props == null) return undefined;
      const rest = path.startsWith("properties.") ? path.slice("properties.".length) : path;
      if (Object.prototype.hasOwnProperty.call(props, rest)) return props[rest];
      return walkPath(props, rest);
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
      // W3b: examples come from the field's nearest App ancestor's *selected* preview
      // record, so changing the record updates values everywhere. Transform-added fields
      // (absent on the app record) fall back to the direct upstream's own sample.
      const app = nearestAppAncestor(sn, nodes, edges);
      const appChosen = app ? chosenSample(app, sampleIndexOf) : undefined;
      const upChosen = chosenSample(sn, sampleIndexOf);
      const custom: PickField[] = [];
      for (const f of schema) {
        let ex = appChosen !== undefined ? resolveSampleField(appChosen, f.path) : undefined;
        if (ex === undefined) ex = upChosen !== undefined ? resolveSampleField(upChosen, f.path) : f.example;
        if (stdSet.has(f.path)) {
          const sys = systemFields.find((s) => s.path === f.path);
          if (sys && sys.example === undefined) sys.example = ex;
        } else {
          custom.push({ path: f.path, label: f.label, type: f.type, example: ex, container: f.container });
        }
      }
      if (custom.length) {
        groups.push({
          from: titleOf(sn),
          stepNo: stepNoById.get(sid),
          appSource: app ? String((app.data.config as { source?: unknown }).source ?? "") : undefined,
          sampleRecord: appChosen ?? upChosen,
          fields: custom,
        });
      }
    }
  }

  // Source fields first; canonical/system fields last (rendered collapsed).
  return [...groups, { from: "System fields", system: true, fields: systemFields }];
}

/** The selected preview record for a node (its `sampleIndex`, else the first sample). */
function chosenSample(node: FNode, sampleIndexOf?: (n: FNode) => number): unknown {
  const sample = (node.data.lastTest?.sample ?? []) as unknown[];
  const idx = sampleIndexOf ? sampleIndexOf(node) : 0;
  return sample[idx] ?? sample[0];
}

/** Walk upstream from a node to the nearest App source (itself if it is one). */
function nearestAppAncestor(start: FNode, nodes: FNode[], edges: Edge[]): FNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const guard = new Set<string>();
  let cur: FNode | undefined = start;
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.type === "app") return cur;
    const up = edges.find((e) => e.target === cur!.id);
    cur = up ? byId.get(up.source) : undefined;
  }
  return undefined;
}

/** Last segment of a dotted path, used as a fallback label for nested fields. */
export function lastSegment(path: string): string {
  const seg = path.split(".").pop() ?? path;
  return STD_META[path]?.label ?? seg;
}

/**
 * Resolve a picked field path (including lazily-expanded nested paths not present in
 * the flat field list) to its provenance: originating step, source app, human label,
 * and the sample value from the selected preview record. Drives the data pill.
 */
export function fieldProvenance(
  fieldGroups: FieldGroup[],
  path: string,
): { stepNo?: number; source?: string; from?: string; label: string; sample?: unknown; type?: string } {
  for (const g of fieldGroups) {
    const exact = g.fields.find((f) => f.path === path);
    if (exact) return { stepNo: g.stepNo, source: g.appSource, from: g.from, label: exact.label, sample: exact.example, type: exact.type };
  }
  // Nested (drilled-into) path: find the owning group by resolving against its sample.
  for (const g of fieldGroups) {
    if (g.system) continue;
    const val = resolveSampleField(g.sampleRecord, path);
    if (val !== undefined) {
      const type = Array.isArray(val) ? "list" : val && typeof val === "object" ? "object" : typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "text";
      return { stepNo: g.stepNo, source: g.appSource, from: g.from, label: lastSegment(path), sample: val, type };
    }
  }
  return { label: lastSegment(path) };
}

// ---------- Flow check rail ----------

export type FlowCheck = { nodeId?: string; title: string; impact: string; fixLabel: string };

/** Count rules that map to a field but haven't chosen one. */
function mappedGaps(filters: unknown): number {
  const rules = ((filters as { rules?: Array<{ valueKind?: string; valueField?: string }> } | undefined)?.rules) ?? [];
  return rules.filter((r) => r.valueKind === "field" && !(r.valueField ?? "").trim()).length;
}

/**
 * Live, human-readable checks for the Flow check rail. Each item says what's wrong,
 * what it changes, and offers one action that jumps to the exact step. Runs on the
 * client so the rail updates as you build (no server round-trip).
 */
export function flowChecks(nodes: FNode[], edges: Edge[], titleOf: (n: FNode) => string): FlowCheck[] {
  const checks: FlowCheck[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (id: string) => edges.filter((e) => e.target === id);

  for (const n of nodes) {
    const title = titleOf(n);
    const cfg = n.data.config as Record<string, unknown>;
    const ins = incoming(n.id);

    if (n.type === "app") {
      if (!cfg.connectionId && !cfg.source) {
        checks.push({ nodeId: n.id, title: `“${title}” has no data source`, impact: "Nothing after it can run until this step loads data.", fixLabel: "Choose an account" });
      }
      continue;
    }

    if (ins.length === 0 && n.type !== "output") {
      checks.push({ nodeId: n.id, title: `“${title}” isn’t connected to anything`, impact: "It has no records to work with, so it produces nothing.", fixLabel: "Connect an input" });
    }

    if (n.type === "formula") {
      const aOk = ins.some((e) => e.targetHandle === "a");
      const bOk = ins.some((e) => e.targetHandle === "b");
      if (!aOk || !bOk) {
        checks.push({ nodeId: n.id, title: `“${title}” needs two numbers`, impact: "A rate or ratio needs a number in both A and B.", fixLabel: "Connect A and B" });
      }
      for (const e of ins) {
        const src = byId.get(e.source);
        if (src?.type === "aggregate") {
          const gb = (src.data.config as { groupBy?: { type?: string; unit?: string; field?: string } | null }).groupBy;
          if (gb) {
            const by = gb.type === "time" ? `by ${gb.unit}` : `by ${gb.field}`;
            checks.push({
              nodeId: src.id,
              title: `“${title}” can’t be calculated`,
              impact: `“${titleOf(src)}” is grouped ${by}, so it’s a series of numbers, not one total. Change it to one total number.`,
              fixLabel: `Fix “${titleOf(src)}”`,
            });
          }
        }
      }
    }

    if (n.type === "output") {
      if (ins.length === 0) checks.push({ nodeId: n.id, title: `“${title}” has nothing to show`, impact: "Connect a step that produces a number or records.", fixLabel: "Connect an input" });
      if (!String(cfg.name ?? "").trim()) checks.push({ nodeId: n.id, title: "Your metric needs a name", impact: "This is the label it shows under on the dashboard.", fixLabel: "Name this metric" });
    }

    // Conditions that map to a field but no field is chosen.
    let gaps = 0;
    if (n.type === "filter") gaps = mappedGaps(cfg);
    else if (n.type === "paths") gaps = ((cfg.paths as Array<{ filters?: unknown }>) ?? []).reduce((a, p) => a + mappedGaps(p.filters), 0);
    else if (n.type === "group") gaps = ((cfg.categories as Array<{ filters?: unknown }>) ?? []).reduce((a, c) => a + mappedGaps(c.filters), 0);
    if (gaps > 0) {
      checks.push({ nodeId: n.id, title: `“${title}” compares against a field that isn’t chosen`, impact: "Pick the field to compare against, or switch back to a fixed value.", fixLabel: "Open step" });
    }
  }

  if (!nodes.some((n) => n.type === "output")) {
    checks.push({ title: "No dashboard tile yet", impact: "Add a “Show on dashboard” step to save a metric.", fixLabel: "Add a step" });
  }

  return checks;
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
