"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * THE TILES THAT GET PUSHED OUT OF THE WAY, ANIMATED.
 *
 * Dragging a tile felt jumpy and the held tile was never the problem — it
 * tracks the pointer and snaps a cell at a time, which is what a grid should
 * do. It was the NEIGHBOURS. Every displaced tile teleported from its old cell
 * to its new one with nothing in between, so crossing one boundary made half
 * the board flicker into a different arrangement. You could see the result;
 * you could not see it happen, which is what makes a layout feel like it is
 * fighting you rather than following you.
 *
 * ═══ WHY THIS IS SCRIPT AND NOT A CSS TRANSITION ═══
 *
 * A cell is placed with `grid-column` / `grid-row` (see `.board-cell`, three
 * breakpoints of them), and grid placement is not an animatable property. There
 * is no transition to add. The standard answer is FLIP: let the browser do the
 * layout, then ask each element where it USED to be, put it back there with a
 * transform, and release it.
 *
 * ═══ WHY IT IS AFFORDABLE HERE ═══
 *
 * FLIP reads geometry, and reading geometry forces layout — which is normally
 * fatal inside a drag that updates on every animation frame. It is fine here
 * because `resolve` ROUNDS the pointer delta to whole columns and rows, so the
 * preview only actually changes when the cursor crosses a cell boundary: a
 * handful of times per drag, not sixty times a second. Between crossings React
 * re-renders identical values and every rect below compares equal, so the
 * common frame costs one `getBoundingClientRect` per tile and animates nothing.
 *
 * ═══ THE HELD TILE IS EXEMPT, AND THAT IS THE WHOLE TRICK ═══
 *
 * Animating the tile under the cursor would make it lag its own pointer — the
 * one thing in a drag that must feel direct. It is excluded by id, so it snaps
 * while everything around it glides. That asymmetry is what reads as "I am
 * carrying this and the board is getting out of the way", rather than as
 * everything sloshing at once.
 */

/** Long enough to read as movement, short enough not to lag the next crossing. */
const MS = 180;

export function useCellFlip(
  rootRef: React.RefObject<HTMLElement | null>,
  /** Attribute the cells carry their id in, e.g. `data-canvas-cell`. */
  cellAttr: string,
  /**
   * Changes whenever the layout might have. Anything stable-per-layout works;
   * the board passes the packed boxes it just rendered.
   */
  key: unknown,
  /** The tile under the pointer, which must not be animated. */
  heldId?: string | null,
) {
  const prev = useRef(new Map<string, { left: number; top: number }>());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /**
     * Somebody who asked their system for less motion gets none, and still gets
     * a correct layout — the whole effect is decoration over a board that is
     * already in the right place by the time this runs.
     */
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const cells = Array.from(root.querySelectorAll<HTMLElement>(`[${cellAttr}]`));
    const now = new Map<string, { left: number; top: number }>();
    /**
     * EVERY READ BEFORE ANY WRITE. Interleaving them makes the browser
     * re-layout between each pair — the layout thrash that turns a smooth
     * effect into the jank it was added to remove.
     */
    for (const el of cells) {
      const id = el.getAttribute(cellAttr);
      if (!id) continue;
      const r = el.getBoundingClientRect();
      now.set(id, { left: r.left, top: r.top });
    }

    if (!still) {
      for (const el of cells) {
        const id = el.getAttribute(cellAttr);
        if (!id || id === heldId) continue;
        const was = prev.current.get(id);
        const is = now.get(id);
        if (!was || !is) continue;
        const dx = was.left - is.left;
        const dy = was.top - is.top;
        // Sub-pixel drift from a resize or a scrollbar is not a move.
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        // Back where it was, with no transition, so the jump is never painted.
        el.style.transition = "none";
        el.style.translate = `${dx}px ${dy}px`;
        // Then released on the next frame, which is the only moment the browser
        // will treat the change as something to tween.
        requestAnimationFrame(() => {
          el.style.transition = `translate ${MS}ms cubic-bezier(0.2, 0, 0, 1)`;
          el.style.translate = "0px 0px";
        });
      }
    }

    prev.current = now;
    // `key` is what says the layout may have changed; the rest are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, heldId, cellAttr, rootRef]);
}
