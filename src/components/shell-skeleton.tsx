import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * THE SHELL, HELD OPEN WHILE A PAGE STREAMS.
 *
 * Every authenticated route renders inside AppShell — a full-height rail, then
 * a column carrying the bar and the panel. The root `loading.tsx` cannot know
 * that, so a navigation into one of those routes used to blank the whole
 * viewport and then paint the chrome back.
 *
 * IT IS A ROW NOW, NOT A COLUMN, and this file has to turn with the frame or
 * it is worse than useless: a mirror of the WRONG shape means the rail's ghost
 * starts 60px down, the real rail lands at zero, and the whole page jumps at
 * hydration — the precise failure this file exists to prevent, caused by the
 * file meant to prevent it. See `app-frame.tsx` for why the shape reversed.
 *
 * All three bands are deliberately empty rather than skeletons of themselves:
 * the real chrome is about to occupy them.
 *
 * `tests/page-width.test.ts` pins this against `app-frame.tsx`, `top-bar.tsx`
 * and `sidebar.tsx` class-for-class — it is the only thing that keeps a
 * hand-copied mirror honest, and it has already caught two drifts.
 */
export function ShellSkeleton({
  width = "default",
  children,
}: {
  /** Mirrors PageContainer's own prop — connections/[id] is a narrow page. */
  width?: "default" | "narrow";
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh bg-background">
      {/* THE RAIL'S GHOST — FIRST, AND FULL HEIGHT. Its width is pinned against
          `sidebar.tsx` by `tests/page-width.test.ts`; `--chrome` matches the
          real rail, and `--chrome-border` is the only thing marking where it
          ends, because the rail and the panel beside it are two different
          materials in both themes.
          NOTHING IS RESERVED FOR IT BELOW `md`, because nothing is drawn there
          — see `Sidebar`. A ghost the real chrome will not replace is 260px of
          content jumping left when the route lands. */}
      <div className="hidden w-65 shrink-0 border-r border-rail-border bg-rail md:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* THE BAR'S GHOST — 65px, `--chrome`, its bottom hairline. Empty: the
            real bar is about to occupy it, and a shimmering placeholder under
            an account name that never moves is noise. */}
        <div className="h-[65px] shrink-0 border-b border-topbar-border bg-topbar" />
        {/* THE PANEL'S GHOST — its own surface (`--panel`) and the same
            top-RIGHT corner the real content column carries under the bar. */}
        <div className="min-h-0 flex-1 overflow-y-auto md:rounded-tr-frame bg-panel">
          {/* Not <main>: PageContainer renders the page's one main landmark. */}
          <div className={`mx-auto w-full p-6 ${width === "narrow" ? "max-w-3xl" : "max-w-6xl"}`}>
            <Skeleton className="h-8 w-48" />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A stack of full-width rows — lists, tables, settings sections. */
export function SkeletonRows({ count = 3, className = "h-16" }: { count?: number; className?: string }) {
  return (
    <div className="mt-8 space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}
