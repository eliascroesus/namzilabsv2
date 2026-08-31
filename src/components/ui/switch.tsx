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
        // ON IS THE MARKER, NOT THE BRAND, and this control is the clearest
        // case for the half of the split people get wrong.
        //
        // "Yellow fills" is not the whole rule. Yellow fills WHERE SOMETHING
        // SITS ON IT — a label, a numeral, an icon — because the 11.24:1 it
        // carries against near-black ink is the entire reason it may be a
        // surface at all. A switch track carries nothing. The only ratio a
        // reader ever gets from it is track-against-track, and #eecf00 to the
        // #d6d6d6 off state is 1.07:1: the same LUMINANCE at two hues, which
        // is invisible in greyscale, invisible to a colour-blind reader, and
        // under the 3:1 WCAG 1.4.11 asks of exactly this — a graphical object
        // that carries the state of a control.
        //
        // The marker is 3.31:1 against the same off track. So an indicator with
        // nothing written on it takes the marker, which is the same reading
        // that sends the progress bar, the chart series and the tab's rule
        // there. It costs the product nothing: "on" and "the primary action"
        // being one colour was a tidy sentence, not a requirement, and the two
        // are never adjacent.
        //
        // The knob's 16px of travel is still the signal that survives
        // everything. It is no longer the ONLY one.
        //
        // `neutral-300`, not 200: the off track and the card border beneath it
        // were the same value, so an unchecked switch on a bordered row read as
        // a hairline with a dot on it rather than as a control in its off
        // position. One step down the ramp is all it needs.
        checked ? "bg-marker" : "bg-rule",
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
