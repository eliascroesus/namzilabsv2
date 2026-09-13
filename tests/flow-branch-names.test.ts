import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Edge } from "@xyflow/react";
import { branchHeadLabels, branchLaneOf, syncBranchLabels, type FNode } from "@/components/flow/graph-utils";

vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

// After the mocks, because the panel's import graph reaches the server actions.
const { ConfigPanel } = await import("@/components/flow/ConfigPanel");

const N = (id: string, type: string, data: Partial<FNode["data"]> = {}): FNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { config: {}, ...data } }) as FNode;
const E = (source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id: `${source}->${target}`, source, target, ...extra });

const hub = (paths: Array<{ id: string; label: string }>, extra: Record<string, unknown> = {}) =>
  N("hub", "paths", { config: { paths, ...extra } });

/**
 * A BRANCH HAS ONE NAME, AND BOTH PLACES IT APPEARS SHOW IT.
 *
 * The Split's panel names its branches. The first card down each lane IS that
 * branch. `addBranch` created the card with a COPY of the name and nothing ever
 * reconciled them again, so renaming the branch in the panel left the card
 * reading "Path A" for the life of the flow — which is what a customer is
 * looking at while the panel tells them something else.
 */
describe("branch names — the Split's list and the card are one name", () => {
  const nodes = [N("src", "app"), hub([{ id: "p1", label: "Booked calls" }, { id: "p2", label: "No-shows" }]), N("h1", "filter", { label: "Path A" }), N("h2", "filter", { label: "Path B" })];
  const edges = [E("src", "hub"), E("hub", "h1", { sourceHandle: "p1" }), E("hub", "h2", { sourceHandle: "p2" })];

  it("hands each branch head the name its Split gives that lane", () => {
    expect(branchHeadLabels(nodes, edges)).toEqual(new Map([["h1", "Booked calls"], ["h2", "No-shows"]]));
  });

  it("repairs a card whose name drifted, without touching the hub's config", () => {
    const fixed = syncBranchLabels(nodes, edges);
    expect(fixed.map((n) => n.data.label)).toEqual([undefined, undefined, "Booked calls", "No-shows"]);
    // The hub is handed back untouched — the repair is display-only, so opening
    // an old flow cannot flag it as edited since publishing.
    expect(fixed[1]).toBe(nodes[1]);
    expect(fixed[1].data.config).toEqual({ paths: [{ id: "p1", label: "Booked calls" }, { id: "p2", label: "No-shows" }] });
  });

  it("returns the very same array when nothing is out of step, so the canvas does not re-render", () => {
    const already = syncBranchLabels(nodes, edges);
    expect(syncBranchLabels(already, edges)).toBe(already);
  });

  it("names the legacy fallback lane too, defaulting to 'Everything else'", () => {
    const ns = [hub([{ id: "p1", label: "Paid" }], { fallbackId: "fb" }), N("h1", "filter"), N("hf", "filter")];
    const es = [E("hub", "h1", { sourceHandle: "p1" }), E("hub", "hf", { sourceHandle: "fb" })];
    expect(branchHeadLabels(ns, es).get("hf")).toBe("Everything else");
    const named = [hub([{ id: "p1", label: "Paid" }], { fallbackId: "fb", fallbackLabel: "Free" }), N("hf", "filter")];
    expect(branchHeadLabels(named, [E("hub", "hf", { sourceHandle: "fb" })]).get("hf")).toBe("Free");
  });

  it("leaves ordinary steps alone — only the head of a lane is a branch", () => {
    const ns = [...nodes, N("later", "formula", { label: "Rate" })];
    const es = [...edges, E("h1", "later")];
    expect(branchHeadLabels(ns, es).has("later")).toBe(false);
    expect(syncBranchLabels(ns, es).find((n) => n.id === "later")!.data.label).toBe("Rate");
  });

  it("ignores a blank branch label rather than blanking the card", () => {
    // PathsConfigSchema requires a non-empty label; a hub that somehow holds ""
    // must not propagate it, or the card loses its name too.
    const ns = [hub([{ id: "p1", label: "  " }]), N("h1", "filter", { label: "Path A" })];
    const es = [E("hub", "h1", { sourceHandle: "p1" })];
    expect(branchHeadLabels(ns, es).size).toBe(0);
    expect(syncBranchLabels(ns, es)[1].data.label).toBe("Path A");
  });

  it("finds the lane a card heads, so renaming the CARD can write the hub", () => {
    expect(branchLaneOf("h2", nodes, edges)).toEqual({ hubId: "hub", pathId: "p2" });
    expect(branchLaneOf("src", nodes, edges)).toBeNull();
    // A plain chain edge is not a lane, however deep in a branch it sits.
    expect(branchLaneOf("later", [...nodes, N("later", "filter")], [...edges, E("h1", "later")])).toBeNull();
  });

  it("ignores a stale handle the hub no longer lists", () => {
    // An undo can leave an edge on a path id the Split has dropped. It names no
    // lane, so it renames nothing and reports no lane.
    const es = [E("hub", "h1", { sourceHandle: "gone" })];
    expect(branchHeadLabels(nodes, es).size).toBe(0);
    expect(branchLaneOf("h1", nodes, es)).toBeNull();
  });
});

/**
 * THE COMBINE STEP COULD NOT BE COMPLETED, IN THE ORDER EVERYONE BUILDS IT.
 *
 * Get data → "+ Add next step" → Combine leaves exactly one dataset candidate,
 * already wired as the one lane. The "Add another step" control was gated on
 * `laneIds.length < datasetCandidates.length` — `1 < 1` — so it never rendered,
 * and there is no other route in: ports are not draggable and no drop slot
 * targets a Combine. The step sat there reading "Ready" with one lane, doing
 * nothing, with no control on screen that could fix it.
 */
describe("Combine — a second lane is always reachable", () => {
  const unite = N("u", "unite", { config: { mode: "stack" } });
  const render = (opts: { inputs: Array<{ nodeId: string; title: string }>; candidates: Array<{ id: string; title: string }>; onAddSourceLane?: () => void }) =>
    renderToStaticMarkup(
      createElement(ConfigPanel as never, {
        node: unite,
        connections: [],
        fieldGroups: [],
        inputs: opts.inputs.map((i) => ({ ...i, targetHandle: null })),
        inputCount: opts.inputs.length,
        testing: false,
        numberGroups: [],
        datasetCandidates: opts.candidates,
        branch: null,
        onChange: () => {},
        onRename: () => {},
        onTest: () => {},
        onAddNext: () => {},
        onSetInput: () => {},
        onSetSources: () => {},
        onAddBranch: () => {},
        onRemoveBranch: () => {},
        onAddSourceLane: opts.onAddSourceLane,
      } as never),
    );

  it("offers a way to add a lane when the only candidate is already wired", () => {
    // The exact reported state: one Get data, wired, nothing else to point at.
    const html = render({ inputs: [{ nodeId: "a", title: "Get data" }], candidates: [{ id: "a", title: "Get data" }], onAddSourceLane: () => {} });
    expect(html).toContain("Add a Get data step");
  });

  it("offers the existing step when there IS one spare, rather than making a new one", () => {
    const html = render({ inputs: [{ nodeId: "a", title: "Get data" }], candidates: [{ id: "a", title: "Get data" }, { id: "b", title: "Sheets" }], onAddSourceLane: () => {} });
    expect(html).toContain("Add another step");
    expect(html).not.toContain("Add a Get data step");
  });

  /**
   * Two counts can agree while a candidate is genuinely addable: a lane wired to
   * a step that later stopped being a line end leaves `datasetCandidates` and
   * takes its place in the total with it. The question is a set question.
   */
  it("adds a lane even when the counts happen to match", () => {
    const html = render({ inputs: [{ nodeId: "calc", title: "Calculate" }], candidates: [{ id: "b", title: "Sheets" }], onAddSourceLane: () => {} });
    expect(html).toContain("Add another step");
  });

  it("keeps a wired lane readable when its step is no longer a candidate", () => {
    // Otherwise the Select falls back to its placeholder and a correctly wired
    // lane reads "Choose a step…", which is both a lie and a trap: opening it
    // to look re-wires the lane.
    const html = render({ inputs: [{ nodeId: "calc", title: "Calculate" }], candidates: [{ id: "b", title: "Sheets" }] });
    expect(html).toContain("Calculate");
  });

  it("stops offering lanes to a Match, which takes exactly two", () => {
    const two = N("u", "unite", { config: { mode: "match" } });
    const html = renderToStaticMarkup(
      createElement(ConfigPanel as never, {
        node: two, connections: [], fieldGroups: [],
        inputs: [{ nodeId: "a", title: "A", targetHandle: null }, { nodeId: "b", title: "B", targetHandle: null }],
        inputCount: 2, testing: false, numberGroups: [], datasetCandidates: [{ id: "c", title: "C" }], branch: null,
        onChange: () => {}, onRename: () => {}, onTest: () => {}, onAddNext: () => {},
        onSetInput: () => {}, onSetSources: () => {}, onAddBranch: () => {}, onRemoveBranch: () => {}, onAddSourceLane: () => {},
      } as never),
    );
    expect(html).not.toContain("Add another step");
    expect(html).not.toContain("Add a Get data step");
  });
});
