"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import {
  FILTER_OP_LABELS,
  PRIMARY_FILTER_OPS,
  NO_VALUE_FILTER_OPS,
  AGGREGATIONS,
  TIME_UNITS,
  VIZ_TYPES,
  TIME_PRESETS,
  FORMULA_OPS,
  FORMATTER_OPS,
  type NodeType,
  type FlowFilterOp,
} from "@/lib/flow/types";
import { STANDARD_FIELDS } from "@/lib/flow/records";
import {
  saveDraftAction,
  testNodeAction,
  publishFlowAction,
  renameFlowAction,
  type NodeTestDTO,
} from "@/app/dashboard/flows/actions";

export type ConnMeta = { id: string; name: string; source: string; eventTypes: string[]; syncStatus?: string };

type NodeData = {
  config: Record<string, unknown>;
  label?: string;
  lastTest?: NodeTestDTO | null;
  dirty?: boolean;
  // Transient (display-only) fields injected before render — never persisted:
  stepNo?: number;
  onAddFrom?: (sourceNodeId: string, sourceHandle?: string | null) => void;
  [k: string]: unknown;
};
type FNode = Node<NodeData>;
type Rule = { field: string; op: string; value: string; value2?: string };
type Filters = { combinator: string; rules: Rule[] };

type PickField = { path: string; label: string; type?: string; example?: unknown };
type FieldGroup = { from: string; stepNo?: number; fields: PickField[] };

type Graph = { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> };

const NODE_META: Record<NodeType, { label: string; blurb: string; accent: string; icon: string; category: string; keywords: string }> = {
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
const LIBRARY_ORDER = ["Sources", "Transform", "Combine", "Branch", "Math", "Output"];
const ALL_TYPES = Object.keys(NODE_META) as NodeType[];

const SOURCE_ICON: Record<string, string> = {
  calendly: "📅",
  close: "💼",
  instantly: "✉️",
  sendblue: "💬",
  gsheets: "📄",
  gcal: "📆",
  webhook: "🪝",
};

/** Filter operators shown under the "More" divider (everything not in the common set). */
const MORE_FILTER_OPS = (Object.keys(FILTER_OP_LABELS) as FlowFilterOp[]).filter((o) => !PRIMARY_FILTER_OPS.includes(o));

// ---------- Standard (canonical) fields the picker always shows ----------
const STD_META: Record<string, { label: string; type: string }> = {
  subject: { label: "Subject / person", type: "text" },
  source: { label: "Source app", type: "text" },
  eventType: { label: "Event type", type: "text" },
  value: { label: "Value / amount", type: "number" },
  currency: { label: "Currency", type: "text" },
  occurredAt: { label: "Occurred at", type: "date" },
  id: { label: "Record id", type: "text" },
};

function defaultConfig(type: NodeType): Record<string, unknown> {
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

// ---------- titles, summaries, formula expression ----------
function nodeIcon(type: NodeType, data: NodeData): string {
  if (type === "app") return SOURCE_ICON[String(data.config.source ?? "")] ?? NODE_META.app.icon;
  return NODE_META[type].icon;
}

function defaultTitle(type: NodeType, data: NodeData): string {
  const c = data.config;
  if (type === "app") return (c.connectionName as string) || "New app step";
  if (type === "output") return (c.name as string) || "New metric";
  return NODE_META[type].label;
}
function nodeTitle(type: NodeType, data: NodeData): string {
  const custom = typeof data.label === "string" ? data.label.trim() : "";
  return custom || defaultTitle(type, data);
}

/** Labels for the Formula's two named input handles, by operation. */
function formulaHandleLabels(op: string): { a: string; b: string } {
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
function formulaExpression(op: string, aName: string, bName: string): string {
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

function summary(type: string, data: NodeData): string {
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

function statusOf(data: NodeData): { label: string; cls: string } {
  if (data.dirty) return { label: "Retest", cls: "bg-amber-100 text-amber-700" };
  if (!data.lastTest) return { label: "Not tested", cls: "bg-neutral-100 text-neutral-500" };
  if (data.lastTest.status === "error") return { label: "Error", cls: "bg-red-100 text-red-700" };
  return { label: "Tested", cls: "bg-green-100 text-green-700" };
}

// ---------- Node card ----------
function FlowNodeCard({ id, type, data, selected }: NodeProps<FNode>) {
  const t = (type as NodeType) ?? "app";
  const meta = NODE_META[t];
  const s = statusOf(data);
  const test = data.lastTest;
  const isPaths = t === "paths";
  const isFormula = t === "formula";
  const fHandles = isFormula ? formulaHandleLabels(String(data.config.op ?? "percentage")) : null;

  return (
    <div className={`w-60 rounded-lg border bg-white shadow-sm ${meta.accent} ${selected ? "ring-2 ring-neutral-900" : ""}`}>
      {/* input handles */}
      {isFormula ? (
        <>
          <Handle type="target" id="a" position={Position.Left} style={{ top: "35%" }} />
          <Handle type="target" id="b" position={Position.Left} style={{ top: "65%" }} />
        </>
      ) : t !== "app" ? (
        <Handle type="target" position={Position.Left} />
      ) : null}

      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700">
          <span className="text-sm leading-none">{nodeIcon(t, data)}</span>
          <span>{data.stepNo != null ? `${data.stepNo}. ` : ""}{nodeTitle(t, data)}</span>
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
      </div>

      <div className="px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">{meta.label}</p>
        <p className="truncate text-sm text-neutral-700">{summary(t, data)}</p>

        {isFormula && fHandles && (
          <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>▸ {fHandles.a}</span>
            <span>▸ {fHandles.b}</span>
          </div>
        )}

        {isPaths && (
          <ul className="mt-1 space-y-0.5">
            {pathHandles(data).map((h) => (
              <li key={h.id} className="truncate text-right text-[10px] text-neutral-500">
                {h.label} &rarr;
              </li>
            ))}
          </ul>
        )}

        {test && test.status === "ok" && (
          <p className="mt-1 text-xs text-neutral-500">
            {t === "aggregate" || t === "formula" || t === "group"
              ? `= ${test.tile != null ? String((test.tile as { value?: unknown }).value ?? "") : test.recordsOut}`
              : `${test.recordsOut} of ${test.recordsIn} records passed`}
            {t === "output" && test.tile ? ` · ${String((test.tile as { value?: unknown }).value ?? "")}` : ""}
          </p>
        )}
        {test && test.status === "error" && <p className="mt-1 truncate text-xs text-red-600">{test.error}</p>}
      </div>

      {/* output handle(s) + contextual add button */}
      {isPaths ? (
        pathHandles(data).map((h, i, arr) => (
          <Handle key={h.id} type="source" id={h.id} position={Position.Right} title={h.label} style={{ top: `${((i + 1) / (arr.length + 1)) * 100}%` }} />
        ))
      ) : t !== "output" ? (
        <Handle type="source" position={Position.Right} />
      ) : null}

      {t !== "output" && !isPaths && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onAddFrom?.(id, null);
          }}
          title="Add a step after this one"
          className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-300 bg-white text-sm leading-none text-neutral-600 shadow-sm hover:bg-neutral-900 hover:text-white"
        >
          +
        </button>
      )}
    </div>
  );
}

function pathHandles(data: NodeData): Array<{ id: string; label: string }> {
  const paths = (data.config.paths as Array<{ id: string; label: string }>) ?? [];
  return [...paths, { id: String(data.config.fallbackId ?? "fallback"), label: String(data.config.fallbackLabel ?? "Fallback") }];
}

const SYNC_DOT: Record<string, string> = {
  live: "bg-green-500",
  synced: "bg-green-500",
  importing: "bg-blue-500",
  outdated: "bg-amber-500",
  error: "bg-red-500",
};
function SyncDot({ status }: { status: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full align-middle ${SYNC_DOT[status] ?? "bg-neutral-400"}`} />;
}
function syncStatusLabel(status: string): string {
  const map: Record<string, string> = { importing: "importing…", outdated: "outdated", error: "sync error" };
  return map[status] ?? status;
}

// ---------- Insertable edge (contextual "+" on a connection) ----------
function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const onInsert = (data as { onInsert?: (edgeId: string) => void } | undefined)?.onInsert;
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs leading-none text-neutral-600 shadow hover:bg-neutral-900 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onInsert?.(id);
          }}
          title="Insert a step here"
        >
          +
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = Object.fromEntries(ALL_TYPES.map((t) => [t, FlowNodeCard])) as Record<string, typeof FlowNodeCard>;
const edgeTypes = { insert: InsertEdge };

// ---------- graph helpers ----------
function computeStepNumbers(nodes: FNode[], edges: Edge[]): Map<string, number> {
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
  // Stable-ish order: seed roots by their vertical position so numbering reads top-down.
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
  // Any nodes left (cycles / disconnected) still get a number.
  for (const n of nodes) if (!order.has(n.id)) order.set(n.id, step++);
  return order;
}

function computeLayout(nodes: FNode[], edges: Edge[]): Map<string, { x: number; y: number }> {
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
function descendantsOf(start: string, edges: Edge[]): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of edges) if (e.source === id && !out.has(e.target)) { out.add(e.target); stack.push(e.target); }
  }
  return out;
}

export function FlowCanvas(props: {
  flowId: string;
  name: string;
  status: string;
  publishedVersion: number | null;
  initialGraph: { nodes: FNode[] | { id: string; type: string; position: { x: number; y: number }; data: { config?: unknown; label?: unknown; lastTest?: unknown } }[]; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> };
  connections: ConnMeta[];
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

type LibraryCtx = { fromNodeId?: string; sourceHandle?: string | null; onEdge?: Edge } | null;

function CanvasInner({ flowId, name: initialName, status, publishedVersion, initialGraph, connections }: Parameters<typeof FlowCanvas>[0]) {
  const initialNodes: FNode[] = useMemo(
    () =>
      initialGraph.nodes.map((n) => {
        const nn = n as { id: string; type: string; position: { x: number; y: number }; data: { config?: unknown; label?: unknown; lastTest?: unknown } };
        return {
          id: nn.id,
          type: nn.type,
          position: nn.position,
          data: {
            config: (nn.data?.config as Record<string, unknown>) ?? {},
            label: typeof nn.data?.label === "string" ? nn.data.label : undefined,
            lastTest: (nn.data?.lastTest as NodeTestDTO) ?? null,
            dirty: false,
          },
        } as FNode;
      }),
    [initialGraph],
  );
  const initialEdges: Edge[] = useMemo(
    () => initialGraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined })),
    [initialGraph],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [publishState, setPublishState] = useState<{ status: string; version: number | null }>({ status, version: publishedVersion });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishWarning, setPublishWarning] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ open: boolean; ctx: LibraryCtx }>({ open: false, ctx: null });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { fitView } = useReactFlow();

  const past = useRef<Array<{ nodes: FNode[]; edges: Edge[] }>>([]);
  const future = useRef<Array<{ nodes: FNode[]; edges: Edge[] }>>([]);
  const snapshot = useCallback(() => ({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }), [nodes, edges]);
  const commit = useCallback(() => {
    past.current.push(snapshot());
    if (past.current.length > 50) past.current.shift();
    future.current = [];
  }, [snapshot]);

  const toGraph = useCallback((): Graph => {
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: String(n.type), position: n.position, data: { config: n.data.config, label: n.data.label, lastTest: n.data.lastTest ?? undefined } })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
    };
  }, [nodes, edges]);

  // Autosave the draft (debounced). Never affects the published version.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setSaveState("unsaved");
    const t = setTimeout(async () => {
      setSaveState("saving");
      const r = await saveDraftAction(flowId, toGraph());
      setSaveState(r.ok ? "saved" : "error");
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, edges, flowId, toGraph]);

  const descendants = useCallback((start: string): Set<string> => descendantsOf(start, edges), [edges]);

  const markDirtyFrom = useCallback(
    (nodeId: string | null | undefined) => {
      if (!nodeId) return;
      const marks = descendants(nodeId);
      marks.add(nodeId);
      setNodes((ns) => ns.map((n) => (marks.has(n.id) ? { ...n, data: { ...n.data, dirty: true } } : n)));
    },
    [descendants, setNodes],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      commit();
      setEdges((eds) => addEdge({ ...c, type: "insert", id: `e_${Math.random().toString(36).slice(2, 9)}` }, eds));
      markDirtyFrom(c.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );

  /** Create a node (optionally connected from a source or inserted on an edge). */
  const createNode = useCallback(
    (type: NodeType, ctx: LibraryCtx) => {
      commit();
      const id = `${type}_${Math.random().toString(36).slice(2, 8)}`;
      let position = { x: 140 + (nodes.length % 4) * 40, y: 90 + nodes.length * 70 };

      if (ctx?.fromNodeId) {
        const src = nodes.find((n) => n.id === ctx.fromNodeId);
        if (src) position = { x: src.position.x + 300, y: src.position.y };
      } else if (ctx?.onEdge) {
        const src = nodes.find((n) => n.id === ctx.onEdge!.source);
        const tgt = nodes.find((n) => n.id === ctx.onEdge!.target);
        if (src && tgt) position = { x: (src.position.x + tgt.position.x) / 2, y: (src.position.y + tgt.position.y) / 2 };
      }

      const newNode: FNode = { id, type, position, data: { config: defaultConfig(type), lastTest: null, dirty: false } };
      setNodes((ns) => [...ns, newNode]);

      const targetHandleFor = (t: NodeType) => (t === "formula" ? "a" : undefined);
      if (ctx?.fromNodeId) {
        setEdges((es) => [
          ...es,
          { id: `e_${Math.random().toString(36).slice(2, 9)}`, type: "insert", source: ctx.fromNodeId!, sourceHandle: ctx.sourceHandle ?? undefined, target: id, targetHandle: targetHandleFor(type) },
        ]);
      } else if (ctx?.onEdge) {
        const old = ctx.onEdge;
        setEdges((es) => [
          ...es.filter((e) => e.id !== old.id),
          { id: `e_${Math.random().toString(36).slice(2, 9)}`, type: "insert", source: old.source, sourceHandle: old.sourceHandle, target: id, targetHandle: targetHandleFor(type) },
          { id: `e_${Math.random().toString(36).slice(2, 9)}`, type: "insert", source: id, target: old.target, targetHandle: old.targetHandle },
        ]);
      }
      setSelectedId(id);
    },
    [commit, nodes, setNodes, setEdges],
  );

  const addFromNode = useCallback((sourceNodeId: string, sourceHandle?: string | null) => {
    setLibrary({ open: true, ctx: { fromNodeId: sourceNodeId, sourceHandle } });
  }, []);
  const insertOnEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) setLibrary({ open: true, ctx: { onEdge: edge } });
    },
    [edges],
  );

  const updateConfig = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      commit();
      const marks = descendants(id);
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === id) return { ...n, data: { ...n.data, config: { ...n.data.config, ...patch }, dirty: true } };
          if (marks.has(n.id)) return { ...n, data: { ...n.data, dirty: true } };
          return n;
        }),
      );
    },
    [commit, descendants, setNodes],
  );

  const renameNode = useCallback(
    (id: string, label: string) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)));
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      commit();
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
    },
    [commit, setNodes, setEdges],
  );

  const duplicateNode = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id);
      if (!src) return;
      commit();
      const newId = `${src.type}_${Math.random().toString(36).slice(2, 8)}`;
      setNodes((ns) => [...ns, { ...src, id: newId, position: { x: src.position.x + 40, y: src.position.y + 40 }, data: { ...src.data, lastTest: null, dirty: true }, selected: false }]);
      setSelectedId(newId);
    },
    [commit, nodes, setNodes],
  );

  const testNode = useCallback(
    async (id: string) => {
      setTestingId(id);
      const result = await testNodeAction(toGraph(), id);
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, lastTest: result, dirty: false } } : n)));
      setTestingId(null);
    },
    [toGraph, setNodes],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snapshot());
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [snapshot, setNodes, setEdges]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshot());
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [snapshot, setNodes, setEdges]);

  const autoLayout = useCallback(() => {
    commit();
    const pos = computeLayout(nodes, edges);
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
  }, [commit, nodes, edges, setNodes, fitView]);

  const alignSelection = useCallback(() => {
    const sel = nodes.filter((n) => n.selected);
    if (sel.length < 2) return;
    commit();
    const y = Math.min(...sel.map((n) => n.position.y));
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, position: { ...n.position, y } } : n)));
  }, [commit, nodes, setNodes]);

  const toggleCollapse = useCallback(() => {
    if (!selectedId) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(selectedId)) next.delete(selectedId);
      else next.add(selectedId);
      return next;
    });
  }, [selectedId]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    setPublishWarning(null);
    await saveDraftAction(flowId, toGraph());
    const r = await publishFlowAction(flowId);
    if (r.ok) {
      setPublishState({ status: "published", version: r.version });
      if (r.warning) setPublishWarning(r.warning);
    } else {
      setPublishError(r.error);
    }
    setPublishing(false);
  }, [flowId, toGraph]);

  const onRename = useCallback(
    (v: string) => {
      setName(v);
      void renameFlowAction(flowId, v);
    },
    [flowId],
  );

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const stepNoById = useMemo(() => computeStepNumbers(nodes, edges), [nodes, edges]);

  // Fields available to the selected node's variable picker: canonical baseline
  // first, then custom (integration) fields from tested upstream nodes.
  const fieldGroups = useMemo<FieldGroup[]>(() => {
    const standard: PickField[] = STANDARD_FIELDS.map((p) => ({ path: p, label: STD_META[p]?.label ?? p, type: STD_META[p]?.type }));
    const stdSet = new Set<string>(STANDARD_FIELDS);
    const groups: FieldGroup[] = [];
    if (selected) {
      const sourceIds = edges.filter((e) => e.target === selected.id).map((e) => e.source);
      for (const sid of sourceIds) {
        const sn = nodes.find((n) => n.id === sid);
        const schema = sn?.data.lastTest?.outputSchema ?? [];
        const custom: PickField[] = [];
        for (const f of schema) {
          if (stdSet.has(f.path)) {
            const std = standard.find((s) => s.path === f.path);
            if (std && std.example === undefined) std.example = f.example;
          } else {
            custom.push({ path: f.path, label: f.label, type: f.type, example: f.example });
          }
        }
        if (custom.length && sn) {
          groups.push({ from: nodeTitle(String(sn.type) as NodeType, sn.data), stepNo: stepNoById.get(sid), fields: custom });
        }
      }
    }
    return [{ from: "Standard fields", fields: standard }, ...groups];
  }, [selected, edges, nodes, stepNoById]);

  // Inject transient display data + hide collapsed branches.
  const hiddenIds = useMemo(() => {
    const h = new Set<string>();
    for (const c of collapsed) for (const d of descendantsOf(c, edges)) h.add(d);
    return h;
  }, [collapsed, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        hidden: hiddenIds.has(n.id),
        data: { ...n.data, stepNo: stepNoById.get(n.id), onAddFrom: addFromNode },
      })),
    [nodes, hiddenIds, stepNoById, addFromNode],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: "insert",
        hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
        data: { ...(e.data ?? {}), onInsert: insertOnEdge },
      })),
    [edges, hiddenIds, insertOnEdge],
  );

  const empty = nodes.length === 0;

  return (
    <div className="flex h-screen flex-col">
      {/* Toolbar */}
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/flows" className="text-sm text-neutral-500 hover:text-neutral-800">
            &larr; Flows
          </Link>
          <input
            value={name}
            onChange={(e) => onRename(e.target.value)}
            className="rounded border border-transparent px-2 py-1 text-sm font-medium hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
          />
          <span className="text-xs text-neutral-400">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Unsaved"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLibrary({ open: true, ctx: null })} className="rounded-md bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-800">
            + Add step
          </button>
          <div className="mx-1 h-5 w-px bg-neutral-200" />
          <ToolButton onClick={autoLayout}>Auto layout</ToolButton>
          <ToolButton onClick={alignSelection}>Align</ToolButton>
          <ToolButton onClick={toggleCollapse}>{selectedId && collapsed.has(selectedId) ? "Expand" : "Collapse"}</ToolButton>
          <ToolButton onClick={() => fitView({ padding: 0.2, duration: 300 })}>Fit</ToolButton>
          <div className="mx-1 h-5 w-px bg-neutral-200" />
          <ToolButton onClick={undo}>Undo</ToolButton>
          <ToolButton onClick={redo}>Redo</ToolButton>
          {publishState.status === "published" && (
            <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">Published v{publishState.version}</span>
          )}
          <button onClick={publish} disabled={publishing} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      {publishError && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">Can&rsquo;t publish: {publishError}</div>}
      {publishWarning && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>{publishWarning}</span>
          <button onClick={() => setPublishWarning(null)} className="text-amber-700 hover:text-amber-900">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "insert" }}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>

          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto rounded-lg border border-dashed border-neutral-300 bg-white/80 p-8 text-center">
                <p className="text-sm text-neutral-600">Start by pulling data from an app.</p>
                <button onClick={() => setLibrary({ open: true, ctx: null })} className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
                  + Add your first step
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Config panel */}
        {selected && (
          <ConfigPanel
            key={selected.id}
            node={selected}
            stepNo={stepNoById.get(selected.id)}
            connections={connections}
            fieldGroups={fieldGroups}
            inputCount={edges.filter((e) => e.target === selected.id).length}
            testing={testingId === selected.id}
            onChange={(patch) => updateConfig(selected.id, patch)}
            onRename={(v) => renameNode(selected.id, v)}
            onTest={() => testNode(selected.id)}
            onDelete={() => deleteNode(selected.id)}
            onDuplicate={() => duplicateNode(selected.id)}
          />
        )}
      </div>

      {library.open && (
        <NodeLibraryModal
          onClose={() => setLibrary({ open: false, ctx: null })}
          onPick={(type) => {
            createNode(type, library.ctx);
            setLibrary({ open: false, ctx: null });
          }}
        />
      )}
    </div>
  );
}

function ToolButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">
      {children}
    </button>
  );
}

// ---------------- Node library modal ----------------

function NodeLibraryModal({ onClose, onPick }: { onClose: () => void; onPick: (type: NodeType) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${m.label} ${m.blurb} ${m.keywords} ${m.category}`.toLowerCase().includes(query);
  };
  const byCategory = LIBRARY_ORDER.map((cat) => ({ cat, types: ALL_TYPES.filter((t) => NODE_META[t].category === cat && matches(t)) })).filter((g) => g.types.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-neutral-100 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Add a step</h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
              ✕
            </button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps and tools…"
            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {byCategory.length === 0 && <p className="p-4 text-center text-sm text-neutral-500">No matches.</p>}
          {byCategory.map(({ cat, types }) => (
            <div key={cat} className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{cat}</p>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => (
                  <button key={t} onClick={() => onPick(t)} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-left hover:border-neutral-400 hover:bg-neutral-50">
                    <span className="text-lg leading-none">{NODE_META[t].icon}</span>
                    <span>
                      <span className="block text-sm font-medium">{NODE_META[t].label}</span>
                      <span className="block text-xs text-neutral-500">{NODE_META[t].blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- Config panel (guided Setup → Configure → Test) ----------------

type TabKey = "setup" | "configure" | "test";

/** Required setup still missing for this node (drives the guided CTA + checkmarks). */
function nodeRequirements(type: NodeType, cfg: Record<string, unknown>, inputCount: number): string[] {
  const miss: string[] = [];
  if (type === "app") {
    if (!cfg.connectionId && !cfg.source) miss.push("Choose a connected account");
  } else if (type === "formula") {
    if (inputCount < 2) miss.push("Connect a number to A and to B");
  } else if (inputCount === 0) {
    miss.push("Connect an input");
  }
  if (type === "output" && !String(cfg.name ?? "").trim()) miss.push("Name this metric");
  return miss;
}

function ConfigPanel({
  node,
  stepNo,
  connections,
  fieldGroups,
  inputCount,
  testing,
  onChange,
  onRename,
  onTest,
  onDelete,
  onDuplicate,
}: {
  node: FNode;
  stepNo?: number;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputCount: number;
  testing: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onRename: (v: string) => void;
  onTest: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const missing = nodeRequirements(type, cfg, inputCount);
  const setupDone = missing.length === 0;
  const tested = !!node.data.lastTest && node.data.lastTest.status === "ok" && !node.data.dirty;

  const [tab, setTab] = useState<TabKey>("configure");

  const tabs: Array<{ key: TabKey; label: string; done: boolean; enabled: boolean }> = [
    { key: "setup", label: "Setup", done: setupDone, enabled: true },
    { key: "configure", label: "Configure", done: setupDone, enabled: true },
    { key: "test", label: "Test", done: tested, enabled: setupDone },
  ];

  // Primary guided CTA.
  const cta = !setupDone
    ? { label: `Fix ${missing.length} required field${missing.length === 1 ? "" : "s"}`, run: () => setTab("configure") }
    : tab !== "test"
      ? { label: "Continue", run: () => setTab("test") }
      : { label: testing ? "Testing…" : tested ? "Re-test node" : "Test node", run: onTest };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          <span>{NODE_META[type].icon}</span>
          <span>{stepNo != null ? `Step ${stepNo} · ` : ""}{NODE_META[type].label}</span>
        </div>
        <input
          value={node.data.label ?? ""}
          onChange={(e) => onRename(e.target.value)}
          placeholder={defaultTitle(type, node.data)}
          className="mt-1 w-full rounded border border-transparent px-1 py-0.5 text-sm font-medium hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
        />
      </div>

      <div className="flex border-b border-neutral-200 text-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            disabled={!t.enabled}
            onClick={() => t.enabled && setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1 px-3 py-2 ${tab === t.key ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"} ${!t.enabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {t.done ? <span className="text-green-600">✓</span> : null}
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "setup" && (
          <div className="space-y-3 text-sm">
            {missing.length > 0 ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <p className="font-medium">Before this step works:</p>
                <ul className="mt-1 list-disc pl-4">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-800">Setup complete — configure and test this step.</p>
            )}
            <p className="text-neutral-500">
              Node id: <code className="text-xs">{node.id}</code>
            </p>
            <div className="flex gap-2">
              <button onClick={onDuplicate} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
                Duplicate
              </button>
              <button onClick={onDelete} className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">
                Delete
              </button>
            </div>
          </div>
        )}

        {tab === "configure" && <ConfigureTab type={type} cfg={cfg} connections={connections} fieldGroups={fieldGroups} inputCount={inputCount} onChange={onChange} />}

        {tab === "test" && <TestTab node={node} testing={testing} onTest={onTest} />}
      </div>

      <div className="border-t border-neutral-200 p-3">
        <button
          onClick={cta.run}
          disabled={testing}
          className={`w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${setupDone ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-amber-500 text-white hover:bg-amber-600"}`}
        >
          {cta.label}
        </button>
      </div>
    </aside>
  );
}

function ConfigureTab({
  type,
  cfg,
  connections,
  fieldGroups,
  inputCount,
  onChange,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  if (type === "app") {
    const connId = (cfg.connectionId as string) ?? "";
    const conn = connections.find((c) => c.id === connId);
    return (
      <div className="space-y-3 text-sm">
        <Field label="Connected account">
          <select
            value={connId}
            onChange={(e) => {
              const c = connections.find((x) => x.id === e.target.value);
              onChange({ connectionId: c?.id ?? null, connectionName: c?.name ?? null, source: c?.source ?? null, eventType: null });
            }}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
          >
            <option value="">Choose an account…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.source})
              </option>
            ))}
          </select>
        </Field>
        {conn?.syncStatus && (
          <p className="text-xs text-neutral-500">
            Data status: <SyncDot status={conn.syncStatus} /> {syncStatusLabel(conn.syncStatus)}
            {conn.syncStatus === "outdated" || conn.syncStatus === "error" ? (
              <>
                {" "}
                &middot;{" "}
                <a className="underline" href={`/connections/${conn.id}`}>
                  Manage
                </a>
              </>
            ) : null}
          </p>
        )}
        {connections.length === 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            No connected accounts yet. Connect one in <a className="underline" href="/integrations">Integrations</a>.
          </p>
        )}
        <Field label="Event type / data source">
          <select value={(cfg.eventType as string) ?? ""} onChange={(e) => onChange({ eventType: e.target.value || null })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="">All events</option>
            {(conn?.eventTypes ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <AdvancedSection>
          <Field label="Match records using">
            <FieldPicker value={(cfg.identityField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
          <p className="text-xs text-neutral-400">Used by downstream Combine / de-duplicate steps to recognise the same person.</p>
        </AdvancedSection>
      </div>
    );
  }

  if (type === "filter") {
    const fc: Filters = { combinator: (cfg.combinator as string) ?? "and", rules: (cfg.rules as Rule[]) ?? [] };
    return <RulesEditor value={fc} fieldGroups={fieldGroups} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />;
  }

  if (type === "time") {
    const mode = (cfg.mode as string) ?? "preset";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Date field">
          <FieldPicker value={(cfg.dateField as string) ?? "occurredAt"} fieldGroups={fieldGroups} onChange={(v) => onChange({ dateField: v })} />
        </Field>
        <Field label="Window">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="preset">Preset period</option>
            <option value="rolling">Rolling (last N days)</option>
            <option value="between">Between two dates</option>
          </select>
        </Field>
        {mode === "preset" && (
          <Field label="Period">
            <select value={(cfg.preset as string) ?? "last_30_days"} onChange={(e) => onChange({ preset: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              {TIME_PRESETS.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
          </Field>
        )}
        {mode === "rolling" && (
          <Field label="Last N days">
            <input type="number" value={Number(cfg.days ?? 30)} onChange={(e) => onChange({ days: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        {mode === "between" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <input type="date" value={(cfg.from as string) ?? ""} onChange={(e) => onChange({ from: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
            <Field label="To">
              <input type="date" value={(cfg.to as string) ?? ""} onChange={(e) => onChange({ to: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          </div>
        )}
      </div>
    );
  }

  if (type === "formula") {
    const op = String(cfg.op ?? "percentage");
    const labels = formulaHandleLabels(op);
    return (
      <div className="space-y-3 text-sm">
        <Field label="Calculation">
          <select value={op} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            {FORMULA_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
          <p className="font-medium">{formulaExpression(op, labels.a, labels.b)}</p>
          <p className="mt-1 text-indigo-700">
            Connect one number to <b>{labels.a}</b> (input A) and one to <b>{labels.b}</b> (input B). {inputCount < 2 ? `Connected: ${inputCount}/2.` : "Both inputs connected."}
          </p>
        </div>
      </div>
    );
  }

  if (type === "combine") {
    const mode = (cfg.mode as string) ?? "stack";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Mode">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="stack">Stack (combine all records)</option>
            <option value="dedupe">De-duplicate by identity</option>
            <option value="match">Match records by identity</option>
          </select>
        </Field>
        {(mode === "dedupe" || mode === "match") && (
          <Field label="Match records using">
            <FieldPicker value={(cfg.identityField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
        )}
        {mode === "match" && (
          <Field label="Keep">
            <select value={(cfg.keep as string) ?? "all"} onChange={(e) => onChange({ keep: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="all">All base records</option>
              <option value="matched">Only matched</option>
              <option value="unmatched">Only unmatched</option>
            </select>
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <AdvancedSection>
            <Field label="When duplicated, which source wins">
              <select value={(cfg.sourceWins as string) ?? "first"} onChange={(e) => onChange({ sourceWins: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
                <option value="first">First connected input</option>
                <option value="last">Last connected input</option>
              </select>
            </Field>
          </AdvancedSection>
        )}
      </div>
    );
  }

  if (type === "paths") {
    const paths = (cfg.paths as Array<{ id: string; label: string; filters: Filters }>) ?? [];
    const setPath = (i: number, patch: Record<string, unknown>) => onChange({ paths: paths.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
    return (
      <div className="space-y-3 text-sm">
        {paths.map((p, i) => (
          <div key={p.id} className="space-y-2 rounded border border-neutral-200 p-2">
            <input value={p.label} onChange={(e) => setPath(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
            <RulesEditor value={p.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setPath(i, { filters: v })} />
            {paths.length > 1 && (
              <button onClick={() => onChange({ paths: paths.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
                Remove path
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => onChange({ paths: [...paths, { id: `p${Math.random().toString(36).slice(2, 7)}`, label: `Path ${paths.length + 1}`, filters: { combinator: "and", rules: [] } }] })}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          + Add path
        </button>
        <Field label="Fallback label (unmatched records)">
          <input value={(cfg.fallbackLabel as string) ?? "Fallback"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
      </div>
    );
  }

  if (type === "group") {
    const mode = (cfg.mode as string) ?? "field";
    const agg = (cfg.aggregation as string) ?? "count";
    const cats = (cfg.categories as Array<{ label: string; filters: Filters }>) ?? [];
    const setCat = (i: number, patch: Record<string, unknown>) => onChange({ categories: cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    return (
      <div className="space-y-3 text-sm">
        <Field label="Group by">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="field">A field value</option>
            <option value="categories">Custom categories</option>
          </select>
        </Field>
        {mode === "field" && (
          <Field label="Field">
            <FieldPicker value={(cfg.field as string) ?? "source"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
          </Field>
        )}
        {mode === "categories" && (
          <div className="space-y-2">
            {cats.map((c, i) => (
              <div key={i} className="space-y-2 rounded border border-neutral-200 p-2">
                <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
                <RulesEditor value={c.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setCat(i, { filters: v })} />
                <button onClick={() => onChange({ categories: cats.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
                  Remove category
                </button>
              </div>
            ))}
            <button onClick={() => onChange({ categories: [...cats, { label: `Category ${cats.length + 1}`, filters: { combinator: "and", rules: [] } }] })} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
              + Add category
            </button>
            <Field label="Fallback label">
              <input value={(cfg.fallbackLabel as string) ?? "Other"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          </div>
        )}
        <Field label="Value per group">
          <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="count">Count</option>
            <option value="sum">Sum of a field</option>
            <option value="count_distinct">Count distinct</option>
          </select>
        </Field>
        {agg === "sum" && (
          <Field label="Sum field">
            <FieldPicker value={(cfg.valueField as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ valueField: v })} />
          </Field>
        )}
      </div>
    );
  }

  if (type === "formatter") {
    const op = (cfg.op as string) ?? "round";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Field to format">
          <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
        </Field>
        <Field label="Operation">
          <select value={op} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            {FORMATTER_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {op === "round" && (
          <Field label="Decimals">
            <input type="number" value={Number(cfg.decimals ?? 2)} onChange={(e) => onChange({ decimals: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        {op === "replace" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Find">
              <input value={(cfg.find as string) ?? ""} onChange={(e) => onChange({ find: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
            <Field label="Replace with">
              <input value={(cfg.replaceWith as string) ?? ""} onChange={(e) => onChange({ replaceWith: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          </div>
        )}
        {op === "default" && (
          <Field label="Value for empty">
            <input value={(cfg.defaultValue as string) ?? ""} onChange={(e) => onChange({ defaultValue: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        {(op === "multiply" || op === "divide") && (
          <Field label="Factor">
            <input type="number" value={cfg.factor != null ? Number(cfg.factor) : ""} onChange={(e) => onChange({ factor: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        <AdvancedSection>
          <Field label="Save to field (defaults to same field)">
            <input value={(cfg.outputField as string) ?? ""} onChange={(e) => onChange({ outputField: e.target.value || undefined })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        </AdvancedSection>
      </div>
    );
  }

  if (type === "aggregate") {
    const agg = (cfg.aggregation as string) ?? "count";
    const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string } | null) ?? null;
    const gbMode = gb ? gb.type : "none";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Calculation">
          <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            {AGGREGATIONS.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {(agg === "sum" || agg === "avg" || agg === "min" || agg === "max") && (
          <Field label="Number field">
            <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
          </Field>
        )}
        {agg === "count_distinct" && (
          <Field label="Distinct by">
            <FieldPicker value={(cfg.distinctField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ distinctField: v })} />
          </Field>
        )}
        <Field label="Group by">
          <select
            value={gbMode}
            onChange={(e) => {
              const m = e.target.value;
              if (m === "none") onChange({ groupBy: null });
              else if (m === "time") onChange({ groupBy: { type: "time", unit: "day" } });
              else onChange({ groupBy: { type: "field", field: "source" } });
            }}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
          >
            <option value="none">No grouping (single number)</option>
            <option value="time">Time period (trend)</option>
            <option value="field">A field (breakdown)</option>
          </select>
        </Field>
        {gb?.type === "time" && (
          <Field label="Period">
            <select value={gb.unit} onChange={(e) => onChange({ groupBy: { type: "time", unit: e.target.value } })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              {TIME_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
        )}
        {gb?.type === "field" && (
          <Field label="Field">
            <FieldPicker value={gb.field ?? "source"} fieldGroups={fieldGroups} onChange={(v) => onChange({ groupBy: { type: "field", field: v } })} />
          </Field>
        )}
      </div>
    );
  }

  // output
  return (
    <div className="space-y-3 text-sm">
      <Field label="Metric name">
        <input value={(cfg.name as string) ?? ""} onChange={(e) => onChange({ name: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
      </Field>
      <Field label="Display as">
        <select value={(cfg.viz as string) ?? "number"} onChange={(e) => onChange({ viz: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
          {VIZ_TYPES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Format">
        <select value={(cfg.format as string) ?? "number"} onChange={(e) => onChange({ format: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
          <option value="number">Number</option>
          <option value="percent">Percentage</option>
          <option value="currency">Currency</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit">
          <input value={(cfg.unit as string) ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
        <Field label="Decimals">
          <input type="number" value={Number(cfg.precision ?? 0)} onChange={(e) => onChange({ precision: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
      </div>
      <Field label="Goal / target (optional)">
        <input type="number" value={cfg.target != null ? Number(cfg.target) : ""} onChange={(e) => onChange({ target: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
      </Field>
    </div>
  );
}

function TestTab({ node, testing, onTest }: { node: FNode; testing: boolean; onTest: () => void }) {
  const t = node.data.lastTest;
  const type = String(node.type);
  return (
    <div className="space-y-3 text-sm">
      <button onClick={onTest} disabled={testing} className="w-full rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
        {testing ? "Testing…" : node.data.lastTest ? "Test again" : "Test this node"}
      </button>
      {node.data.dirty && <p className="text-xs text-amber-700">This node changed — retest to refresh its data.</p>}
      {t && t.status === "error" && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{t.error}</p>}
      {t && t.status === "ok" && (
        <div className="space-y-3">
          <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-center font-medium">
            {type === "aggregate" || type === "formula" || type === "group"
              ? `Result: ${t.tile != null ? String((t.tile as { value?: unknown }).value ?? "—") : "—"}`
              : `${t.recordsOut} of ${t.recordsIn} records passed`}
          </p>
          {type === "output" && t.tile ? (
            <div className="rounded border border-green-200 bg-green-50 p-2">
              <span className="text-neutral-500">Dashboard value</span>{" "}
              <span className="font-semibold">{String((t.tile as { value?: unknown }).value ?? "—")}</span>
            </div>
          ) : null}
          <BeforeAfter before={t.inputSample ?? []} after={t.sample} />
        </div>
      )}
    </div>
  );
}

function BeforeAfter({ before, after }: { before: unknown[]; after: unknown[] }) {
  const render = (r: unknown) => {
    const rec = r as { source?: string; eventType?: string; subject?: string; value?: unknown };
    return `${rec.source ?? ""} · ${rec.eventType ?? ""}${rec.subject ? ` · ${rec.subject}` : ""}${rec.value != null ? ` · ${String(rec.value)}` : ""}`;
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Before ({before.length})</p>
        <div className="space-y-1">
          {before.length === 0 && <p className="text-xs text-neutral-400">—</p>}
          {before.slice(0, 3).map((r, i) => (
            <div key={i} className="truncate rounded border border-neutral-100 bg-neutral-50 p-1.5 text-[11px]">{render(r)}</div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">After ({after.length})</p>
        <div className="space-y-1">
          {after.length === 0 && <p className="text-xs text-neutral-400">—</p>}
          {after.slice(0, 3).map((r, i) => (
            <div key={i} className="truncate rounded border border-green-100 bg-green-50 p-1.5 text-[11px]">{render(r)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Reusable AND/OR rule list, used by Filter, Paths, and Group categories. */
function RulesEditor({ value, fieldGroups, onChange }: { value: Filters; fieldGroups: FieldGroup[]; onChange: (v: Filters) => void }) {
  const rules = value.rules ?? [];
  const setRule = (i: number, patch: Partial<Rule>) => onChange({ ...value, rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2 text-sm">
      {rules.length > 1 && (
        <select value={value.combinator} onChange={(e) => onChange({ ...value, combinator: e.target.value })} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
          <option value="and">Match ALL rules</option>
          <option value="or">Match ANY rule</option>
        </select>
      )}
      {rules.map((r, i) => (
        <div key={i} className="space-y-1 rounded border border-neutral-200 p-2">
          <FieldPicker value={r.field} fieldGroups={fieldGroups} onChange={(v) => setRule(i, { field: v })} />
          <div className="flex gap-1">
            <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} className="rounded-md border border-neutral-300 px-1 py-1 text-xs">
              <optgroup label="Common">
                {PRIMARY_FILTER_OPS.map((o) => (
                  <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>
                ))}
              </optgroup>
              <optgroup label="More">
                {MORE_FILTER_OPS.map((o) => (
                  <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>
                ))}
              </optgroup>
            </select>
            {!NO_VALUE_FILTER_OPS.includes(r.op as FlowFilterOp) && (
              <input value={r.value ?? ""} placeholder="value" onChange={(e) => setRule(i, { value: e.target.value })} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
            )}
            {r.op === "between" && (
              <input value={r.value2 ?? ""} placeholder="to" onChange={(e) => setRule(i, { value2: e.target.value })} className="w-14 rounded-md border border-neutral-300 px-1 py-1 text-xs" />
            )}
          </div>
          <button onClick={() => onChange({ ...value, rules: rules.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
            Remove
          </button>
        </div>
      ))}
      <button onClick={() => onChange({ ...value, rules: [...rules, { field: "eventType", op: "equals", value: "" }] })} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50">
        + Add rule
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function AdvancedSection({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded border border-neutral-200 p-2">
      <summary className="cursor-pointer text-xs font-medium text-neutral-500">Advanced</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

/** Field input with a searchable variable picker grouped by previous step. */
function FieldPicker({ value, fieldGroups, onChange }: { value: string; fieldGroups: FieldGroup[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = fieldGroups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !query || `${f.label} ${f.path}`.toLowerCase().includes(query)) }))
    .filter((g) => g.fields.length > 0);

  const example = (ex: unknown) => {
    if (ex == null) return null;
    const s = String(ex);
    return s.length > 22 ? `${s.slice(0, 22)}…` : s;
  };

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="field (e.g. subject or properties.plan)" className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
        <button type="button" onClick={() => setOpen((o) => !o)} title="Insert a field from a previous step" className="w-7 rounded-md border border-neutral-300 text-xs hover:bg-neutral-50">
          +
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
          {groups.length === 0 && <p className="p-2 text-center text-xs text-neutral-400">No fields. Test upstream steps to load their fields.</p>}
          {groups.map((g) => (
            <div key={g.from} className="mb-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {g.stepNo != null ? `${g.stepNo}. ` : ""}{g.from}
              </p>
              <div className="space-y-0.5">
                {g.fields.map((f) => (
                  <button
                    key={`${g.from}:${f.path}`}
                    type="button"
                    onClick={() => {
                      onChange(f.path);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-neutral-700">{f.label}</span>
                      {f.example != null && <span className="block truncate text-[10px] text-neutral-400">{example(f.example)}</span>}
                    </span>
                    {f.type && <span className="shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-[9px] uppercase text-neutral-500">{f.type}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
