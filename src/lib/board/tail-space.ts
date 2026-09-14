/** The board's own gutter — what sits above the first tile, and what the last one earns. */
export const BOARD_TAIL_GUTTER_PX = 16;

/**
 * HOW MUCH EMPTY ROOM THE BOARD OWES BELOW ITS LAST TILE.
 *
 * A board taller than the window stops scrolling the moment its last tile's
 * BOTTOM reaches the bottom of the screen — so the tile furthest down can only
 * ever be read at the very bottom of the viewport, under everything else. The
 * owner asked for the editor behaviour instead: keep scrolling until that last
 * tile sits at the TOP, with the board's own 16px gutter above it.
 *
 * That distance is the viewport minus the tile minus the gutter. Anything less
 * strands the tile mid-screen; anything more is dead space you can scroll into,
 * which is the failure mode of a plain `padding-bottom: 100vh`.
 *
 * NOTHING IS OWED TO A BOARD THAT ALREADY FITS. Handing a short board a
 * viewport of padding gives it a scrollbar over nothing — a page that scrolls
 * and shows no new content reads as broken, and it would be the common case,
 * since most boards are shorter than the screen.
 *
 * Pure, and measured in pixels the caller took from the live DOM rather than
 * summed from the chrome's constants: the height of that scroll region is a
 * total of the top bar, the view strip, the frame's inset and the panel's
 * padding, five numbers living in four files, and `calendar-check.mjs` already
 * carries the scar from adding them up somewhere else.
 */
export function tailSpacePx(opts: {
  /** The scroll region's visible height — `#main`'s `clientHeight`. */
  viewportPx: number;
  /** The height of the tile furthest down the board. */
  lastTilePx: number;
  /** How tall the board's content is WITHOUT any tail space already added. */
  contentPx: number;
  /**
   * WHAT ALREADY SITS BELOW THE LAST TILE — the board container's own bottom
   * padding, and anything else between that tile and the end of the content.
   *
   * Measured, not assumed, and the first version of this did assume: it took
   * the whole distance for itself and overshot by exactly the board's 24px
   * inset, so scrolling to the end put the last tile EIGHT PIXELS ABOVE the top
   * of the screen instead of sixteen below it. The browser check caught it; no
   * unit test could have, because 24 is a number in a stylesheet.
   */
  trailingPx?: number;
}): number {
  const { viewportPx, lastTilePx, contentPx, trailingPx = 0 } = opts;
  if (!(viewportPx > 0) || !(lastTilePx > 0)) return 0;
  // A board that fits needs no room to scroll into.
  if (contentPx <= viewportPx) return 0;
  return Math.max(0, Math.round(viewportPx - lastTilePx - BOARD_TAIL_GUTTER_PX - Math.max(0, trailingPx)));
}
