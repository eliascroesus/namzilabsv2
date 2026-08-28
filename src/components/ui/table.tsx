import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE TABLE. Three hand-rolled tables disagreed on header size, header
 * colour, row separators (border-t vs divide-y — both in one file) and
 * whether rows answer the pointer. These wrappers are the one answer.
 *
 * ON THE SHEET: the shell is one of the sheet's generous, soft-cornered
 * islands — a white plane on the off-white page, leaning on its FILL and a
 * hairline rather than on elevation — and the header row is the sheet's micro
 * voice, ALL CAPS at 12px with wide tracking. That voice is not decoration: a
 * column head and a cell value are different KINDS of thing, and caps says so
 * without spending a second colour or a second size on it.
 */

export function TableShell({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // Spelled exactly like `Card`'s `surface` variant — rounded-surface,
      // hairline, shadow-xs — because that is what this is: the same island
      // with rows in it. It used to sit a rung higher (`shadow-card`), so a
      // table and the card beside it floated at two different heights on one
      // page, which is the drift this kit keeps having to undo.
      className={cn("overflow-x-auto rounded-surface border border-border bg-card shadow-xs", className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full text-left text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        // FULL-STRENGTH muted, not the old /50. The page is off-white now and
        // `--muted` IS that colour, so the wash reads as a recessed strip on
        // the white card the table lives in; at half alpha it composited to
        // #fafafa and the header had no surface of its own at all.
        //
        // The hairline is the other half: `TBody` divides BETWEEN rows, so the
        // head/body joint was the one unlined seam in the table and the first
        // row read as part of the header block.
        "border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  // The weight lives HERE and not on `THead`, because the browser's own
  // stylesheet declares `th { font-weight: bold }` directly on the cell, and a
  // directly-declared UA value beats an INHERITED author one however specific
  // the ancestor rule is. Set on the thead alone, the caps rendered at 700 —
  // one notch heavier than every other micro label in the kit.
  return <th className={cn("px-4 py-3 font-semibold", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

/** Rows answer the pointer by default; pass `static` for pure-display rows. */
export function TR({ className, static: isStatic, ...props }: React.ComponentProps<"tr"> & { static?: boolean }) {
  return (
    <tr
      className={cn(
        // `bg-muted`, not `bg-muted/40`: every table in the app sits on a white
        // card, and 40% of the recessed wash over white is #fbfbfb — a hover
        // state you cannot see is the same as not having one.
        !isStatic && "transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  // 16px/12px, which is the sheet's rhythm AND the geometry the loading
  // skeletons were already drawn at (`px-4 py-3` in activity/loading.tsx).
  // The cells were px-3 py-2.5, so every route with a skeleton in front of a
  // table shifted its rows by a few pixels the moment the data arrived —
  // precisely the jank a skeleton exists to prevent.
  return <td className={cn("px-4 py-3", className)} {...props} />;
}
