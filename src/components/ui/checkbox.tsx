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
        // CHECKED IS A FILL, so it takes the vibrant violet — this is the
        // control the brand sheet's `--primary` is most obviously for.
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
        // `hover:border-neutral-300` is the pointer feedback every other
        // control in the kit has; `transition-colors` because what moves is
        // the border and the fill, not the shadow.
        "peer size-4 shrink-0 rounded-sm border border-input bg-card shadow-xs transition-colors duration-(--duration-fast) hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
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
