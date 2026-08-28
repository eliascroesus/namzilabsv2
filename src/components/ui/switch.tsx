"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE SWITCH. There were three hand-rolled copies of this control, all
 * carrying the same inline transition string, one with a knob offset sized
 * for a different track. This is the only one.
 *
 * Both sizes travel exactly 16px, so the spring reads identically wherever
 * the switch appears. Transform, not `left`: it composites instead of
 * relayouting, and reduced-motion users get the state change without the
 * journey via the media query in globals.css.
 */
export type SwitchProps = Omit<React.ComponentProps<"button">, "children"> & {
  checked: boolean;
  size?: "default" | "sm";
};

export function Switch({ className, checked, size = "default", disabled, ...props }: SwitchProps) {
  const track = size === "sm" ? "h-5 w-9" : "h-6 w-10";
  const knob = size === "sm" ? "size-4" : "size-5";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        // Focus comes from the shared rule in globals.css — see button.tsx.
        "relative shrink-0 rounded-full transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        track,
        // THE SMALL SWITCH IS 20px TALL, AND WCAG 2.2 AA WANTS 24.
        //
        // Measured in a headless browser, not guessed: the `sm` track renders
        // 36×20, which fails SC 2.5.8 (Target Size, Minimum) on height — and it
        // is the control that turns a flow on and off, so it is one of the most
        // consequential taps in the product.
        //
        // Growing the track would break the switch's proportions and the 16px
        // knob travel both sizes share. A pseudo-element instead: invisible,
        // out of the layout, and it extends the HIT AREA to 24px without moving
        // a pixel of the design. The larger switch is already 24 and needs none.
        //
        // `-inset-y-0.5` (2px above and below a 20px track) rather than the
        // more obvious `top-1/2 h-6 -translate-y-1/2`: Tailwind v4 emits
        // translate utilities as the standalone `translate` property, which a
        // pseudo-element here did not compose — verified in a browser, where
        // the probe found `transform: none` and the hit area was still 20px.
        // Insets need no transform at all, so there is nothing to compose.
        size === "sm" && "before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']",
        // ON IS THE SHEET'S VIBRANT VIOLET, and it is reached through the
        // `primary` ROLE rather than `bg-brand-500`. Two reasons: the role is
        // what inverts with the theme, and it is the very same fill the primary
        // Button takes — so "this is on" and "this is the action" are ONE
        // colour in the product rather than two violets that nearly match.
        //
        // `neutral-300`, not 200: the off track and the card border beneath it
        // were the same value, so an unchecked switch on a bordered row read as
        // a hairline with a dot on it rather than as a control in its off
        // position. One step down the ramp is all it needs.
        checked ? "bg-primary" : "bg-neutral-300",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-0.5 rounded-full bg-white shadow-card transition-transform duration-(--duration-base) ease-(--ease-spring)",
          knob,
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
