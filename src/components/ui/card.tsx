import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * THE SURFACE. Every boxed thing that is not a button comes from here.
 *
 * Three rungs, matching the elevation ladder in globals.css: `card` for tiles
 * and sections sitting in the page flow, `surface` for the bigger pieces —
 * tables, panels, anything that reads as a place rather than an item — and
 * `tile` for the metric card itself. All three draw a real border and take the
 * ring-free shadow twin (see the ladder's comment for why a ring under a
 * border reads as mud).
 */
const cardVariants = cva("border border-border bg-card", {
  variants: {
    variant: {
      card: "rounded-card shadow-xs",
      surface: "rounded-surface shadow-xs",
      /**
       * THE METRIC TILE — the one surface the product is actually FOR, and the
       * one place its chrome is decided.
       *
       * It was `surface` plus a hand-typed `hover:shadow-card-hover` at each
       * call site, which is three copies of one idea and a fourth tile away
       * from drifting. Same resting elevation as `surface` on purpose: a tile
       * sits beside the legacy `MetricTile` on the same board, and a heavier
       * shadow on one of them reads as two card styles rather than as
       * hierarchy — the chrome is meant to be quiet, the NUMBER is the loud
       * thing.
       *
       * The pointer response is here; the `lift` translate is NOT. The groups
       * board's tiles are read, so they rise a pixel under the cursor; the
       * canvas board's are DRAGGED, and a hover translate under a gesture that
       * also moves the box is one motion too many (it also shifts the
       * bounding boxes `scripts/canvas-check.mjs` measures overlap with).
       */
      /**
       * THE TILE STAYS WHITE IN DARK, AND IT IS THE ONE CARD THAT DOES.
       *
       * `--card` is `neutral-800` under `.dark`, which measured 1.24:1 against
       * the new `--ground` — a tile you could not see the edge of, carried
       * entirely by its border. That was survivable while the ground was
       * `#1a1a1a` and nobody had drawn the alternative; the Figma draws it, and
       * it draws white cards on the dark board.
       *
       * Scoped to `tile` rather than flipped on the `--card` ROLE on purpose.
       * The role is also every dropdown, dialog, popover and panel in the
       * product; turning it white in dark would invert the whole app to chase
       * one surface. The metric tile is the surface the comp actually shows, so
       * it is the surface that changes — and it now reads at 15.3:1 against the
       * ground instead of 1.24:1.
       */
      tile: "rounded-surface shadow-xs transition-shadow duration-(--duration-base) ease-(--ease-standard) hover:shadow-card-hover dark:border-transparent dark:bg-white dark:text-neutral-900",
    },
    padding: {
      none: "",
      dense: "p-3",
      compact: "p-4",
      default: "p-6",
    },
  },
  defaultVariants: { variant: "card", padding: "default" },
});

export type CardProps = React.ComponentProps<"div"> & VariantProps<typeof cardVariants>;

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...props} />;
}

export { cardVariants };
