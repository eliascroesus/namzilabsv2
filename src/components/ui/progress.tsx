"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      // THE TRACK IS A RECESS, NOT A WASH OF THE BAR. It was `bg-primary/20`,
      // which tinted the empty part of the bar with the same hue as the full
      // part, so a bar at 10% and one at 90% differed mostly in saturation — the
      // reading this component exists to give, made harder. `bg-muted` is the
      // kit's word for "surface pushed back", and it is what the bar has to
      // contrast against.
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-accent",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // THE BAR IS THE MARKER, AND IT IS THE ONE FILLED THING IN THE KIT THAT
        // IS NOT THE BRAND.
        //
        // Every other yellow in the product is a fill carrying near-black ink,
        // and the 11.24:1 that makes it work is the INK's ratio, not the shape's.
        // A progress bar carries no ink. The only thing a reader measures is the
        // bar against its own track, and #eecf00 on `--muted` is 1.42:1 — the
        // exact number globals.css names when it says the yellow may only stroke
        // on a dark surface. The marker is 4.41:1 there, past the 3:1 a non-text
        // indicator owes.
        //
        // It measures 2.94:1 on the dark theme's track, a hair under the same
        // bar, and that trade is taken deliberately: a hair under is dim, where
        // 1.42:1 in the theme the product is mostly read in is gone. The top
        // bar's progress arc stays yellow for the mirror-image reason — it is
        // drawn on the charcoal band, where the measurement comes out 8.77:1.
        //
        // `transition-transform`, not `transition-all`: the bar moves by the
        // `translateX` below, and `all` would additionally animate the focus
        // outline of anything inheriting it. On the kit's slow step, because
        // progress is the one thing here that should read as travelling.
        className="h-full w-full flex-1 bg-marker transition-transform duration-(--duration-slow) ease-(--ease-standard)"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
