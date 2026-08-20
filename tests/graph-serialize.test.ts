import { describe, expect, it } from "vitest";
import { serializeGraph } from "@/components/flow/graph-serialize";
import type { FNode } from "@/components/flow/graph-utils";
import type { NodeTestDTO } from "@/lib/flow/test-run";

/** A real result shape, so the fixture cannot drift from what a Test returns. */
const OK_TEST: NodeTestDTO = { status: "ok", recordsIn: 12, recordsOut: 9, sample: [], inputSample: [], outputSchema: [], value: 9 };

/**
 * CLICKING A STEP IS NOT AN EDIT.
 *
 * The builder autosaves on a debounce driven by the node array. React Flow
 * replaces that array on every selection change, so opening a step produced a
 * new array, woke the autosave, and wrote a draft byte-identical to the one
 * already stored — the flow said "Saving…" because you looked at it, and every
 * click on the canvas cost a database round trip.
 *
 * The fix is to compare the SERIALISED PAYLOAD between renders instead of the
 * array it came from, which only works while the payload is free of session
 * state. These pin that: anything React Flow or the canvas writes onto a node
 * that is about the SESSION rather than about the FLOW must not survive
 * serialisation, or the guard silently stops guarding and the bug returns with
 * no error anywhere.
 *
 * Sabotage-verified: adding `selected: n.selected` to the mapping in
 * graph-serialize.ts fails the first test alone.
 */
function node(id: string, extra: Partial<FNode> = {}): FNode {
  return {
    id,
    type: "filter",
    position: { x: 0, y: 120 },
    data: { config: { op: "count" }, label: "Filter", lastTest: null, dirty: false },
    ...extra,
  } as FNode;
}

const edges = [{ id: "e1", source: "a", target: "b", sourceHandle: null, targetHandle: null }];
const metrics = [{ id: "m1", nodeId: "b", name: "Leads", precision: 0, target: null } as never];

describe("serializeGraph drops session state", () => {
  it("selecting a step produces an identical payload", () => {
    const before = serializeGraph([node("a"), node("b")], edges, metrics);
    const after = serializeGraph([node("a", { selected: true }), node("b")], edges, metrics);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("dragging, measuring and the dirty mark are all invisible to it", () => {
    const before = serializeGraph([node("a")], edges, metrics);
    const noisy = serializeGraph(
      [
        node("a", {
          selected: true,
          dragging: true,
          measured: { width: 300, height: 72 },
          data: { config: { op: "count" }, label: "Filter", lastTest: null, dirty: true },
        } as Partial<FNode>),
      ],
      edges,
      metrics,
    );
    expect(JSON.stringify(noisy)).toBe(JSON.stringify(before));
  });

  it("a real edit DOES change the payload", () => {
    // The guard must not be so eager that it swallows work. If this ever
    // passes as "unchanged", the autosave has stopped saving.
    const before = serializeGraph([node("a")], edges, metrics);
    const edited = serializeGraph(
      [node("a", { data: { config: { op: "sum" }, label: "Filter", lastTest: null, dirty: true } } as Partial<FNode>)],
      edges,
      metrics,
    );
    expect(JSON.stringify(edited)).not.toBe(JSON.stringify(before));
  });

  it("renaming, moving, and running a test all change the payload", () => {
    const base = serializeGraph([node("a")], edges, metrics);
    const renamed = serializeGraph([node("a", { data: { config: { op: "count" }, label: "Renamed", lastTest: null, dirty: false } } as Partial<FNode>)], edges, metrics);
    const moved = serializeGraph([node("a", { position: { x: 40, y: 120 } })], edges, metrics);
    const tested = serializeGraph(
      [node("a", { data: { config: { op: "count" }, label: "Filter", lastTest: OK_TEST, dirty: false } } as Partial<FNode>)],
      edges,
      metrics,
    );
    for (const changed of [renamed, moved, tested]) {
      expect(JSON.stringify(changed)).not.toBe(JSON.stringify(base));
    }
  });
});
