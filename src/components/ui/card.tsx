import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * THE SURFACE. Every boxed thing that is not a button comes from here.
 *
 * Two rungs, matching the elevation ladder in globals.css: `card` for tiles
 * and sections sitting in the page flow, `surface` for the bigger pieces —
 * tables, panels, anything that reads as a place rather than an item. Both
 * draw a real border and take the ring-free shadow twin (see the ladder's
 * comment for why a ring under a border reads as mud).
 */
const cardVariants = cva("border border-border bg-card", {
  variants: {
    variant: {
      card: "rounded-card shadow-xs",
      surface: "rounded-surface shadow-xs",
    },
    padding: {
      none: "",
      dense: "p-2.5",
      compact: "p-3.5",
      default: "p-4",
    },
  },
  defaultVariants: { variant: "card", padding: "default" },
});

export type CardProps = React.ComponentProps<"div"> & VariantProps<typeof cardVariants>;

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...props} />;
}

export { cardVariants };
