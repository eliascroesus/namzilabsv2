import { ShellSkeleton, SkeletonRows } from "@/components/shell-skeleton";

export default function IntegrationsLoading() {
  return (
    <ShellSkeleton>
      <SkeletonRows count={4} />
    </ShellSkeleton>
  );
}
