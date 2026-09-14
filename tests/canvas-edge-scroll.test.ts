import { describe, it, expect } from "vitest";
import { edgeScrollPx } from "@/app/dashboard/canvas-drag";
import { tailSpacePx } from "@/lib/board/tail-space";
import { GRID_GAP_PX } from "@/lib/board/grid";

/**
 * THE EDGE THAT SCROLLS, AND THE GESTURE IT MUST NOT SCROLL FOR.
 *
 * Carrying a tile towards the bottom of the window should scroll the board —
 * the place you are taking it to may be off-screen. RESIZING is the same
 * gesture geometrically and the opposite thing in fact: the pointer is not
 * going anywhere, it is holding an edge. Scrolling under it moves that edge, so
 * the tile grows, so the pointer is still in the edge zone, so it scrolls
 * again — at 18px a frame, roughly twenty-seven grid rows a second, which is
 * what the owner met as "it scrolls super quick and then when I try to make it
 * small it collapses".
 */
describe("the auto-scroll at the canvas edge", () => {
  const H = 900;

  it("carries a moving tile towards the edge it is heading for", () => {
    expect(edgeScrollPx({ y: H - 10, viewportH: H, mode: "move" })).toBeGreaterThan(0);
    expect(edgeScrollPx({ y: 10, viewportH: H, mode: "move" })).toBeLessThan(0);
  });

  it("does nothing in the middle of the screen, where most of a drag happens", () => {
    expect(edgeScrollPx({ y: H / 2, viewportH: H, mode: "move" })).toBe(0);
    expect(edgeScrollPx({ y: H / 2, viewportH: H, mode: "resize" })).toBe(0);
  });

  it("gets stronger the further into the edge the pointer goes", () => {
    const near = edgeScrollPx({ y: H - 60, viewportH: H, mode: "move" });
    const deep = edgeScrollPx({ y: H - 4, viewportH: H, mode: "move" });
    expect(deep).toBeGreaterThan(near);
  });

  it("NEVER scrolls for a resize — the whole bug, as one assertion", () => {
    /**
     * Both edges, and deep into each: a resize sets the tile's edge from the
     * pointer, so any scroll at all feeds straight back into the size.
     */
    expect(edgeScrollPx({ y: H - 1, viewportH: H, mode: "resize" })).toBe(0);
    expect(edgeScrollPx({ y: H - 40, viewportH: H, mode: "resize" })).toBe(0);
    expect(edgeScrollPx({ y: 1, viewportH: H, mode: "resize" })).toBe(0);
  });
});

/**
 * AND WHERE THE SCROLL STOPS — the other half of the same complaint. The last
 * tile should come to rest AT THE TOP, its gutter above it, so there is a whole
 * screen of room under it to drag its corner into.
 */
describe("the room below the board", () => {
  const board = { viewportPx: 900, contentPx: 3000, lastTilePx: 240, trailingPx: 24 };

  it("stops the scroll with the last tile at the top under its own gutter", () => {
    /**
     * THE IDENTITY THIS EXISTS FOR, checked by the same algebra the caller
     * relies on. Scrolled fully down:
     *
     *   top of last tile = viewport − trailing − lastTile − spacer
     *
     * so with `spacer = viewport − lastTile − gutter − trailing` every term
     * cancels and it lands at exactly the gutter.
     */
    const spacer = tailSpacePx(board);
    expect(spacer).toBe(900 - 240 - GRID_GAP_PX - 24);
    const restsAt = board.viewportPx - board.trailingPx - board.lastTilePx - spacer;
    expect(restsAt).toBe(GRID_GAP_PX);
  });

  it("counts what already sits below the last tile rather than assuming it", () => {
    /**
     * The board's bottom inset was assumed once and the browser caught it: the
     * spacer claimed that distance twice and put the tile EIGHT PIXELS ABOVE
     * the top of the screen, clipped. A bigger inset must take proportionally
     * less room.
     */
    expect(tailSpacePx({ ...board, trailingPx: 40 })).toBe(900 - 240 - GRID_GAP_PX - 40);
    expect(tailSpacePx({ ...board, trailingPx: 0 })).toBe(900 - 240 - GRID_GAP_PX);
    // A negative reading (sub-pixel rounding) is ignored rather than added on.
    expect(tailSpacePx({ ...board, trailingPx: -5 })).toBe(900 - 240 - GRID_GAP_PX);
  });

  it("owes nothing when the last tile is already taller than the screen", () => {
    // It cannot be brought to the top; there is nothing to add that would help.
    expect(tailSpacePx({ ...board, lastTilePx: 2000 })).toBe(0);
  });

  it("gives a board that already fits nothing at all", () => {
    // A scrollbar over empty space is worse than the problem it solves.
    expect(tailSpacePx({ ...board, contentPx: 400 })).toBe(0);
    expect(tailSpacePx({ ...board, contentPx: 900 })).toBe(0);
  });

  it("answers nothing when it has not measured anything yet", () => {
    // First paint, before the observers report — 0 is the honest answer, and
    // it keeps the board from jumping on load.
    expect(tailSpacePx({ viewportPx: 0, contentPx: 0, lastTilePx: 0, trailingPx: 0 })).toBe(0);
  });
});
