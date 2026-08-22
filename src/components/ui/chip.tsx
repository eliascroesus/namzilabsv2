"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE FILTER CHIP. A row of these is a question with one answer showing —
 * dashboard scope, flow-state filters, rank presets all speak through it.
 *
 * On-state is the accent doing its actual job (selection); off-state is
 * text-only so the row reads as options, not as a wall of outlined buttons.
 */
export type ChipProps = React.ComponentProps<"button"> & {
  active?: boolean;
  /** A trailing count — renders as a small numeral, tinted to match. */
  count?: number;
};

export function Chip({ className, active, count, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-small font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring/40",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {count != null && (
        <span className={cn("tnum rounded-full px-1.5 text-micro font-semibold", active ? "bg-white/25" : "bg-muted")}>
          {count}
        </span>
      )}
    </button>
  );
}
