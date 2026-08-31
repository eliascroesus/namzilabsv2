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
        // `h-7` rather than vertical padding, so a chip and a `size="sm"` Button
        // in the same toolbar row are the same height by construction. It came
        // down from 32 with the whole control ladder — see button.tsx.
        //
        // NOT UPPERCASE ANY MORE, and that is the one place a chip and a badge
        // part company. The caps voice is for a LABEL — a status, a section
        // name, a column header: strings you scan rather than read. A filter
        // chip carries a source name or a metric name, which is a proper noun
        // the customer chose, and setting somebody's workspace or connector name
        // in caps is the product shouting a word it did not write.
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-3 text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        active
          ? // THE FILL IS THE BRAND: #00bc7d under #0f1011 ink at 7.70:1. Hover
            // walks UP the ramp on the same ladder the primary Button uses, so a
            // selected chip and a primary button never answer the pointer
            // differently. Up rather than down is the surface's doing — on a
            // light page the brand had to darken under the pointer, because
            // brightening it moved it toward the white behind it and the label's
            // contrast fell at the moment of the press. On near-black, raised
            // means lighter.
            "bg-primary text-primary-foreground hover:bg-brand-500 active:bg-brand-700"
          : // OFF-HOVER IS A RAISED STEP, NOT A TINT. It was the marker's violet
            // wash, because on a light page `hover:bg-accent` and the page were
            // the same #f5f5f5 — an invisible hover on the only control in the
            // row that has to say "you can pick me".
            //
            // On this surface coming forward IS the affordance, and it costs no
            // colour at all: `neutral-700` is the same raised step the rail's
            // rows, the menu's rows and the table's rows all use, so every
            // hoverable thing in the product answers the pointer the same way.
            // Selecting still says "this is the one" in the brand's voice —
            // two statements, spelled apart, one of them now in greyscale.
            "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {/* THE ACTIVE COUNT IS AN INVERTED PILL, not a translucent wash.
          `bg-white/25` over the fill composites to a pale wash, and a numeral
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
            active ? "bg-primary-foreground text-primary" : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
