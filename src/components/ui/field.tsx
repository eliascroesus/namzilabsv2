import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The words around a field, so a form reads as one voice: label above,
 * hint or error below. The label margin is the kit's ONE value — it was
 * `mb-1` in four files and `mb-1.5` in two others for the same job.
 */

/**
 * A FIELD LABEL IS A MICRO LABEL, AND THE SHEET SETS THOSE IN CAPS.
 *
 * The same voice as the chips in ui/badge.tsx: 12px, semibold, ALL CAPS,
 * tracking opened up. Caps is what makes a line read as a LABEL — the question
 * asked above the box — rather than as a very small sentence competing with the
 * answer inside it. At 14px sentence case the label and its own value were the
 * same typographic object twice.
 *
 * `tracking-wide` is structural, not decorative: body copy in this app runs at
 * -0.008em (globals.css), and caps set at negative tracking close up into a
 * block. And caps here is `text-transform`, which leaves the DOM text alone —
 * the accessible name a screen reader announces is still the sentence-case
 * string written at the call site.
 *
 * It stays `text-foreground` and semibold on purpose. A label that reads
 * lighter than its own value turns a form into a list of answers to questions
 * nobody can find.
 */
export function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground", className)}
      {...props}
    />
  );
}

// The hint and the error are PROSE, so neither takes the label's caps: two
// shouted lines around one box is a field that looks like a warning. They are
// separated by weight and colour instead, which is the difference that matters.
export function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1 text-xs text-muted-foreground", className)} {...props} />;
}

export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  // role="alert" so the message is announced when it appears, not discovered.
  return <p role="alert" className={cn("mt-1 text-xs font-medium text-danger-ink", className)} {...props} />;
}
