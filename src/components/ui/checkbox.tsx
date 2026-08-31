"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // CHECKED IS A FILL, so it takes the brand — #eecf00 under the
        // near-black tick at 11.24:1, which is the one shape yellow is allowed
        // to take and the control `--primary` is most obviously for.
        //
        // The checked border goes TRANSPARENT rather than following the fill.
        // Its only job is to retire the resting `border-input` hairline, and a
        // transparent border lets the fill paint through it — backgrounds are
        // clipped to the border box — so the box reads as one solid shape at
        // exactly the size it already was. Spelling it as a yellow LINE would be
        // the half of the split that does not work: #eecf00 draws at 1.55:1 on
        // a white card, so the rim would contribute nothing and would still have
        // to be kept in step with the fill beside it. What says "checked" is the
        // tick, not the box's edge against the page.
        //
        // `rounded-sm` (6px) rather than shadcn's 4px: pill-first softens
        // every corner in the kit, and on a 16px box 6px is as round as this
        // can go before it starts reading as a RADIO. That distinction is
        // load-bearing — the same menu renders both.
        //
        // `bg-card` gives it a fill at rest. It arrived transparent, which on
        // the off-white page read as a hole punched in the surface rather than
        // as an empty box, and shadcn patched only the dark side of that with
        // `dark:bg-input/30`. The token does both.
        //
        // `hover:border-muted-foreground` is the pointer feedback every other
        // control in the kit has; `transition-colors` because what moves is
        // the border and the fill, not the shadow.
        "peer size-4 shrink-0 rounded-xs border border-rule bg-control shadow-xs transition-colors duration-(--duration-fast) hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-transparent data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
