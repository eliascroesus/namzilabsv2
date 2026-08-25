import { ShellSkeleton } from "@/components/shell-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
// NOT from ./CalendarBoard — that module is `"use client"`, and this file is a
// server component, so the import would arrive as a client reference stub and
// stringify a whole function into every day cell's class. See day-cell.ts.
import { DAY_CELL_H } from "./day-cell";

/**
 * The calendar's own shape, held open while the page streams.
 *
 * A generic three-bar skeleton in front of a 7×5 grid is worse than none: the
 * content lands nowhere near where the shimmer stood, so the page appears to
 * jump on arrival. This is the control bar, the summary line and the grid, at
 * the sizes they actually render at — 92px squares, 8px gaps, five rows, which
 * is what every month but a long one starting late comes to.
 */
export default function CalendarLoading() {
  return (
    <ShellSkeleton>
      {/* No lede bar — the h1 stands alone, as it does on every board now. */}
      <Skeleton className="mt-6 h-14 rounded-surface" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-4 rounded-surface border border-border bg-card p-3 shadow-card sm:p-4">
        <div className="grid grid-cols-7 gap-2 pb-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="mx-auto h-3 w-8" />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={i} className={`${DAY_CELL_H} rounded-card`} />
          ))}
        </div>
      </div>
    </ShellSkeleton>
  );
}
