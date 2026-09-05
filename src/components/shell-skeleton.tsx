import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * THE SHELL, HELD OPEN WHILE A PAGE STREAMS.
 *
 * Every authenticated route renders inside AppShell — a full-width bar,
 * then a row of the rail and the panel under it. The root `loading.tsx`
 * cannot know that, so a navigation into one of those routes used to blank
 * the whole viewport and then paint the chrome back.
 *
 * This holds the frame's new SHAPE — bar first, then the row — so only the
 * CONTENT shimmers. All three bands are deliberately empty rather than
 * skeletons of themselves: the real chrome is about to occupy them.
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
    <div className="flex h-dvh flex-col bg-background">
      {/* THE BAR'S GHOST — 60px, `--chrome`, its bottom hairline. Empty: the
          real bar is about to occupy it, and a shimmering placeholder under
          a wordmark that never moves is noise. */}
      <div className="h-[60px] shrink-0 border-b border-border bg-chrome" />
      <div className="flex min-h-0 flex-1">
        {/* THE RAIL'S GHOST — its own width, pinned against `sidebar.tsx` by
            `tests/page-width.test.ts`. `--chrome`, matching the bar above it;
            the border is the ONLY thing marking where it ends, because the
            rail and the panel beside it are two different surfaces now. */}
        {/* NOTHING IS RESERVED FOR THE RAIL BELOW `md`, because nothing is
            drawn there — see `Sidebar`. A ghost the real chrome will not
            replace is 57px of content jumping left when the route lands,
            which is the one failure this file exists to prevent. */}
        <div className="hidden w-[56px] shrink-0 border-r border-border bg-chrome md:block" />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* THE PANEL'S GHOST — its own surface (`--panel`) and the same
              top-RIGHT corner the real content column carries under the bar.
              The rail side stays square in both, which is the export's own
              geometry and the reverse of every earlier notch this shell had. */}
          <div className="flex-1 overflow-y-auto md:rounded-tr-frame bg-panel">
            {/* Not <main>: PageContainer renders the page's one main landmark. */}
            <div className={`mx-auto w-full p-6 ${width === "narrow" ? "max-w-3xl" : "max-w-6xl"}`}>
              <Skeleton className="h-8 w-48" />
              {children}
            </div>
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
