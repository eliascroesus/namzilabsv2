"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        // Initials on `--avatar`, THE ONE FILL FOR EVERY AVATAR-SHAPED
        // CIRCLE — this fallback disc and `AvatarGroupCount`'s "+N" disc
        // share it, per the 4 Sep 2026 Figma naming both "avatar / icon
        // circles". The fallback is what most avatars in this product
        // actually render — almost nobody uploads a picture to an internal
        // analytics tool — so treating it as the degraded case left the
        // app's people looking like missing images.
        //
        // `--foreground` carries the initials in BOTH themes: a near-black
        // fill under white ink on dark, a white disc under black ink on
        // light. `border-input` is what actually FINDS the circle in the
        // second case — a white disc on a `#F7F8F9` page has no edge of its
        // own, the same problem every white surface in this kit has — and it
        // costs nothing on dark, where `--input` already aliases `--border`.
        "flex size-full items-center justify-center rounded-full border border-input bg-avatar text-sm font-semibold text-foreground group-data-[size=sm]/avatar:text-xs",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      // A BADGE IS A FILL, so it is the brand — the unread dot globals.css names
      // by that word, at 11.24:1 under the near-black glyph it carries.
      //
      // `ring-background` is what bounds it, and on this hue that ring stopped
      // being decoration: #eecf00 is 1.42:1 against the page, so an 8px disc
      // with no edge is a smudge on the avatar's corner rather than an object
      // sitting over it. The ring is the edge the fill cannot draw for itself.
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        // Same `--avatar` fill AND the same `--input` edge as
        // `AvatarFallback` — one neutral circle for every avatar-shaped
        // thing the kit draws, per the shape rule's "circles only for
        // avatars/badges" clause. `ring-2 ring-background` stays on top of
        // the border: the ring is what separates one overlapping avatar from
        // the next in the stack, a job the 1px edge cannot do on its own.
        "relative flex size-8 shrink-0 items-center justify-center rounded-full border border-input bg-avatar text-sm text-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
}
