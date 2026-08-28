"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE TOAST — promoted from the flow canvas, where it was the only one in
 * the app while settings errors were a red paragraph on a five-second timer.
 *
 * THE SHEET'S DEEP BLACK, WEARING OFF-WHITE. `ink-900` is #1a1a1a — the same
 * value the sheet names as its black and the same one `--foreground` resolves
 * to — reached through the ink ladder rather than through the role because
 * this surface must stay dark in BOTH themes: `bg-foreground` would flip the
 * toast to a white slab over a dark app, and the one thing floating above the
 * working area should not be the brightest object on the screen.
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
          "flow-pop-in pointer-events-auto flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-3 rounded-surface bg-ink-900 py-3 pl-5 pr-3 text-sm text-ink-50 shadow-surface",
          className,
        )}
      >
        {children}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            // `focus-ring-light`: the shared focus outline is the brand violet,
            // which all but disappears on a near-black toast. The class swaps it
            // for white without re-spelling the rest of the rule.
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
