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

  it("routes no POINTER event through the document or the window", () => {
    /**
     * The rule is about the pointer specifically, and it is narrower than it
     * first looks. A document-level `pointermove` is the regression: it
     * outlives its drag and leaves the board following a tile nobody is
     * holding. Capture is what makes it unnecessary.
     *
     * The window listeners that DO exist — `blur` and `keydown` — are the
     * opposite thing. They are how a drag ENDS when the pointer never comes
     * back, and forbidding them outright is what produced the frozen ghost.
     */
    for (const evt of ["pointermove", "pointerup", "pointerdown", "pointercancel"]) {
      expect(code(drag), `${evt} is listened for on the document`).not.toMatch(
        new RegExp(`document\\.addEventListener\\("${evt}`),
      );
      expect(code(drag), `${evt} is listened for on the window`).not.toMatch(
        new RegExp(`window\\.addEventListener\\("${evt}`),
      );
    }
  });

  it("swallows the click that ends a drop", () => {
    // A drag that began on the card and ended over the menu's corner is
    // reported as a click there. Without this, every such drop opens the menu.
    expect(code(drag)).toMatch(/swallowClick/);
    expect(code(menu)).toMatch(/if \(swallowClick\?\.\(\)\) return;/);
  });

  it("claims the gesture on touch, where the browser would take it for scrolling", () => {
    expect(menu).toMatch(/\[touch-action:none\]/);
    // And the menu is reachable at all on a device that never hovers.
    expect(menu).toMatch(/pointer-coarse:opacity-100/);
  });

  it("makes the CARD the drag source, and protects the controls on it", () => {
    /**
     * It began as a grip in the corner, which had to be hunted for on hover and
     * sat on top of the metric's own NAME — so hovering the card you meant to
     * move hid which card it was. A tile carries a Refresh submit and two links,
     * and those are protected by four words rather than by a separate handle.
     */
    expect(code(menu)).toMatch(/closest\("button, a, input"\)/);
    // And the same protection on the column header, which is also its handle.
    expect(code(column)).toMatch(/closest\("button, input"\)/);
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
    expect(code(drag)).toMatch(/if \(commit && s\.moved && s\.target\) onDrop\(/);
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

describe("a lane only takes what it is for", () => {
  it("filters candidate lanes by what is in the hand", () => {
    /**
     * THE BUG: hovering a group puts the pointer inside BOTH that group's tile
     * lane and the row of columns. Both scored a perfect hit, the tie fell to
     * document order, and the row of columns is always found first — so
     * dragging a metric onto a group opened a COLUMN-sized gap beside it and
     * the metric could never get in. Every group, every time.
     *
     * Resolving by depth would also work and would be the wrong rule: a column
     * has no business landing in a lane of metrics either.
     */
    expect(code(drag)).toMatch(/if \(el\.getAttribute\(ACCEPTS_ATTR\) !== kind\) continue;/);
  });

  it("labels every lane, and labels them correctly", () => {
    // A lane with no label accepts nothing and silently stops being a target.
    expect(code(layout)).toMatch(/\[ACCEPTS_ATTR\]: "tile"/);
    expect(code(layout)).toMatch(/\[ACCEPTS_ATTR\]: "column"/);
    expect(code(column)).toMatch(/\[ACCEPTS_ATTR\]: "tile"/);
    // Three lanes are declared across the two files; all three are labelled.
    const lanes = (code(layout) + code(column)).match(/\[LANE_ATTR\]:/g) ?? [];
    const labels = (code(layout) + code(column)).match(/\[ACCEPTS_ATTR\]:/g) ?? [];
    expect(labels.length, "a lane is declared without saying what it accepts").toBe(lanes.length);
  });

  it("says which kind is being carried at each grab site", () => {
    expect(code(menu)).toMatch(/kind: "tile"/);
    expect(code(column)).toMatch(/kind: "column"/);
  });
});

describe("the menus escape the scroller they live in", () => {
  it("uses the Popover's fixed mode in both places", () => {
    /**
     * THE BUG IN THE SCREENSHOT: a container that scrolls on ONE axis clips on
     * BOTH, so an absolutely-positioned menu inside a column was cut off at the
     * scroller's bottom edge. On an empty column — barely taller than its own
     * header — that lost everything below the first sort: no Move left, no Move
     * right, no Delete.
     *
     * `fixed` measures the trigger and positions in the viewport, re-measuring
     * on scroll in the capture phase so it stays glued to a column being
     * scrolled sideways. Both menus live inside a scroller; both need it.
     */
    expect(code(column)).toMatch(/^\s*fixed$/m);
    expect(code(menu)).toMatch(/^\s*fixed$/m);
  });

  it("lets a menu taller than the viewport scroll rather than clip", () => {
    // Fixed mode caps the panel's height and hides its overflow, so the content
    // has to be the thing that scrolls or the same fold reappears one layer in.
    expect(code(column)).toMatch(/overflow-y-auto/);
    expect(code(menu)).toMatch(/overflow-y-auto/);
  });
});

describe("the gap is the size of the hole it fills", () => {
  it("measures the held card rather than assuming a height", () => {
    // A fixed height was close for a bare number and wrong for a tile carrying
    // a goal bar, and a gap that is not the size of the card going into it
    // makes everything below it jump on the drop.
    expect(code(drag)).toMatch(/heldH/);
    expect(code(menu)).toMatch(/height: height && height > 0 \? height : 112/);
  });

  it("keeps the ungrouped row on the brand, not on the grey group default", () => {
    // Passing grey looked broken: a dashed grey box with a grey disc in it
    // reads as a disabled region rather than as the place a card is going.
    expect(code(menu)).toMatch(/const brand = accent == null;/);
    expect(code(layout)).toMatch(/<DropGap height=\{drag\?\.height\} \/>/);
  });
});

describe("a drag always ends, however it ends", () => {
  it("hears every way the pointer can go away, not just pointerup", () => {
    /**
     * THE FREEZE. A drag ends when the pointer comes up, and `pointerup` is not
     * the only way the pointer can leave: alt-tab, a click into the browser's
     * own chrome, the OS taking the gesture. With nothing else listening,
     * `live.current` stayed set, the rAF loop kept running, and the ghost sat
     * frozen over the board until a reload.
     */
    expect(code(drag)).toMatch(/addEventListener\("lostpointercapture"/);
    expect(code(drag)).toMatch(/window\.addEventListener\("blur"/);
    expect(code(drag)).toMatch(/ev\.key === "Escape"/);
  });

  it("CANCELS on those, rather than committing a move nobody finished", () => {
    // Dropping a metric into a group because a notification stole focus is
    // worse than dropping it nowhere.
    expect(code(drag)).toMatch(/const onAbort = \(\) => finish\(false\);/);
    expect(code(drag)).toMatch(/const onUp = \(\) => finish\(true\);/);
  });

  it("tears down through one idempotent release, so a double end is harmless", () => {
    // `lostpointercapture` fires in the ordinary case too, right after
    // `pointerup` — by which point `finish` has nulled the state and there is
    // nothing left to do. That ordering is the whole reason this is safe.
    expect(code(drag)).toMatch(/const s = live\.current;\s*\n\s*if \(!s\) return;\s*\n\s*s\.release\(\);/);
  });

  it("clears the selection the press started, and stops more accruing", () => {
    // Four pixels with the button down is enough to begin selecting text, so a
    // stuck drag came with a blue smear across the card's own name.
    expect(code(drag)).toMatch(/removeAllRanges\(\)/);
    expect(code(layout)).toMatch(/drag \? "select-none" : undefined/);
  });
});

describe("dropping a card where it already is", () => {
  it("is not a drop, so no placeholder opens and nothing is written", () => {
    /**
     * Hovering the hole a card came out of would otherwise open a placeholder
     * saying "it goes HERE" about the spot it is already in, and releasing
     * would write a row to produce the arrangement already on screen.
     *
     * `home` is recorded in the SAME coordinates a target is reported in — its
     * lane, and its index among the OTHER items — so the comparison is a
     * comparison rather than a reconstruction.
     */
    expect(code(drag)).toMatch(/home = \{ laneId: id, index: bounds\.length \};/);
    expect(code(drag)).toMatch(
      /if \(s\.home && s\.home\.laneId === lane\.id && s\.home\.index === index\) return null;/,
    );
  });
});
