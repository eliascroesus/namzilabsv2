import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE TABLE. Three hand-rolled tables disagreed on header size, header
 * colour, row separators (border-t vs divide-y — both in one file) and
 * whether rows answer the pointer. These wrappers are the one answer.
 */

export function TableShell({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("overflow-x-auto rounded-surface border border-border bg-card shadow-card", className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full text-left text-base", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead className={cn("bg-muted/50 text-micro uppercase tracking-wide text-muted-foreground", className)} {...props} />
  );
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("px-3 py-2 font-medium", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

/** Rows answer the pointer by default; pass `static` for pure-display rows. */
export function TR({ className, static: isStatic, ...props }: React.ComponentProps<"tr"> & { static?: boolean }) {
  return <tr className={cn(!isStatic && "transition-colors hover:bg-muted/40", className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5", className)} {...props} />;
}
