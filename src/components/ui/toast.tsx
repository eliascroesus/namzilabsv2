"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE TOAST — promoted from the flow canvas, where it was the only one in
 * the app while settings errors were a red paragraph on a five-second timer.
 *
 * THE LADDER'S RAISED RUNG. `neutral-700` is #332f31 — one step above a card,
 * which is the same step the rail's hover, a menu row and a table row all take.
 * A floating surface should be the raised thing, not a different material.
 *
 * THIS TOKEN HAS MOVED THREE TIMES AND THE REASON IS ALWAYS THE SAME LADDER
 * BEING RE-CUT UNDER IT. It was `ink-900` when the ladder ran DOWN from a
 * #0f0f0f band, then `ink-800` when the band went charcoal and the ladder was
 * re-cut ABOVE it. Both of those spellings existed to keep this surface DARK in
 * both themes — `bg-foreground` would have flipped the toast to a white slab
 * over a dark app, and the one thing floating above the working area should not
 * be the brightest object on the screen.
 *
 * There is one theme, so there is nothing to stay dark against and the whole
 * `ink-*` ramp is retired. What is left is the ordinary raised step, which is
 * what this always meant.
 *
 * Presentational — the caller owns timing and state; conditional render is
 * show/hide.
 */
export type ToastProps = {
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
};

export function Toast({ children, action, className }: ToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div
        role="status"
        className={cn(
          // `rounded-surface`, not the sheet's pill: a toast is a SURFACE, and
          // the pill radius belongs to controls. An error from settings can run
          // to two lines, and a stadium-shaped paragraph is the shape a pill
          // stops being able to hold.
          //
          // Asymmetric padding on purpose — the action button carries its own
          // 10px, so an even inset would leave the right side visibly airier
          // than the left.
          "flow-pop-in pointer-events-auto flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-3 rounded-surface bg-accent py-3 pl-5 pr-3 text-sm text-foreground shadow-surface",
          className,
        )}
      >
        {children}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            // NO RING OVERRIDE. This carried `focus-ring-light`, because the
            // shared outline was the marker's violet at 2.86:1 on the toast's
            // charcoal — under the 3:1 a focus indicator owes, on the single
            // most important indicator in the product. `--ring` is the brand
            // green now and measures 8.5:1 on this surface, so the white twin is
            // retired and the product's one ring is the correct one here.
            //
            // The label is the sheet's micro voice — the same ALL CAPS as a chip
            // — because at this size on this surface it is a control, not a word
            // in the sentence beside it.
            className="shrink-0 rounded-control px-2.5 py-1 text-xs font-medium uppercase tracking-label text-white/90 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-white/15 hover:text-white"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
