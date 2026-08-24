import { ShellSkeleton, SkeletonRows } from "@/components/shell-skeleton";

export default function ConnectionLoading() {
  return (
    // `narrow` matches connections/[id]/page.tsx's PageContainer — the widest
    // single jump on the page, ~256px, when the real page replaced this one.
    <ShellSkeleton width="narrow">
      <SkeletonRows count={3} className="h-24" />
    </ShellSkeleton>
  );
}
