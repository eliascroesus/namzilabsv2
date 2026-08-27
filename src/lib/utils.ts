import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * TAILWIND-MERGE, TAUGHT OUR TYPE SCALE.
 *
 * This is not a nicety — without it the merger silently deletes colours.
 *
 * tailwind-merge resolves `text-*` by asking "is this a known font size?" and
 * treating anything else as a text COLOUR. It ships Tailwind's default scale
 * (xs/sm/base/lg/xl…), and ours is `micro tiny small lead title display`. So
 * `cn("text-primary-foreground", "text-lead")` looked to it like two colours
 * in a row, and it dropped the first — which is how the builder's primary
 * buttons ended up rendering BLACK text on the accent blue: `Test flow` and
 * `Edit output` both pass `text-lead`, and both lost `text-primary-foreground`
 * on the way through `cn()`. Nothing in the source looked wrong, because
 * nothing in the source was wrong.
 *
 * Registering the scale here fixes every instance at once and stops the next
 * one happening. Pinned by tests/cn-merge.test.ts.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      /**
       * BOTH SPELLINGS, because both compile.
       *
       * `xs`/`sm`/`lg` and friends are already in tailwind-merge's own default
       * font-size group, so they need no help — but `md`, `display-xs` and the
       * rest of Untitled UI's scale are NOT stock Tailwind sizes, and the eight
       * legacy names survive as aliases while the app is migrated surface by
       * surface. Anything missing from this list is treated as a text COLOUR
       * and silently eats the colour before it.
       */
      "font-size": [
        {
          text: [
            "md",
            "display-xs",
            "display-sm",
            "display-md",
            "display-lg",
            "micro",
            "tiny",
            "small",
            "lead",
            "title",
            "display",
            "stat",
            "hero",
            "banner",
          ],
        },
      ],
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
