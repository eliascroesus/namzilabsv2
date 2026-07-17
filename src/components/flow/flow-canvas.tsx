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
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import { FLOW_FILTER_OPS, AGGREGATIONS, TIME_UNITS, VIZ_TYPES, TIME_PRESETS, FORMULA_OPS, FORMATTER_OPS, type NodeType } from "@/lib/flow/types";
import {
  saveDraftAction,
  testNodeAction,
  publishFlowAction,
  renameFlowAction,
  type NodeTestDTO,
} from "@/app/dashboard/flows/actions";

export type ConnMeta = { id: string; name: string; source: string; eventTypes: string[] };

type NodeData = {
  config: Record<string, unknown>;
  lastTest?: NodeTestDTO | null;
  dirty?: boolean;
  [k: string]: unknown;
};
type FNode = Node<NodeData>;
type Rule = { field: string; op: string; value: string; value2?: string };
type Filters = { combinator: string; rules: Rule[] };
type UpstreamField = { path: string; label: string; from: string };

type Graph = { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> };

const NODE_META: Record<NodeType, { label: string; blurb: string; accent: string }> = {
  app: { label: "App", blurb: "Pull records from a connected app", accent: "border-blue-300" },
  filter: { label: "Filter", blurb: "Keep only matching records", accent: "border-amber-300" },
  aggregate: { label: "Aggregate", blurb: "Turn records into a number", accent: "border-violet-300" },
  output: { label: "Output", blurb: "Save a metric to the dashboard", accent: "border-green-300" },
  combine: { label: "Combine", blurb: "Merge records from multiple inputs", accent: "border-cyan-300" },
  paths: { label: "Paths", blurb: "Split records into branches", accent: "border-pink-300" },
  group: { label: "Group", blurb: "Group records into categories", accent: "border-orange-300" },
  formula: { label: "Formula", blurb: "Calculate with numbers", accent: "border-indigo-300" },
  formatter: { label: "Formatter", blurb: "Clean & reshape field values", accent: "border-teal-300" },
  time: { label: "Time", blurb: "Limit records to a time window", accent: "border-sky-300" },
};
const PALETTE: NodeType[] = ["app", "time", "filter", "formatter", "combine", "paths", "group", "aggregate", "formula", "output"];

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
  if (type === "output") return `${(c.name as string) ?? "Output"} · ${(c.viz as string) ?? "number"}`;
  if (type === "time") {
    const mode = String(c.mode ?? "preset");
    return mode === "preset" ? String(c.preset ?? "last_30_days").replace(/_/g, " ") : mode === "rolling" ? `last ${c.days ?? 30} days` : "between dates";
  }
  if (type === "formula") return String(c.op ?? "percentage").replace(/_/g, " ");
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

function FlowNodeCard({ id, type, data, selected }: NodeProps<FNode>) {
  const meta = NODE_META[(type as NodeType) ?? "app"];
  const s = statusOf(data);
  const t = data.lastTest;
  return (
    <div className={`w-56 rounded-lg border bg-white shadow-sm ${meta.accent} ${selected ? "ring-2 ring-neutral-900" : ""}`}>
      {type !== "app" && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{meta.label}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium text-neutral-800">{summary(type, data)}</p>
        {type === "paths" && (
          <ul className="mt-1 space-y-0.5">
            {pathHandles(data).map((h) => (
              <li key={h.id} className="truncate text-right text-[10px] text-neutral-500">
                {h.label} &rarr;
              </li>
            ))}
          </ul>
        )}
        {t && t.status === "ok" && (
          <p className="mt-1 text-xs text-neutral-500">
            {t.recordsIn}&rarr;{t.recordsOut}
            {type === "output" && t.tile ? ` · ${String((t.tile as { value?: unknown }).value ?? "")}` : ""}
          </p>
        )}
        {t && t.status === "error" && <p className="mt-1 truncate text-xs text-red-600">{t.error}</p>}
      </div>
      {type === "paths" ? (
        pathHandles(data).map((h, i, arr) => (
          <Handle key={h.id} type="source" id={h.id} position={Position.Right} title={h.label} style={{ top: `${((i + 1) / (arr.length + 1)) * 100}%` }} />
        ))
      ) : type !== "output" ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

function pathHandles(data: NodeData): Array<{ id: string; label: string }> {
  const paths = (data.config.paths as Array<{ id: string; label: string }>) ?? [];
  return [...paths, { id: String(data.config.fallbackId ?? "fallback"), label: String(data.config.fallbackLabel ?? "Fallback") }];
}

const nodeTypes = {
  app: FlowNodeCard,
  filter: FlowNodeCard,
  aggregate: FlowNodeCard,
  output: FlowNodeCard,
  time: FlowNodeCard,
  formatter: FlowNodeCard,
  combine: FlowNodeCard,
  paths: FlowNodeCard,
  group: FlowNodeCard,
  formula: FlowNodeCard,
};

export function FlowCanvas(props: {
  flowId: string;
  name: string;
  status: string;
  publishedVersion: number | null;
  initialGraph: { nodes: FNode[] | { id: string; type: string; position: { x: number; y: number }; data: { config?: unknown; lastTest?: unknown } }[]; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> };
  connections: ConnMeta[];
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ flowId, name: initialName, status, publishedVersion, initialGraph, connections }: Parameters<typeof FlowCanvas>[0]) {
  const initialNodes: FNode[] = useMemo(
    () =>
      initialGraph.nodes.map((n) => {
        const nn = n as { id: string; type: string; position: { x: number; y: number }; data: { config?: unknown; lastTest?: unknown } };
        return {
          id: nn.id,
          type: nn.type,
          position: nn.position,
          data: { config: (nn.data?.config as Record<string, unknown>) ?? {}, lastTest: (nn.data?.lastTest as NodeTestDTO) ?? null, dirty: false },
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
  const [publishing, setPublishing] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

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
      nodes: nodes.map((n) => ({ id: n.id, type: String(n.type), position: n.position, data: { config: n.data.config, lastTest: n.data.lastTest ?? undefined } })),
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

  const onConnect = useCallback(
    (c: Connection) => {
      commit();
      setEdges((eds) => addEdge({ ...c, id: `e_${Math.random().toString(36).slice(2, 9)}` }, eds));
      markDirtyFrom(c.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );

  const descendants = useCallback(
    (start: string): Set<string> => {
      const out = new Set<string>();
      const stack = [start];
      while (stack.length) {
        const id = stack.pop()!;
        for (const e of edges) if (e.source === id && !out.has(e.target)) { out.add(e.target); stack.push(e.target); }
      }
      return out;
    },
    [edges],
  );

  const markDirtyFrom = useCallback(
    (nodeId: string | null | undefined) => {
      if (!nodeId) return;
      const marks = descendants(nodeId);
      marks.add(nodeId);
      setNodes((ns) => ns.map((n) => (marks.has(n.id) ? { ...n, data: { ...n.data, dirty: true } } : n)));
    },
    [descendants, setNodes],
  );

  const addNode = useCallback(
    (type: NodeType) => {
      commit();
      const id = `${type}_${Math.random().toString(36).slice(2, 8)}`;
      const idx = nodes.length;
      const newNode: FNode = { id, type, position: { x: 140 + (idx % 4) * 40, y: 90 + idx * 70 }, data: { config: defaultConfig(type), lastTest: null, dirty: false } };
      setNodes((ns) => [...ns, newNode]);
      setSelectedId(id);
    },
    [commit, nodes.length, setNodes],
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

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    await saveDraftAction(flowId, toGraph());
    const r = await publishFlowAction(flowId);
    if (r.ok) setPublishState({ status: "published", version: r.version });
    else setPublishError(r.error);
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

  const upstreamFields = useMemo(() => {
    if (!selected) return [] as Array<{ path: string; label: string; from: string }>;
    const sources = edges.filter((e) => e.target === selected.id).map((e) => e.source);
    const out: Array<{ path: string; label: string; from: string }> = [];
    const seen = new Set<string>();
    for (const sid of sources) {
      const sn = nodes.find((n) => n.id === sid);
      const schema = sn?.data.lastTest?.outputSchema ?? [];
      const fromLabel = sn ? summary(String(sn.type), sn.data) : sid;
      for (const f of schema) {
        if (seen.has(f.path)) continue;
        seen.add(f.path);
        out.push({ path: f.path, label: f.label, from: fromLabel });
      }
    }
    return out;
  }, [selected, edges, nodes]);

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
          <button onClick={undo} className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">
            Undo
          </button>
          <button onClick={redo} className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">
            Redo
          </button>
          {publishState.status === "published" && (
            <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
              Published v{publishState.version}
            </span>
          )}
          <button
            onClick={publish}
            disabled={publishing}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      {publishError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">Can&rsquo;t publish: {publishError}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Add node</p>
          <div className="space-y-1.5">
            {PALETTE.map((t) => (
              <button
                key={t}
                onClick={() => addNode(t)}
                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-medium">{NODE_META[t].label}</span>
                <span className="block text-xs text-neutral-500">{NODE_META[t].blurb}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {/* Config panel */}
        {selected && (
          <ConfigPanel
            key={selected.id}
            node={selected}
            connections={connections}
            upstreamFields={upstreamFields}
            testing={testingId === selected.id}
            onChange={(patch) => updateConfig(selected.id, patch)}
            onTest={() => testNode(selected.id)}
            onDelete={() => deleteNode(selected.id)}
            onDuplicate={() => duplicateNode(selected.id)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------- Config panel ----------------

function ConfigPanel({
  node,
  connections,
  upstreamFields,
  testing,
  onChange,
  onTest,
  onDelete,
  onDuplicate,
}: {
  node: FNode;
  connections: ConnMeta[];
  upstreamFields: Array<{ path: string; label: string; from: string }>;
  testing: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onTest: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [tab, setTab] = useState<"setup" | "configure" | "test">("configure");
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{NODE_META[type].label} node</p>
        <p className="text-sm text-neutral-600">{NODE_META[type].blurb}</p>
      </div>
      <div className="flex border-b border-neutral-200 text-sm">
        {(["setup", "configure", "test"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 capitalize ${tab === t ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "setup" && (
          <div className="space-y-3 text-sm">
            <p className="text-neutral-600">Node id: <code className="text-xs">{node.id}</code></p>
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

        {tab === "configure" && (
          <ConfigureTab type={type} cfg={cfg} connections={connections} upstreamFields={upstreamFields} onChange={onChange} />
        )}

        {tab === "test" && <TestTab node={node} testing={testing} onTest={onTest} />}
      </div>
    </aside>
  );
}

function ConfigureTab({
  type,
  cfg,
  connections,
  upstreamFields,
  onChange,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  connections: ConnMeta[];
  upstreamFields: Array<{ path: string; label: string; from: string }>;
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
        <Field label="Identity field (for matching people)">
          <input value={(cfg.identityField as string) ?? "subject"} onChange={(e) => onChange({ identityField: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
      </div>
    );
  }

  if (type === "filter") {
    const fc: Filters = { combinator: (cfg.combinator as string) ?? "and", rules: (cfg.rules as Rule[]) ?? [] };
    return <RulesEditor value={fc} upstreamFields={upstreamFields} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />;
  }

  if (type === "time") {
    const mode = (cfg.mode as string) ?? "preset";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Date field">
          <FieldPicker value={(cfg.dateField as string) ?? "occurredAt"} upstreamFields={upstreamFields} onChange={(v) => onChange({ dateField: v })} />
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
    return (
      <div className="space-y-3 text-sm">
        <Field label="Calculation">
          <select value={(cfg.op as string) ?? "percentage"} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            {FORMULA_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-600">
          Connect Aggregate (or Formula) nodes as inputs. The first connected input is A, the second is B. Percentage = A ÷ B × 100.
        </p>
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
          <Field label="Identity field">
            <FieldPicker value={(cfg.identityField as string) ?? "subject"} upstreamFields={upstreamFields} onChange={(v) => onChange({ identityField: v })} />
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
          <Field label="When duplicated, which source wins">
            <select value={(cfg.sourceWins as string) ?? "first"} onChange={(e) => onChange({ sourceWins: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="first">First connected input</option>
              <option value="last">Last connected input</option>
            </select>
          </Field>
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
            <RulesEditor value={p.filters ?? { combinator: "and", rules: [] }} upstreamFields={upstreamFields} onChange={(v) => setPath(i, { filters: v })} />
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
            <FieldPicker value={(cfg.field as string) ?? "source"} upstreamFields={upstreamFields} onChange={(v) => onChange({ field: v })} />
          </Field>
        )}
        {mode === "categories" && (
          <div className="space-y-2">
            {cats.map((c, i) => (
              <div key={i} className="space-y-2 rounded border border-neutral-200 p-2">
                <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
                <RulesEditor value={c.filters ?? { combinator: "and", rules: [] }} upstreamFields={upstreamFields} onChange={(v) => setCat(i, { filters: v })} />
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
            <FieldPicker value={(cfg.valueField as string) ?? "value"} upstreamFields={upstreamFields} onChange={(v) => onChange({ valueField: v })} />
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
          <FieldPicker value={(cfg.field as string) ?? "value"} upstreamFields={upstreamFields} onChange={(v) => onChange({ field: v })} />
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
        <Field label="Save to field (optional — defaults to same field)">
          <input value={(cfg.outputField as string) ?? ""} onChange={(e) => onChange({ outputField: e.target.value || undefined })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
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
            <FieldPicker value={(cfg.field as string) ?? "value"} upstreamFields={upstreamFields} onChange={(v) => onChange({ field: v })} />
          </Field>
        )}
        {agg === "count_distinct" && (
          <Field label="Distinct by">
            <FieldPicker value={(cfg.distinctField as string) ?? "subject"} upstreamFields={upstreamFields} onChange={(v) => onChange({ distinctField: v })} />
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
            <FieldPicker value={gb.field ?? "source"} upstreamFields={upstreamFields} onChange={(v) => onChange({ groupBy: { type: "field", field: v } })} />
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
  return (
    <div className="space-y-3 text-sm">
      <button onClick={onTest} disabled={testing} className="w-full rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
        {testing ? "Testing…" : node.data.lastTest ? "Test again" : "Test this node"}
      </button>
      {node.data.dirty && <p className="text-xs text-amber-700">This node changed — retest to refresh its data.</p>}
      {t && t.status === "error" && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{t.error}</p>}
      {t && t.status === "ok" && (
        <div className="space-y-2">
          <div className="flex justify-between rounded border border-neutral-200 p-2">
            <span className="text-neutral-500">Records in</span>
            <span className="font-medium">{t.recordsIn}</span>
          </div>
          <div className="flex justify-between rounded border border-neutral-200 p-2">
            <span className="text-neutral-500">Records out</span>
            <span className="font-medium">{t.recordsOut}</span>
          </div>
          {node.type === "output" && t.tile ? (
            <div className="rounded border border-green-200 bg-green-50 p-2">
              <span className="text-neutral-500">Result</span>{" "}
              <span className="font-semibold">{String((t.tile as { value?: unknown }).value ?? "—")}</span>
            </div>
          ) : null}
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Latest {Math.min(3, t.sample.length)} records</p>
            <div className="space-y-1">
              {t.sample.length === 0 && <p className="text-xs text-neutral-500">No records.</p>}
              {t.sample.slice(0, 3).map((r, i) => {
                const rec = r as { source?: string; eventType?: string; subject?: string; value?: unknown; occurredAt?: string };
                return (
                  <div key={i} className="rounded border border-neutral-100 bg-neutral-50 p-1.5 text-xs">
                    {rec.source} · {rec.eventType} {rec.subject ? `· ${rec.subject}` : ""} {rec.value != null ? `· ${String(rec.value)}` : ""}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Reusable AND/OR rule list, used by Filter, Paths, and Group categories. */
function RulesEditor({ value, upstreamFields, onChange }: { value: Filters; upstreamFields: UpstreamField[]; onChange: (v: Filters) => void }) {
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
          <FieldPicker value={r.field} upstreamFields={upstreamFields} onChange={(v) => setRule(i, { field: v })} />
          <div className="flex gap-1">
            <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} className="rounded-md border border-neutral-300 px-1 py-1 text-xs">
              {FLOW_FILTER_OPS.map((o) => (
                <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
              ))}
            </select>
            <input value={r.value ?? ""} placeholder="value" onChange={(e) => setRule(i, { value: e.target.value })} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
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

/** A field input plus a dropdown of upstream (previous-node) fields, labeled by source. */
function FieldPicker({
  value,
  upstreamFields,
  onChange,
}: {
  value: string;
  upstreamFields: Array<{ path: string; label: string; from: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="field (e.g. subject or properties.plan)" className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
      <select value="" onChange={(e) => e.target.value && onChange(e.target.value)} className="w-8 rounded-md border border-neutral-300 text-xs" title="Insert a field from a previous node">
        <option value="">+</option>
        {upstreamFields.map((f) => (
          <option key={f.path} value={f.path}>
            {f.from} → {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}
