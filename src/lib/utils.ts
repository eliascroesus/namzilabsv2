import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * TAILWIND-MERGE, TAUGHT OUR TYPE SCALE.
 *
 * This is not a nicety — without it the merger silently deletes colours.
 *
 * tailwind-merge resolves `text-*` by asking "is this a known font size?" and
 * treating anything else as a text COLOUR. It ships Tailwind's default scale
 * (xs/sm/base/lg/xl…), and the steps this kit adds on top of it — `md`, the
 * four `display-*` rungs, `banner` — are not in that list. So a size it does
 * not recognise looks to it like a second COLOUR, and it drops the first:
 * `cn("text-primary-foreground", "text-md")` returned only `text-md`, which is
 * how the builder's primary buttons ended up rendering BLACK text on the accent
 * blue. Nothing in the source looked wrong, because nothing in the source was
 * wrong.
 *
 * Registering the scale here fixes every instance at once and stops the next
 * one happening. Pinned by tests/cn-merge.test.ts.
 *
 * THE LIST HAS TO TRACK `@theme` IN BOTH DIRECTIONS. A size missing from it
 * eats colours, as above; a size that lingers in it after the token is deleted
 * is worse, because `cn()` then treats a dead class as a live font size and
 * resolves conflicts in favour of a class that compiles to nothing at all.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      /**
       * ONE SPELLING PER SIZE, matching the scale in globals.css.
       *
       * `xs`/`sm`/`lg`/`xl` are already in tailwind-merge's own default
       * font-size group, so they need no help — but `md`, the four `display-*`
       * steps and `banner` are NOT stock Tailwind sizes. Anything missing from
       * this list is treated as a text COLOUR and silently eats the colour
       * before it, which is the bug in this file's header.
       *
       * The eight legacy names (micro/tiny/small/base/lead/title/display/stat,
       * plus hero) were here while the app carried both spellings. They are
       * gone from the theme, so they are gone from here: leaving a dead name in
       * this list would make `cn()` quietly accept a class that now compiles to
       * nothing, which is the one thing the gate is supposed to make visible.
       */
      "font-size": [{ text: ["md", "display-xs", "display-sm", "display-md", "display-lg", "banner"] }],
      /**
       * THE KIT'S RADIUS NAMES, FOR EXACTLY THE SAME REASON AS THE SIZES.
       *
       * tailwind-merge did not know `control`, `card`, `surface` or `frame`, so
       * it could not see that `rounded-control` and `rounded-full` are the same
       * DECISION. Both survived the merge, and the winner was decided by their
       * order in the generated stylesheet rather than by the call site — which
       * means a component could not override the pill on `buttonVariants`' base
       * at all.
       *
       * That is not hypothetical: the page title is a Button that wraps, and a
       * full radius on a two-line box is half its height, so it rendered as a
       * grey CIRCLE around the words. `rounded-control` was passed, ignored,
       * and nothing anywhere reported it.
       *
       * The workaround already in the tree is the arbitrary spelling —
       * `rounded-[var(--radius-control)]` in top-bar.tsx — which tailwind-merge
       * understands because it looks like a value. Registering the names is the
       * fix that spelling was standing in for.
       */
      rounded: [{ rounded: ["control", "card", "surface", "frame"] }],
    },
  },
});

/**
 * The shadcn class helper: compose conditional classes, then let
 * tailwind-merge resolve conflicts so the LAST one wins.
 *
 * Without it, `cn("px-4", props.className)` where the caller passes `px-2`
 * produces `px-4 px-2` — two competing declarations whose winner depends on
 * their order in the generated stylesheet, not on the call site. That is how
 * a component "ignores" the override it was handed, and it is the bug this
 * one-liner exists to make impossible.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
