import { GRID_GAP_PX } from "@/lib/board/grid";

/**
 * HOW MUCH EMPTY ROOM THE BOARD OWES BELOW ITS LAST TILE.
 *
 * A board taller than the window stops scrolling the instant its last tile's
 * BOTTOM meets the bottom of the screen, so the tile furthest down can only be
 * read along the bottom edge — and only RESIZED there, a few pixels at a time,
 * which is the complaint this exists for.
 *
 * WHERE THE SCROLL SHOULD STOP: with that last tile at the TOP, its own padding
 * above it, exactly where the FIRST tile sits when the board is scrolled to the
 * beginning. Not a whole empty screen — that was a middle draft, and scrolling
 * into a void is its own kind of broken.
 *
 * THE GAP IT RESTS IN IS THE BOARD'S OWN GUTTER, `GRID_GAP_PX` — the 16px
 * between any two tiles, borrowed rather than retyped, so it cannot drift from
 * the grid it is supposed to match.
 *
 * AN EARLIER DRAFT MEASURED IT INSTEAD, as "however far the FIRST tile sits
 * from the top of the content", which is a prettier idea and wrong: the board
 * is not always the only thing in the scroller, and on a page with anything
 * above it that distance is the height of everything above it. The check caught
 * it reading 7208px. A gutter is a constant; the thing that genuinely varies is
 * what sits BELOW the last tile, and that is still measured.
 *
 * The identity it produces, for anyone checking the algebra: scrolled fully
 * down, the last tile's top sits `GRID_GAP_PX` from the top of the scroll
 * region. Every other term cancels.
 *
 * NOTHING IS OWED TO A BOARD THAT ALREADY FITS. Handing a short board padding
 * gives it a scrollbar over nothing, and most boards are shorter than the
 * screen.
 */
export function tailSpacePx(opts: {
  /** The scroll region's visible height — the real scroller's, not `<main>`'s. */
  viewportPx: number;
  /** How tall the board's content is WITHOUT any tail space already added. */
  contentPx: number;
  /** The height of the tile furthest down the board. */
  lastTilePx: number;
  /** What already sits below the last tile — the board's bottom inset. */
  trailingPx: number;
}): number {
  const { viewportPx, contentPx, lastTilePx, trailingPx } = opts;
  if (!(viewportPx > 0) || !(lastTilePx > 0)) return 0;
  if (contentPx <= viewportPx) return 0;
  return Math.max(0, Math.round(viewportPx - lastTilePx - GRID_GAP_PX - Math.max(0, trailingPx)));
}
