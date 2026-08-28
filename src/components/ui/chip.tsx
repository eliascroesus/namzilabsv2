"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE FILTER CHIP. A row of these is a question with one answer showing —
 * dashboard scope, flow-state filters, rank presets all speak through it.
 *
 * On-state is the accent doing its actual job (selection); off-state is
 * text-only so the row reads as options, not as a wall of outlined buttons.
 *
 * ALL CAPS, like every chip and tab on the brand sheet — the same micro voice
 * `StatusPill` and the table head are set in. At 12px it reads as a LABEL, and
 * a row of labels reads as a control rather than as a sentence somebody made
 * small; it also stops "Paused" beside "Drafts" looking like body copy that
 * happens to be clickable.
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
        // `h-8` rather than vertical padding, so a chip and a `size="sm"`
        // Button in the same toolbar row are the same height by construction.
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold uppercase tracking-wide transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        active
          ? // The FILL takes the vibrant violet — that is the one job the 500 has
            // on this sheet — and hover walks DOWN the ramp on the same ladder
            // the primary Button uses, so a selected chip and a primary button
            // never answer the pointer differently.
            "bg-primary text-primary-foreground hover:bg-brand-600 active:bg-brand-700"
          : // OFF-HOVER IS THE VIOLET TINT, NOT THE GREY WASH. `--muted` and the
            // app's page are both #f5f5f5 now, so `hover:bg-muted` on a chip row
            // sitting on the page painted the background onto itself — an
            // invisible hover on the only control in the row that has to say
            // "you can pick me". The tint is the same colour family the ON
            // state fills with, so hovering previews what selecting does.
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {/* THE ACTIVE COUNT IS AN INVERTED PILL, not a translucent wash.
          `bg-white/25` over the violet composites to a mid-lilac, and white on
          that is under AA on the flows filter row where the counts ARE the
          information. A solid white pill keeps both states shaped like the same
          component and introduces no colour that is not already in the ramp.
          (`bg-black/20` measures better still and was rejected: it puts pure
          black into a kit that refuses it by name.)

          Its ink is the TEXT violet, not the fill violet: brand-500 on white is
          4.42:1 and this numeral is set at 12px semibold. The sheet's rule —
          500 fills, 700 speaks — is exactly this case. Spelled as the RAMP and
          not as `accent-foreground`, because that role is brand-300 in the dark
          theme while this pill stays white in both, and brand-300 on white is
          2.3:1.

          The off-state pill is an ALPHA OF THE FOREGROUND, not `--muted`: muted
          and the page are both #f5f5f5 now, so a muted count on a page-level
          filter row was a numeral floating in nothing. 10% of the near-black
          reads on white and on off-white alike, and it inverts with the theme
          for free — which no fixed grey step in the ramp does. */}
      {count != null && (
        <span
          className={cn(
            "tnum rounded-full px-1.5 text-xs font-semibold",
            active ? "bg-primary-foreground text-brand-700" : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
