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
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Hover walks DOWN the ramp, it does not brighten. `brightness-110` on
        // a 7.19:1 ultramarine lightens it toward the white behind it, so the
        // label's contrast FELL at the one moment the button is under a
        // pointer. Down the ramp is also the direction a real button moves.
        /**
         * BLACK IS THE DEFAULT, and both sheets say so.
         *
         * The first draws every workhorse button in DEEP BLACK — sign in,
         * reserve, the error bar — with yellow reserved for the one hero act on
         * a screen. The second labels its black button "Default" and its violet
         * one "Button". Treating violet as the default read as violet-and-grey
         * and lost the sheet's whole character, which is black carrying the
         * work and colour arriving only where it means something.
         *
         * Black comes through the `foreground` ROLE, not a raw near-black fill:
         * it inverts with the theme, and the kit gate bans that literal.
         */
        default: "bg-foreground text-background shadow-xs hover:bg-neutral-800 active:bg-neutral-700",
        /** NEON YELLOW — the hero act, one per screen. Black ink, because the
         *  yellow is far too bright to carry white and the sheet sets it in
         *  black every time it appears. */
        yellow: "bg-accent-yellow text-neutral-900 shadow-xs hover:brightness-95 active:brightness-90",
        /** VIBRANT VIOLET — the sheet's "Button": the branded action, where a
         *  screen wants the accent rather than the workhorse. */
        accent: "bg-primary text-primary-foreground shadow-xs hover:bg-brand-600 active:bg-brand-700",
        secondary: "border border-border bg-card text-foreground shadow-xs hover:bg-muted active:bg-neutral-200",
        /** The sheet's "Pressed" — a violet wash carrying violet ink. */
        soft: "bg-accent text-accent-foreground hover:bg-brand-100 active:bg-brand-200",
        /** Its "Deject" — outlined violet, for a secondary act in a violet flow. */
        outlineAccent: "border border-brand-300 bg-transparent text-accent-foreground hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-neutral-200",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-danger-ink active:brightness-95",
        success: "bg-success-soft text-success-ink hover:brightness-[0.97]",
        destructiveGhost: "text-muted-foreground hover:bg-danger-soft hover:text-danger-ink",
        destructiveOutline: "border border-red-200 bg-card text-danger-ink hover:bg-danger-soft/60",
        link: "text-accent-foreground underline-offset-4 hover:underline",
      },
      size: {
        /**
         * THE DENSE ROW'S SIZE, and it is a size because it was already being
         * used as one.
         *
         * The metric tile's tray spelled it inline — `size="sm"` plus
         * `className="h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5"`, twice,
         * once for Refresh and once for Open. That is a sixth button geometry
         * invented at a call site, which is exactly the drift `cva` is here to
         * prevent, and the next dense row would have re-typed it slightly
         * differently.
         *
         * It cannot simply become `sm`: at a real tile width (three columns
         * inside 1152px) two 36px-tall buttons push the tray's timestamp into
         * "1 hour …", and the provenance is the half of that row that carries a
         * product rule. So the geometry the tray actually needs is named here
         * once and the override is deleted.
         */
        xs: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
        sm: "h-9 px-3.5 text-sm [&_svg]:size-4",
        default: "h-11 px-5 text-sm [&_svg]:size-[18px]",
        lg: "h-13 px-7 text-md [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-[18px]",
        iconSm: "size-9 [&_svg]:size-4",
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
