/**
 * ONE WHOLE SCREEN OF ROOM BELOW THE BOARD, once the board is tall enough to
 * scroll at all.
 *
 * A board taller than the window stops scrolling the moment its last tile's
 * BOTTOM reaches the bottom of the screen, so the tile furthest down can only
 * ever be read — and RESIZED — along the bottom edge.
 *
 * THIS WAS CLEVERER ONCE AND THAT WAS THE MISTAKE. The first version worked out
 * the exact distance that brings the last tile to the top with the board's 16px
 * gutter above it, on the argument that anything more is dead space you can
 * scroll into. Correct, and not what the job needs: EXPANDING a bottom tile
 * eats that room as the tile grows, so the exact amount runs out precisely
 * during the gesture it was meant to help, and the owner hit it twice. A whole
 * viewport is the editor behaviour ("scroll past end") and it is what was asked
 * for, in those words: "have a vh down".
 *
 * NOTHING IS OWED TO A BOARD THAT ALREADY FITS. Handing a short board a screen
 * of padding gives it a scrollbar over nothing — a page that scrolls and shows
 * no new content reads as broken, and most boards are shorter than the screen.
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
  /** How tall the board's content is WITHOUT any tail space already added. */
  contentPx: number;
}): number {
  const { viewportPx, contentPx } = opts;
  if (!(viewportPx > 0)) return 0;
  // A board that fits needs no room to scroll into.
  if (contentPx <= viewportPx) return 0;
  return Math.round(viewportPx);
}
