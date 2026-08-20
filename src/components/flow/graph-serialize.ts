import type { Edge } from "@xyflow/react";
import type { FNode, Graph, MetricSpecT } from "./graph-utils";

/**
 * THE SAVE PAYLOAD, AND ONLY THE SAVE PAYLOAD.
 *
 * React Flow's node objects carry a lot that is about the SESSION rather than
 * about the flow: `selected`, `dragging`, `measured`, and our own client-only
 * `dirty` mark. None of it belongs in the draft, and none of it is here.
 *
 * That is not merely tidiness. The autosave watches the node array, and React
 * Flow replaces that array on every selection change — so clicking a step
 * produced a new array, woke the autosave, and wrote a draft byte-identical to
 * the one already stored. The flow said "Saving…" because you looked at it.
 * The cure is to compare THIS output between renders rather than the array it
 * came from, which only works while the output is free of session state; so
 * this function is where that promise is kept, and `tests/graph-serialize.test.ts`
 * is what keeps it.
 */
export function serializeGraph(nodes: FNode[], edges: Edge[], metrics: MetricSpecT[]): Graph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: String(n.type),
      position: n.position,
      data: { config: n.data.config, label: n.data.label, lastTest: n.data.lastTest ?? undefined },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
    // A non-finite number fails the graph schema, which fails the autosave of
    // this edit and every edit after it. The inputs can no longer produce one;
    // this is the belt, so no future input can either.
    //
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
}
