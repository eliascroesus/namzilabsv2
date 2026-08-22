import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The words around a field, so a form reads as one voice: label above,
 * hint or error below. The label margin is the kit's ONE value — it was
 * `mb-1` in four files and `mb-1.5` in two others for the same job.
 */

export function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-base font-semibold text-foreground", className)} {...props} />;
}

export function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1 text-tiny text-muted-foreground", className)} {...props} />;
}

export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  // role="alert" so the message is announced when it appears, not discovered.
  return <p role="alert" className={cn("mt-1 text-tiny font-medium text-danger-ink", className)} {...props} />;
}
