"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-neutral-950/40 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          // A MODAL SURFACE, so it takes the modal shadow — `shadow-panel`,
          // the same rung the Dialog and the Modal sit on. It was `shadow-surface`,
          // one step down, which put the app's largest overlay lower than the
          // dialogs it replaces.
          //
          // The two duration overrides are gone. globals.css already retimes
          // every `[data-state]` entrance to `--duration-base` on the spring
          // curve and every exit to `--duration-fast` on the exit curve; this
          // component was overriding both with 500ms in and 300ms out, so the
          // one panel that covers a third of the screen was also the slowest
          // thing in the product to dismiss. `transition ease-in-out` goes with
          // them: the movement is keyframed by the `slide-*` animations, and a
          // bare `transition` also animates the focus outline into place.
          "fixed z-50 flex flex-col gap-4 bg-card shadow-panel data-[state=closed]:animate-out data-[state=open]:animate-in",
          // THE CORNER FACES THE APP. Only the edge that meets the page is
          // rounded — the three sides flush with the viewport stay square,
          // exactly as `AppFrame` cuts `rounded-l-frame` into the scroll region
          // and leaves the outer edges alone. A sheet rounded on all four
          // corners reads as a card that has drifted off the screen.
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 rounded-l-surface border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 rounded-r-surface border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto rounded-b-surface border-b border-border data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto rounded-t-surface border-t border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          // The Dialog's dismiss, to the class — one close button in the
          // product, not one per overlay primitive.
          <SheetPrimitive.Close className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-muted hover:text-foreground disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      // Sized, where it was not: a bare `font-semibold` inherits whatever the
      // sheet's parent happens to set, so the same title rendered at 14px in
      // one caller and 16px in another. It is a modal title, so it takes the
      // modal title.
      className={cn(
        "text-title font-semibold tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
