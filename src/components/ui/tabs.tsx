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
 * THE TRACK IS A PILL, AND SO IS THE TAB INSIDE IT.
 *
 * `p-[3px]` became `p-1`. Three pixels is not a step on the 4px grid; it was
 * there so a squarish `rounded-surface` tab could sit inside a squarish
 * `rounded-surface` track without the two corners fighting. At `--radius-control`'s
 * 9999px both are lozenges and the inset is simply breathing room, so it can be
 * a real grid step — which is what puts the active pill's edge on the same
 * rhythm as everything else in the row.
 *
 * The `line` variant keeps its padding at zero: it has no track to inset from,
 * and 4px there pushed the underline 4px clear of the text it underlines.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-control p-1 text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none data-[variant=line]:p-0",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
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
 * So the rule takes `--marker` (4.41:1 light, 6.60:1 dark) and the label takes
 * `accent-foreground`, the marker's ink step, at 6.79:1 — because 4.41 clears
 * the 3:1 a rule owes and falls short of the 4.5:1 a word does.
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
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-control border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--duration-fast) group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-xs group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // ACTIVE, segmented: the brand pill. Near-black on #eecf00 is 11.24:1,
        // comfortably past AA for the 14px semibold label it carries.
        "data-[state=active]:bg-primary data-[state=active]:font-semibold data-[state=active]:text-primary-foreground",
        // ACTIVE, line: no fill at all, so the label takes the marker's INK step
        // rather than the pill's yellow — a word on the page, not an object on
        // it, and yellow has no step that may carry a word.
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-accent-foreground group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent",
        // The line variant's mark, and the one class in this file the rebrand
        // moved. It was `after:bg-primary`, and `after:bg-foreground` before
        // that — a near-black underline said "current" in the same voice as the
        // body text around it, where a brand colour says it as the product.
        //
        // A 2px rule is a STROKE, so the colour that says it is the marker's:
        // the yellow that reads at 11.24:1 as a fill draws at 1.42:1 on the
        // ground, and an indicator carrying state cannot be the one thing on the
        // strip you cannot see. `--tab-underline` in globals.css is the same
        // value for the same reason, one layout up.
        "after:absolute after:bg-marker after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
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
