"use client"

import * as React from "react"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * THE MENU LANGUAGE — written down here because four files speak it.
 *
 * This menu, the Select, the Popover and the Command palette are one surface
 * wearing four behaviours, and they arrived from shadcn as four slightly
 * different ones: `rounded-md` panels at `shadow-md`, `rounded-sm` rows, a
 * sentence-case section label. Three near-misses that no single component looks
 * responsible for, which is exactly how the app got thirteen radii the first
 * time.
 *
 * The kit's answer, and the shape every one of them now takes:
 *
 *   PANEL   `rounded-surface border border-border bg-popover p-1.5 shadow-surface`
 *           — the 16px surface step, the ring-free shadow twin (it draws a real
 *           border, so the ringed rung would double the hairline), and 6px of
 *           padding so a pill row's round end clears the panel's own corner.
 *   ROW     `rounded-control px-3 py-1.5` — `--radius-control` is 9999px now,
 *           so a menu row is a LOZENGE. That is the brand sheet's first
 *           instruction and the reason `px-3` rather than shadcn's `px-2`: at
 *           full round, 8px of inset puts the first glyph inside the curve.
 *   ACTIVE  `bg-accent text-accent-foreground` — the violet wash carrying the
 *           violet INK. Not `--primary`: brand-500 is 4.42:1 on our off-white
 *           and fails AA as text. Fills take the 500, words take the 700.
 *   LABEL   `text-micro font-semibold uppercase tracking-wide` — the same
 *           micro label the rail's section headings and every `StatusPill` use.
 *
 * Kept as prose rather than a shared constant on purpose: these are four
 * vendored files that `shadcn add --overwrite` can replace one at a time, and a
 * const imported from a fifth would survive the re-add while the component
 * around it silently reverted. The words are here so the next reader can see
 * what a reverted file no longer says.
 */

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          // PANEL. See the menu-language note at the top of this file.
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-surface border border-border bg-popover p-1.5 text-popover-foreground shadow-surface data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        // ROW + ACTIVE. The destructive row takes the kit's danger trio —
        // `danger-soft` under `danger-ink` — rather than shadcn's
        // `destructive/10` wash under full-strength `destructive`: the trio is
        // the pair the app already uses for a destructive Button, an Alert and
        // a StatusPill, and it is the one measured for contrast (5.49:1).
        "relative flex cursor-default items-center gap-2 rounded-control px-3 py-1.5 text-sm select-none transition-colors duration-(--duration-fast) focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-danger-ink data-[variant=destructive]:focus:bg-danger-soft data-[variant=destructive]:focus:text-danger-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-danger-ink!",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        // CHECKED IS NOT ONLY A COLOUR. The violet tick says "on", and the
        // weight says it again for anyone who cannot see the difference between
        // a 6.79:1 violet and a 16.43:1 near-black — which on a list of eight
        // rows is the whole state of the menu.
        "relative flex cursor-default items-center gap-2 rounded-control py-1.5 pr-3 pl-8 text-sm select-none transition-colors duration-(--duration-fast) focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:font-semibold data-[state=checked]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-3.5 items-center justify-center text-accent-foreground">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        // Same selected treatment as the checkbox row — one menu, one way of
        // saying "this is the one you picked".
        "relative flex cursor-default items-center gap-2 rounded-control py-1.5 pr-3 pl-8 text-sm select-none transition-colors duration-(--duration-fast) focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:font-semibold data-[state=checked]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-3.5 items-center justify-center text-accent-foreground">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        // LABEL. A menu's section heading is a LABEL, not a very small
        // sentence — so it is set the way every other micro label in the
        // product is: caps, tracked, muted. shadcn shipped it at `text-sm
        // font-medium`, the same size and nearly the same weight as the ROWS
        // beneath it, which is why a shadcn menu reads as a flat list with a
        // dead first item instead of as a titled group.
        "px-3 pt-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      // Bled to the panel's edge, so the negative margin has to track the
      // panel's `p-1.5`. At the old `-mx-1` it stopped 2px short of both sides
      // and read as a short rule floating in the middle of the menu.
      className={cn("-mx-1.5 my-1.5 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-micro tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        // An OPEN sub-trigger holds the active wash for as long as its
        // submenu is up — the row stays lit as the thing you are inside.
        "flex cursor-default items-center gap-2 rounded-control px-3 py-1.5 text-sm select-none transition-colors duration-(--duration-fast) focus:bg-accent focus:text-accent-foreground data-[inset]:pl-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        // The same PANEL as the root menu. It was a rung higher (`shadow-lg`
        // against `shadow-md`), which floated a submenu above the menu it
        // belongs to; they are one surface at one height.
        "z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-surface border border-border bg-popover p-1.5 text-popover-foreground shadow-surface data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
