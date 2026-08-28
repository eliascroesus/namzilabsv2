"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      // `text-foreground` added, and it is not cosmetic: this Label is used
      // beside a Checkbox inside menus, popovers and panels that set a muted
      // colour on their container, so with nothing declared the choice's own
      // name inherited the caption grey and came out quieter than the caption
      // under it. A label names a control; it is body text.
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
