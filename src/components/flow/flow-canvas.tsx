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
  useReactFlow,
  addEdge,
  type Edge,
  type Connection,
} from "@xyflow/react";
import { type NodeType } from "@/lib/flow/types";
import { saveDraftAction, testNodeAction, publishFlowAction, renameFlowAction, runChainAction, type NodeTestDTO, type ChainStepDTO } from "@/app/dashboard/flows/actions";
import {
  bridgeEdgeFor,
  buildFieldGroups,
  computeLayout,
  computeStepNumbers,
  describeInputs,
  descendantsOf,
  flowChecks,
  isValidFlowConnection,
  type ConnMeta,
  type FieldGroup,
  type FNode,
  type Graph,
  type InputDescriptor,
  type LibraryCtx,
} from "./graph-utils";
import { ALL_TYPES, defaultConfig, nodeTitle } from "./node-meta";
import { FlowNodeCard } from "./FlowNodeCard";
import { InsertEdge } from "./InsertEdge";
import { ConfigPanel } from "./ConfigPanel";
import { NodeLibraryModal } from "./NodeLibraryModal";
import { FlowCheckRail } from "./FlowCheckRail";

export type { ConnMeta };

const nodeTypes = Object.fromEntries(ALL_TYPES.map((t) => [t, FlowNodeCard])) as Record<string, typeof FlowNodeCard>;
const edgeTypes = { insert: InsertEdge };

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
  const [showMinimap, setShowMinimap] = useState(false);
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
      // Snap to the 16px grid so steps line up cleanly (n8n-style).
      position = { x: Math.round(position.x / 16) * 16, y: Math.round(position.y / 16) * 16 };

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

  /** Remove a node with exactly one in + one out edge, bridging prev→next. */
  const deleteAndReconnect = useCallback(
    (id: string) => {
      const bridge = bridgeEdgeFor(id, edges);
      if (!bridge) return deleteNode(id);
      commit();
      setEdges((es) => [...es.filter((e) => e.source !== id && e.target !== id), bridge]);
      setNodes((ns) => ns.map((n) => (n.id === bridge.target ? { ...n, data: { ...n.data, dirty: true } } : n)).filter((n) => n.id !== id));
      setSelectedId(null);
    },
    [edges, commit, setEdges, setNodes, deleteNode],
  );

  /** Block shape-incompatible connections (e.g. records into a Formula input). */
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const s = nodes.find((n) => n.id === c.source);
      const t = nodes.find((n) => n.id === c.target);
      if (!s || !t) return true;
      return isValidFlowConnection(String(s.type), String(t.type));
    },
    [nodes],
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

  // Fields for the selected node's variable picker: real upstream source fields
  // first (with values from each source's chosen sample record), canonical/system
  // fields collapsed at the end.
  const fieldGroups = useMemo<FieldGroup[]>(
    () =>
      buildFieldGroups({
        selectedId: selected?.id ?? null,
        nodes,
        edges,
        stepNoById,
        titleOf: (n) => nodeTitle(String(n.type) as NodeType, n.data),
        sampleIndexOf: (n) => Number((n.data.config as { sampleIndex?: unknown }).sampleIndex ?? 0),
      }),
    [selected, edges, nodes, stepNoById],
  );

  const selectedInputs = useMemo<InputDescriptor[]>(
    () => (selected ? describeInputs({ selectedId: selected.id, nodes, edges, titleOf: (n) => nodeTitle(String(n.type) as NodeType, n.data) }) : []),
    [selected, nodes, edges],
  );

  // ---- Auto-recalc (W5): recompute the selected node's chain on a debounce ----
  // Read-only over synced data, so downstream transforms never need a manual test.
  // The key excludes lastTest/dirty so writing results back doesn't re-trigger the loop.
  const [chainSteps, setChainSteps] = useState<ChainStepDTO[]>([]);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const toGraphRef = useRef(toGraph);
  toGraphRef.current = toGraph;
  const recalcKey = useMemo(
    () =>
      JSON.stringify({
        sel: selectedId,
        edges: edges.map((e) => [e.source, e.target, e.sourceHandle ?? null, e.targetHandle ?? null]),
        nodes: nodes.map((n) => [n.id, n.type, n.data.config]),
      }),
    [selectedId, edges, nodes],
  );
  useEffect(() => {
    if (!selectedId) {
      setChainSteps([]);
      return;
    }
    const t = setTimeout(async () => {
      setRecalcLoading(true);
      const r = await runChainAction(toGraphRef.current(), selectedId);
      setChainSteps(r.steps);
      setNodes((ns) => ns.map((n) => (r.results[n.id] ? { ...n, data: { ...n.data, lastTest: r.results[n.id], dirty: false } } : n)));
      setRecalcLoading(false);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalcKey]);

  const resultTitles = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, nodeTitle(String(n.type) as NodeType, n.data)])), [nodes]);

  const checks = useMemo(() => flowChecks(nodes, edges, (n) => nodeTitle(String(n.type) as NodeType, n.data)), [nodes, edges]);

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
          <ToolButton onClick={() => setShowMinimap((v) => !v)}>{showMinimap ? "Hide map" : "Map"}</ToolButton>
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
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "insert" }}
            snapToGrid
            snapGrid={[16, 16]}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            {showMinimap && <MiniMap pannable zoomable />}
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

          {!empty && <FlowCheckRail checks={checks} onFix={(id) => id && setSelectedId(id)} />}
        </div>

        {/* Config panel */}
        {selected && (
          <ConfigPanel
            key={selected.id}
            node={selected}
            stepNo={stepNoById.get(selected.id)}
            connections={connections}
            fieldGroups={fieldGroups}
            inputs={selectedInputs}
            inputCount={edges.filter((e) => e.target === selected.id).length}
            testing={testingId === selected.id}
            canReconnect={bridgeEdgeFor(selected.id, edges) !== null}
            resultSteps={chainSteps}
            resultTitles={resultTitles}
            resultLoading={recalcLoading}
            onChange={(patch) => updateConfig(selected.id, patch)}
            onRename={(v) => renameNode(selected.id, v)}
            onTest={() => testNode(selected.id)}
            onDelete={() => deleteNode(selected.id)}
            onDeleteReconnect={() => deleteAndReconnect(selected.id)}
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
