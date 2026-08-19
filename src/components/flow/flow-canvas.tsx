"use client";

import { Database, Maximize2, Plug, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  useUpdateNodeInternals,
  type Edge,
} from "@xyflow/react";
import { isDatasetFormulaOp, seedMetricFormat, type NodeType } from "@/lib/flow/types";
import { isBinaryCalc, outputShapeOf, producesDataset, producesNumber, readsRecords, recordsSourceOf } from "@/lib/flow/shapes";
import { useRouter } from "next/navigation";
import { saveDraftAction, startNodeTestAction, pollNodeTestAction, publishFlowAction, renameFlowAction, duplicateFlowAction, deleteFlowAction, setFlowEnabledAction, type NodeTestDTO } from "@/app/dashboard/flows/actions";

/**
 * Poll a handed-off Test run until it settles (bounded; ~90s of 800ms ticks).
 *
 * The three not-finished outcomes are DIFFERENT failures and say so. Previously
 * they all produced "the sync may still be running", which was an assertion the
 * client had no basis for: a run nobody ever picked up, and a run whose
 * container was killed mid-flight, both looked like slowness. That copy is why
 * a dead background worker could sit unnoticed — it reads as patience.
 *
 * `cancelled` returns null and stops polling — the user walked away from a run
 * they no longer care about. The run itself is left to settle on the server:
 * it is durable, it costs nothing to finish, and killing it from here would
 * mean inventing a cancel path through Inngest for a button whose entire job is
 * "stop showing me this".
 */
async function pollTestResult(runId: string, cancelled: () => boolean): Promise<NodeTestDTO | null> {
  const fail = (error: string): NodeTestDTO => ({
    status: "error",
    recordsIn: 0,
    recordsOut: 0,
    sample: [],
    inputSample: [],
    outputSchema: [],
    error,
  });
  /** Past this with no state change, "still working" stops being credible. */
  const STALL_MS = 45_000;
  let last: { status: string; ageMs: number } | null = null;

  for (let tick = 0; tick < 112; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (cancelled()) return null;
    const state = await pollNodeTestAction(runId);
    if (!state) return fail("This test run no longer exists — try again.");
    if (state.status === "ok" && state.result) return state.result;
    if (state.status === "error") return fail(state.error ?? "The test run failed — try again.");
    last = { status: state.status, ageMs: state.ageMs };
  }

  // Never started: the row is still queued, so nothing ever claimed it.
  if (last?.status === "queued") {
    return fail(
      "This test was queued but never picked up — the background worker isn't running. Check the Inngest connection, then try again.",
    );
  }
  // Started and went quiet: the run began and stopped reporting, which is what a
  // container killed at its time limit looks like from here.
  if (last?.status === "running" && last.ageMs > STALL_MS) {
    return fail("The test started but stopped responding — it likely hit the time limit. Try a smaller date range, or try again.");
  }
  return fail("The test is still running after 90 seconds. It may finish on its own — reopen this step shortly to see the result.");
}
import {
  bridgeEdgesFor,
  buildFieldGroups,
  computeNodeStatus,
  computeStepNumbers,
  computeVerticalLayout,
  describeInputs,
  descendantsOf,
  isCompareNode,
  laneAncestorIds,
  matchKeepOf,
  nearestAppAncestor,
  publishesToDashboard,
  resolveSampleField,
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
import type { DataField, DataGroup } from "./controls/types";
import { formatSample } from "./controls/field-utils";
import { ALL_TYPES, defaultConfig, formulaExpression, formulaHandleLabels, nodeTitle, pathHandles } from "./node-meta";
import { FlowNodeCard } from "./FlowNodeCard";
import { InsertEdge } from "./InsertEdge";
import { ReferenceEdge } from "./ReferenceEdge";
import { FlowToolbar } from "./FlowToolbar";
import { ConfigPanel, type StepRef } from "./ConfigPanel";
import { NodeLibraryModal, anchorFromRect, type PickerAnchor } from "./NodeLibraryModal";
import { ReviewPublishModal, type Endpoint } from "./ReviewPublishModal";

export type { ConnMeta };

const rid = () => `e_${Math.random().toString(36).slice(2, 9)}`;

/**
 * A step that yields a single number, usable as a First/Second number in
 * Compare — answered by the shared classifier, not a private list.
 *
 * The old version said yes to ANY Calculate, so one split over time was
 * offered as a number and then failed at run time; and the private
 * DATASET_PRODUCERS beside it had never heard of Time between, so that step
 * could not be combined with anything.
 */
function isNumberProducer(n: FNode): boolean {
  return producesNumber(String(n.type), (n.data.config ?? {}) as Record<string, unknown>);
}

/** Short "what to do next" hint shown inside a step that needs setup. */
/**
 * The one thing missing from this step, in as few words as fit on a card.
 *
 * These were sentences — "Wire in the two steps to check against each other."
 * — inside about twenty characters of usable width, so they arrived as "Wire
 * in the ...", which is worse than no hint at all: it takes the space, draws
 * the eye, and withholds the answer. A fragment with no full stop reads as a
 * label, which is what this is.
 */
function setupHint(type: string, cfg: Record<string, unknown>, inputCount: number): string {
  if (type === "app") return cfg.connectionId ? "Pick what to pull" : "Pick an account";
  if (type === "unite") {
    if (String(cfg.mode ?? "stack") !== "match") return "Pick the steps to combine";
    return inputCount < 2 ? "Needs two steps" : "Pick the fields to match";
  }
  if (type === "time_between") return "Pick a key and both times";
  if (type === "filter") return inputCount === 0 ? "Needs a step above" : "Add a condition";
  if (type === "formula") return isDatasetFormulaOp(cfg.op ?? "percentage") ? "Needs a step above" : "Pick two numbers";
  if (type === "calculate") return String(cfg.mode ?? "number") === "compare" ? "Pick two numbers" : "Needs a step above";
  if (type === "output") return inputCount === 0 ? "Needs a step above" : "Name it";
  return "Needs a step above";
}

const nodeTypes = Object.fromEntries(ALL_TYPES.map((t) => [t, FlowNodeCard])) as Record<string, typeof FlowNodeCard>;
const edgeTypes = { insert: InsertEdge, reference: ReferenceEdge };

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
    // An App (Get data) step has no inputs — it's a data source, a root of its own
    // lane. Any stored edge INTO one is an artifact of older builds (where "Add next
    // step → Get data" wrongly chained it); dropping them here heals those flows.
    const appIds = new Set(initialGraph.nodes.filter((n) => (n as { type: string }).type === "app").map((n) => (n as { id: string }).id));
    const es: Edge[] = initialGraph.edges
      .filter((e) => !appIds.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined }));
    // Older flows used a compare step's "a" number edge as its place in the line. Give
    // those steps a plain chain edge anchored to the same source, so changing which
    // numbers they compare can never move them (references are data, not position).
    for (const n of initialGraph.nodes) {
      const raw = n as { id: string; type: string; data?: { config?: unknown } };
      const cfg = (raw.data?.config ?? {}) as Record<string, unknown>;
      if (!isBinaryCalc(String(raw.type), cfg)) continue;
      const ins = es.filter((e) => e.target === raw.id);
      if (ins.length === 0 || ins.some((e) => e.targetHandle == null)) continue;
      const anchor = ins.find((e) => e.targetHandle === "a") ?? ins[0];
      es.push({ id: `e_chain_${raw.id}`, source: anchor.source, target: raw.id });
    }
    return es;
  }, [initialGraph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const rf = useReactFlow();
  // The bottom bar shows the zoom level, so it has to re-render as it changes.
  const { zoom } = useViewport();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [publishState, setPublishState] = useState<{ status: string; version: number | null }>({ status, version: publishedVersion });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishIssues, setPublishIssues] = useState<Array<{ nodeId?: string; message: string }>>([]);
  const [publishWarning, setPublishWarning] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ open: boolean; ctx: LibraryCtx; anchor: PickerAnchor; anchorSelector: string | null }>({ open: false, ctx: null, anchor: null, anchorSelector: null });
  const [metrics, setMetrics] = useState<MetricSpecT[]>(initialGraph.metrics ?? []);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ message: string; run: () => void } | null>(null);
  /** Transient notice: a step delete (with Undo), or a flow-action error (without). */
  const [toast, setToast] = useState<{ message: string; undoable?: boolean } | null>(null);
  /** Running a whole flow: which step number we are on, out of how many. */
  const [runAll, setRunAll] = useState<{ at: number; of: number } | null>(null);

  const past = useRef<Array<{ nodes: FNode[]; edges: Edge[] }>>([]);
  const future = useRef<Array<{ nodes: FNode[]; edges: Edge[] }>>([]);
  /**
   * The history stacks live in refs (a snapshot must not trigger a render),
   * so their DEPTHS are mirrored into state — otherwise the Undo and Redo
   * buttons can never go flat, and both sat there looking pressable on a
   * brand-new flow with nothing behind them.
   */
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const syncHist = useCallback(() => setHist({ undo: past.current.length, redo: future.current.length }), []);
  const snapshot = useCallback(() => ({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }), [nodes, edges]);
  const commit = useCallback(() => {
    past.current.push(snapshot());
    if (past.current.length > 50) past.current.shift();
    future.current = [];
    syncHist();
  }, [snapshot, syncHist]);

  const toGraph = useCallback((): Graph => {
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: String(n.type), position: n.position, data: { config: n.data.config, label: n.data.label, lastTest: n.data.lastTest ?? undefined } })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
      // A non-finite number fails the graph schema, which fails the autosave
      // of this edit and every edit after it. The inputs can no longer produce
      // one; this is the belt, so no future input can either.
      // Clamped to what MetricSpecSchema actually accepts — int, 0..6. A bare
      // Number.isFinite check let 20 and 1.5 through, and those throw inside
      // parseGraph just as loudly as NaN did, reopening the same silent
      // save-death this belt exists to close.
      metrics: metrics.map((m) => ({
        ...m,
        precision: Number.isFinite(m.precision) ? Math.min(6, Math.max(0, Math.round(m.precision))) : 0,
        target: m.target != null && Number.isFinite(m.target) ? m.target : null,
      })),
    };
  }, [nodes, edges, metrics]);

  /** Save immediately, for the Retry the failure banner offers. */
  const saveNow = useCallback(async () => {
    setSaveState("saving");
    const r = await saveDraftAction(flowId, toGraph());
    setSaveState(r.ok ? "saved" : "error");
  }, [flowId, toGraph]);

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

  /**
   * Create a node (optionally connected from a source or inserted on an edge).
   *
   * `configOverride` is what lets one node type be two picker entries: the
   * library's "Summarise records" and "Compare two numbers" both build a
   * `formula`, differing only in the `op` they land on — so the panel opens on
   * the half the user asked for instead of on a dropdown asking which half
   * they meant.
   */
  const createNode = useCallback(
    (type: NodeType, ctx: LibraryCtx, configOverride?: Record<string, unknown>) => {
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

      const config = { ...defaultConfig(type), ...(configOverride ?? {}) };
      const newNode: FNode = { id, type, position, data: { config, lastTest: null, dirty: false } };

      // A Paths hub auto-creates one "Path conditions" (Filter) step per branch, so the
      // canvas splits into labeled lanes the moment you add it (Zapier-style). When the
      // hub is dropped between two steps, the existing downstream chain is routed into the
      // FIRST branch — so a split always begins with exactly its branches, never a stray
      // third line to the old next step.
      const extraNodes: FNode[] = [];
      const extraEdges: Edge[] = [];
      if (type === "paths") {
        const paths = (config.paths as Array<{ id: string; label: string }>) ?? [];
        const onEdge = ctx?.onEdge ?? null;
        paths.forEach((p, i) => {
          const bid = `filter_${Math.random().toString(36).slice(2, 8)}`;
          extraNodes.push({
            id: bid,
            type: "filter",
            position: { x: position.x + (i - (paths.length - 1) / 2) * 300, y: position.y + 170 },
            data: { config: defaultConfig("filter"), label: p.label, lastTest: null, dirty: false },
          });
          extraEdges.push({ id: rid(), type: "insert", source: id, sourceHandle: p.id, target: bid });
          if (i === 0 && onEdge) extraEdges.push({ id: rid(), type: "insert", source: bid, target: onEdge.target, targetHandle: onEdge.targetHandle ?? undefined });
        });
      }
      setNodes((ns) => [...ns, newNode, ...extraNodes]);

      setEdges((es) => {
        // A Get data step is a data SOURCE — a new root lane beside the others, never a
        // next step. No matter where it was added from (an Add-next button, a "+" on an
        // edge), it connects to nothing; later steps pull it in via Combine or numbers.
        if (type === "app") return es;
        let base = es;
        const predecessor = ctx?.fromNodeId ?? ctx?.onEdge?.source ?? null;
        if (ctx?.fromNodeId) {
          // The chain edge is always plain — it fixes the step's place in the line.
          base = [...es, { id: rid(), type: "insert", source: ctx.fromNodeId, sourceHandle: ctx.sourceHandle ?? undefined, target: id }];
        } else if (ctx?.onEdge) {
          const old = ctx.onEdge;
          base = [...es.filter((e) => e.id !== old.id), { id: rid(), type: "insert", source: old.source, sourceHandle: old.sourceHandle, target: id }];
          // A Paths hub re-wires the downstream through its first branch (above); every
          // other node keeps the plain hub→next-step chain edge.
          if (type !== "paths") base = [...base, { id: rid(), type: "insert", source: id, target: old.target, targetHandle: old.targetHandle }];
        }
        // A compare step defaults its first number to the step it was added after —
        // a data reference (named handle), separate from the chain edge above.
        if (type === "formula" && predecessor) {
          base = [...base, { id: rid(), type: "insert", source: predecessor, target: id, targetHandle: "a" }];
        }
        return [...base, ...extraEdges];
      });
      // Inserting a step on the KEEP lane of a matching Combine moves that
      // lane's head — the config follows, or the Combine points at a step no
      // longer wired into it and errors on its next run.
      if (ctx?.onEdge && type !== "app" && type !== "paths") {
        const old = ctx.onEdge;
        setNodes((ns) => ns.map((n) => (n.id === old.target && matchKeepOf(n) === old.source ? { ...n, data: { ...n.data, config: { ...n.data.config, keepNodeId: id }, dirty: true } } : n)));
      }
      setSelectedId(id);
    },
    [commit, nodes, setNodes, setEdges],
  );

  // Opening the picker always closes the config window — it belongs to the step
  // you were on, not the one you're about to add (Make.com behaviour).
  const addFromNode = useCallback((sourceNodeId: string, sourceHandle?: string | null, anchor?: { x: number; y: number; leftX?: number }) => {
    setSelectedId(null);
    // Keep the picker glued to this source's live "Add next step" button as the canvas pans.
    const anchorSelector = sourceHandle ? `[data-add-btn="${sourceNodeId}:${sourceHandle}"]` : `[data-add-btn="${sourceNodeId}"]`;
    setLibrary({ open: true, ctx: { fromNodeId: sourceNodeId, sourceHandle }, anchor: anchor ?? null, anchorSelector });
  }, []);
  const insertOnEdge = useCallback(
    (edgeId: string, anchor?: { x: number; y: number; leftX?: number }) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) {
        setSelectedId(null);
        setLibrary({ open: true, ctx: { onEdge: edge }, anchor: anchor ?? null, anchorSelector: null });
      }
    },
    [edges],
  );

  // The config panel's "Continue": if a step already follows this one, open ITS
  // config (walk the flow). A split hub steps into its first branch. Only at the
  // end of the line does it add a step — opening the picker exactly where this
  // step's "Add next step" button sits, nudging it into view first if needed.
  const continueFromNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.type === "paths") {
        const firstBranch = edges.find((e) => e.source === nodeId && e.sourceHandle)?.target;
        if (firstBranch) return setSelectedId(firstBranch);
      }
      const nextId = edges.find((e) => e.source === nodeId && !e.sourceHandle && e.targetHandle == null)?.target;
      if (nextId) return setSelectedId(nextId);

      const btn = document.querySelector<HTMLElement>(`[data-add-btn="${nodeId}"]`);
      if (!btn || !node) return addFromNode(nodeId, null, btn ? anchorFromRect(btn.getBoundingClientRect()) : undefined);
      const r = btn.getBoundingClientRect();
      // The picker sits to the RIGHT of this button, vertically centred on it
      // (NodeLibraryModal WIDTH/GAP). Move the canvas by the SMALLEST amount that
      // brings that rect fully on-screen with 20px of breathing room — and move
      // nothing at all when it already fits.
      const PAD = 20;
      const PICKER_W = 380;
      const GAP = 14;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let dx = 0;
      const pickerRight = r.right + GAP + PICKER_W; // picker's right edge in its default placement
      if (pickerRight + PAD > vw) dx = vw - PAD - pickerRight; // slide left just enough to fit
      if (r.left + dx < PAD) dx = PAD - r.left; // …but never push the button off the left edge
      let dy = 0;
      if (r.top < PAD) dy = PAD - r.top; // button above the viewport → nudge down
      else if (r.bottom > vh - PAD) dy = vh - PAD - r.bottom; // button below the viewport → nudge up
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return addFromNode(nodeId, null, anchorFromRect(r));
      const vp = rf.getViewport();
      rf.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 200 });
      // Open at the picker's predicted final spot; it then stays glued to the live
      // button (anchorSelector) as this short pan animates.
      addFromNode(nodeId, null, { x: r.right + dx, y: r.top + dy + r.height / 2, leftX: r.left + dx });
    },
    [nodes, edges, rf, addFromNode],
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
      /**
       * ALL the edges, not just the structural ones. A step wired into a
       * Calculate's A or B input is connected by a number reference, which
       * `structuralEdges` deliberately hides from the drawn line — and hiding
       * it here meant the step below had no outgoing edge to bridge, so
       * deleting the step above it left it standing alone with "Needs setup".
       *
       * A matching Combine still reconnects its KEPT lane: bridging blind from
       * the first edge could hand downstream the check list's records.
       */
      const bridges = bridgeEdgesFor(id, edges, matchKeepOf(nodes.find((n) => n.id === id)));
      if (bridges.length === 0) return deleteNode(id);
      commit();
      setEdges((es) => [...es.filter((e) => e.source !== id && e.target !== id), ...bridges]);
      const bridgedTargets = new Map(bridges.map((b) => [b.target, b.source]));
      setNodes((ns) =>
        ns
          .map((n) => {
            const newSource = bridgedTargets.get(n.id);
            if (newSource == null) return n;
            // Deleting the head of a matching Combine's KEEP lane promotes
            // the bridged predecessor into the role — otherwise the config
            // names a step that no longer exists.
            const repointed = matchKeepOf(n) === id ? { ...n.data.config, keepNodeId: newSource } : n.data.config;
            return { ...n, data: { ...n.data, config: repointed, dirty: true } };
          })
          .filter((n) => n.id !== id),
      );
      setSelectedId(null);
    },
    [nodes, edges, commit, setEdges, setNodes, deleteNode],
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
  // Unite's lanes ARE the flow's shape: the picker manages plain chain edges, so the
  // junction genuinely joins those lines (and downstream steps see all their data).
  const setUniteSources = useCallback(
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
      const hubCfg = hub.data.config as { paths?: Array<{ id: string; label: string }>; fallbackId?: string };
      const paths = hubCfg.paths ?? [];
      const remaining = paths.filter((p) => p.id !== pathId);
      // Lanes still leaving the hub after this branch is gone (paths + the fallback lane).
      const laneIds = [...remaining.map((p) => p.id), ...(hubCfg.fallbackId ? [hubCfg.fallbackId] : [])];

      // Remove the deleted branch's whole subtree (chain descendants only — a step
      // elsewhere that merely references a branch step is never deleted with it).
      const branchTargets = edges.filter((e) => e.source === hubId && e.sourceHandle === pathId).map((e) => e.target);
      const toRemove = new Set<string>(branchTargets);
      for (const t of branchTargets) for (const d of descendantsOf(t, sEdges)) toRemove.add(d);

      if (laneIds.length <= 1) {
        // One (or zero) lane left is a pointless split — dissolve the hub entirely. The
        // surviving branch's auto-created "Path conditions" head dissolves with it when
        // it's pristine (no rules), so its REAL content reconnects straight to the step
        // before the split; an empty surviving branch vanishes completely and the
        // pre-split step becomes the line end again. A head with real rules is kept
        // (it's genuine logic, now a plain Filter in the line).
        const survivorHandle = laneIds[0];
        const survivorFirst = survivorHandle ? edges.find((e) => e.source === hubId && e.sourceHandle === survivorHandle)?.target : undefined;
        const survivorNode = survivorFirst ? nodes.find((n) => n.id === survivorFirst) : undefined;
        const scfg = (survivorNode?.data.config ?? {}) as { rules?: unknown[]; dateRange?: { enabled?: boolean } };
        const pristineHead = survivorNode?.type === "filter" && ((scfg.rules ?? []).length === 0) && !scfg.dateRange?.enabled;
        let survivorTargets: string[] = survivorFirst ? [survivorFirst] : [];
        if (pristineHead && survivorFirst) {
          toRemove.add(survivorFirst);
          survivorTargets = edges.filter((e) => e.source === survivorFirst && e.targetHandle == null).map((e) => e.target);
        }
        const hubParents = edges.filter((e) => e.target === hubId).map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? undefined }));
        toRemove.add(hubId);
        setNodes((ns) =>
          ns
            .map((n) => (survivorTargets.includes(n.id) ? { ...n, data: { ...n.data, dirty: true } } : n))
            .filter((n) => !toRemove.has(n.id)),
        );
        setEdges((es) => {
          let next = es.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target) && e.source !== hubId && e.target !== hubId);
          for (const t of survivorTargets) for (const p of hubParents) next = [...next, { id: rid(), type: "insert", source: p.source, sourceHandle: p.sourceHandle, target: t }];
          return next;
        });
        setSelectedId(null);
        return;
      }

      // Two or more lanes remain: just drop this branch and its path entry.
      setNodes((ns) =>
        ns.map((n) => (n.id === hubId ? { ...n, data: { ...n.data, config: { ...n.data.config, paths: remaining } } } : n)).filter((n) => !toRemove.has(n.id)),
      );
      setEdges((es) => es.filter((e) => !(e.source === hubId && e.sourceHandle === pathId) && !toRemove.has(e.source) && !toRemove.has(e.target)));
    },
    [commit, nodes, edges, sEdges, setNodes, setEdges],
  );

  // Paths: toggle a fallback branch ("everything else"). Enabling adds its handle (the hub
  // then shows a "+ Add to …" for it); disabling removes the fallback lane + its subtree.
  const setFallback = useCallback(
    (hubId: string, enabled: boolean) => {
      const hub = nodes.find((n) => n.id === hubId);
      if (!hub) return;
      const cfg = hub.data.config as { fallbackId?: string };
      commit();
      if (enabled) {
        if (cfg.fallbackId) return;
        const fid = `fb${Math.random().toString(36).slice(2, 7)}`;
        setNodes((ns) => ns.map((n) => (n.id === hubId ? { ...n, data: { ...n.data, config: { ...n.data.config, fallbackId: fid, fallbackLabel: "Everything else" } } } : n)));
      } else {
        const fid = cfg.fallbackId;
        if (!fid) return;
        const branchTargets = edges.filter((e) => e.source === hubId && e.sourceHandle === fid).map((e) => e.target);
        const toRemove = new Set<string>(branchTargets);
        for (const t of branchTargets) for (const d of descendantsOf(t, sEdges)) toRemove.add(d);
        setNodes((ns) =>
          ns
            .map((n) => (n.id === hubId ? { ...n, data: { ...n.data, config: { ...n.data.config, fallbackId: undefined, fallbackLabel: undefined } } } : n))
            .filter((n) => !toRemove.has(n.id)),
        );
        setEdges((es) => es.filter((e) => !(e.source === hubId && e.sourceHandle === fid) && !toRemove.has(e.source) && !toRemove.has(e.target)));
      }
    },
    [commit, nodes, edges, sEdges, setNodes, setEdges],
  );

  // A branch's entry mode (Custom rules / Always run / Fallback) is edited from the
  // branch head's own panel (Zapier-style) but stored on the hub's path entry, where
  // the engine reads it. Switching away from custom clears the head's now-unused rules.
  const setBranchMode = useCallback(
    (hubId: string, pathId: string, headId: string, mode: string) => {
      commit();
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === hubId) {
            const paths = ((n.data.config as { paths?: Array<{ id: string; label: string; mode?: string }> }).paths) ?? [];
            return { ...n, data: { ...n.data, config: { ...n.data.config, paths: paths.map((p) => (p.id === pathId ? { ...p, mode } : p)) } } };
          }
          if (n.id === headId && mode !== "custom") {
            return { ...n, data: { ...n.data, config: { ...n.data.config, combinator: "and", rules: [], dateRange: undefined } } };
          }
          return n;
        }),
      );
      // A mode change re-routes records for every lane (fallback depends on siblings).
      markDirtyFrom(hubId);
    },
    [commit, setNodes, markDirtyFrom],
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
        const cfg = parent.data.config as { paths?: unknown[]; fallbackId?: string };
        const isFallback = handle === cfg.fallbackId;
        const laneCount = ((cfg.paths ?? []).length) + (cfg.fallbackId ? 1 : 0);
        // Deleting a path branch that leaves one lane dissolves the split; deleting the
        // fallback lane just removes it (the split stays).
        const willDissolve = !isFallback && laneCount <= 2;
        const message = willDissolve
          ? `This deletes this branch and its ${count} step${count === 1 ? "" : "s"}. The other branch will connect straight to the step before the split.`
          : `This deletes this branch and its ${count} step${count === 1 ? "" : "s"}.`;
        setPendingDelete({
          message,
          run: () => {
            if (isFallback) setFallback(parent.id, false);
            else removeBranch(parent.id, handle);
            setSelectedId(null);
          },
        });
        return;
      }

      // A PLAIN STEP DELETES INSTANTLY, AND SAYS SO WITH A WAY BACK.
      //
      // Cards are selected by clicking and are never edited in place, so
      // "click a step, reach for the keyboard, press Backspace" is an ordinary
      // sequence that destroyed a configured step in silence. A confirm dialog
      // is the wrong fix — deleting is common here and a modal on every one of
      // them is worse than the mistake. Undo already existed (⌘Z and the
      // toolbar); nothing had ever told anyone it was there.
      deleteAndReconnect(id);
      setToast({ message: `“${nodeTitle(String(node.type) as NodeType, node.data)}” deleted.`, undoable: true });
    },
    [nodes, sEdges, commit, setNodes, setEdges, removeBranch, setFallback, deleteAndReconnect],
  );

  // The notice clears itself; a stale "Undo" pointing at a history entry the
  // user has since built past would undo the wrong thing.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

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

  /**
   * Set while a Test is being abandoned, so its late result is dropped instead
   * of landing on a card the user has moved on from. A ref, not state: the
   * running `testNode` closure has to read the CURRENT value, not the one that
   * existed when it started.
   */
  const cancelTestRef = useRef(false);
  const cancelTest = useCallback(() => {
    cancelTestRef.current = true;
    setTestingId(null);
  }, []);

  const testNode = useCallback(
    async (id: string) => {
      cancelTestRef.current = false;
      setTestingId(id);
      // D.1-full: the Test runs on the durable high-priority lane; the editor
      // polls for its result instead of holding one long request open. The
      // inline fallback (Inngest unavailable) returns the settled result
      // immediately in the same shape.
      let result: NodeTestDTO | null;
      try {
        const started = await startNodeTestAction(toGraph(), id);
        if (started.result) {
          result = started.result;
        } else {
          result = await pollTestResult(started.runId, () => cancelTestRef.current);
        }
      } catch (e) {
        result = {
          status: "error",
          recordsIn: 0,
          recordsOut: 0,
          sample: [],
          inputSample: [],
          outputSchema: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
      // Cancelled: the step keeps whatever it had, including its dirty mark.
      // Writing the result anyway would resurrect a run the user dismissed.
      if (cancelTestRef.current || result == null) return;
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
    syncHist();
  }, [snapshot, setNodes, setEdges, syncHist]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshot());
    setNodes(next.nodes);
    setEdges(next.edges);
    syncHist();
  }, [snapshot, setNodes, setEdges, syncHist]);

  // ⌘Z / ⌘⇧Z (Ctrl on Windows) — the toolbar buttons' keyboard twins. Same
  // typing guard as Backspace: never steal undo from a focused input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      // A modal owns the screen: undoing the graph BEHIND Review & publish
      // can delete the very endpoint whose card is being edited.
      if (reviewOpen || library.open || pendingDelete) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo, reviewOpen, library.open, pendingDelete]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    setPublishIssues([]);
    setPublishWarning(null);
    await saveDraftAction(flowId, toGraph());
    const r = await publishFlowAction(flowId);
    if (r.ok) {
      setPublishState({ status: "published", version: r.version });
      if (r.warning) setPublishWarning(r.warning);
      else setReviewOpen(false);
    } else {
      setPublishError(r.error);
      setPublishIssues(r.issues ?? []);
    }
    setPublishing(false);
  }, [flowId, toGraph]);

  /**
   * Duplicate and delete belong to the toolbar now (they were a ⋮ away on the
   * flows LIST, and nowhere at all in the editor). Both are server actions;
   * both navigate on success, and a failure lands in the toast rather than
   * vanishing.
   */
  const router = useRouter();
  /**
   * The toolbar switch. Same server action and same three-state model as the
   * flows list, so the two screens cannot disagree about what "on" means.
   * Optimistic, then corrected from the server's own answer — which will
   * refuse for a flow that has never been published.
   */
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const toggleEnabled = useCallback(async () => {
    const next = publishState.status !== "published";
    setTogglingEnabled(true);
    setPublishState((p) => ({ ...p, status: next ? "published" : "draft" }));
    const r = await setFlowEnabledAction(flowId, next);
    if (r.ok) setPublishState((p) => ({ ...p, status: r.state === "active" ? "published" : "draft" }));
    else {
      setPublishState((p) => ({ ...p, status: next ? "draft" : "published" }));
      setToast({ message: r.error });
    }
    setTogglingEnabled(false);
  }, [flowId, publishState.status]);

  const duplicateFlow = useCallback(async () => {
    const r = await duplicateFlowAction(flowId);
    if (r.ok) router.push(`/dashboard/flows/${r.id}`);
    else setToast({ message: r.error });
  }, [flowId, router]);
  const deleteFlow = useCallback(async () => {
    const r = await deleteFlowAction(flowId);
    if (r.ok) router.push("/dashboard/flows");
    else setToast({ message: r.error });
  }, [flowId, router]);

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

  /**
   * WHICH STEP'S RECORDS THIS ONE READS, named on screen whenever it is not
   * simply the step above.
   *
   * The engine reaches back past steps that produce a number to the nearest
   * one that produces records, which is what makes two aggregations of one
   * source buildable at all. Reaching back silently would be worse than the
   * error it replaces, so the panel says where the records came from.
   */
  const recordSourceNote = useMemo<string | null>(() => {
    if (!selected) return null;
    const cfg = (selected.data.config ?? {}) as Record<string, unknown>;
    if (!readsRecords(String(selected.type), cfg)) return null;
    const src = recordsSourceOf({ nodes: nodes.map((n) => ({ id: n.id, type: String(n.type) })), edges }, selected.id);
    if (!src) return null;
    // Silent in the ordinary case: the records come from the step directly
    // above, which the line already says.
    const parent = edges.find((e) => e.target === selected.id && e.targetHandle == null)?.source;
    if (!parent || parent === src.nodeId) return null;
    const from = nodes.find((n) => n.id === src.nodeId);
    if (!from) return null;
    const no = stepNoById.get(src.nodeId);
    return `${no != null ? `${no}. ` : ""}${nodeTitle(String(from.type) as NodeType, from.data)}`;
  }, [selected, nodes, edges, stepNoById]);

  // If the selected step is a branch head (the first step of a Paths branch), its panel
  // shows the entry-mode dropdown (Custom rules / Always run / Fallback) — the mode
  // itself lives on the hub's path entry.
  const branch = useMemo(() => {
    if (!selected || selected.type !== "filter") return null;
    const inEdge = sEdges.find((e) => e.target === selected.id);
    if (!inEdge?.sourceHandle) return null;
    const hub = nodes.find((n) => n.id === inEdge.source);
    if (!hub || hub.type !== "paths") return null;
    const cfg = hub.data.config as { paths?: Array<{ id: string; label: string; mode?: string }>; fallbackId?: string };
    const entry = (cfg.paths ?? []).find((p) => p.id === inEdge.sourceHandle);
    if (!entry) return null; // a legacy fallback lane has no path entry — no dropdown
    const siblings = (cfg.paths ?? []).filter((p) => p.id !== entry.id);
    const hubId = hub.id;
    const pathId = entry.id;
    const headId = selected.id;
    return {
      mode: entry.mode ?? "custom",
      siblingHasFallback: siblings.some((p) => (p.mode ?? "custom") === "fallback") || !!cfg.fallbackId,
      siblingHasAlways: siblings.some((p) => (p.mode ?? "custom") === "always"),
      set: (m: string) => setBranchMode(hubId, pathId, headId, m),
    };
  }, [selected, sEdges, nodes, setBranchMode]);

  // A Unite's lane candidates: only each line's FURTHEST step (computed as if this
  // unite weren't connected), so lanes always join at their ends — never mid-line.
  // Paths hubs are never pickable (they only feed their branches).
  const candidates = useMemo(() => {
    if (!selected || selected.type !== "unite") return { dataset: [] as StepRef[] };
    const desc = descendantsOf(selected.id, edges);
    const edgesSansSelf = edges.filter((e) => e.target !== selected.id);
    const ends = terminalIds(nodes, edgesSansSelf);
    const toItem = (n: FNode): StepRef => ({ id: n.id, title: nodeTitle(String(n.type) as NodeType, n.data), stepNo: stepNoById.get(n.id) });
    return {
      dataset: nodes
        .filter((n) => n.id !== selected.id && !desc.has(n.id) && ends.has(n.id) && producesDataset(String(n.type)) && n.type !== "paths")
        .map(toItem),
    };
  }, [selected, nodes, edges, stepNoById]);

  // A matching Combine's field pickers are lane-scoped: each side may only
  // offer fields reachable through that input. The union would re-open the
  // trap matching closes — picking a field the chosen side's records never
  // carry. Computed for every Combine; only the match UI reads it.
  const laneScopes = useMemo<Record<string, string[]> | undefined>(() => {
    if (!selected || selected.type !== "unite") return undefined;
    const out: Record<string, string[]> = {};
    for (const e of edges) {
      if (e.target !== selected.id) continue;
      out[e.source] = [...laneAncestorIds(e.source, edges)];
    }
    return out;
  }, [selected, edges]);

  // Number choices for a compare step, in the same data-browser shape as every other
  // input: one group per earlier step, each exposing exactly its number — a scalar
  // step's Result, or a dataset step's Output number (its record count).
  const numberGroups = useMemo<DataGroup[]>(() => {
    if (!selected) return [];
    const desc = descendantsOf(selected.id, edges);
    // A stacking Combine is plumbing — its count is just its lanes' sum, so it
    // is not offered. A MATCHING Combine's count is a real answer ("28 of the
    // sheet's leads exist in Close") and fills a Compare slot like any other.
    const plumbing = (n: FNode) => n.type === "paths" || (n.type === "unite" && String((n.data.config as { mode?: unknown }).mode ?? "stack") !== "match");
    const avail = nodes
      .filter((n) => n.id !== selected.id && !desc.has(n.id) && !plumbing(n) && (isNumberProducer(n) || producesDataset(String(n.type))))
      .sort((a, b) => (stepNoById.get(a.id) ?? 0) - (stepNoById.get(b.id) ?? 0));
    return avail.map((n) => {
      const app = nearestAppAncestor(n, nodes, edges);
      // A step's OWN number: a value step's result, or a dataset step's
      // record count. `producesNumber` says yes to both (both can fill a
      // Compare slot), so the label/sample split has to ask the sharper
      // question — otherwise a Get data step reads "Result" with no value.
      const scalar = outputShapeOf(String(n.type), (n.data.config ?? {}) as Record<string, unknown>) === "scalar";
      const t = n.data.lastTest;
      const tile = t?.status === "ok" ? (t.tile as { value?: unknown } | undefined) : undefined;
      const sample = scalar ? t?.value ?? tile?.value : t?.status === "ok" ? t.recordsOut : undefined;
      /**
       * A dataset step's OWN COLUMNS, after its Output number. The slot used
       * to offer exactly one thing per step — the record count — so a
       * spreadsheet cell holding a precomputed total was unreachable from a
       * Calculate. Every column is offered (the browser opens on the Numbers
       * chip, but a text cell holding "5" is still a number to the engine).
       *
       * ONLY FROM A STEP HOLDING ONE RECORD. A column read off many records
       * has no single value — the total, the average and the latest are three
       * different questions — so the engine refuses it, and offering it here
       * would be inviting the error. Totalling a column across records is what
       * Calculate's own Sum is for, and it can now add several columns at once.
       *
       * THE PREVIEW IS THAT ONE RECORD'S VALUE, which is exactly what fills the
       * slot: the two entries beside it show the step's precise Result and
       * Output number, so a sample that disagreed would read as a promise the
       * flow then broke.
       */
      const own: DataField[] = [];
      if (!scalar && t?.status === "ok" && t.recordsOut === 1) {
        const sampleRecs = (t.sample ?? []) as unknown[];
        const chosen = sampleRecs[0];
        for (const f of t.outputSchema ?? []) {
          if (f.path.startsWith("__")) continue;
          own.push({
            path: f.path,
            label: f.label,
            type: f.type,
            container: f.container,
            populated: f.populated,
            sample: chosen !== undefined ? resolveSampleField(chosen, f.path) : f.example,
          });
        }
      }
      return {
        stepId: n.id,
        stepNo: stepNoById.get(n.id),
        source: app ? String((app.data.config as { source?: unknown }).source ?? "") : undefined,
        title: nodeTitle(String(n.type) as NodeType, n.data),
        fields: [{ path: scalar ? `__result_${n.id}` : `__count_${n.id}`, label: scalar ? "Result" : "Output number", type: "number", sample }, ...own],
      };
    });
  }, [selected, nodes, edges, stepNoById]);

  /**
   * RE-MEASURE A PATHS HUB WHENEVER ITS LANES CHANGE.
   *
   * React Flow caches each node's handle positions and only re-reads them when
   * the card's BOX changes size — a resize, a type change. A hub's lanes are
   * handles created from its config: adding a branch adds a 6x6 invisible
   * handle to a fixed-width card, so nothing it watches changes. The new lane's
   * edge then cannot be positioned, and an edge whose endpoints resolve to null
   * is not drawn at all — no line, no elbow, no marker. That is the reported
   * "the connection line doesn't appear when I add a new branch": the branch,
   * its step and its edge all existed, and only the drawing was missing, which
   * is why reloading the page fixed it.
   *
   * The lanes that were already there are re-measured too, and need to be: the
   * handles are spaced (i+1)/(n+1) across the card, so going from two lanes to
   * three moves every existing one.
   */
  const updateNodeInternals = useUpdateNodeInternals();
  const laneSignature = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "paths")
        .map((n) => `${n.id}:${pathHandles(n.data).map((h) => h.id).join(",")}`)
        .join("|"),
    [nodes],
  );
  useEffect(() => {
    for (const part of laneSignature.split("|")) {
      const id = part.split(":")[0];
      if (id) updateNodeInternals(id);
    }
  }, [laneSignature, updateNodeInternals]);

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
      // Default names a person would keep: the flow's own name when there is
      // one result, "flow — step" when branches produce several. The old
      // default was the node type ("Calculate"), which shipped tiles
      // literally called Calculate.
      const defaultName = (ep: Endpoint) => (endpoints.length === 1 ? name || ep.title : `${name || "Flow"} — ${ep.title}`);
      /**
       * A step that says it measures a length of time publishes a tile that
       * says so too. This used to hardcode format "number", so a hand-built
       * speed-to-lead reading "4h 45m" in the builder published a tile
       * reading "285" — the builder and the dashboard disagreeing about the
       * same number, which only the Close template escaped because it ships
       * its metric pre-seeded.
       */
      const byNodeId = new Map(nodes.map((n) => [n.id, n]));
      const seedFormat = (ep: Endpoint) => seedMetricFormat((byNodeId.get(ep.nodeId)?.data.config ?? {}) as Record<string, unknown>);
      return endpoints.map((ep) => {
        /**
         * AN EXISTING METRIC RE-DERIVES ITS DURATION FACTS, every time this
         * opens. The spec used to be returned verbatim, so it was a snapshot:
         * change the step's field from `time_between.hours` to `.minutes`
         * and the published tile kept `unit: "hours"` — the builder said 35s
         * while the dashboard said 35m. The step owns what its number IS
         * (this modal's own Format select says "set on the step"); the spec
         * keeps only what the person chose here — name, viz, precision,
         * target, time reference.
         */
        const existing = byId.get(ep.nodeId);
        if (existing) {
          const derived = seedFormat(ep);
          if (existing.format !== "duration" && derived.format !== "duration") return existing;
          // Same rule as the materializer: a step back on plain numbers sheds
          // the old duration unit, or a count republishes as "56 minutes".
          return derived.format === "duration" ? { ...existing, ...derived } : { ...existing, ...derived, unit: undefined, durationDisplay: undefined };
        }
        return {
          nodeId: ep.nodeId,
          enabled: true,
          name: defaultName(ep),
          viz: "number",
          currency: "USD",
          precision: 0,
          target: null,
          timeUnit: "month",
          ...seedFormat(ep),
        };
      });
    });
    setPublishError(null);
    setPublishWarning(null);
    setReviewOpen(true);
  }, [endpoints, name, nodes]);

  // Each endpoint's last tested value — the Review modal's preview. Reads the
  // same fields resultLabel does: a computed value first, then a tile value.
  const endpointPreviews = useMemo<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {};
    for (const ep of endpoints) {
      const n = nodes.find((x) => x.id === ep.nodeId);
      const t = n?.data.lastTest;
      const tileVal = (t?.tile as { value?: unknown } | undefined)?.value;
      out[ep.nodeId] = n?.data.dirty ? null : t?.status === "ok" ? (typeof t.value === "number" ? t.value : typeof tileVal === "number" ? tileVal : null) : null;
    }
    return out;
  }, [endpoints, nodes]);
  // The metric's "Time reference" choices (which value says WHEN each record
  // happened). ONLY date fields are offered: the backend canonicalizes every
  // date-looking value at ingest (normalize-dates), so a real timestamp column
  // always reads as a date here — and non-date fields would only be noise.
  const timeFieldOptions = useMemo<Array<{ value: string; label: string; hint?: string }>>(() => {
    type Opt = { value: string; label: string; hint?: string; step: number };
    // Preview each date field with its value from the FIRST step's chosen sample
    // record (the same record the sample picker selects), so the user recognises
    // the right timestamp column by seeing a real value — not just its name.
    const chosenSampleOf = (n: FNode): unknown => {
      const s = (n.data.lastTest?.sample ?? []) as unknown[];
      const idx = Number((n.data.config as { sampleIndex?: unknown }).sampleIndex ?? 0);
      return s[idx] ?? s[0];
    };
    const seen = new Map<string, Opt>();
    for (const n of nodes) {
      const t = n.data.lastTest;
      if (t?.status !== "ok") continue;
      const step = stepNoById.get(n.id) ?? 999;
      const app = nearestAppAncestor(n, nodes, edges);
      const appChosen = app ? chosenSampleOf(app) : undefined;
      const upChosen = chosenSampleOf(n);
      for (const f of t.outputSchema ?? []) {
        if (f.path.startsWith("__") || f.type !== "date") continue;
        const prev = seen.get(f.path);
        if (prev && prev.step <= step) continue; // keep the earliest step's value
        let ex = appChosen !== undefined ? resolveSampleField(appChosen, f.path) : undefined;
        if (ex === undefined) ex = upChosen !== undefined ? resolveSampleField(upChosen, f.path) : f.example;
        seen.set(f.path, { value: f.path, label: f.label, hint: formatSample(ex) ?? undefined, step });
      }
    }
    return [...seen.values()].sort((a, b) => a.step - b.step).map(({ value, label, hint }) => ({ value, label, hint }));
  }, [nodes, stepNoById, edges]);
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

  /**
   * How records enter each Paths branch head, keyed by the head's node id. A
   * head in "always" or "everything else" mode correctly has no rules, so it
   * must not be badged "Needs setup" — a badge it could never clear.
   */
  const branchModeById = useMemo(() => {
    const out = new Map<string, string>();
    for (const e of edges) {
      if (!e.sourceHandle) continue;
      const hub = nodes.find((n) => n.id === e.source);
      if (hub?.type !== "paths") continue;
      const entry = ((hub.data.config as { paths?: Array<{ id: string; mode?: string }> }).paths ?? []).find((p) => p.id === e.sourceHandle);
      if (entry) out.set(e.target, entry.mode ?? "custom");
    }
    return out;
  }, [nodes, edges]);

  /**
   * WHICH STEPS BECOME DASHBOARD TILES, visible while building instead of
   * only at the publish gate.
   *
   * A step becomes a metric by being a structural terminal — a rule that was
   * never stated and never shown. It bites hardest on the shape everyone
   * builds second: two counts feeding a rate. Those counts' only outgoing
   * edges are number references, which the layout drops, so they ARE
   * terminals, and Review & publish offered three metrics to someone who
   * expected one. Saying it on the canvas turns that surprise into something
   * learnable by looking, and fixable while there is still context.
   *
   * A metric the user has explicitly switched off in Review & publish says so
   * instead; a terminal with no spec yet will be seeded enabled, so it counts
   * as publishing.
   */
  const metricByNode = useMemo(() => new Map(metrics.map((m) => [m.nodeId, m])), [metrics]);

  /** A compare step's two inputs, named on the card itself. */
  const refLineById = useMemo(() => {
    const out = new Map<string, string>();
    const label = (id: string | undefined) => {
      if (!id) return null;
      const n = nodes.find((x) => x.id === id);
      if (!n) return null;
      const no = stepNoById.get(id);
      return `${no != null ? `${no}. ` : ""}${nodeTitle(String(n.type) as NodeType, n.data)}`;
    };
    for (const n of nodes) {
      if (!isCompareNode(n)) continue;
      const cfg = (n.data.config ?? {}) as { op?: unknown; aFixed?: unknown; bFixed?: unknown };
      const a = label(edges.find((e) => e.target === n.id && e.targetHandle === "a")?.source) ?? (cfg.aFixed != null ? String(cfg.aFixed) : null);
      const b = label(edges.find((e) => e.target === n.id && e.targetHandle === "b")?.source) ?? (cfg.bFixed != null ? String(cfg.bFixed) : null);
      if (a && b) out.set(n.id, formulaExpression(String(cfg.op ?? "percentage"), a, b));
    }
    return out;
  }, [nodes, edges, stepNoById]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const inputCount = inDegreeById.get(n.id) ?? 0;
        const status = computeNodeStatus({ type: String(n.type), cfg: n.data.config, inputCount, inputHandles: inHandlesById.get(n.id) ?? [], branchMode: branchModeById.get(n.id) ?? null, lastTest: n.data.lastTest, dirty: n.data.dirty, updating: testingId === n.id });
        const issue = status === "setup" ? setupHint(String(n.type), n.data.config, inputCount) : undefined;
        let freeHandles: Array<{ id: string; label: string }> | undefined;
        if (n.type === "paths") {
          const used = usedHandles.get(n.id) ?? new Set<string>();
          freeHandles = pathHandles(n.data).filter((h) => !used.has(h.id));
        }
        return {
          ...n,
          position: layout.get(n.id) ?? n.position,
          // Drive the selection ring from OUR selection (the open config step), so
          // programmatic selection (adding/continuing to a step) highlights the right card.
          selected: n.id === selectedId,
          data: {
            ...n.data,
            stepNo: stepNoById.get(n.id),
            status,
            issue,
            isTerminal: terminals.has(n.id),
            publishes: publishesToDashboard(String(n.type), terminals.has(n.id), metricByNode.get(n.id)),
            refLine: refLineById.get(n.id),
            freeHandles,
            onAddFrom: addFromNode,
            onDeleteNode: requestDelete,
            onDuplicateNode: duplicateNode,
          },
        };
      }),
    [nodes, layout, terminals, stepNoById, inDegreeById, inHandlesById, usedHandles, addFromNode, testingId, requestDelete, duplicateNode, selectedId, metricByNode, refLineById],
  );
  /**
   * RUN THE WHOLE FLOW, top to bottom.
   *
   * Every Test was per-step, and changing step 1 correctly marks every step
   * below it dirty — so seeing the effect of one edit meant opening six panels
   * and pressing six buttons. There was also no way at all to ask "what does
   * this metric say right now?" without opening the last step, or publishing.
   *
   * Sequential on purpose: these are real queries over real data, and firing
   * six at once would spike the very provider budget the sync engine spends
   * the rest of its life protecting. In step order, so the canvas reads as a
   * progress display — which is the moment the flow explains itself.
   *
   * Steps that need setup are SKIPPED rather than run: they would fail, and a
   * red Error badge on a step whose only problem is being unfinished replaces
   * a true amber with a false red.
   */
  const testAll = useCallback(async () => {
    const runnable = displayNodes
      .filter((n) => n.type !== "paths" && n.data.status !== "setup")
      .sort((a, b) => (stepNoById.get(a.id) ?? 999) - (stepNoById.get(b.id) ?? 999));
    if (runnable.length === 0) return;
    for (let i = 0; i < runnable.length; i++) {
      setRunAll({ at: i + 1, of: runnable.length });
      setSelectedId(runnable[i].id);
      await testNode(runnable[i].id);
      // A cancel during a run-all stops the whole run, not just this step.
      if (cancelTestRef.current) break;
    }
    setRunAll(null);
  }, [displayNodes, stepNoById, testNode]);

  // Only the flow's chain edges are drawn — a compare step's number references are
  // picked in the panel and never rendered as lines (they'd cut across the canvas).
  // Branch edges (from a Paths hub) get no "+" insert: a branch always starts with
  // its own mandatory conditions step.
  const displayEdges = useMemo(() => {
    const compareIds = new Set(nodes.filter(isCompareNode).map((n) => n.id));
    const seen = new Set<string>();
    const out: Edge[] = [];
    for (const e of edges) {
      // A compare step's number references are picked in the panel — drawn only
      // while that step is selected, so the default canvas stays a clean column
      // and the wiring appears exactly when someone is looking for it.
      if (compareIds.has(e.target) && (e.targetHandle === "a" || e.targetHandle === "b")) {
        if (e.target !== selectedId) continue;
        const target = nodes.find((n) => n.id === e.target);
        const labels = formulaHandleLabels(String((target?.data.config as { op?: unknown })?.op ?? "percentage"));
        out.push({ ...e, type: "reference", zIndex: 5, data: { label: e.targetHandle === "a" ? labels.a : labels.b } });
        continue;
      }
      // Collapse duplicate lines between the same two nodes (chain + reference pair).
      const key = `${e.source}::${e.sourceHandle ?? ""}->${e.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...e, type: "insert", data: { ...(e.data ?? {}), onInsert: e.sourceHandle ? undefined : insertOnEdge } });
    }
    return out;
  }, [nodes, edges, insertOnEdge, selectedId]);

  const empty = nodes.length === 0;

  return (
    // NO BAR, NO RAIL. The canvas is the page; the chrome floats on it.
    <div className="relative flex h-screen flex-col">
      <FlowToolbar
        name={name}
        onRename={onRename}
        saveState={saveState}
        onRetrySave={saveNow}
        onDuplicate={duplicateFlow}
        onDelete={deleteFlow}
        onTestAll={testAll}
        onStopTestAll={cancelTest}
        runAll={runAll}
        showTestAll={!empty}
        publishedVersion={publishState.version}
        isPublished={publishState.status === "published"}
        publishing={publishing}
        onReview={openReview}
        panelOpen={selectedId != null}
        onUndo={undo}
        onRedo={redo}
        canUndo={hist.undo > 0}
        canRedo={hist.redo > 0}
        onZoomIn={() => rf.zoomIn({ duration: 150 })}
        onZoomOut={() => rf.zoomOut({ duration: 150 })}
        onFitView={() => rf.fitView({ duration: 250, maxZoom: 1 })}
        zoom={zoom}
        onToggleEnabled={toggleEnabled}
        togglingEnabled={togglingEnabled}
      />

      {publishError && !reviewOpen && (
        <div className="absolute left-1/2 top-[98px] z-10 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-small text-red-800 flow-shadow">
          <p>{publishError}</p>
          {/* One line per issue, each pointing at the step that caused it. The
              whole list used to be joined into a single string with no step
              named, prefixed twice: "Can't publish: Cannot publish: A; B; C". */}
          <ul className="mt-1 space-y-0.5">
            {publishIssues.map((iss, i) => (
              <li key={i}>
                {iss.nodeId ? (
                  <button
                    type="button"
                    onClick={() => { setSelectedId(iss.nodeId!); setPublishError(null); }}
                    className="text-left underline underline-offset-2 hover:no-underline"
                  >
                    {iss.message}
                  </button>
                ) : (
                  iss.message
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {publishWarning && (
        <div className="absolute left-1/2 top-[98px] z-10 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-small text-amber-800 flow-shadow">
          <span>{publishWarning}</span>
          <button onClick={() => setPublishWarning(null)} className="text-amber-700 hover:text-amber-900">
            Dismiss
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Canvas — full width; the config panel floats OVER it as an overlay. */}
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
            // Never zoom IN past 100% when fitting — so the very first node (or a
            // tiny flow) sits at natural size instead of filling the screen.
            fitViewOptions={{ maxZoom: 1 }}
            deleteKeyCode={null}
            // Scroll/two-finger pans the canvas; pinch (or ⌘/Ctrl+scroll) zooms.
            panOnScroll
            // A double-click/tap on the canvas does nothing (no accidental zoom).
            zoomOnDoubleClick={false}
            // One step selected at a time — no box-select or shift/⌘ multi-select.
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            selectionOnDrag={false}
            proOptions={{ hideAttribution: true }}
          >
            {/* A soft grey canvas with a faint, wide-spaced dot grid — calm and
                smooth while panning, not a busy pattern. */}
            {/* size is a DIAMETER and it scales with zoom — see --color-canvas-dot. */}
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.6} color="#d9d5e8" bgColor="#f6f6fb" />
          </ReactFlow>

        </div>

        {/* Config panel — mounted through a host so it can scale OUT on deselect,
            not just pop in. */}
        <ConfigPanelHost
          data={
            selected
              ? {
                  node: selected,
                  stepNo: stepNoById.get(selected.id),
                  connections,
                  fieldGroups,
                  inputs: selectedInputs,
                  recordSourceNote,
                  inputCount: edges.filter((e) => e.target === selected.id).length,
                  testing: testingId === selected.id,
                  numberGroups,
                  datasetCandidates: candidates.dataset,
                  laneScopes,
                  branch,
                  onChange: (patch) => updateConfig(selected.id, patch),
                  onRename: (v) => renameNode(selected.id, v),
                  onTest: () => testNode(selected.id),
                  onCancelTest: cancelTest,
                  onTestUpstream: (() => {
                    const up = edges.find((e) => e.target === selected.id && e.targetHandle == null)?.source;
                    return up ? () => testNode(up) : undefined;
                  })(),
                  onAddNext: () => continueFromNode(selected.id),
                  onSetInput: (handle, sourceId) => setFormulaInput(selected.id, handle, sourceId),
                  onSetSources: (ids) => setUniteSources(selected.id, ids),
                  onAddBranch: () => addBranch(selected.id),
                  onRemoveBranch: (pid) => removeBranch(selected.id, pid),
                }
              : null
          }
        />
      </div>

      {library.open && (
        <NodeLibraryModal
          anchor={library.anchor}
          anchorSelector={library.anchorSelector}
          onClose={() => setLibrary({ open: false, ctx: null, anchor: null, anchorSelector: null })}
          onPick={(entry) => {
            createNode(entry.type, library.ctx, entry.config);
            setLibrary({ open: false, ctx: null, anchor: null, anchorSelector: null });
          }}
        />
      )}

      {reviewOpen && (
        <ReviewPublishModal
          endpoints={endpoints}
          metrics={metrics}
          previews={endpointPreviews}
          timeFieldOptions={timeFieldOptions}
          hasCustomRange={nodes.some((n) => {
            const c = n.data.config as { dateRange?: { enabled?: boolean; mode?: string; to?: string }; mode?: string; to?: string };
            // Both shapes: a Filter's dateRange, and the retired-but-still-
            // running Date range step, which stores mode/from/to at the top level.
            // A window with no "To" is the OPEN-ended one below; this notice is
            // about the end-of-day change, which can only move a bounded range.
            if (c.dateRange?.enabled && c.dateRange.mode === "between") return !!c.dateRange.to;
            return n.type === "time" && c.mode === "between" && !!c.to;
          })}
          // The second number-moving change to the same control, and the bigger
          // one: an open end used to stop at the current instant, so a flow
          // reading a calendar silently excluded every scheduled meeting.
          hasOpenEndedRange={nodes.some((n) => {
            const c = n.data.config as { dateRange?: { enabled?: boolean; mode?: string; to?: string }; mode?: string; to?: string };
            if (c.dateRange?.enabled && c.dateRange.mode === "between") return !c.dateRange.to;
            return n.type === "time" && c.mode === "between" && !c.to;
          })}
          publishing={publishing}
          error={publishError}
          issues={publishIssues}
          onSelectNode={(id) => { setReviewOpen(false); setSelectedId(id); }}
          warning={publishWarning}
          publishedVersion={publishState.version}
          onChange={setMetrics}
          onPublish={publish}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {/* Bottom-centre, over the canvas, out of the config panel's way. */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-card bg-ink-900 py-2.5 pl-4 pr-2.5 text-base text-ink-50 flow-shadow flow-pop-in">
            <span>{toast.message}</span>
            {toast.undoable && (
              <button
                onClick={() => {
                  undo();
                  setToast(null);
                }}
                className="rounded-control px-2.5 py-1 text-base font-semibold text-white/90 transition-colors hover:bg-white/15 hover:text-white"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 flow-shadow flow-pop-in" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-foreground">Delete this step?</p>
            <p className="mt-1.5 text-sm text-neutral-600">{pendingDelete.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingDelete(null)} className="rounded-lg border border-neutral-200 px-3.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                Cancel
              </button>
              <button
                onClick={() => {
                  pendingDelete.run();
                  setPendingDelete(null);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
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

/**
 * The first thing anyone ever sees of the builder, and the only place in it
 * that explains what a flow IS.
 *
 * IT OPENS THE STEP PICKER NO LONGER. The old empty state's one button opened
 * the full six-step library, from which a first-time user could pick "Filter
 * records" — creating a card that reads "Needs setup — Connect an input" with
 * no input to connect and no way forward except deleting it. The first step of
 * every flow is a Get data step; offering the other five was offering a dead
 * end. So the button MAKES one and opens its panel.
 *
 * With no connected accounts, every path from here ends at "No connected
 * accounts yet" inside that panel — so the button goes to Integrations
 * instead, which is the actual next thing to do.
 */
function EmptyCanvas({ hasConnections, onStart }: { hasConnections: boolean; onStart: () => void }) {
  const steps = [
    { n: 1, title: "Get the records", detail: "from an app you've connected" },
    { n: 2, title: "Narrow them down", detail: "keep only the ones that count" },
    { n: 3, title: "Turn them into a number", detail: "count, total, average, compare" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-7 flow-shadow">
        <h2 className="text-center text-title font-semibold tracking-tight text-foreground">Build a metric in three moves</h2>
        <ol className="mt-5 space-y-3">
          {steps.map((s) => (
            <li key={s.n} className="flex items-start gap-3">
              <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-micro font-semibold text-neutral-500">
                {s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{s.title}</span>
                <span className="block text-small leading-snug text-neutral-500">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {hasConnections ? (
          <Button onClick={onStart} size="lg" className="mt-6 w-full">
            <Database />
            Start with Get data
          </Button>
        ) : (
          <>
            <Link
              href="/integrations"
              className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-control bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              <Plug size={16} />
              Connect an app first
            </Link>
            <p className="mt-2 text-center text-xs text-neutral-500">A flow reads records from a connected account — there aren&rsquo;t any yet.</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Keeps the config panel mounted for one exit animation after it's deselected, so
 * it scales OUT (not just vanishes). While a step is selected it renders the live
 * panel; on deselect it holds the last panel and plays `flow-pop-out`, then unmounts.
 */
function ConfigPanelHost({ data }: { data: React.ComponentProps<typeof ConfigPanel> | null }) {
  const [visible, setVisible] = useState(false);
  const last = useRef<React.ComponentProps<typeof ConfigPanel> | null>(null);
  if (data) last.current = data;
  const key = data ? data.node.id : null;
  useEffect(() => {
    if (key != null) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 140);
    return () => clearTimeout(t);
  }, [key]);

  if (!data && !visible) return null;
  const props = last.current;
  if (!props) return null;
  const closing = !data && visible;
  return <ConfigPanel key={props.node.id} {...props} animClass={closing ? "flow-pop-out" : "flow-pop-in"} />;
}
