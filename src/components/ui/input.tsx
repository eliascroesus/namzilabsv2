import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE FIELD RECIPE. One box, one border, one focus behaviour — the app had
 * twelve input class strings, eight of which had no focus state at all.
 *
 * `focus-visible` (not `focus:`) on purpose: text inputs match
 * `:focus-visible` whenever they hold focus — clicked or tabbed — because
 * they accept keyboard input, so fields always show the ring and buttons
 * only show it to keyboard users. One rule, both behaviours.
 */
const FIELD =
  "w-full rounded-control border border-input bg-card text-base text-foreground transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  // h-9, same as the default Button — a field and its submit sit level.
  return <input className={cn(FIELD, "h-9 px-3", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD, "min-h-20 px-3 py-2", className)} {...props} />;
}

/**
 * The native <select>, dressed as an Input. Native on purpose: the OS picker
 * is better than anything we would hand-roll for plain option lists — the
 * builder's searchable combobox is a different component for a different job.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select className={cn(FIELD, "h-9 appearance-none pl-3 pr-8")} {...props}>
        {children}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export { FIELD as fieldClasses };
