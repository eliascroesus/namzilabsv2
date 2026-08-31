"use client";

import { useCallback, useRef, useState } from "react";
import { compact, GRID_COLS, GRID_GAP_PX, ROW_UNIT_PX, type GridBox } from "@/lib/board/grid";
import { pageScrollerOf, scrollTopOf } from "./board-drag";

/**
 * MOVE AND RESIZE A CHART ON THE CANVAS.
 *
 * A SIBLING OF `board-drag.ts`, NOT AN EXTENSION OF IT, and the reason is worth
 * stating because "reuse the drag engine" is the obvious instinct. That engine
 * answers a ONE-DIMENSIONAL question — which lane, which index — and its
 * `resolve` is ninety lines of lane geometry: a deadband as a share of item
 * size, a sorted-lane rule, a home-index no-op rule. None of that means
 * anything on a free grid, where the answer is a column and a row. Bolting a
 * second geometry onto it would put two hit-tests in one `measure`, on the hot
 * path of a feature that has already shipped three drag regressions, and six of
 * `board-drag-rules.test.ts`'s assertions pin that function's internals by
 * regex precisely to stop that.
 *
 * What IS reused is what that engine learned the hard way, imported rather than
 * rewritten: `pageScrollerOf` (the app scrolls in a DIV, so `window.scrollY` is
 * permanently 0 and `window.scrollBy` a no-op — a bug only a real browser
 * found) and `scrollTopOf`. Its `outside` is not: lane-distance has no meaning
 * on a free grid, where a pointer is always over some column and some row.
 * The DISCIPLINE is reused in full, deliberately line for line:
 *
 *   · window listeners installed BEFORE `setPointerCapture`, inside a `try`,
 *     because capture throws and a throw used to escape the handler so the
 *     listeners never got added at all;
 *   · ONE `release()` removing exactly what was added;
 *   · `finish(commit)` reached by pointerup (commit) and by pointercancel,
 *     blur and Escape (cancel) — without those three an alt-tab mid-gesture
 *     leaves a frozen ghost and a rAF loop running forever;
 *   · rects read ONCE, at gesture start, and scroll corrected arithmetically.
 *
 * `src/components/flow/controls/DataBrowser.tsx` is the counter-example living
 * in this repo: a pointermove/pointerup pair with no cancel path and no
 * capture. Do not copy it.
 *
 * THE PREVIEW IS COMPUTED BY THE SAME `compact` THE COMMIT WRITES. That is the
 * single most important line here: what you see while dragging IS the outcome,
 * with no second opinion to drift from it.
 */

/** Below this a press is a click — the same threshold the lane engine uses. */
const CANVAS_START_PX = 4;
/** How close to the viewport edge starts the page moving, and how fast. */
const CANVAS_SCROLL_EDGE = 64;
const CANVAS_SCROLL_MAX = 18;
/** A chart smaller than this has no room to mean anything. */
/**
 * The floor when the caller offers none. Every real board passes `minOf`, which
 * answers PER CHART — a line needs five rows before its axis frame has any
 * height at all, and one global floor squashed it to nothing.
 */
const MIN_TILE_W = 2;
const MIN_TILE_H = 3;

export const CANVAS_ATTR = "data-canvas";
export const CELL_ATTR = "data-canvas-cell";
export const HANDLE_ATTR = "data-canvas-handle";

export type CanvasGesture = { id: string; mode: "move" | "resize" };

type Live = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  moved: boolean;
  start: GridBox;
  colPx: number;
  scrollY0: number;
  pageScroller: HTMLElement | null;
  pointer: { x: number; y: number };
  release: () => void;
};

/**
 * THE ONE PLACE A RECT IS READ, at gesture start.
 *
 * `cols` comes from the LIVE grid rather than from a copy of the breakpoints in
 * JavaScript, which is the honest source and needs no second definition to keep
 * in step with the stylesheet.
 */
function measureCanvas(root: HTMLElement, id: string, boxes: GridBox[]) {
  const grid = root.querySelector(`[${CANVAS_ATTR}]`) as HTMLElement | null;
  const start = boxes.find((b) => b.id === id);
  if (!grid || !start) return null;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  /**
   * DESKTOP ONLY, AND THIS IS THE ENFORCEMENT.
   *
   * The stored layout is the twelve-column one; the six- and one-column
   * renderings are derived and have no inverse. A resize performed against the
   * six-column grid cannot be widened back into twelve without inventing
   * information, so it has nothing honest to save — it would silently rewrite
   * the desktop layout with a guess. Narrower viewports get no handles at all.
   */
  if (cols !== GRID_COLS) return null;
  const rect = grid.getBoundingClientRect();
  const colPx = (rect.width - GRID_GAP_PX * (cols - 1)) / cols;
  const pageScroller = pageScrollerOf(root);
  return { colPx, pageScroller, scrollY0: scrollTopOf(pageScroller), start };
}

export function useCanvasDrag(
  rootRef: React.RefObject<HTMLElement | null>,
  boxes: GridBox[],
  /**
   * The packed layout, and WHICH tile the gesture moved. The id matters on the
   * way out as much as on the way in: it is the tiebreak that keeps the held
   * tile ahead of the one it landed on, so re-packing the answer cannot quietly
   * swap them back.
   */
  onCommit: (next: GridBox[], movedId: string) => void,
  /** The smallest box this particular tile may be dragged to. */
  minOf?: (id: string) => { w: number; h: number },
) {
  const [gesture, setGesture] = useState<CanvasGesture | null>(null);
  /** The layout as it looks RIGHT NOW, gesture included. Null when nothing is held. */
  const [preview, setPreview] = useState<GridBox[] | null>(null);
  const live = useRef<Live | null>(null);
  const raf = useRef<number | null>(null);
  const dragged = useRef(false);

  /** Pointer delta → grid units → the whole packed layout. No layout reads. */
  const resolve = useCallback(
    (x: number, y: number): GridBox[] => {
      const s = live.current;
      if (!s) return boxes;
      const dy = scrollTopOf(s.pageScroller) - s.scrollY0;
      const dCols = Math.round((x - s.startX) / (s.colPx + GRID_GAP_PX));
      const dRows = Math.round((y - s.startY + dy) / ROW_UNIT_PX);
      const b = s.start;
      const next: GridBox =
        s.mode === "move"
          ? { ...b, x: b.x + dCols, y: Math.max(0, b.y + dRows) }
          : {
              ...b,
              w: Math.max(minOf?.(b.id)?.w ?? MIN_TILE_W, b.w + dCols),
              h: Math.max(minOf?.(b.id)?.h ?? MIN_TILE_H, b.h + dRows),
            };
      // The SAME compact the commit writes and every render draws. `first` is
      // the held tile, so it wins its row and pushes rather than being pushed.
      return compact(
        boxes.map((o) => (o.id === b.id ? next : o)),
        GRID_COLS,
        b.id,
      );
    },
    [boxes],
  );

  const tick = useCallback(() => {
    const s = live.current;
    if (!s) return;
    const { x, y } = s.pointer;
    // One scroller, the page's — a canvas has no sideways scroll of its own.
    const up = y < CANVAS_SCROLL_EDGE ? -CANVAS_SCROLL_MAX * (1 - y / CANVAS_SCROLL_EDGE) : 0;
    const bottom = window.innerHeight - y;
    const down = bottom < CANVAS_SCROLL_EDGE ? CANVAS_SCROLL_MAX * (1 - bottom / CANVAS_SCROLL_EDGE) : 0;
    const dv = up || down;
    if (dv) {
      if (s.pageScroller) s.pageScroller.scrollTop += dv;
      else window.scrollBy(0, dv);
    }
    setPreview(resolve(x, y));
    raf.current = requestAnimationFrame(tick);
  }, [resolve]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, item: { id: string; mode: "move" | "resize" }) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      /**
       * A PRESS THAT STARTED ON A CHART IS A READ, NOT A DRAG.
       *
       * The plot is the largest press target on a tile, so reading one meant
       * picking the card up: the crosshair appeared, you moved a few pixels to
       * follow the series, and the tile came with you. Every chart's plot box
       * carries `data-plot` (see `AxisFrame`), and a gesture beginning inside
       * one simply never starts — which also leaves the pointer free for the
       * hover readout, since nothing captures it.
       *
       * The GRIP still drags, and so does every other part of the card: the
       * header band, the numeral, the padding. Nothing became unmovable, the
       * one region that was ambiguous stopped being.
       */
      if ((e.target as HTMLElement).closest("[data-plot]")) return;
      const root = rootRef.current;
      if (!root) return;
      const m = measureCanvas(root, item.id, boxes);
      if (!m) return; // narrow viewport, or a tile that has gone

      const el = e.currentTarget;
      live.current = {
        id: item.id,
        mode: item.mode,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        start: m.start,
        colPx: m.colPx,
        scrollY0: m.scrollY0,
        pageScroller: m.pageScroller,
        pointer: { x: e.clientX, y: e.clientY },
        release: () => {},
      };

      const finish = (commit: boolean) => {
        const s = live.current;
        if (!s) return; // idempotent: pointerup and blur can both arrive
        /**
         * THE ANSWER IS TAKEN BEFORE THE GESTURE IS TORN DOWN, and the order is
         * the whole of it: `resolve` reads `live.current`, so clearing it first
         * makes every completed drag throw — which the tests could not see,
         * because a source-text rule cannot notice that two correct lines are
         * in the wrong order. A browser found it on the first press.
         */
        const held = s.moved ? resolve(s.pointer.x, s.pointer.y) : null;
        s.release();
        live.current = null;
        if (raf.current != null) cancelAnimationFrame(raf.current);
        raf.current = null;
        setGesture(null);
        setPreview(null);
        if (commit && held) onCommit(held, s.id);
      };

      const onMove = (ev: PointerEvent) => {
        const s = live.current;
        if (!s) return;
        s.pointer = { x: ev.clientX, y: ev.clientY };
        if (!s.moved) {
          if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < CANVAS_START_PX) return;
          s.moved = true;
          dragged.current = true;
          // A drag that also selects the text under it looks broken.
          window.getSelection?.()?.removeAllRanges();
          setGesture({ id: s.id, mode: s.mode });
          raf.current = requestAnimationFrame(tick);
        }
      };
      const onUp = () => finish(true);
      const onAbort = () => finish(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        // A LIVE GESTURE OWNS ESCAPE. The tile settings panel also listens for
        // it, on the window, and both fired — cancelling the drag AND closing a
        // panel nobody asked to close. Marking the event consumed lets the
        // outer listener stand down; it costs nothing when no panel is open.
        ev.preventDefault();
        finish(false);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onAbort);
      window.addEventListener("blur", onAbort);
      window.addEventListener("keydown", onKey);
      live.current.release = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onAbort);
        window.removeEventListener("blur", onAbort);
        window.removeEventListener("keydown", onKey);
      };

      // AFTER the listeners, and inside a try. Capture keeps a fast flick from
      // losing moves; it also throws, and a throw here used to escape the whole
      // handler so nothing was ever listening.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* the gesture works without it — the window listeners see every move */
      }
    },
    [boxes, onCommit, resolve, rootRef, tick],
  );

  /** Read-and-clear, so the click that ends a drag does not also open a menu. */
  const swallowClick = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  return { gesture, preview, onPointerDown, swallowClick };
}
