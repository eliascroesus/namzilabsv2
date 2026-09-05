"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * `default` IS AN 8px RECTANGLE TRACK WITH AN 8px RECTANGLE TAB INSIDE IT;
 * `line` HAS NO TRACK AT ALL.
 *
 * `p-[3px]` became `p-1`. Three pixels is not a step on the 4px grid; it was
 * there so a squarish `rounded-surface` tab could sit inside a squarish
 * `rounded-surface` track without the two corners fighting. `--radius-control`
 * is 8px, not the fully round capsule this comment used to claim, so in the
 * `default` variant both track and tab are ordinary rounded rectangles, and
 * the inset is simply breathing room — which is what puts the active tab's
 * edge on the same rhythm as everything else in the row. `line` shares the
 * same `rounded-control` on its own tab (there is still a hover wash to
 * round) but draws no track at all — `bg-transparent`, no border — so it is
 * bare where `default` is enclosed, not the same shape in a different colour.
 *
 * The `line` variant keeps its padding at zero: it has no track to inset from,
 * and 4px there pushed the underline 4px clear of the text it underlines.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-control p-0.5 text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none data-[variant=line]:p-0",
  {
    variants: {
      variant: {
        default: "border border-border bg-control",
        // 24px BETWEEN TABS, which is the reference's own gap and is spent as
        // `gap-6` rather than as padding inside each tab: the underline has to
        // be the width of the WORD, not the width of the word plus its
        // breathing room, or a two-character tab wears a rule twice its length.
        line: "gap-6 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * THE TWO TAB STRIPS, AND WHY THE ACTIVE STATE IS SPELLED IN TWO COLOURS.
 *
 * `default` is the segmented control: a pill slides under the active label.
 * That is a FILLED object, so it is the brand — `--primary` carrying near-black
 * at 11.24:1. `line` is the underlined strip, and everything it draws is the
 * OTHER half of the split: the mark is a 2px rule and the label beside it is a
 * word. Neither may be yellow. #eecf00 measures 1.42:1 as a stroke on the app's
 * ground, which is not dim, it is gone.
 *
 * So the rule takes `--tab-rule` — a grey, not the brand stroke:
 * `--muted-foreground` dark, `--heading` light — and the TEXT carries the
 * emphasis instead, stepping to `--heading` while the tabs beside it stay
 * muted. See the 5 Sep 2026 amendment: a fixed grey rule owes no ramp-step
 * contrast claim the way `--marker` did, so the word is what says SELECTED
 * now, not the line under it.
 *
 * That is the whole rule the rebrand cares about, in one component: fills are
 * yellow, lines and words are violet, and a strip that renders both has to say
 * both.
 *
 * The four class strings below stay as four arguments because Tailwind resolves
 * them by variant count, not by source order: the `line` overrides carry two
 * stacked variants where the base active state carries one, so they win without
 * `!important`. Collapsing them into one string would not change that, but it
 * would hide which group is overriding which.
 */
function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // RESTING. `text-muted-foreground` in both themes replaces shadcn's
        // `text-foreground/60` plus a `dark:` correction — 60% of the near-
        // black is a grey that exists nowhere else in the kit, and naming the
        // real token for dark mode was already conceding the point.
        //
        // `transition-colors`, never `transition-all`: `all` animates the
        // focus outline, so the ring grew into place a beat after the arrow
        // key was pressed. Button spells it this way for the same reason.
        //
        // NOTE WHAT IS GONE: `focus-visible:outline-1 focus-visible:outline-ring`.
        // Focus is declared once in globals.css at 2px with a 2px offset. A
        // second, thinner spelling here meant the tabs rang differently from
        // every other control in the product — the exact drift that rule
        // exists to end.
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-control border border-transparent px-2.5 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--duration-fast) group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-xs group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // ACTIVE, segmented: the brand fill. White on `--primary` (#0070E8) is
        // 4.68:1, clear of the 4.5:1 the label owes.
        "data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-foreground",
        // ACTIVE, line: no fill, and the label goes WHITE.
        //
        // It was the marker's ink step, because a 2px rule at 4.41:1 could not
        // carry the state on its own and the coloured word was helping it. The
        // rule is `--tab-rule` now — a grey, not the brand stroke, since the 5
        // Sep amendment moved the active tab's underline off the marker
        // entirely — so the label carries the state on its own, stepping up
        // the ink ramp to white while the four beside it stay muted. That reads
        // as SELECTED rather than as LINKED, which is what a coloured word says.
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-heading group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent",
        // The line variant's mark, and the one class in this file the rebrand
        // moved. It was `after:bg-primary`, and `after:bg-foreground` before
        // that — a near-black underline said "current" in the same voice as the
        // body text around it, where a brand colour says it as the product.
        //
        // THE LINE VARIANT'S MARK IS NOT THE STROKE ANY MORE. `--marker` drew
        // it through every earlier rebrand, but the 5 Sep 2026 amendment gives
        // the active tab's rule its own role — `--tab-rule` (`--muted-foreground`
        // dark, `--heading` light) — because the Figma draws this rule in grey,
        // not in the brand. `--marker` stays reserved for links, the focus ring
        // and a selected edge, which is what it draws everywhere else in the kit.
        "after:absolute after:bg-tab-rule after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
