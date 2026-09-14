"use client";

import { useEffect, useRef, useState } from "react";
import { pageScrollerOf } from "./board-drag";
import { tailSpacePx } from "@/lib/board/tail-space";

/**
 * HALF A SCREEN AND MORE OF ROOM BELOW THE BOARD, so the tile at the bottom can
 * be dragged taller without the gesture running out of page.
 *
 * A board taller than the window stops scrolling the instant its last tile's
 * bottom edge meets the bottom of the viewport. That tile can then only be
 * read along the bottom edge and only RESIZED there, a few pixels at a time,
 * which is the complaint: "expanding metrics vertically that are close to the
 * bottom is super annoying".
 *
 * IT LOOKS FOR THE SCROLLER, NOT FOR `<main>`, and that distinction is the
 * whole reason the first two attempts did nothing at all. `AppFrame` renders
 * its scroll region as a plain `<div>` for every page that brings its own
 * `PageContainer` — which is every page but the flow builder — and
 * `PageContainer` then renders the `<main>` INSIDE it. So `closest("main")`
 * found an element that never scrolls, whose `clientHeight` is its own content,
 * and the board therefore looked like it always fitted. `pageScrollerOf` is the
 * rule the canvas drag already uses to answer the same question; sharing it
 * means the spacer and the drag cannot disagree about what scrolls.
 *
 * NOTHING IS OWED TO A BOARD THAT ALREADY FITS — `pageScrollerOf` only answers
 * with an element that is actually overflowing, and `tailSpacePx` refuses again
 * on the content it measures. A scrollbar over a screen of emptiness is worse
 * than the problem, and most boards are shorter than the screen.
 *
 * WHAT TRIGGERS A RE-MEASURE. A `ResizeObserver` on the board's own content
 * catches a tile being dragged, resized, added or deleted — including the
 * moment the board first grows past the fold, when the scroller appears and
 * this has something to do. A window `resize` listener catches the viewport
 * itself, which no observer here would see: the board's width changes with the
 * window but its HEIGHT does not, so a shorter window alone would leave a stale
 * measurement behind.
 */
export function BoardTailSpace() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [px, setPx] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /** The board's own content — everything this spacer follows. */
    const board = el.previousElementSibling ?? el.parentElement;

    const measure = () => {
      // Looked up per measurement rather than captured: a board that did not
      // overflow at mount has no scroller yet, and growing one is exactly the
      // case this exists for.
      const scroller = pageScrollerOf(el);
      if (!scroller) return setPx(0);
      /**
       * The content WITHOUT this spacer — otherwise the measurement includes
       * what it is about to set and the board grows by its own tail forever.
       */
      const contentPx = scroller.scrollHeight - el.offsetHeight;
      setPx(tailSpacePx({ viewportPx: scroller.clientHeight, contentPx }));
    };

    const ro = new ResizeObserver(measure);
    if (board) ro.observe(board);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // `aria-hidden` and no text: this is room to scroll into, not content. It is
  // never focusable and a screen reader has nothing to say about it.
  return <div ref={ref} aria-hidden style={{ height: px }} />;
}
