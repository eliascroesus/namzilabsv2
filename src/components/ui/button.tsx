import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
/**
 * The LEAF package, not the `radix-ui` barrel.
 *
 * `import { Slot } from "radix-ui"` re-exports Dialog, DropdownMenu and every
 * other primitive through one entry point — all of them `"use client"`. This
 * file is deliberately NOT a client component (see below), and pulling that
 * barrel in would drag the whole of Radix into the server graph behind the
 * most-imported component in the app. `@radix-ui/react-slot` carries no
 * directive and does nothing but clone its child.
 */
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/**
 * THE BUTTON. Every clickable thing in the product comes from here.
 *
 * Before this there were roughly a dozen hand-written button class strings —
 * `.btn-brand`, three variations of a bordered secondary, two greys, a red,
 * and an icon button re-declared in five files. They drifted (different radii,
 * different disabled treatments, three different focus behaviours) because
 * nothing forced them together, and drifted class strings are most of what
 * "looks unfinished" actually is.
 *
 * `cva` makes the variants data rather than prose, so a new one is a line in a
 * table instead of a new string somewhere. Deliberately NOT a client
 * component: it holds no state and calls no hooks, so it renders inside server
 * components too — which is where half the app's buttons live (forms posting
 * to server actions).
 */
const buttonVariants = cva(
  // Shared. NOTE what this no longer carries: an outline reset and a
  // focus-ring spelling of its own.
  //
  // Focus is decided ONCE, in globals.css, by a zero-specificity
  // `:where(a, button, summary, …):focus-visible` outline, so every control in
  // the product shows the SAME ring. That was the actual problem: buttons rang
  // at /40, fields at /25, the rail in white, and four controls had no focus
  // state at all — 122 hand-written copies of one idea. A component that
  // re-spells the ring can drift from it, and an outline reset here would
  // switch the shared rule off for the most-focused element in the app.
  //
  // `transition-colors`, not `transition-all`: `all` animates the outline too,
  // so the focus ring grew into place a beat after the key was pressed.
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-semibold transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Hover walks DOWN the ramp, it does not brighten. `brightness-110` on
        // a 7.19:1 ultramarine lightens it toward the white behind it, so the
        // label's contrast FELL at the one moment the button is under a
        // pointer. Down the ramp is also the direction a real button moves.
        default: "bg-primary text-primary-foreground hover:bg-brand-700 active:bg-brand-800",
        secondary: "border border-border bg-card text-foreground hover:bg-muted active:bg-neutral-200",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-neutral-200",
        destructive: "bg-destructive text-destructive-foreground hover:bg-danger-ink active:brightness-95",
        // Running something is a different KIND of act from publishing it, and
        // Make/Zapier both give it its own colour rather than a second grey.
        success: "bg-success-soft text-success-ink hover:brightness-[0.97]",
        // A destructive action that is not the point of the screen: quiet
        // until hovered, then unmistakable.
        // Rest was `text-neutral-400` — 2.53:1, and globals.css marks that token
        // "decorative / disabled only — never text". It was carrying real labels
        // ("Revoke", "Delete role", "Remove") at 13px semibold. Hover was no
        // better: destructive-on-red-50 measures 4.34:1. Both states now come
        // from the danger trio — 5.68:1 at rest, 5.49:1 on hover.
        destructiveGhost: "text-muted-foreground hover:bg-danger-soft hover:text-danger-ink",
        // The bordered delete: present enough to find, calm enough to sit
        // beside content. Confirm steps and inline "Disconnect"s live here.
        destructiveOutline: "border border-red-200 bg-card text-danger-ink hover:bg-danger-soft/60",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-2.5 text-small [&_svg]:size-3.5",
        default: "h-9 px-4 text-base [&_svg]:size-4",
        lg: "h-10 px-5 text-lead [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
        iconSm: "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /**
     * Render the CHILD as the button instead of emitting a `<button>`.
     *
     * The kit's answer to "a link that looks like a button" has been
     * `className={buttonVariants({ variant })}` on an `<a>` — 23 call sites
     * composing a class string by hand. That works, but it is the same
     * component expressed two ways, and only one of them gets a new prop when
     * `Button` grows one.
     *
     * It is also what the vendored Radix components need: `<DialogClose
     * asChild><Button/></DialogClose>` hands the trigger's behaviour DOWN to
     * whatever it wraps, and that only composes if this can do the same.
     */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
