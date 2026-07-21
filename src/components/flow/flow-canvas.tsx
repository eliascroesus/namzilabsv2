"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReactFlow, ReactFlowProvider, Background, useNodesState, useEdgesState, type Edge } from "@xyflow/react";
import { type NodeType } from "@/lib/flow/types";
import { saveDraftAction, testNodeAction, publishFlowAction, renameFlowAction, type NodeTestDTO } from "@/app/dashboard/flows/actions";
import {
  bridgeEdgeFor,
  buildFieldGroups,
  computeNodeStatus,
  computeStepNumbers,
  computeVerticalLayout,
  describeInputs,
  descendantsOf,
  isCompareNode,
  nearestAppAncestor,
  structuralEdges,
  terminalIds,
  type ConnMeta,
  type FieldGroup,
  type FNode,
  type Graph,
  type InputDescriptor,
  type LibraryCtx,
  type MetricSpecT,
} from "./graph-utils";
import type { DataGroup } from "./controls/types";
import { ALL_TYPES, defaultConfig, nodeTitle, pathHandles } from "./node-meta";
import { FlowNodeCard } from "./FlowNodeCard";
import { InsertEdge } from "./InsertEdge";
import { ConfigPanel, type StepRef } from "./ConfigPanel";
import { NodeLibraryModal } from "./NodeLibraryModal";
import { ReviewPublishModal, type Endpoint } from "./ReviewPublishModal";

export type { ConnMeta };

const DATASET_PRODUCERS = new Set(["app", "filter", "time", "formatter", "combine", "paths"]);
const rid = () => `e_${Math.random().toString(36).slice(2, 9)}`;

/** A step that yields a single number, usable as a First/Second number in Compare. */
function isNumberProducer(n: FNode): boolean {
  const t = String(n.type);
  if (t === "aggregate" || t === "formula") return true;
  if (t === "calculate") {
    const m = String((n.data.config as { mode?: unknown }).mode ?? "number");
    return m === "number" || m === "compare";
  }
  return false;
}

/** Short "what to do next" hint shown inside a step that needs setup. */
function setupHint(type: string, cfg: Record<string, unknown>, inputCount: number): string {
  if (type === "app") return cfg.connectionId ? "Choose what data to pull." : "Choose an account to load data.";
  if (type === "formula") return "Pick a First and Second number.";
  if (type === "calculate") return String(cfg.mode ?? "number") === "compare" ? "Pick a First and Second number." : "Connect an input.";
  if (type === "output") return inputCount === 0 ? "Connect an input." : "Name this metric.";
  return "Connect an input.";
}

const nodeTypes = Object.fromEntries(ALL_TYPES.map((t) => [t, FlowNodeCard])) as Record<string, typeof FlowNodeCard>;
const edgeTypes = { insert: InsertEdge };

export function FlowCanvas(props: {
  flowId: string;
  name: string;
  status: string;
  publishedVersion: number | null;
  initialGraph: { nodes: FNode[] | { id: string; type: string; position: { x: number; y: number }; data: { config?: unknown; label?: unknown; lastTest?: unknown } }[]; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>; metrics?: MetricSpecT[] };
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
  const initialEdges: Edge[] = useMemo(() => {
    const es: Edge[] = initialGraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined }));
    // Older flows used a compare step's "a" number edge as its place in the line. Give
    // those steps a plain chain edge anchored to the same source, so changing which
    // numbers they compare can never move them (references are data, not position).
    for (const n of initialGraph.nodes) {
      const raw = n as { id: string; type: string; data?: { config?: unknown } };
      const isCompare = raw.type === "formula" || (raw.type === "calculate" && String((raw.data?.config as { mode?: unknown } | undefined)?.mode ?? "") === "compare");
      if (!isCompare) continue;
      const ins = es.filter((e) => e.target === raw.id);
      if (ins.length === 0 || ins.some((e) => e.targetHandle == null)) continue;
      const anchor = ins.find((e) => e.targetHandle === "a") ?? ins[0];
      es.push({ id: `e_chain_${raw.id}`, source: anchor.source, target: raw.id });
    }
    return es;
  }, [initialGraph]);

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
  const [metrics, setMetrics] = useState<MetricSpecT[]>(initialGraph.metrics ?? []);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ message: string; run: () => void } | null>(null);

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
      metrics,
    };
  }, [nodes, edges, metrics]);

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

      const config = defaultConfig(type);
      const newNode: FNode = { id, type, position, data: { config, lastTest: null, dirty: false } };

      // A Paths hub auto-creates one "Path conditions" (Filter) step per branch, so the
      // canvas splits into labeled lanes the moment you add it (Zapier-style).
      const extraNodes: FNode[] = [];
      const extraEdges: Edge[] = [];
      if (type === "paths") {
        const paths = (config.paths as Array<{ id: string; label: string }>) ?? [];
        paths.forEach((p, i) => {
          const bid = `filter_${Math.random().toString(36).slice(2, 8)}`;
          extraNodes.push({
            id: bid,
            type: "filter",
            position: { x: position.x + (i - (paths.length - 1) / 2) * 300, y: position.y + 170 },
            data: { config: defaultConfig("filter"), label: p.label, lastTest: null, dirty: false },
          });
          extraEdges.push({ id: rid(), type: "insert", source: id, sourceHandle: p.id, target: bid });
        });
      }
      setNodes((ns) => [...ns, newNode, ...extraNodes]);

      setEdges((es) => {
        let base = es;
        const predecessor = ctx?.fromNodeId ?? ctx?.onEdge?.source ?? null;
        if (ctx?.fromNodeId) {
          // The chain edge is always plain — it fixes the step's place in the line.
          base = [...es, { id: rid(), type: "insert", source: ctx.fromNodeId, sourceHandle: ctx.sourceHandle ?? undefined, target: id }];
        } else if (ctx?.onEdge) {
          const old = ctx.onEdge;
          base = [
            ...es.filter((e) => e.id !== old.id),
            { id: rid(), type: "insert", source: old.source, sourceHandle: old.sourceHandle, target: id },
            { id: rid(), type: "insert", source: id, target: old.target, targetHandle: old.targetHandle },
          ];
        }
        // A compare step defaults its first number to the step it was added after —
        // a data reference (named handle), separate from the chain edge above.
        if (type === "formula" && predecessor) {
          base = [...base, { id: rid(), type: "insert", source: predecessor, target: id, targetHandle: "a" }];
        }
        return [...base, ...extraEdges];
      });
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
      // Display-only keys (e.g. which sample record feeds the pills) never invalidate a test.
      const displayOnly = Object.keys(patch).length > 0 && Object.keys(patch).every((k) => k === "sampleIndex");
      commit();
      const marks = displayOnly ? new Set<string>() : descendants(id);
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === id) return { ...n, data: { ...n.data, config: { ...n.data.config, ...patch }, dirty: displayOnly ? n.data.dirty : true } };
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

  // The flow's SHAPE: chain edges only (a compare step's number references are data,
  // not position). Layout, step numbers, terminals, and delete-reconnect follow these.
  const sEdges = useMemo(() => structuralEdges(nodes, edges), [nodes, edges]);

  /** Remove a node with exactly one chain in + one chain out, bridging prev→next. */
  const deleteAndReconnect = useCallback(
    (id: string) => {
      const bridge = bridgeEdgeFor(id, sEdges);
      if (!bridge) return deleteNode(id);
      commit();
      setEdges((es) => [...es.filter((e) => e.source !== id && e.target !== id), bridge]);
      setNodes((ns) => ns.map((n) => (n.id === bridge.target ? { ...n, data: { ...n.data, dirty: true } } : n)).filter((n) => n.id !== id));
      setSelectedId(null);
    },
    [sEdges, commit, setEdges, setNodes, deleteNode],
  );

  // Multi-input steps are wired from the config panel (labeled pills), never by
  // dragging ports. These manage the underlying edges so the engine is unchanged.
  const setFormulaInput = useCallback(
    (nodeId: string, handle: "a" | "b", sourceId: string | null) => {
      commit();
      setEdges((es) => {
        const kept = es.filter((e) => !(e.target === nodeId && (e.targetHandle ?? null) === handle));
        return sourceId ? [...kept, { id: rid(), type: "insert", source: sourceId, target: nodeId, targetHandle: handle }] : kept;
      });
      markDirtyFrom(nodeId);
    },
    [commit, setEdges, markDirtyFrom],
  );
  const setCombineSources = useCallback(
    (nodeId: string, sourceIds: string[]) => {
      commit();
      setEdges((es) => [...es.filter((e) => e.target !== nodeId), ...sourceIds.map((sid) => ({ id: rid(), type: "insert", source: sid, target: nodeId }))]);
      markDirtyFrom(nodeId);
    },
    [commit, setEdges, markDirtyFrom],
  );

  // Paths: add a branch = a new labeled handle + its own "Path conditions" (Filter) step.
  const addBranch = useCallback(
    (hubId: string) => {
      const hub = nodes.find((n) => n.id === hubId);
      if (!hub) return;
      commit();
      const paths = ((hub.data.config as { paths?: Array<{ id: string; label: string }> }).paths) ?? [];
      const pid = `p${Math.random().toString(36).slice(2, 7)}`;
      const label = `Path ${String.fromCharCode(65 + paths.length)}`;
      const bid = `filter_${Math.random().toString(36).slice(2, 8)}`;
      setNodes((ns) => [
        ...ns.map((n) => (n.id === hubId ? { ...n, data: { ...n.data, config: { ...n.data.config, paths: [...paths, { id: pid, label }] } } } : n)),
        { id: bid, type: "filter", position: { x: hub.position.x, y: hub.position.y + 170 }, data: { config: defaultConfig("filter"), label, lastTest: null, dirty: false } } as FNode,
      ]);
      setEdges((es) => [...es, { id: rid(), type: "insert", source: hubId, sourceHandle: pid, target: bid }]);
    },
    [commit, nodes, setNodes, setEdges],
  );
  const removeBranch = useCallback(
    (hubId: string, pathId: string) => {
      const hub = nodes.find((n) => n.id === hubId);
      if (!hub) return;
      commit();
      const paths = ((hub.data.config as { paths?: Array<{ id: string; label: string }> }).paths) ?? [];
      const remaining = paths.filter((p) => p.id !== pathId);

      // Remove the deleted branch's whole subtree (chain descendants only — a step
      // elsewhere that merely references a branch step is never deleted with it).
      const branchTargets = edges.filter((e) => e.source === hubId && e.sourceHandle === pathId).map((e) => e.target);
      const toRemove = new Set<string>(branchTargets);
      for (const t of branchTargets) for (const d of descendantsOf(t, sEdges)) toRemove.add(d);

      if (remaining.length <= 1) {
        // A split with one (or zero) branch left is pointless — dissolve the hub and wire
        // the surviving branch straight onto whatever fed the split, so the flow stays a
        // single line (no orphaned steps).
        const survivor = remaining[0];
        const survivorFirst = survivor ? edges.find((e) => e.source === hubId && e.sourceHandle === survivor.id)?.target : undefined;
        const hubParents = edges.filter((e) => e.target === hubId).map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? undefined }));
        toRemove.add(hubId);
        setNodes((ns) => ns.filter((n) => !toRemove.has(n.id)));
        setEdges((es) => {
          let next = es.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target) && e.source !== hubId && e.target !== hubId);
          if (survivorFirst) for (const p of hubParents) next = [...next, { id: rid(), type: "insert", source: p.source, sourceHandle: p.sourceHandle, target: survivorFirst }];
          return next;
        });
        setSelectedId(null);
        return;
      }

      // Two or more branches remain: just drop this branch and its path entry.
      setNodes((ns) =>
        ns.map((n) => (n.id === hubId ? { ...n, data: { ...n.data, config: { ...n.data.config, paths: remaining } } } : n)).filter((n) => !toRemove.has(n.id)),
      );
      setEdges((es) => es.filter((e) => !(e.source === hubId && e.sourceHandle === pathId) && !toRemove.has(e.source) && !toRemove.has(e.target)));
    },
    [commit, nodes, edges, sEdges, setNodes, setEdges],
  );

  // Delete from a card's kebab. A plain step reconnects its neighbours (stays linear);
  // a Paths hub or a branch takes the whole subtree with it, behind a confirmation, so
  // the split can never leave orphaned steps that reflow to the top.
  const requestDelete = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      if (node.type === "paths") {
        const sub = descendantsOf(id, sEdges);
        const count = sub.size;
        setPendingDelete({
          message: `This deletes “Split into paths” and all ${count} step${count === 1 ? "" : "s"} in its branches.`,
          run: () => {
            commit();
            const remove = new Set<string>([id, ...sub]);
            setNodes((ns) => ns.filter((n) => !remove.has(n.id)));
            setEdges((es) => es.filter((e) => !remove.has(e.source) && !remove.has(e.target)));
            setSelectedId(null);
          },
        });
        return;
      }

      const inEdge = sEdges.find((e) => e.target === id);
      const parent = inEdge ? nodes.find((n) => n.id === inEdge.source) : undefined;
      if (parent?.type === "paths" && inEdge?.sourceHandle) {
        const sub = descendantsOf(id, sEdges);
        const count = sub.size + 1;
        const handle = inEdge.sourceHandle;
        const hubPaths = (((parent.data.config as { paths?: unknown[] }).paths) ?? []).length;
        const message =
          hubPaths <= 2
            ? `This deletes this branch and its ${count} step${count === 1 ? "" : "s"}. The other branch will connect straight to the step before the split.`
            : `This deletes this branch and its ${count} step${count === 1 ? "" : "s"}.`;
        setPendingDelete({
          message,
          run: () => {
            removeBranch(parent.id, handle);
            setSelectedId(null);
          },
        });
        return;
      }

      deleteAndReconnect(id);
    },
    [nodes, sEdges, commit, setNodes, setEdges, removeBranch, deleteAndReconnect],
  );

  // Backspace / Delete removes the selected step (routed through the same smart delete,
  // so a Paths hub or branch still asks for confirmation). Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (!selectedId) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      requestDelete(selectedId);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, requestDelete]);

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
    setPublishWarning(null);
    await saveDraftAction(flowId, toGraph());
    const r = await publishFlowAction(flowId);
    if (r.ok) {
      setPublishState({ status: "published", version: r.version });
      if (r.warning) setPublishWarning(r.warning);
      else setReviewOpen(false);
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

  // Candidate steps for wiring multi-input steps (exclude self + descendants).
  const candidates = useMemo(() => {
    if (!selected) return { dataset: [] as StepRef[] };
    const desc = descendantsOf(selected.id, edges);
    const avail = nodes.filter((n) => n.id !== selected.id && !desc.has(n.id));
    const toItem = (n: FNode): StepRef => ({ id: n.id, title: nodeTitle(String(n.type) as NodeType, n.data), stepNo: stepNoById.get(n.id) });
    return { dataset: avail.filter((n) => DATASET_PRODUCERS.has(String(n.type))).map(toItem) };
  }, [selected, nodes, edges, stepNoById]);

  // Number choices for a compare step, in the same data-browser shape as every other
  // input: one group per earlier step, each exposing exactly its number — a scalar
  // step's Result, or a dataset step's Output number (its record count).
  const numberGroups = useMemo<DataGroup[]>(() => {
    if (!selected) return [];
    const desc = descendantsOf(selected.id, edges);
    const avail = nodes
      .filter((n) => n.id !== selected.id && !desc.has(n.id) && (isNumberProducer(n) || DATASET_PRODUCERS.has(String(n.type))))
      .sort((a, b) => (stepNoById.get(a.id) ?? 0) - (stepNoById.get(b.id) ?? 0));
    return avail.map((n) => {
      const app = nearestAppAncestor(n, nodes, edges);
      const scalar = isNumberProducer(n);
      const t = n.data.lastTest;
      const tile = t?.status === "ok" ? (t.tile as { value?: unknown } | undefined) : undefined;
      const sample = scalar ? t?.value ?? tile?.value : t?.status === "ok" ? t.recordsOut : undefined;
      return {
        stepId: n.id,
        stepNo: stepNoById.get(n.id),
        source: app ? String((app.data.config as { source?: unknown }).source ?? "") : undefined,
        title: nodeTitle(String(n.type) as NodeType, n.data),
        fields: [{ path: scalar ? `__result_${n.id}` : `__count_${n.id}`, label: scalar ? "Result" : "Output number", type: "number", sample }],
      };
    });
  }, [selected, nodes, edges, stepNoById]);

  // Managed top-to-bottom layout + per-node status + terminal add points (no free placement).
  const layout = useMemo(() => computeVerticalLayout(nodes, edges), [nodes, edges]);
  const terminals = useMemo(() => terminalIds(nodes, edges), [nodes, edges]);

  // Endpoints (terminals, excluding legacy Output nodes) each become a dashboard
  // metric at Review & publish — a flow with un-recombined Paths has several.
  const endpoints = useMemo<Endpoint[]>(
    () => nodes.filter((n) => terminals.has(n.id) && n.type !== "output").map((n) => ({ nodeId: n.id, title: nodeTitle(String(n.type) as NodeType, n.data) })),
    [nodes, terminals],
  );
  const openReview = useCallback(() => {
    setMetrics((prev) => {
      const byId = new Map(prev.map((m) => [m.nodeId, m]));
      return endpoints.map((ep) => byId.get(ep.nodeId) ?? { nodeId: ep.nodeId, enabled: true, name: ep.title, viz: "number", format: "number", currency: "USD", precision: 0, target: null, timeUnit: "month" });
    });
    setPublishError(null);
    setPublishWarning(null);
    setReviewOpen(true);
  }, [endpoints]);
  // Date fields across the flow — offered as a metric's "Time reference" (dashboard axis).
  const timeFieldOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    const seen = new Map<string, string>();
    seen.set("occurredAt", "When it happened");
    for (const n of nodes) {
      for (const f of n.data.lastTest?.outputSchema ?? []) {
        if (f.type === "date" && !seen.has(f.path)) seen.set(f.path, f.label);
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [nodes]);
  const inDegreeById = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, 0);
    for (const e of edges) m.set(e.target, (m.get(e.target) ?? 0) + 1);
    return m;
  }, [nodes, edges]);
  const inHandlesById = useMemo(() => {
    const m = new Map<string, Array<string | null>>();
    for (const e of edges) {
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.target)!.push(e.targetHandle ?? null);
    }
    return m;
  }, [edges]);
  const usedHandles = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (e.sourceHandle == null) continue;
      if (!m.has(e.source)) m.set(e.source, new Set());
      m.get(e.source)!.add(e.sourceHandle);
    }
    return m;
  }, [edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const inputCount = inDegreeById.get(n.id) ?? 0;
        const status = computeNodeStatus({ type: String(n.type), cfg: n.data.config, inputCount, inputHandles: inHandlesById.get(n.id) ?? [], lastTest: n.data.lastTest, dirty: n.data.dirty, updating: testingId === n.id });
        const issue = status === "setup" ? setupHint(String(n.type), n.data.config, inputCount) : undefined;
        let freeHandles: Array<{ id: string; label: string }> | undefined;
        if (n.type === "paths") {
          const used = usedHandles.get(n.id) ?? new Set<string>();
          freeHandles = pathHandles(n.data).filter((h) => !used.has(h.id));
        }
        return {
          ...n,
          position: layout.get(n.id) ?? n.position,
          data: { ...n.data, stepNo: stepNoById.get(n.id), status, issue, isTerminal: terminals.has(n.id), freeHandles, onAddFrom: addFromNode, onDeleteNode: requestDelete, onDuplicateNode: duplicateNode },
        };
      }),
    [nodes, layout, terminals, stepNoById, inDegreeById, inHandlesById, usedHandles, addFromNode, testingId, requestDelete, duplicateNode],
  );
  // Only the flow's chain edges are drawn — a compare step's number references are
  // picked in the panel and never rendered as lines (they'd cut across the canvas).
  // Branch edges (from a Paths hub) get no "+" insert: a branch always starts with
  // its own mandatory conditions step.
  const displayEdges = useMemo(() => {
    const compareIds = new Set(nodes.filter(isCompareNode).map((n) => n.id));
    return edges
      .filter((e) => !(compareIds.has(e.target) && (e.targetHandle === "a" || e.targetHandle === "b")))
      .map((e) => ({
        ...e,
        type: "insert",
        data: { ...(e.data ?? {}), onInsert: e.sourceHandle ? undefined : insertOnEdge },
      }));
  }, [nodes, edges, insertOnEdge]);

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
          <ToolButton onClick={undo}>Undo</ToolButton>
          <ToolButton onClick={redo}>Redo</ToolButton>
          {publishState.status === "published" && (
            <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">Published v{publishState.version}</span>
          )}
          <button onClick={openReview} disabled={publishing} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {publishState.status === "published" ? "Edit output" : "Review & publish"}
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
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "insert" }}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            deleteKeyCode={null}
          >
            <Background gap={16} />
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
            inputs={selectedInputs}
            inputCount={edges.filter((e) => e.target === selected.id).length}
            testing={testingId === selected.id}
            numberGroups={numberGroups}
            datasetCandidates={candidates.dataset}
            onChange={(patch) => updateConfig(selected.id, patch)}
            onRename={(v) => renameNode(selected.id, v)}
            onTest={() => testNode(selected.id)}
            onAddNext={() => addFromNode(selected.id)}
            onSetInput={(handle, sourceId) => setFormulaInput(selected.id, handle, sourceId)}
            onSetSources={(ids) => setCombineSources(selected.id, ids)}
            onAddBranch={() => addBranch(selected.id)}
            onRemoveBranch={(pid) => removeBranch(selected.id, pid)}
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

      {reviewOpen && (
        <ReviewPublishModal
          endpoints={endpoints}
          metrics={metrics}
          timeFieldOptions={timeFieldOptions}
          publishing={publishing}
          error={publishError}
          warning={publishWarning}
          publishedVersion={publishState.version}
          onChange={setMetrics}
          onPublish={publish}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-neutral-900">Delete this step?</p>
            <p className="mt-1.5 text-sm text-neutral-600">{pendingDelete.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingDelete(null)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
                Cancel
              </button>
              <button
                onClick={() => {
                  pendingDelete.run();
                  setPendingDelete(null);
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
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
