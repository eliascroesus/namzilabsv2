import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * THE BANNER, ON THE KIT'S STATE TRIOS.
 *
 * `rounded-card` is the same 10px `rounded-lg` resolved to — the pixels do not
 * move, the NAME does, so an Alert and a Card are now visibly one decision
 * instead of two that happen to agree. `shadow-xs` and the explicit border
 * match `ui/card.tsx` for the same reason: an alert is a card that is telling
 * you something.
 *
 * The destructive variant is the real change. It was full-strength
 * `--destructive` ink on a plain white card — the SIGNAL colour used as a text
 * colour, which is the loudest thing on the page and still only tells you
 * something is wrong by shouting. The kit already owns the pair for this:
 * `danger-soft` under `danger-ink`, measured at 5.49:1, and the same two
 * tokens a `StatusPill tone="danger"` and a destructive Button already use. A
 * warning in an alert and a warning in a pill are now the same red.
 */
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-card border px-4 py-3 text-sm shadow-xs has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        destructive:
          // `border-red-200` is the tinted hairline the trio has no token for
          // — the same one `Button variant="destructiveOutline"` draws, and the
          // reason `src/components/ui` is allowlisted for raw tints at all.
          "border-red-200 bg-danger-soft text-danger-ink *:data-[slot=alert-description]:text-danger-ink/90 [&>svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      // `font-semibold`, matching the kit's list-item title. At `font-medium`
      // the heading and the sentence under it were one weight apart on a
      // 14px grid, which is not enough separation to read as a heading at all.
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
