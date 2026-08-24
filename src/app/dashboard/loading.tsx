import { ShellSkeleton } from "@/components/shell-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The board's own recipe, so content lands where the shimmer stood rather than
 * jumping when the real page arrives. That is the whole job of a skeleton and
 * the only way it can fail: this one was three half-height bars in two columns
 * in front of a board that is a filter island, a caption and three columns of
 * tall tiles.
 *
 * Note this is the FIRST-LOAD skeleton only. Switching range or source no
 * longer comes through here — `TileArea` swaps in tile-shaped placeholders in
 * place, without unmounting the page (see board-controls.tsx).
 */
export default function DashboardLoading() {
  return (
    <ShellSkeleton>
      <Skeleton className="mt-3 h-4 w-96" />
      <Skeleton className="mt-6 h-14 rounded-surface" />
      <Skeleton className="mt-3 h-3 w-64" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-surface" />
        ))}
      </div>
    </ShellSkeleton>
  );
}
