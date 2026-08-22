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
const pillVariants = cva("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-semibold", {
  variants: {
    tone: {
      success: "bg-success-soft text-success-ink",
      warn: "bg-warn-soft text-warn-ink",
      danger: "bg-danger-soft text-danger-ink",
      pending: "bg-muted text-muted-foreground",
      brand: "bg-accent text-accent-foreground",
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
        "inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-tiny font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { pillVariants };
