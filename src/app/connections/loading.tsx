import { ShellSkeleton, SkeletonRows } from "@/components/shell-skeleton";

export default function ConnectionLoading() {
  return (
    <ShellSkeleton>
      <SkeletonRows count={3} className="h-24" />
    </ShellSkeleton>
  );
}
