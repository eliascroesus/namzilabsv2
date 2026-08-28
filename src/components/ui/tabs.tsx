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
 * THE TWO TAB STRIPS, AND WHY THE VIOLET IS SPELLED TWICE.
 *
 * `default` is the segmented control: a violet pill slides under the active
 * label, which is a FILL, so it takes `--primary` (the vibrant 500) with white
 * on it. `line` is the underlined strip: the mark is a 2px rule that takes the
 * 500 as well — also a fill — but the LABEL beside it is text, and text cannot
 * have the 500. Brand-500 measures 4.42:1 on our off-white, under AA. So the
 * line variant's active label is `accent-foreground`, the 700, at 6.79:1.
 *
 * That is the whole rule the brand sheet cares about: fills take the 500, words
 * take the 700, and a component that renders both has to say both.
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
        // ACTIVE, segmented: the violet pill. White on brand-500 is 4.81:1,
        // which clears AA for the 14px semibold label it carries.
        "data-[state=active]:bg-primary data-[state=active]:font-semibold data-[state=active]:text-primary-foreground",
        // ACTIVE, line: no fill at all, and the label takes the READABLE
        // violet rather than the pill's.
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-accent-foreground group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent",
        // The line variant's mark. `after:bg-primary` where it was
        // `after:bg-foreground`: a near-black underline says "current" in the
        // same voice as the body text around it, where the brand colour says
        // it as the product.
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
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
