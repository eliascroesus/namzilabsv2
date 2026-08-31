"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE FILTER CHIP. A row of these is a question with one answer showing —
 * dashboard scope, flow-state filters, rank presets all speak through it.
 *
 * On-state is the brand's fill doing its actual job (selection); off-state is
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
          ? // THE FILL IS THE BRAND, which is the one shape yellow is allowed to
            // take: #eecf00 under near-black ink at 11.24:1. Hover walks DOWN
            // the ramp on the same ladder the primary Button uses, so a selected
            // chip and a primary button never answer the pointer differently —
            // and on this hue that is not a preference. Brightening a yellow
            // moves it toward the white behind it, so the label's contrast would
            // FALL at the one moment the chip is under a pointer.
            "bg-primary text-primary-foreground hover:bg-brand-700 active:bg-brand-800"
          : // OFF-HOVER IS THE MARKER'S TINT, NOT THE GREY WASH. `--muted` and
            // the app's page are both #f5f5f5 now, so `hover:bg-muted` on a chip
            // row sitting on the page painted the background onto itself — an
            // invisible hover on the only control in the row that has to say
            // "you can pick me".
            //
            // It is deliberately NOT a wash of the yellow. A hover is a tint
            // BEHIND ink and the ON state is a filled object carrying near-black;
            // a pale yellow under yellow ink is the one combination the
            // fill/stroke split forbids, and a pale yellow under near-black ink
            // would just be a weaker copy of the selected state. So hovering
            // says "this is pressable" in the marker's voice and selecting says
            // "this is the one" in the brand's — two statements, spelled apart.
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {/* THE ACTIVE COUNT IS AN INVERTED PILL, not a translucent wash.
          `bg-white/25` over the yellow composites to a pale cream, and a numeral
          on that is under AA on the flows filter row where the counts ARE the
          information. Inverting keeps both states shaped like the same component
          and introduces no colour that is not already on the chip: the pill
          takes the chip's INK and the numeral takes the chip's FILL, which is
          the same 11.24:1 read the other way up.
          (`bg-black/20` measures better still and was rejected: it puts pure
          black into a kit that refuses it by name.)

          BOTH HALVES ARE CONSTANTS, and that is why the fill is spelled as the
          RAMP rather than as `--primary`. The chip does not invert — the yellow
          and its near-black ink answer identically in both themes — so a pill
          built from `foreground`/`background`, or an ink taken from
          `accent-foreground`, would flip underneath a fill that stayed put.

          The off-state pill is an ALPHA OF THE FOREGROUND, not `--muted`: muted
          and the page are both #f5f5f5 now, so a muted count on a page-level
          filter row was a numeral floating in nothing. 10% of the near-black
          reads on white and on off-white alike, and it inverts with the theme
          for free — which no fixed grey step in the ramp does. */}
      {count != null && (
        <span
          className={cn(
            "tnum rounded-full px-1.5 text-xs font-semibold",
            active ? "bg-primary-foreground text-brand-600" : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
