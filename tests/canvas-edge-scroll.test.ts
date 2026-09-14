import { describe, it, expect } from "vitest";
import { edgeScrollPx } from "@/app/dashboard/canvas-drag";
import { tailSpacePx } from "@/lib/board/tail-space";

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
 * AND THE ROOM THAT MAKES RESIZING AT THE BOTTOM COMFORTABLE — the other half
 * of the same complaint. With a viewport of space below the last tile, it can
 * be scrolled to the TOP and resized into open screen, where no edge is near.
 */
describe("the room below the board", () => {
  it("is a whole screen, once the board is long enough to scroll", () => {
    /**
     * A VIEWPORT, not the exact distance that brings the last tile to the top.
     * The exact amount was the first version and it was too clever: EXPANDING a
     * bottom tile eats the room as the tile grows, so it ran out during the one
     * gesture it existed for. "Have a vh down" is the ask, twice.
     */
    expect(tailSpacePx({ viewportPx: 900, contentPx: 3000 })).toBe(900);
    expect(tailSpacePx({ viewportPx: 700, contentPx: 701 })).toBe(700);
  });

  it("gives a board that already fits nothing at all", () => {
    // A scrollbar over empty space is worse than the problem it solves.
    expect(tailSpacePx({ viewportPx: 900, contentPx: 400 })).toBe(0);
    expect(tailSpacePx({ viewportPx: 900, contentPx: 900 })).toBe(0);
  });

  it("answers nothing when it has not measured anything yet", () => {
    // First paint, before the observers report — 0 is the honest answer, and
    // it keeps the board from jumping on load.
    expect(tailSpacePx({ viewportPx: 0, contentPx: 0 })).toBe(0);
  });
});
