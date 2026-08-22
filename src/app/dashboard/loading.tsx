import { ShellSkeleton } from "@/components/shell-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The tile grid's own recipe, so content lands where the shimmer stood rather
 * than jumping when the real page arrives.
 */
export default function DashboardLoading() {
  return (
    <ShellSkeleton>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </ShellSkeleton>
  );
}
