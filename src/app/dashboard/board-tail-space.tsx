"use client";

import { useEffect, useRef, useState } from "react";
import { CELL_ATTR } from "./canvas-drag";
import { tailSpacePx } from "@/lib/board/tail-space";

/**
 * THE ROOM BELOW THE LAST TILE, so the bottom of a board can be read at the TOP
 * of the screen.
 *
 * A board taller than the window stops scrolling the instant its last tile's
 * bottom edge reaches the bottom of the viewport, so the tile furthest down can
 * only ever be looked at along the bottom edge, under everything else — and
 * resized there, in the strip where the drag's own auto-scroll lives. This
 * renders the missing distance: viewport minus that tile minus the board's 16px
 * gutter, which is exactly enough to bring it to the top and no more. The
 * arithmetic and its refusals are `tailSpacePx`.
 *
 * IT MEASURES RATHER THAN CALCULATES. The height of the scroll region is the
 * frame's inset, the top bar, the view strip and the panel's own padding —
 * five numbers in four files, none of which would tell this component when one
 * of them moved. `calendar-check.mjs` carries the scar from summing that
 * overhead somewhere else: the symptom is a page that scrolls forty pixels
 * wrong and nobody files it. So: read `#main`, read the tiles, re-read when
 * either changes.
 *
 * A `ResizeObserver` on the scroll region catches the window, the rail
 * collapsing and the browser's own chrome; one on the grid catches a tile being
 * dragged, resized, added or deleted. Both fire on mount, so the first
 * measurement needs no separate call.
 */
export function BoardTailSpace() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [px, setPx] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main");
    const grid = main?.querySelector(`[${CELL_ATTR}]`)?.parentElement ?? null;
    if (!main) return;

    const measure = () => {
      const tiles = [...main.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`)];
      if (tiles.length === 0) return setPx(0);
      /**
       * THE TILE FURTHEST DOWN, by its painted box rather than by its stored
       * `y`. A row can hold tiles of different heights and the bottom-most one
       * is whichever ENDS lowest — which is also the only one that can be
       * brought to the top without leaving another below it.
       */
      let lastTilePx = 0;
      let bottom = -Infinity;
      for (const t of tiles) {
        const r = t.getBoundingClientRect();
        if (r.bottom > bottom) {
          bottom = r.bottom;
          lastTilePx = r.height;
        }
      }
      /**
       * The content WITHOUT this spacer — otherwise the measurement includes
       * what it is about to set and the board keeps growing by its own tail.
       */
      const contentPx = main.scrollHeight - el.offsetHeight;
      /**
       * AND WHAT ALREADY SITS UNDER THE LAST TILE. The board container carries
       * a 24px bottom inset, so claiming the whole distance overshot by exactly
       * that and put the tile eight pixels off the top of the screen. Taken
       * from the live boxes rather than from the stylesheet's number.
       */
      const lastBottomInContent = bottom - main.getBoundingClientRect().top + main.scrollTop;
      const trailingPx = contentPx - lastBottomInContent;
      setPx(tailSpacePx({ viewportPx: main.clientHeight, lastTilePx, contentPx, trailingPx }));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(main);
    if (grid) ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  // `aria-hidden` and no text: this is room to scroll into, not content. It is
  // never focusable and a screen reader has nothing to say about it.
  return <div ref={ref} aria-hidden style={{ height: px }} />;
}
