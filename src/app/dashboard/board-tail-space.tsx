"use client";

import { useEffect, useRef, useState } from "react";
import { tailSpacePx } from "@/lib/board/tail-space";

/**
 * ONE SCREEN OF ROOM BELOW THE BOARD, so its last tile can be brought up to
 * where there is space to work.
 *
 * A board taller than the window stops scrolling the instant its last tile's
 * bottom edge meets the bottom of the viewport, so the tile furthest down can
 * only be read along the bottom edge — and resized there, in the strip where
 * the drag's own auto-scroll used to live. The arithmetic and its one refusal
 * are `tailSpacePx`.
 *
 * BOTH BOARDS RENDER IT. A custom view is `CustomBoard` and a groups view is
 * `BoardLayout` — different storage, different geometry, one complaint. Wiring
 * only the first is why the owner saw no change at all.
 *
 * IT MEASURES RATHER THAN CALCULATES. The height of the scroll region is the
 * frame's inset, the top bar, the view strip and the panel's own padding — five
 * numbers in four files, none of which would tell this component when one of
 * them moved. `calendar-check.mjs` carries the scar from summing that overhead
 * somewhere else: the symptom is a page that scrolls forty pixels wrong and
 * nobody files it. So: read `#main`, re-read when it or the board changes.
 *
 * A `ResizeObserver` on the scroll region catches the window, the rail
 * collapsing and the browser's own chrome; one on the board's own wrapper
 * catches a tile being dragged, resized, added or deleted. Both fire on mount,
 * so the first measurement needs no separate call.
 */
export function BoardTailSpace() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [px, setPx] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main");
    if (!main) return;
    /** Everything above this spacer — the board itself, whichever board it is. */
    const board = el.previousElementSibling ?? el.parentElement;

    const measure = () => {
      /**
       * The content WITHOUT this spacer — otherwise the measurement includes
       * what it is about to set and the board grows by its own tail forever.
       */
      const contentPx = main.scrollHeight - el.offsetHeight;
      setPx(tailSpacePx({ viewportPx: main.clientHeight, contentPx }));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(main);
    if (board) ro.observe(board);
    return () => ro.disconnect();
  }, []);

  // `aria-hidden` and no text: this is room to scroll into, not content. It is
  // never focusable and a screen reader has nothing to say about it.
  return <div ref={ref} aria-hidden style={{ height: px }} />;
}
