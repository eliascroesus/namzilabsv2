import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE DRAG'S RULES, PINNED WHERE THEY ARE A CONSTANT OR AN ABSENCE.
 *
 * Modelled on `tests/drag-rules.test.ts`, which does the same job for the flow
 * canvas, and for the same reason: every hazard here produces a bug that is
 * either invisible in review or impossible to reproduce by hand.
 *
 *  - a `getBoundingClientRect` in the move handler is a layout per frame, and
 *    the canvas already paid for that once ("stop the drag doing a DFS per
 *    pixel");
 *  - a document-level listener instead of pointer capture loses the drop the
 *    moment the cursor leaves the window;
 *  - lane geometry that ignores scroll drops the tile in the wrong column,
 *    intermittently, only after the board has been scrolled;
 *  - a placeholder written into `drop-slot.tsx` fails an unrelated test about
 *    the flow builder.
 *
 * There is no DOM in this test environment, so none of it could be caught by
 * rendering anyway.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const drag = read("src/app/dashboard/board-drag.ts");
const layout = read("src/app/dashboard/board-layout.tsx");
const menu = read("src/app/dashboard/board-tile-menu.tsx");
const slot = read("src/components/flow/drop-slot.tsx");
const column = read("src/app/dashboard/board-column.tsx");

/** Prose about a hazard is not the hazard. `check-ui.ts` strips for the same reason. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A numeric `const NAME = <number>;` read out of the drag module. */
function constant(name: string): number {
  const m = drag.match(new RegExp(`const ${name} = (\\d+);`));
  expect(m, `${name} is not a plain numeric constant in board-drag.ts`).not.toBeNull();
  return Number(m![1]);
}

describe("the drag's measurements", () => {
  it("keeps its four constants as plain numbers, so they can be read here", () => {
    // A press below this is a click, which is what opens the menu — so it has
    // to be small enough that a deliberate drag never registers as a press, and
    // large enough that a shaky press never registers as a drag.
    expect(constant("DRAG_START_PX")).toBeGreaterThan(0);
    expect(constant("DRAG_START_PX")).toBeLessThanOrEqual(8);
    // Out past this there is no target and releasing cancels.
    expect(constant("LANE_REACH")).toBeGreaterThan(0);
    expect(constant("AUTOSCROLL_EDGE")).toBeGreaterThan(0);
    expect(constant("AUTOSCROLL_MAX")).toBeGreaterThan(0);
  });

  it("measures ONCE, and never in the move path", () => {
    /**
     * THE EXPENSIVE LESSON, RESTATED. `getBoundingClientRect` forces a layout,
     * and a drag makes about sixty calls a second on a page that is
     * simultaneously animating a placeholder.
     *
     * It may appear only inside `measure`, which runs once at drag start.
     */
    const body = code(drag);
    const measureFn = body.match(/function measure\([\s\S]*?\n}/);
    expect(measureFn, "the measure function has moved").not.toBeNull();
    const outsideMeasure = body.replace(measureFn![0], "");
    expect(outsideMeasure).not.toMatch(/getBoundingClientRect/);
    // And it really is called from exactly one place.
    expect((body.match(/measure\(root, /g) ?? []).length).toBe(1);
  });

  it("corrects for scroll arithmetically rather than re-measuring", () => {
    // `scrollLeft` is a property read; a rect is a layout. Caching the rects
    // with the scroll offsets of the moment is what lets auto-scroll run
    // without silently invalidating the hit-test.
    expect(code(drag)).toMatch(/scrollLeft0/);
    expect(code(drag)).toMatch(/window\.scrollY - s\.scrollY0/);
  });
});

describe("pointer capture, not document listeners", () => {
  it("captures the pointer on the handle", () => {
    // Capture routes every move and the release back to the handle even when
    // the cursor leaves it — which is what makes a drop off the edge of the
    // board land instead of vanishing.
    expect(code(drag)).toMatch(/setPointerCapture\(/);
  });

  it("never listens on the document", () => {
    // The regression this replaces: a document listener that outlives its drag
    // leaves the board dragging a tile nobody is holding.
    expect(code(drag)).not.toMatch(/document\.addEventListener/);
    expect(code(drag)).not.toMatch(/window\.addEventListener/);
  });

  it("swallows the click that ends a drop", () => {
    // A drag ends with a pointerup over the handle, which the browser then
    // reports as a click. Without this, every drop also opens the menu.
    expect(code(drag)).toMatch(/swallowClick/);
    expect(code(menu)).toMatch(/if \(swallowClick\?\.\(\)\) return;/);
  });

  it("claims the gesture on touch, where the browser would take it for scrolling", () => {
    expect(menu).toMatch(/\[touch-action:none\]/);
    // And the handle is reachable at all on a device that never hovers.
    expect(menu).toMatch(/pointer-coarse:opacity-100/);
  });
});

describe("the placeholder", () => {
  it("is written in the board module, never in drop-slot.tsx", () => {
    /**
     * `tests/drag-rules.test.ts` reads the FIRST `h-[Npx]` in `drop-slot.tsx` to
     * prove the canvas's SLOT_H still matches its placeholder. A second
     * component with its own pixel height in that file fails that test with a
     * message about the flow builder, and whoever hits it will be looking in
     * the wrong place for an afternoon.
     */
    expect(menu).toMatch(/export function DropGap/);
    expect(slot.match(/h-\[\d+px\]/g) ?? []).toHaveLength(1);
    expect(slot).not.toMatch(/DropGap/);
  });

  it("borrows the ghost from the builder rather than growing a second one", () => {
    // One drag vocabulary in the product. The ghost is imported unchanged.
    expect(layout).toMatch(/import \{ DragGhost \} from "@\/components\/flow\/drop-slot";/);
    expect(layout).not.toMatch(/DropSlotNode/);
  });

  it("counts its index among the tiles that are NOT held", () => {
    // The held card stays on screen, faded, where it was. Counting it would put
    // the gap one place out for every drop below the tile's own position.
    expect(code(layout)).toMatch(/if \(t\.key !== heldKey\) seen\+\+;/);
  });
});

describe("out of reach is not a drop", () => {
  it("returns null past LANE_REACH and commits nothing on release", () => {
    // Cancelling has to be possible. The canvas's own rule, applied to a board:
    // "a target you can see, aim at, and miss".
    expect(code(drag)).toMatch(/if \(!best \|\| best\.d > LANE_REACH\) return null;/);
    expect(code(drag)).toMatch(/if \(s\?\.moved && s\.target\) onDrop\(/);
  });
});

describe("a sorted column cannot be reordered by hand", () => {
  it("decides it in ONE expression, and the expression names the sort", () => {
    /**
     * Dropping a tile at an index the sort would override on the very next
     * render is a lie the interface tells once and is never trusted about
     * again. A SECOND expression deciding the same thing is how the drag and
     * the menu come to disagree — the same rule `drag-rules.test.ts` enforces
     * on the canvas about what may be dragged there.
     */
    const decisions = (code(column).match(/g\.sortKey === "manual"/g) ?? []).length;
    expect(decisions, "more than one thing decides whether a column is sorted").toBe(1);
    expect(column).toMatch(/const sortedBy = g\.sortKey === "manual" \? null :/);
  });

  it("withholds the drag and both nudges, but never the way out", () => {
    // Moving a tile OUT of a sorted column is always allowed, and every lane
    // option stays — only "up" and "down" WITHIN this lane go.
    expect(code(menu)).toMatch(/if \(sortedBy\) return;/);
    expect(code(menu)).toMatch(/disabled=\{index === 0 \|\| sortedBy != null\}/);
    expect(code(menu)).toMatch(/disabled=\{index >= count - 1 \|\| sortedBy != null\}/);
    // The lane list is not gated on it.
    expect(code(menu)).toMatch(/<LaneOption label="Ungrouped"/);
  });

  it("says why, rather than presenting a control that silently does nothing", () => {
    expect(menu).toMatch(/Sorted by \$\{sortedBy\} — switch to Manual to reorder/);
  });
});

describe("lanes nest, and an item belongs to exactly one", () => {
  it("skips items that belong to a lane inside this one", () => {
    /**
     * The row of columns is a lane whose items are the columns; each column
     * holds a lane whose items are tiles. A plain descendant query would count
     * every tile on the board as an item of the columns row, and dropping a
     * column would land it between two metrics.
     */
    expect(code(drag)).toMatch(/if \(t\.closest\(`\[\$\{LANE_ATTR\}\]`\) !== el\) continue;/);
  });
});
