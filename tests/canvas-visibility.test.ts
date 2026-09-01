import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canvasRowFate, tileKeyOfFlow, tileKeyOfMetric } from "@/lib/board/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));
vi.mock("@/app/dashboard/board-actions", () => ({
  addCustomTileAction: async () => ({ ok: true }),
  deleteCustomTileAction: async () => ({ ok: true }),
  setCustomTileAction: async () => ({ ok: true }),
  duplicateCustomTileAction: async () => ({ ok: true, tile: { id: "copy", tileKey: "flow:f1:o1", chart: "number", config: {}, x: 3, y: 0, w: 3, h: 4 } }),
  setCustomTileLayoutAction: async () => ({ ok: true }),
}));

const { CustomBoard } = await import("@/app/dashboard/custom-board");
type CanvasTile = Parameters<typeof CustomBoard>[0]["tiles"][number];

/**
 * A CHART SOMEBODY ELSE MAY SEE AND YOU MAY NOT.
 *
 * Both of the page's permission filters drop hidden metrics at the SOURCE, so
 * a canvas row pointing at one joined to nothing — and so did a row whose
 * metric had genuinely been deleted. Two different facts, one `undefined`, and
 * the renderer treated both as death: it drew `DeadTile`, which prints the
 * row's TITLE (the override lives on the row, which no filter touches) above
 * the sentence "It isn't published any more. Publish it again."
 *
 * Both halves of that were wrong. The title is exactly what a rank exists to
 * withhold, and the sentence was false — the metric is fine; the viewer simply
 * is not on its list. So a hidden row is now dropped on the server and nothing
 * about it crosses the boundary, while a genuinely dead one keeps its box.
 */

const FLOW = tileKeyOfFlow("f1", "o1");
const METRIC = tileKeyOfMetric("m1");

describe("telling 'you may not see it' from 'it is gone'", () => {
  it("calls a row hidden when its key survives the unfiltered set", () => {
    const existing = new Set([FLOW, METRIC]);
    expect(canvasRowFate(FLOW, false, existing)).toBe("hidden");
    expect(canvasRowFate(METRIC, false, existing)).toBe("hidden");
  });

  it("calls a row dead only when nothing anywhere still has its key", () => {
    expect(canvasRowFate(FLOW, false, new Set())).toBe("dead");
    expect(canvasRowFate(FLOW, false, new Set([METRIC]))).toBe("dead");
  });

  it("renders a row that joined, whatever the set says", () => {
    expect(canvasRowFate(FLOW, true, new Set([FLOW]))).toBe("render");
    expect(canvasRowFate(FLOW, true, new Set())).toBe("render");
  });

  it("reads every hidden row as DEAD if the set is built after the filter", () => {
    /**
     * The regression itself, stated as an assertion. `existing` has to be
     * assembled BEFORE `canSeeMetric` runs; assembling it after gives a set
     * that already excludes the hidden keys, every row reads "dead", and the
     * leak is back with the same false sentence.
     */
    const afterTheFilter = new Set<string>(); // hidden keys already gone
    expect(canvasRowFate(FLOW, false, afterTheFilter)).toBe("dead");
  });
});

/** The page's own flatMap, over the rule, so the omission is asserted end to end. */
const build = (rows: Array<{ tileKey: string; title: string }>, joined: Set<string>, existing: Set<string>) =>
  rows.flatMap((row) => (canvasRowFate(row.tileKey, joined.has(row.tileKey), existing) === "hidden" ? [] : [row]));

describe("what crosses to the client", () => {
  it("omits a hidden row entirely — no entry, and no title anywhere in it", () => {
    const rows = [
      { tileKey: FLOW, title: "Revenue by rep, Q3 confidential" },
      { tileKey: METRIC, title: "Pickup Rate" },
    ];
    const out = build(rows, new Set([METRIC]), new Set([FLOW, METRIC]));

    expect(out).toHaveLength(1);
    expect(out[0].tileKey).toBe(METRIC);
    // The whole payload, not just the tile list: a title reaching the client in
    // ANY field is the leak, and the serialized prop is what actually crosses.
    expect(JSON.stringify(out)).not.toContain("confidential");
    expect(JSON.stringify(out)).not.toContain("f1");
  });

  it("keeps a genuinely dead row, because its box is somebody's arrangement", () => {
    const rows = [{ tileKey: FLOW, title: "Revenue" }];
    expect(build(rows, new Set(), new Set())).toHaveLength(1);
  });
});

const tile = (id: string, over: Partial<CanvasTile> = {}): CanvasTile => ({
  id,
  tileKey: `flow:f1:${id}`,
  x: 0,
  y: 0,
  w: 3,
  h: 4,
  chart: "number",
  charts: ["number"],
  metricName: "Booked Leads",
  config: {},
  attention: 0,
  data: { kind: "flow", status: "fresh", tile: { format: "number", precision: 0, byRange: { today: { value: 12 } } } },
  ...over,
});

const board = (over: Partial<Parameters<typeof CustomBoard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(CustomBoard, {
      viewId: "v1",
      tiles: [tile("t1"), tile("t2", { x: 3 })],
      options: [],
      rangeKey: "today",
      canEdit: true,
      ...over,
    }),
  );

describe("a view holding a hidden row is read-only", () => {
  /**
   * THE HAZARD THAT COMES WITH OMITTING. The hidden tile is absent from this
   * viewer's layout, so any drag lets `compact` float the survivors up into its
   * space — and `setCustomTileLayoutAction` would write that, overlapping a
   * tile for everyone who CAN see it. One viewer's permissions must not
   * rearrange another viewer's board, so the whole arrangement is frozen.
   */
  it("offers no gesture: no grab cursor, no resize grip", () => {
    const open = board();
    const frozen = board({ layoutFrozen: true });

    expect(open).toContain("cursor-grab");
    expect(frozen).not.toContain("cursor-grab");
    // The grip is the only `cursor-se-resize` on the board.
    expect(open).toContain("cursor-se-resize");
    expect(frozen).not.toContain("cursor-se-resize");
  });

  it("says why, once, without describing what is hidden", () => {
    const frozen = board({ layoutFrozen: true });
    expect(frozen).toContain("arrangement is locked");
    // Naming it, counting it, or hinting at its shape would leak the very
    // thing the omission protects.
    expect(frozen).not.toMatch(/\b1 chart is hidden\b/);
    expect((frozen.match(/arrangement is locked/g) ?? []).length).toBe(1);
  });

  it("still lets the charts you CAN see be edited — it freezes arrangement only", () => {
    // The menu survives: renaming, repointing and restyling touch one row and
    // move nothing, so there is no reason to take them away.
    expect(board({ layoutFrozen: true })).toContain("Options for");
  });

  it("gates every path that writes a layout, and only those", async () => {
    /**
     * SOURCE, not markup, and deliberately. The menu's rows live inside a
     * Popover that renders nothing until it is opened, so a static render
     * cannot see them — `scripts/canvas-check.mjs` opens the real menu in a
     * browser and asserts Width and Move are gone. What is checkable here is
     * the WIRING: that the freeze reaches exactly the three paths that call
     * `writeLayout`, and that it is derived rather than re-decided per site.
     */
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/app/dashboard/custom-board.tsx"), "utf8");

    expect(src).toContain("const canArrange = canEdit && !layoutFrozen;");
    // The drag strip, the grip, and the menu's Width/Height/Move block.
    expect((src.match(/canArrange/g) ?? []).length).toBeGreaterThanOrEqual(5);
    /**
     * The gesture is gated by NOT RENDERING its handle rather than by an early
     * return: the drag surface is the card's top half, and a strip that does
     * not exist cannot be pressed. Same for the corner grip. Sabotage: render
     * either unconditionally and a frozen board becomes draggable again.
     */
    /**
     * Anchored on what each handle IS — the grab cursor, and the resize
     * handle's own attribute — rather than on the element that carries it. The
     * old spelling pinned a literal `<span>` and the opening words of a code
     * comment, so re-skinning the strip failed a test about permissions.
     *
     * Comments are stripped before measuring, because the window is a proximity
     * claim about CODE. Left in, the distance from a guard to the thing it
     * guards grows every time somebody explains it — which is exactly what
     * happened here, and the note that broke this was one about not coupling
     * tests to appearance.
     *
     * THE DRAG SURFACE CHANGED SHAPE, AND THE ASSERTION FOLLOWS THE GUARD
     * RATHER THAN THE MARKUP.
     *
     * The grab cursor used to live on a half-height overlay introduced with
     * `{canArrange && (`. That overlay is gone: it was a sibling painted ABOVE
     * the chart, so a press on a plot never reached the plot and the
     * "you cannot drag a card by its axes" rule could not be enforced. The
     * press and the cursor moved onto the cell itself, where the guard is a
     * ternary rather than a block.
     *
     * What is being checked has not changed: the grab cursor and the resize
     * grip are each within arm's length of a `canArrange` guard, so neither can
     * be offered to a viewer whose board is frozen. Comments are stripped
     * first, because the window is a proximity claim about CODE — left in, the
     * distance from a guard to the thing it guards grows every time somebody
     * explains it, which is exactly what broke this assertion once before.
     */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/canArrange \?[\s\S]{0,120}?cursor-grab/);
    expect(code).toMatch(/\{canArrange && \([\s\S]{0,200}?HANDLE_ATTR/);
    // And the press itself is gated on the same answer, not merely the cursor.
    expect(code).toMatch(/onPointerDown=\{canArrange \?/);
  });

  it("is unchanged for a viewer who can see everything", () => {
    // The freeze is not a new default: a normal board still drags.
    expect(board()).not.toContain("arrangement is locked");
  });
});
