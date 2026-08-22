"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE TOAST — promoted from the flow canvas, where it was the only one in
 * the app while settings errors were a red paragraph on a five-second timer.
 *
 * Dark on purpose: it is the one surface that floats OVER the working area,
 * and the ink ladder makes it read as chrome, not content. Presentational —
 * the caller owns timing and state; conditional render is show/hide.
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
          "flow-pop-in pointer-events-auto flex items-center gap-3 rounded-surface bg-ink-900 py-2.5 pl-4 pr-2.5 text-base text-ink-50 shadow-surface",
          className,
        )}
      >
        {children}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="rounded-control px-2.5 py-1 text-base font-semibold text-white/90 outline-none transition-colors hover:bg-white/15 focus-visible:ring-4 focus-visible:ring-white/25"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
