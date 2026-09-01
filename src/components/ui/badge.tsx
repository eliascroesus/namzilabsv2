import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * STATE, WORN AS A PILL. The app had five independent badge implementations
 * and four status vocabularies; the same "good" was five different greens.
 *
 * Tones map 1:1 to the state trios in globals.css. `pending` is deliberately
 * neutral — transient states used to be blue, which competed with the accent
 * for meaning. Nothing transient deserves a colour.
 */
const pillVariants = cva(/**
   * 10px CAPS IN A 4px RECTANGLE, DOWN FROM 12px CAPS IN A FULL PILL.
   *
   * The caps survive: they are the kit's own voice for a micro label, and they
   * are what lets a very small string read as a LABEL rather than as very small
   * prose. Everything else changed to the reference's own badge, which is the
   * one small object it draws more than any other — `text-2xs` (10px) at
   * `--tracking-label`, `rounded-xs`, and 4px of vertical padding.
   *
   * THE PILL HAD TO GO because a capsule is now the shape of nothing else in
   * the product: buttons are 8px, cards and selects are 10, and a full-radius
   * status badge sitting in a table row was the last capsule on the screen. The
   * caps and the tracking are what carry the label voice; the radius never was.
   */
  "inline-flex shrink-0 items-center gap-1.5 rounded-xs px-2 py-0.5 text-xs font-medium uppercase tracking-label", {
  variants: {
    tone: {
      /**
       * THE DECORATIVE TONES. They say WHICH, never HOW IT IS GOING — success,
       * warn and danger keep the job of meaning, so a decorative chip can never
       * be mistaken for a warning.
       *
       * THE INK IS THE GROUND, NOT WHITE. These three are saturated fills, and
       * on a light app they carried white or near-black by eye. Re-cut for this
       * surface they are all light enough that #1b191a is the only ink that
       * clears AA on them: white on the orange measures 2.3:1.
       *
       * `yellow` IS THE ODD ONE OUT and keeps its name on purpose. It pointed
       * at `--primary` while the primary WAS yellow; the primary is green now,
       * so a tone called `yellow` rendering green would be a badge lying about
       * its own name. It takes the decorative orange — the nearest thing the
       * set still holds — and the name is scheduled to go with the next sweep
       * of its four call sites rather than silently mean something else here.
       */
      yellow: "bg-accent-orange text-neutral-950",
      orange: "bg-accent-orange text-neutral-950",
      pink: "bg-accent-pink text-neutral-950",
      peri: "bg-accent-peri text-neutral-950",
      /**
       * THE STATE TRIOS, EACH INSIDE ITS OWN RING.
       *
       * A 10% wash on #272426 is a very quiet object — quieter than the same
       * wash was on white — so each one takes a 20% ring of its own colour,
       * which is exactly what the reference does with its green badge. Without
       * it a status pill in a table row reads as tinted text with no edge.
       */
      success: "bg-success-soft text-success-ink ring-1 ring-inset ring-brand-soft-line",
      warn: "bg-warn-soft text-warn-ink ring-1 ring-inset ring-warn/25",
      danger: "bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger/25",
      pending: "bg-accent text-muted-foreground",
      brand: "bg-brand-soft text-marker ring-1 ring-inset ring-brand-soft-line",
    },
  },
  defaultVariants: { tone: "pending" },
});

export type StatusPillProps = React.ComponentProps<"span"> &
  VariantProps<typeof pillVariants> & {
    /** A small leading dot in the tone's own colour — for "live" states. */
    dot?: boolean;
  };

export function StatusPill({ className, tone, dot, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(pillVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

/**
 * The quieter cousin: counts, capabilities, keys — facts, not states.
 * Same pill geometry one step smaller, no tone vocabulary to misuse.
 */
export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-xs bg-accent px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { pillVariants };
