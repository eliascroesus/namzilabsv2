import { describe, it, expect } from "vitest";
import { edgeScrollPx } from "@/app/dashboard/canvas-drag";
import { tailSpacePx, BOARD_TAIL_GUTTER_PX } from "@/lib/board/tail-space";

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
describe("the room below the last tile", () => {
  it("is exactly enough to bring the last tile to the top under the gutter", () => {
    // 900 of viewport, a 240px tile: 644 below it puts its top at 16.
    expect(tailSpacePx({ viewportPx: 900, lastTilePx: 240, contentPx: 3000 })).toBe(900 - 240 - BOARD_TAIL_GUTTER_PX);
  });

  it("counts what already sits under the last tile, rather than claiming it twice", () => {
    /**
     * THE BUG THE BROWSER FOUND. The board container carries a 24px bottom
     * inset below the last tile; taking the whole distance on top of it
     * overshot by exactly that, and scrolling to the end put the tile EIGHT
     * PIXELS ABOVE the top of the screen — clipped by the chrome — instead of
     * sixteen below it. No unit test could have caught it on its own: 24 is a
     * number in a stylesheet, which is why this argument is measured.
     */
    expect(tailSpacePx({ viewportPx: 900, lastTilePx: 240, contentPx: 3000, trailingPx: 24 })).toBe(
      900 - 240 - BOARD_TAIL_GUTTER_PX - 24,
    );
    // Already roomy enough below? Then nothing more is owed.
    expect(tailSpacePx({ viewportPx: 900, lastTilePx: 240, contentPx: 3000, trailingPx: 5000 })).toBe(0);
    // A negative reading (sub-pixel rounding) is ignored rather than added on.
    expect(tailSpacePx({ viewportPx: 900, lastTilePx: 240, contentPx: 3000, trailingPx: -10 })).toBe(
      900 - 240 - BOARD_TAIL_GUTTER_PX,
    );
  });

  it("gives a board that already fits nothing at all", () => {
    // A scrollbar over empty space is worse than the problem it solves.
    expect(tailSpacePx({ viewportPx: 900, lastTilePx: 240, contentPx: 400 })).toBe(0);
    expect(tailSpacePx({ viewportPx: 900, lastTilePx: 240, contentPx: 900 })).toBe(0);
  });

  it("never goes negative when the last tile is taller than the screen", () => {
    expect(tailSpacePx({ viewportPx: 400, lastTilePx: 900, contentPx: 3000 })).toBe(0);
  });

  it("answers nothing when it has not measured anything yet", () => {
    // First paint, before the observers report — 0 is the honest answer, and
    // it keeps the board from jumping on load.
    expect(tailSpacePx({ viewportPx: 0, lastTilePx: 0, contentPx: 0 })).toBe(0);
  });
});
