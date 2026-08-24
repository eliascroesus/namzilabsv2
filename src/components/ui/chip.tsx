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
        // Focus comes from the shared rule in globals.css — see button.tsx.
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-small font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        active
          ? "bg-primary text-primary-foreground hover:bg-brand-700"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {/* THE ACTIVE COUNT IS AN INVERTED PILL, not a translucent wash.
          `bg-white/25` over brand-600 composites to #6073e2, and white on that
          is 4.16:1 — under AA for 11px semibold, on the flows filter row where
          the counts ARE the information. A solid white pill with brand-600 text
          is 7.19:1, keeps both states shaped like the same component, and
          introduces no colour that is not already in the ramp. (`bg-black/20`
          measures better still and was rejected: it puts pure black into a kit
          that refuses it by name.) */}
      {count != null && (
        <span
          className={cn(
            "tnum rounded-full px-1.5 text-micro font-semibold",
            active ? "bg-primary-foreground text-primary" : "bg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
