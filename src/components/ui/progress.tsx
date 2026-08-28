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
      // THE TRACK IS A RECESS, NOT A FAINT VIOLET. `bg-primary/20` tinted the
      // empty part of the bar with the same hue as the full part, so a bar at
      // 10% and one at 90% differed mostly in saturation — the reading this
      // component exists to give, made harder. `bg-muted` is the kit's word for
      // "surface pushed back", and it is what the fill has to contrast against.
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // A FILL, so it takes the vibrant violet at full strength.
        //
        // `transition-transform`, not `transition-all`: the bar moves by the
        // `translateX` below, and `all` would additionally animate the focus
        // outline of anything inheriting it. On the kit's slow step, because
        // progress is the one thing here that should read as travelling.
        className="h-full w-full flex-1 bg-primary transition-transform duration-(--duration-slow) ease-(--ease-standard)"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
