import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE RULES THE CANVAS GESTURE CANNOT BE ALLOWED TO FORGET.
 *
 * `tests/board-drag-rules.test.ts` exists because three drag regressions
 * shipped in a row on the groups board, and every one of them was a rule
 * someone deleted while the feature still looked like it worked. This is the
 * same file for the same reasons, aimed at the second gesture — which is a
 * SIBLING of that engine rather than an extension of it, so none of those
 * assertions cover it.
 *
 * Source text, because that is where these live: a listener that is never
 * removed, a rect read on every frame, and a capture call that throws before
 * the listeners are attached are all invisible in a screenshot and obvious in
 * a diff.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const drag = read("src/app/dashboard/canvas-drag.ts");
const board = read("src/app/dashboard/custom-board.tsx");
/** Comments describe the rules; they must not be able to satisfy them. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the gesture always ends, however it ends", () => {
  it("commits on pointerup and CANCELS on pointercancel, blur and Escape", () => {
    /**
     * Without all three, an alt-tab or an OS gesture steals the pointer, no
     * pointerup ever arrives, and the board is left with a live `live.current`
     * and a requestAnimationFrame loop running forever — the frozen-ghost bug
     * `board-drag.ts` documents at length.
     */
    expect(code(drag)).toMatch(/const onUp = \(\) => finish\(true\)/);
    expect(code(drag)).toMatch(/const onAbort = \(\) => finish\(false\)/);
    expect(code(drag)).toMatch(/window\.addEventListener\("pointercancel", onAbort\)/);
    expect(code(drag)).toMatch(/window\.addEventListener\("blur", onAbort\)/);
    expect(code(drag)).toMatch(/ev\.key === "Escape"/);
  });

  it("is idempotent, because pointerup and blur can both arrive", () => {
    expect(code(drag)).toMatch(/if \(!s\) return;/);
  });

  it("removes exactly the listeners it added", () => {
    // Sabotage: add a sixth listener and forget it in `release`. The gesture
    // keeps working and the page leaks one handler per press.
    const added = [...code(drag).matchAll(/window\.addEventListener\("(\w+)"/g)].map((m) => m[1]).sort();
    const removed = [...code(drag).matchAll(/window\.removeEventListener\("(\w+)"/g)].map((m) => m[1]).sort();
    expect(added).toEqual(removed);
    expect(added.length).toBeGreaterThanOrEqual(5);
  });

  it("cancels its animation frame when it finishes", () => {
    expect(code(drag)).toMatch(/cancelAnimationFrame/);
  });
});

describe("capture is an optimisation, not a dependency", () => {
  it("attaches the listeners BEFORE calling setPointerCapture", () => {
    /**
     * `setPointerCapture` throws — NotFoundError, InvalidStateError — and a
     * throw used to escape the whole handler, so `addEventListener` never ran
     * and the tile simply would not drag. That was the "I can't drag the
     * metrics inside a group" bug, and this ordering is the fix.
     */
    const body = code(drag);
    expect(body.indexOf('window.addEventListener("pointermove"')).toBeLessThan(body.indexOf("setPointerCapture"));
    expect(body).toMatch(/try \{\s*\n\s*el\.setPointerCapture\(e\.pointerId\);\s*\n\s*\} catch/);
  });
});

describe("geometry is measured once and corrected arithmetically", () => {
  it("reads a rect ONLY inside measureCanvas", () => {
    // A rect is a layout; a gesture makes about sixty calls a second on a page
    // that is simultaneously re-packing a grid.
    const body = code(drag);
    const fn = body.match(/function measureCanvas\([\s\S]*?\n}/);
    expect(fn, "measureCanvas has moved").not.toBeNull();
    expect(body.replace(fn![0], "")).not.toMatch(/getBoundingClientRect|getComputedStyle/);
  });

  it("is called from exactly one place", () => {
    expect((code(drag).match(/measureCanvas\(root, /g) ?? []).length).toBe(1);
  });

  it("corrects for scroll from a cached offset rather than re-measuring", () => {
    expect(code(drag)).toMatch(/scrollTopOf\(s\.pageScroller\) - s\.scrollY0/);
  });

  it("scrolls the app's own container, not the window", () => {
    // The app frame puts every page in a `div.overflow-y-auto`, so `window.scrollY`
    // is permanently 0 and `window.scrollBy` a no-op. Only a real browser found it.
    expect(code(drag)).toMatch(/pageScrollerOf/);
    expect(code(drag)).toMatch(/s\.pageScroller\.scrollTop \+= dv/);
  });

  it("imports those helpers rather than re-deriving them", () => {
    expect(drag).toMatch(/import \{ pageScrollerOf, scrollTopOf \} from "\.\/board-drag"/);
    expect(code(drag)).not.toMatch(/function pageScrollerOf\(/);
  });
});

describe("the preview and the write are one answer", () => {
  it("computes the preview with the same compact the commit stores", () => {
    /**
     * THE MOST IMPORTANT RULE IN THE FILE. When the thing that draws the
     * preview and the thing that computes the drop are two implementations of
     * one idea, they drift — and the bug reads as "it landed in the wrong
     * place" rather than as "two functions disagree".
     */
    expect(code(drag)).toMatch(/import \{ compact,/);
    expect(code(drag)).toMatch(/return compact\(/);
    // ...and the board re-packs with the id the gesture actually moved, so the
    // held tile cannot be swapped back behind the one it landed on.
    // `boxes`, not raw state: the gesture must see the membership-reconciled
    // list, or a tile that arrived from another tab is undraggable and a ghost
    // participates in every hit test.
    expect(code(board)).toMatch(/useCanvasDrag\(rootRef, boxes, applyLayout\)/);
    expect(code(board)).toMatch(/compact\(next, GRID_COLS, movedId\)/);
  });

  it("has no collision loop of its own anywhere in the board", () => {
    expect(code(board)).not.toMatch(/overlap|while \(.*collid/i);
  });
});

describe("gestures are desktop-only, and it is enforced rather than assumed", () => {
  it("refuses to start unless the live grid really is twelve columns", () => {
    /**
     * The stored layout IS the twelve-column one; the narrow renderings are
     * derived and have no inverse. A resize against the six-column grid cannot
     * be widened back without inventing information, so it would silently
     * overwrite the desktop layout with a guess.
     */
    expect(code(drag)).toMatch(/if \(cols !== GRID_COLS\) return null/);
    // Read from the live grid rather than a copy of the breakpoints in JS,
    // which would be a second definition to keep in step with the stylesheet.
    expect(code(drag)).toMatch(/gridTemplateColumns/);
  });
});

describe("the controls inside a card survive the card being a handle", () => {
  it("guards pointerdown by name, including the resize grip", () => {
    // The whole card is the move handle, so a press on the kebab, a link or the
    // corner grip would otherwise start dragging the board. Same guard, and the
    // same reason, as the groups board's TileSlot.
    expect(code(board)).toMatch(/closest\(`button, a, input, \[\$\{HANDLE_ATTR\}\]`\)/);
    expect(code(board)).toMatch(/\[touch-action:none\]/);
  });

  it("hides every handle from a viewer who may not edit", () => {
    expect(code(board)).toMatch(/if \(!canEdit\) return;/);
  });
});

describe("the harness's selectors stay unambiguous", () => {
  it("does not dress the resize grip as the groups board's ghost or placeholder", () => {
    /**
     * `scripts/board-drag-check.mjs` counts `.fixed.z-50` to find the ghost and
     * `border-dashed` children to find the placeholder. A second element
     * wearing either would quietly change what 34 existing checks measure.
     */
    const grip = code(board).match(/\[HANDLE_ATTR\][\s\S]{0,900}?\/>/)?.[0] ?? "";
    expect(grip).not.toMatch(/fixed/);
    expect(grip).not.toMatch(/border-dashed/);
    expect(grip).toMatch(/cursor-se-resize/);
  });
});

describe("membership reconciles from the prop; positions never do", () => {
  const board = readFileSync(join(process.cwd(), "src/app/dashboard/custom-board.tsx"), "utf8");
  const body = board.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("keeps the two pending windows, and retires them when the prop catches up", () => {
    /**
     * The crash that shipped: a successful add put a box in the seeded layout,
     * the prop had not caught up, and `byId.get(id)!` fed undefined to a menu
     * that read `.title` off it. The permanent form: a tile deleted in another
     * tab left a ghost box, and the layout action's wholesale refusal then
     * failed every subsequent move on the board.
     */
    expect(body).toMatch(/pending\.current\.adds\.add\(t\.id\)/);
    expect(body).toMatch(/pending\.current\.removes\.add\(id\)/);
    expect(body).toMatch(/if \(liveIds\.has\(id\)\) pending\.current\.adds\.delete\(id\)/);
    expect(body).toMatch(/if \(!liveIds\.has\(id\)\) pending\.current\.removes\.delete\(id\)/);
  });

  it("drops a box the server no longer has, unless this client just added it", () => {
    expect(body).toMatch(/layout\.filter\(\(b\) => liveIds\.has\(b\.id\) \|\| pending\.current\.adds\.has\(b\.id\)\)/);
  });

  it("admits a tile that arrived from elsewhere, at its server position", () => {
    expect(body).toMatch(/!knownIds\.has\(t\.id\) && !pending\.current\.removes\.has\(t\.id\)/);
  });

  it("never renders a menu for a box whose tile has not arrived", () => {
    // Sabotage: restore the bare `byId.get(tile.id)!` and every successful add
    // crashes the page again, exactly as it did in production.
    expect(body).toMatch(/canEdit && byId\.has\(tile\.id\) &&/);
    expect(body).toMatch(/nodeOf\.get\(tile\.id\) \?\? <PendingCard \/>/);
  });

  it("re-learns membership when a layout write is refused wholesale", () => {
    // One stale id must not go on failing every drag until a reload.
    const applyLayout = body.slice(body.indexOf("const applyLayout"), body.indexOf("const rootRef"));
    expect(applyLayout).toMatch(/router\.refresh\(\)/);
  });
});
