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
       * THE TILE FOLLOWS THE THEME, like every other surface in the product.
       *
       * IT WAS FORCED WHITE IN DARK, and that was two bugs wearing one comp.
       * The reasoning was "the Figma draws white cards on the dark board", and
       * the cost arrived immediately: `dark:bg-white` fixed the SURFACE and
       * nothing inside it, so every muted label still asked the dark theme for
       * its ink and got `neutral-400` — 2.52:1 on the white it now sat on, on
       * the one screen this product exists to be read all day.
       *
       * That was patched with a `tile-surface` light island — a class that
       * re-pointed the whole role block at its light values for the subtree.
       * It worked, and it was the wrong shape: a white plate is a different
       * MATERIAL from the dark chrome around it, and a dashboard of them reads
       * as a light app someone switched the frame off on.
       *
       * A dark card needs no island. `--card` (#2b2b2b) on `--ground` (#1b191a)
       * behind a `--border` (#3d3d3d) hairline is the same subtle-step-plus-
       * edge every dark dashboard worth copying uses, and the ink that belongs
       * on it is the ink the theme already solved: `muted-foreground` measures
       * 5.66:1 there and `foreground` 15.2:1. The contrast bug does not get
       * fixed so much as it stops existing.
       */
      tile: "rounded-surface bg-card text-card-foreground shadow-xs transition-shadow duration-(--duration-base) ease-(--ease-standard) hover:shadow-card-hover",
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
