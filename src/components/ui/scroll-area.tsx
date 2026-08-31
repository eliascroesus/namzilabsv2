"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // NO FOCUS SPELLING HERE. Radix gives this viewport `tabindex="0"`
        // when its content overflows — which is correct, a scroll region must
        // be reachable by keyboard — and that means the shared
        // `:where(…[tabindex]:not([tabindex="-1"])):focus-visible` rule in
        // globals.css already covers it. shadcn's `focus-visible:outline-1`
        // was a second, thinner ring for one element.
        //
        // `rounded-[inherit]` stays: it takes the corner of whatever it is
        // clipping rather than naming a radius that could drift from its
        // parent's.
        className="size-full rounded-[inherit]"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        // The same thumb as `.quiet-scroll` in globals.css, which is what every
        // NATIVE scroller in the app draws: neutral-300 at rest, neutral-400
        // under the pointer. It was `bg-border` — neutral-200, a full step
        // lighter — so the one overlay-scrolled region in the product had a
        // fainter scrollbar than the sidebar beside it.
        className="relative flex-1 rounded-full bg-rule transition-colors duration-(--duration-fast) hover:bg-muted-foreground"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
