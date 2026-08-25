import { ShellSkeleton } from "@/components/shell-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The feed's own shape: the filter island, then one table card whose head and
 * rows stand where the real ones land. A generic three-bar skeleton in front of
 * a fifty-row table is worse than none — the content arrives nowhere near where
 * the shimmer stood, which is the single thing a skeleton exists to prevent.
 *
 * Twelve rows rather than fifty: below the fold nobody sees the difference, and
 * fifty shimmering bars is a page that looks like it is doing something heavy.
 */
export default function ActivityLoading() {
  return (
    <ShellSkeleton>
      <Skeleton className="mt-6 h-12 rounded-surface" />
      <div className="mt-4 overflow-hidden rounded-surface border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>
      </div>
    </ShellSkeleton>
  );
}
