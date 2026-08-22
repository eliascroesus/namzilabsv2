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
        "relative shrink-0 rounded-full outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring/40",
        track,
        checked ? "bg-primary" : "bg-neutral-200",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-0.5 rounded-full bg-white shadow-card transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          knob,
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
