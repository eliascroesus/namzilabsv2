import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The shadcn class helper: compose conditional classes, then let
 * tailwind-merge resolve conflicts so the LAST one wins.
 *
 * Without it, `cn("px-4", props.className)` where the caller passes `px-2`
 * produces `px-4 px-2` — two competing declarations whose winner depends on
 * their order in the generated stylesheet, not on the call site. That is how
 * a component "ignores" the override it was handed, and it is the bug this
 * one-liner exists to make impossible.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
