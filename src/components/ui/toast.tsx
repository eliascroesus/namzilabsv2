"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE TOAST — promoted from the flow canvas, where it was the only one in
 * the app while settings errors were a red paragraph on a five-second timer.
 *
 * THE LADDER'S RAISED RUNG, WEARING OFF-WHITE. `ink-800` is #434343 — the step
 * globals.css names for the rail's active row and, by name, for this surface —
 * reached through the ink ladder rather than through a role because this surface
 * must stay dark in BOTH themes: `bg-foreground` would flip the toast to a white
 * slab over a dark app, and the one thing floating above the working area should
 * not be the brightest object on the screen.
 *
 * IT WAS `ink-900`, AND THAT RUNG MOVED UNDERNEATH IT. The ladder used to run
 * DOWNWARDS from a #0f0f0f band, so `ink-900` was #1a1a1a and this was the
 * darkest surface in the app. The band is charcoal now and the ladder was re-cut
 * ABOVE it — on #2e2e2e, raised means LIGHTER — which left `ink-900` as the
 * rail's hover step, a rung below where a floating surface belongs. `ink-800` is
 * 1.45:1 over the band, so the toast reads as sitting on top of the chrome
 * rather than sinking into it.
 *
 * Dark on purpose for the same reason it is dark on the sheet: it is the one
 * surface that sits OVER the work, and the ink ladder makes it read as chrome,
 * not content. Presentational — the caller owns timing and state; conditional
 * render is show/hide.
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
          "flow-pop-in pointer-events-auto flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-3 rounded-surface bg-ink-800 py-3 pl-5 pr-3 text-sm text-ink-50 shadow-surface",
          className,
        )}
      >
        {children}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            // `focus-ring-light`: the shared focus outline is the MARKER's
            // violet, which measures 2.86:1 on the toast's charcoal — under the
            // 3:1 a focus indicator owes, on the single most important indicator
            // in the product. The class swaps it for white without re-spelling
            // the rest of the rule.
            //
            // The label is the sheet's micro voice — the same ALL CAPS as a chip
            // — because at this size on this surface it is a control, not a word
            // in the sentence beside it.
            className="focus-ring-light shrink-0 rounded-control px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/90 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-white/15 hover:text-white"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
