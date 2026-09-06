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
  // `rounded-control`, AND THE SHAPE RULE IS DONE MOVING. It went rectangle,
  // then pill, then rectangle again — three sheets, three answers — and the
  // 4 Sep 2026 Figma (docs/superpowers/specs/2026-09-04-retheme-blue-design.md)
  // is recorded as the LAST word specifically so the next flip needs a new
  // design, not a comment: 8px on every button, chip, input, select, tab and
  // the period switch, circles reserved for avatars, badges and dots. The
  // capsule "New flow"/"Refresh all"/"Invite members" drew in the previous
  // sheet is gone with it.
  //
  // The token itself was never the risk — `--radius-control` was 9999px for
  // one commit once and 51 files inherited it, which is how every text field,
  // menu row and small panel went capsule-shaped, and that is why the base
  // class has always spelled its OWN radius rather than deferring to the
  // token. It still does, so a stray global pill-ification can't recur.
  //
  // THE ONE EXCEPTION IS UNCHANGED: a control that WRAPS still passes an
  // explicit `rounded-control` override, which still wins over this base
  // through `cn()` (see lib/utils.ts) — it is simply no longer overriding a
  // different shape.
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
        default: "border border-border bg-card text-foreground shadow-xs hover:bg-accent active:bg-accent",
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
        accent: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        /**
         * THE RECESSED TWIN OF `default`, AND NOW ITS OWN TOKEN.
         *
         * It used to borrow `--control` — the surface a search field or a
         * select sits on — because `--secondary` had no consumer anywhere in
         * the app to prove it out. The 4 Sep 2026 Figma draws these buttons as
         * their own grey (#333333 dark, white-with-a-hairline light), distinct
         * from a field's own fill, so this is the button that finally spends
         * the token that was sitting there unused. `border-input` rather than
         * `border-border`: it is the SAME hairline in the dark theme (`--input`
         * aliases `--border` there) and the Figma's own lighter edge in the
         * light theme, where a white button on an off-white page has no other
         * way to be found.
         */
        secondary: "border border-input bg-secondary text-secondary-foreground shadow-xs hover:bg-accent active:bg-accent",
        /**
         * WHITE, AND LITERALLY #FFFFFF — the one variant that does not go
         * through a role.
         *
         * Every other fill in this file names a token, because a token is what
         * lets the two themes disagree correctly. This one is a fixed value on
         * purpose: it was specified as a colour ("the background of the add
         * button is WHITE #ffffff"), and `--foreground` — the nearest role, and
         * what `default` uses to get a light button on the console — is
         * #E8E6E7. Four counts off white is exactly the near-miss the kit
         * argues against everywhere else, so the honest thing is to say white
         * and mean it rather than to approximate it through a role.
         *
         * It carries `--color-neutral-950` ink at 17.5:1 and keeps the border,
         * which is doing real work in the LIGHT theme: white on a #F7F8F9 page
         * is a 1.03:1 step, so without the hairline the button has no edge at
         * all. On the console the border is invisible against the fill and
         * costs nothing.
         */
        white: "border border-border bg-white text-neutral-950 shadow-xs hover:bg-neutral-50 active:bg-neutral-100",
        /** THE REFERENCE'S OWN BADGE-AS-BUTTON: a 10% brand wash inside a 20%
         *  brand ring, carrying brand ink. On a light page this shape was
         *  impossible in the brand — a yellow wash under yellow ink needs
         *  near-black text, at which point it is not a tinted button but a pale
         *  one — which is why this variant used to be the marker's violet. The
         *  green is 8.88:1 on its own wash. */
        soft: "bg-brand-soft text-marker ring-1 ring-inset ring-brand-soft-line hover:bg-brand-soft/70",
        /** Outlined brand, for a secondary act in a branded flow. */
        outlineAccent: "border border-brand-soft-line bg-transparent text-marker hover:bg-brand-soft",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:brightness-110 active:brightness-95",
        success: "bg-success-soft text-success-ink ring-1 ring-inset ring-brand-soft-line hover:bg-success-soft/70",
        destructiveGhost: "text-muted-foreground hover:bg-danger-soft hover:text-danger-ink",
        destructiveOutline: "border border-danger/30 bg-card text-danger-ink hover:bg-danger-soft",
        link: "text-marker underline-offset-4 hover:underline",
      },
      size: {
        /**
         * ONE CONTROL HEIGHT: 32px, at 14px type.
         *
         * The ladder was 28 / 36 / 44 / 52 when this was a roomy light app.
         * The Figma draws EVERY control at 32 — date picker, selects,
         * segmented groups, buttons — and that number is not decoration: the
         * period control, the inputs and this button all line up in one page
         * header, and 44 beside 32 reads as two systems in one row.
         *
         * THE TYPE DID NOT COME DOWN WITH THE HEIGHTS. `default` shipped at
         * `text-xs` for one commit, on the reasoning that a 32px control is a
         * small control. The Figma is explicit that it is not: its 32px date
         * picker carries 12px because it is a DROPDOWN, and its actual buttons
         * carry 14. 14 on 32 leaves 6px above and below the cap height, which
         * is the proportion the whole interface is set at. Getting this wrong
         * does not read as "the button is small" — it reads as every button in
         * the product sitting a step quieter than the text beside it.
         *
         * `xs` (24px / 12px) IS GONE, 6 Sep 2026. It was the dense row's rung,
         * and it ended up on the three buttons in the dashboard header —
         * "+ Add", the period dropdown and "Refresh all" — where it put them a
         * full 8px shorter and two type steps quieter than the identical-
         * looking buttons in the top bar directly above them. That is the
         * near-miss this table exists to prevent, and it shipped: the owner
         * caught it on the live app. Everything that spelled `xs` now stands
         * at 32, the metric tile's tray included.
         *
         * `sm` AND `default` ARE ONE RUNG, and have been since the heights came
         * down. `sm` also carried `gap-1.5`, which the base class list already
         * sets — a second copy of one value, deleted. Both NAMES survive
         * because ~90 call sites spell one or the other and renaming them all
         * is churn with no rendered difference; what is not allowed is them
         * drifting apart again without an argument written here.
         *
         * `lg` survives at 40 for the landing's hero and for a form that
         * genuinely wants air. Deliberately NOT 44: nothing else in the product
         * is 44 any more, and a lone rung nobody stands on is how the ladder
         * grew a sixth step last time.
         *
         * The three icon rungs are icon-ONLY affordances inside dense rows — a
         * tile menu, a table row, a dialog's dismiss — where a 32px square
         * beside 32px of text crowds the row it sits in. They carry no label,
         * so they are not on this ladder and 32 is not owed to them.
         */
        sm: "h-8 px-3 text-sm [&_svg]:size-4",
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
