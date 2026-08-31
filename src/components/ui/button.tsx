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
    //
  // `rounded-control`, NOT `rounded-full`, AND THE KIT'S SHAPE RULE INVERTED
  // WITH IT. "Everything pressable is a full pill" was the rule, and it came
  // from a brand sheet that pilled its buttons and chips. The reference this
  // interface is now drawn from has no capsule anywhere except an avatar and a
  // status dot: its buttons are 8px, its badges 4px, its selects and cards
  // 10px. A pill among them reads as a control borrowed from another product,
  // and it was also the shape that forced the one exception the old rule
  // needed — a control that WRAPS cannot be a pill, because a full radius on a
  // two-line box renders as a circle around the words. There is no exception
  // now; every pressable thing is a rounded rectangle.
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
        default: "border border-border bg-card text-foreground shadow-xs hover:bg-neutral-700 active:bg-neutral-700",
        /**
         * THE BRAND — the act the screen exists for, in yellow under near-black
         * ink at 11.24:1.
         *
         * THERE WAS A `yellow` VARIANT HERE AND IT HAS GONE, which is the whole
         * rebrand expressed in one deletion. It existed because the primary was
         * violet and the hero act needed a colour the primary could not give it,
         * so the kit carried two names for "the loudest button on the screen"
         * and every call site chose between them by feel. Yellow IS the primary
         * now, so `yellow` and `accent` resolved to the same object under two
         * spellings — the exact drift this file's own header argues against, and
         * the reason `check:ui` bans a second spelling of anything.
         *
         * Hover walks DOWN the ramp rather than brightening, and on this hue
         * that is not a stylistic preference: `brightness-95` on a yellow moves
         * it toward the white behind it, so the label's contrast FELL at the one
         * moment the button was under a pointer.
         */
        accent: "bg-primary text-primary-foreground shadow-xs hover:bg-brand-500 active:bg-brand-700",
        /** The recessed twin of `default` — a control sitting ON a card, where
         *  the card's own colour would give the button no edge to be found by. */
        secondary: "border border-border bg-control text-foreground shadow-xs hover:bg-neutral-700 active:bg-neutral-700",
        /** THE REFERENCE'S OWN BADGE-AS-BUTTON: a 10% brand wash inside a 20%
         *  brand ring, carrying brand ink. On a light page this shape was
         *  impossible in the brand — a yellow wash under yellow ink needs
         *  near-black text, at which point it is not a tinted button but a pale
         *  one — which is why this variant used to be the marker's violet. The
         *  green is 8.88:1 on its own wash. */
        soft: "bg-brand-soft text-marker ring-1 ring-inset ring-brand-soft-line hover:bg-brand-soft/70",
        /** Outlined brand, for a secondary act in a branded flow. */
        outlineAccent: "border border-brand-soft-line bg-transparent text-marker hover:bg-brand-soft",
        ghost: "text-muted-foreground hover:bg-neutral-700 hover:text-foreground active:bg-neutral-700",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:brightness-110 active:brightness-95",
        success: "bg-success-soft text-success-ink ring-1 ring-inset ring-brand-soft-line hover:bg-success-soft/70",
        destructiveGhost: "text-muted-foreground hover:bg-danger-soft hover:text-danger-ink",
        destructiveOutline: "border border-red-200 bg-card text-danger-ink hover:bg-danger-soft",
        link: "text-marker underline-offset-4 hover:underline",
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
        /**
         * EVERY RUNG CAME DOWN, AND `default` IS THE REFERENCE'S 32px.
         *
         * The ladder was 28 / 36 / 44 / 52, cut for a roomy light app. The
         * reference draws EVERY control — its date picker, its selects, its
         * segmented groups — at exactly 32, and that number is not decoration:
         * the period track, the inputs and this button all have to line up in a
         * page header, and 44 beside 32 is the near-miss that reads as two
         * systems in one row.
         *
         * `lg` survives at 40 for the landing's hero and for a form that
         * genuinely wants air. It is deliberately NOT 44: nothing else in the
         * product is 44 any more, and a lone rung nobody else stands on is how
         * the ladder grew a sixth step last time.
         */
        /**
         * THE HEIGHTS CAME DOWN; THE TYPE SHOULD NOT HAVE COME WITH THEM.
         *
         * `default` shipped at `text-xs` for one commit, on the reasoning that a
         * 32px control is a small control. The reference says otherwise and is
         * explicit about it: its 32px date picker carries 12px because it is a
         * DROPDOWN — a compact control in a header — and its actual buttons
         * carry 14px. 14 on 32 leaves 6px above and below the cap height, which
         * is the proportion the whole interface is set at.
         *
         * The visible effect of getting this wrong is not "the button is small",
         * it is that every button in the product reads a step quieter than the
         * body text beside it, and the whole screen feels shrunk.
         */
        /**
         * `sm` IS 32px, WHICH IS `default`'s HEIGHT, AND THAT IS THE POINT.
         *
         * It was 28. Measured across a rendered page the app was running EIGHT
         * control heights — 48, 40, 36, 32, 28, 26, 24, 18 — and 28-beside-32
         * was the worst of them, because it is a near-miss: two buttons in one
         * row, four pixels apart, which reads as a rendering fault rather than
         * as a size choice. `sm` is used ~40 times and every one of those is a
         * console control that should stand at the console's height.
         *
         * The two names survive because the CALL SITES mean different things by
         * them and one of them will grow a real difference again (a dense table
         * row is a genuine case). What is not allowed is them differing by four
         * pixels with nothing to say about why.
         */
        xs: "h-6 gap-1 px-2 text-xs [&_svg]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-sm [&_svg]:size-4",
        default: "h-8 px-3 text-sm [&_svg]:size-4",
        lg: "h-10 px-4 text-sm [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-[18px]",
        iconSm: "size-7 [&_svg]:size-4",
        iconXs: "size-6 [&_svg]:size-3.5",
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
