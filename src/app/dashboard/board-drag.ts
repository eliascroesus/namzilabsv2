"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * DRAGGING A TILE ACROSS THE BOARD.
 *
 * The vocabulary is the flow builder's, because a customer has already learned
 * it there: the held card stays where it is and fades, a reduced ghost follows
 * the cursor, and a dashed placeholder opens at the destination. Out of reach
 * of every lane is NOT a drop — "a target you can see, aim at, and miss".
 *
 * The PLUMBING is deliberately not the builder's. That one reads
 * `TouchEvent.touches` to paper over the mouse/touch split; this uses Pointer
 * Events with pointer capture, which routes every move and the release back to
 * the handle even when the pointer leaves it. No document-level listeners, and
 * no drop that lands nowhere because the cursor left the window.
 */

/** Movement before a press becomes a drag. Below it, the press is a click. */
const DRAG_START_PX = 4;
/** Beyond this from every lane, releasing cancels instead of dropping. */
const LANE_REACH = 120;
/** The band at a scroller's edge that starts it moving. */
const AUTOSCROLL_EDGE = 64;
/** Pixels per frame at the very edge, ramping from zero across the band. */
const AUTOSCROLL_MAX = 18;

/** Where a held tile would land: a lane, and a position among its other tiles. */
export type DragTarget = { laneId: string | null; index: number };

export type DragState = {
  tileKey: string;
  title: string;
  accent: string;
  /**
   * The held card's own height, measured at drag start.
   *
   * The gap that opens for it is exactly the hole it will fill. A fixed height
   * was close for a bare number and wrong for a tile carrying a goal bar or a
   * breakdown, and a gap that is not the size of the thing going into it makes
   * every card below it jump on the drop.
   */
  height: number;
  /** The pointer, in viewport coordinates — where the ghost is drawn. */
  x: number;
  y: number;
  target: DragTarget | null;
};

/** The attribute contract between this hook and the board's markup. */
export const LANE_ATTR = "data-board-lane";
export const AXIS_ATTR = "data-board-axis";
export const TILE_ATTR = "data-board-tile";
export const SCROLLER_ATTR = "data-board-scroller";
/**
 * WHAT A LANE WILL TAKE — "tile" or "column".
 *
 * THE BUG THIS EXISTS FOR: lanes nest, so when the pointer is over a group's
 * column it is inside BOTH the row of columns and that group's own tile lane.
 * Both scored a perfect hit, the tie was broken by document order, and the row
 * of columns is always found first — so dragging a metric onto a group opened a
 * COLUMN-sized gap beside it and the metric could never get in. Reported as "I
 * can't move the metrics inside the groups", and it was every group, always.
 *
 * Resolving the tie by depth would work and would be the wrong rule: a column
 * has no business being dropped into a lane of metrics either. What decides is
 * WHAT IS IN THE HAND, so a lane simply says what it takes and the rest are not
 * candidates at all.
 */
export const ACCEPTS_ATTR = "data-board-accepts";
export type DragKind = "tile" | "column";
/** `data-board-lane` cannot be empty, so the ungrouped row needs a spelling. */
export const UNGROUPED = "__ungrouped__";
/**
 * The row of columns is itself a lane, whose items are the columns. One engine
 * answers both questions — "which column does this metric belong in" and "where
 * does this column go" — because they are the same question about different
 * nesting levels, and two engines would drift in their feel long before they
 * drifted in their arithmetic.
 */
export const COLUMNS_LANE = "__columns__";

type Lane = {
  id: string | null;
  /** Which way its tiles run: the ungrouped row is "x", a column is "y". */
  axis: "x" | "y";
  /** Viewport rect AT DRAG START. Corrected for scroll on every move. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Midpoints between consecutive tiles, along the lane's own axis. */
  bounds: number[];
  scroller: HTMLElement | null;
  scrollLeft0: number;
};

/**
 * MEASURED ONCE, AT DRAG START — never in the move handler.
 *
 * The canvas learned this the expensive way ("stop the drag doing a DFS per
 * pixel"): a drag makes about sixty calls a second, and `getBoundingClientRect`
 * in that path forces a layout on each one, on a page that is simultaneously
 * animating a placeholder.
 *
 * Everything is stored as it was at drag start, together with the scroll
 * positions of the moment. Scroll is then corrected arithmetically — a
 * `scrollLeft` read is a cheap property, a rect is a layout — which is what
 * makes the cache survive auto-scroll instead of silently going stale and
 * dropping the tile in the wrong column.
 */
function measure(
  root: HTMLElement,
  held: string,
  kind: DragKind,
): { lanes: Lane[]; scrollY0: number; heldH: number; home: DragTarget | null } {
  const lanes: Lane[] = [];
  const heldEl = root.querySelector<HTMLElement>(`[${TILE_ATTR}="${held}"]`);
  const heldH = heldEl ? heldEl.getBoundingClientRect().height : 0;
  /**
   * WHERE THE HELD ITEM ALREADY IS, in the same coordinates a target is
   * reported in: its lane, and its index among the OTHER items of that lane.
   *
   * This is what lets a drop onto its own position be recognised as the no-op
   * it is — see `resolve`.
   */
  let home: DragTarget | null = null;

  for (const el of root.querySelectorAll<HTMLElement>(`[${LANE_ATTR}]`)) {
    // A lane that does not take what is in the hand is not a candidate. See
    // ACCEPTS_ATTR — this one line is the whole fix for "I can't move the
    // metrics inside the groups".
    if (el.getAttribute(ACCEPTS_ATTR) !== kind) continue;
    const raw = el.getAttribute(LANE_ATTR)!;
    const id = raw === UNGROUPED ? null : raw;
    const axis = el.getAttribute(AXIS_ATTR) === "x" ? "x" : "y";
    const r = el.getBoundingClientRect();
    const scroller = el.closest<HTMLElement>(`[${SCROLLER_ATTR}]`);
    const bounds: number[] = [];
    for (const t of el.querySelectorAll<HTMLElement>(`[${TILE_ATTR}]`)) {
      /**
       * LANES NEST — the row of columns is a lane whose items are the columns,
       * and each column contains a lane whose items are its tiles. A plain
       * descendant query would therefore count every tile on the board as an
       * item of the columns row, and dropping a column would land it between
       * two metrics. An item belongs to its NEAREST lane and no other.
       */
      if (t.closest(`[${LANE_ATTR}]`) !== el) continue;
      // The held item is excluded, so an index counts among the OTHERS — which
      // is exactly what the placement maths expects to be handed. Its position
      // in that count IS its home.
      if (t.getAttribute(TILE_ATTR) === held) {
        home = { laneId: id, index: bounds.length };
        continue;
      }
      const tr = t.getBoundingClientRect();
      bounds.push(axis === "x" ? tr.left + tr.width / 2 : tr.top + tr.height / 2);
    }
    lanes.push({
      id,
      axis,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      bounds,
      scroller,
      scrollLeft0: scroller?.scrollLeft ?? 0,
    });
  }
  return { lanes, scrollY0: window.scrollY, heldH, home };
}

/** How far outside a band a value sits — zero when it is inside. */
const outside = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);

export function useBoardDrag(
  rootRef: React.RefObject<HTMLElement | null>,
  onDrop: (tileKey: string, laneId: string | null, index: number) => void,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Everything the move handler needs, off the render path entirely. */
  const live = useRef<{
    lanes: Lane[];
    scrollY0: number;
    startX: number;
    startY: number;
    moved: boolean;
    tileKey: string;
    target: DragTarget | null;
    home: DragTarget | null;
    pointer: { x: number; y: number };
    /** Everything this drag subscribed to, so one call can undo all of it. */
    release: () => void;
  } | null>(null);
  /** Set when a press became a drag, so the click that follows is swallowed. */
  const dragged = useRef(false);
  const raf = useRef<number | null>(null);

  const stopScrolling = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  useEffect(() => stopScrolling, [stopScrolling]);

  /**
   * WHICH LANE, AND WHERE IN IT.
   *
   * Not nearest-point-within-a-radius: a board has structure, so this is two
   * questions rather than one. A lane wins outright when the pointer is inside
   * it; otherwise the nearest by the axis that DISTINGUISHES lanes — sideways
   * for the columns, up and down for the row above them — wins, and only within
   * `LANE_REACH`. Past that there is no target and releasing cancels.
   */
  const resolve = useCallback((x: number, y: number): DragTarget | null => {
    const s = live.current;
    if (!s) return null;
    const dy = window.scrollY - s.scrollY0;

    let best: { lane: Lane; d: number } | null = null;
    for (const lane of s.lanes) {
      const dx = (lane.scroller?.scrollLeft ?? 0) - lane.scrollLeft0;
      const left = lane.left - dx;
      const right = lane.right - dx;
      const top = lane.top - dy;
      const bottom = lane.bottom - dy;
      const ox = outside(x, left, right);
      const oy = outside(y, top, bottom);
      // Inside both bands is a hit. Otherwise the distance that counts is along
      // the axis that separates one lane from the next.
      const d = ox === 0 && oy === 0 ? 0 : lane.axis === "y" ? ox + oy * 0.25 : oy + ox * 0.25;
      if (!best || d < best.d) best = { lane, d };
    }
    if (!best || best.d > LANE_REACH) return null;

    /**
     * THE INDEX IS DECIDED IN THE LANE'S GAP-FREE COORDINATES, and that is what
     * keeps it stable.
     *
     * Opening the placeholder reflows the lane — every tile after it moves by a
     * card — so the boundaries measured at drag start stop describing where the
     * tiles now are. Re-measuring would be a layout read per frame AND a
     * feedback loop: the gap moves the tiles, the tiles move the gap.
     *
     * Measuring once WITHOUT the held tile and never again gives the frame the
     * question is actually asked in — "where would this go if nothing had moved
     * yet" — so the answer depends only on the pointer. The visible gap follows
     * the answer rather than informing it.
     */
    const lane = best.lane;
    const shift = lane.axis === "x" ? (lane.scroller?.scrollLeft ?? 0) - lane.scrollLeft0 : dy;
    const along = lane.axis === "x" ? x : y;
    let index = 0;
    for (const b of lane.bounds) if (along > b - shift) index++;

    /**
     * A DROP ONTO ITS OWN POSITION IS NOT A DROP.
     *
     * Hovering the hole a card came out of, or either side of it that resolves
     * to the same place, would otherwise open a placeholder saying "it goes
     * HERE" about the spot it is already in — and releasing would write a row
     * and re-render the board to produce the arrangement that was already on
     * screen. Reported as the placeholder showing "right next to where it used
     * to be because it doesn't really change position", which is exactly right.
     *
     * Returning null here means no placeholder AND no write: the same answer as
     * dragging out of reach, because they are the same answer — nothing to do.
     */
    if (s.home && s.home.laneId === lane.id && s.home.index === index) return null;

    return { laneId: lane.id, index };
  }, []);

  /** The scroll loop, reading the pointer from a ref so it never re-subscribes. */
  const tick = useCallback(() => {
    const s = live.current;
    if (!s) return;
    const { x, y } = s.pointer;

    /**
     * ONE SCROLLER AT A TIME, chosen by which lane the pointer is nearest
     * VERTICALLY — the row above the board and the board itself are separate
     * scrollers, and moving both at once produces diagonal drift on a trackpad
     * that reads as the board fighting the cursor.
     *
     * The choice is deliberately not "the target lane": out past `LANE_REACH`
     * there IS no target, and that is exactly when someone is dragging toward a
     * column off the right-hand edge and needs the board to come to them.
     */
    const dy = window.scrollY - s.scrollY0;
    let near: Lane | null = null;
    let nearD = Infinity;
    for (const l of s.lanes) {
      const d = outside(y, l.top - dy, l.bottom - dy);
      if (d < nearD) {
        nearD = d;
        near = l;
      }
    }
    const scroller = near?.scroller ?? null;

    if (scroller) {
      const nearLeft = x;
      const nearRight = window.innerWidth - x;
      if (nearLeft < AUTOSCROLL_EDGE) scroller.scrollLeft -= AUTOSCROLL_MAX * (1 - nearLeft / AUTOSCROLL_EDGE);
      else if (nearRight < AUTOSCROLL_EDGE) scroller.scrollLeft += AUTOSCROLL_MAX * (1 - nearRight / AUTOSCROLL_EDGE);
    }
    if (y < AUTOSCROLL_EDGE) window.scrollBy(0, -AUTOSCROLL_MAX * (1 - y / AUTOSCROLL_EDGE));
    else if (window.innerHeight - y < AUTOSCROLL_EDGE)
      window.scrollBy(0, AUTOSCROLL_MAX * (1 - (window.innerHeight - y) / AUTOSCROLL_EDGE));

    const target = resolve(x, y);
    s.target = target;
    setDrag((d) => (d ? { ...d, x, y, target } : d));
    raf.current = requestAnimationFrame(tick);
  }, [resolve]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, tile: { key: string; title: string; accent: string; kind: DragKind }) => {
      // Secondary buttons and modifier-clicks belong to the browser.
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const root = rootRef.current;
      if (!root) return;
      dragged.current = false;
      live.current = {
        lanes: [],
        scrollY0: 0,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        tileKey: tile.key,
        target: null,
        home: null,
        pointer: { x: e.clientX, y: e.clientY },
        release: () => {},
      };
      // Capture NOW, before the threshold: without it a fast flick loses its
      // own pointermove events to whatever is under the cursor.
      e.currentTarget.setPointerCapture(e.pointerId);

      const el = e.currentTarget;
      const onMove = (ev: PointerEvent) => {
        const s = live.current;
        if (!s) return;
        s.pointer = { x: ev.clientX, y: ev.clientY };
        if (!s.moved) {
          if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < DRAG_START_PX) return;
          // The press has become a drag. Measure once, here.
          s.moved = true;
          dragged.current = true;
          const m = measure(root, tile.key, tile.kind);
          s.lanes = m.lanes;
          s.scrollY0 = m.scrollY0;
          s.home = m.home;
          /**
           * THE SELECTION THE PRESS ALREADY STARTED, CLEARED.
           *
           * Four pixels with the button down is enough for the browser to begin
           * selecting text, so by the time this is a drag there is often a blue
           * smear across the card's own name. The root also takes `select-none`
           * for the duration — see BoardLayout — so no more can accumulate.
           */
          window.getSelection?.()?.removeAllRanges();
          setDrag({
            tileKey: tile.key,
            title: tile.title,
            accent: tile.accent,
            height: m.heldH,
            x: ev.clientX,
            y: ev.clientY,
            target: null,
          });
          raf.current = requestAnimationFrame(tick);
        }
      };
      /**
       * ONE TEARDOWN, REACHED BY EVERY WAY A DRAG CAN END — and the reason this
       * is a `release` closure rather than four copies of the same three lines.
       *
       * THE FREEZE THIS FIXES: a drag ends when the pointer comes up, and
       * `pointerup` is not the only way the pointer can go away. Alt-tab to
       * another app, click into the browser's own chrome, let the OS take the
       * gesture — and `pointerup` never arrives on this element. The old code
       * had nothing else to hear, so `live.current` stayed set, the
       * requestAnimationFrame loop kept running, and the ghost sat frozen over
       * the board with a placeholder stuck beside it. Nothing could clear it but
       * a reload.
       *
       * So: `lostpointercapture` (the browser handing capture back for ANY
       * reason), window `blur` (focus left the page entirely), and Escape (the
       * key a person actually presses when something is stuck). All three
       * CANCEL rather than commit — a drag whose end nobody witnessed is not an
       * instruction, and dropping a metric somewhere because a Slack
       * notification stole focus is worse than dropping it nowhere.
       *
       * `lostpointercapture` also fires in the ordinary case, immediately after
       * `pointerup`. By then `finish` has already run and nulled `live.current`,
       * so the cancel path finds nothing to do — which is why the ordering
       * matters and why `release` is idempotent.
       */
      const finish = (commit: boolean) => {
        const s = live.current;
        if (!s) return;
        s.release();
        live.current = null;
        stopScrolling();
        setDrag(null);
        // No target is a CANCELLED drag, not a drop at the nearest thing.
        // Cancelling has to be possible, and "somewhere over there" is the
        // shape of a mistake rather than an instruction.
        if (commit && s.moved && s.target) onDrop(s.tileKey, s.target.laneId, s.target.index);
      };
      const onUp = () => finish(true);
      const onAbort = () => finish(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") finish(false);
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onAbort);
      el.addEventListener("lostpointercapture", onAbort);
      window.addEventListener("blur", onAbort);
      window.addEventListener("keydown", onKey);
      live.current.release = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onAbort);
        el.removeEventListener("lostpointercapture", onAbort);
        window.removeEventListener("blur", onAbort);
        window.removeEventListener("keydown", onKey);
      };
    },
    [rootRef, onDrop, stopScrolling, tick],
  );

  /**
   * Whether the click that follows this press should be ignored.
   *
   * A drag ends with a `pointerup` over the handle it started on, which the
   * browser then reports as a click — so without this, every drop would also
   * open the "Move to" menu.
   */
  const swallowClick = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  return { drag, onPointerDown, swallowClick };
}
