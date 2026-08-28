import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * THE SHELL, HELD OPEN WHILE A PAGE STREAMS.
 *
 * Every authenticated route renders inside AppShell — the navigation column on
 * the left, the top bar across the rest, the canvas under it. The root
 * `loading.tsx` cannot know that, so a navigation into one of those routes used
 * to blank the whole viewport and then paint the chrome back: it appeared to
 * leave and return for a frame, which reads as a broken page rather than a
 * loading one.
 *
 * This holds the frame's shape — the same column, the same 64px bar, the same
 * wash and gutter — so only the CONTENT shimmers. Both chrome bands are
 * deliberately empty rather than skeletons of themselves: the real chrome is
 * about to occupy them, and shimmering placeholders under a wordmark and six
 * icons that never move is noise.
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
    // EVERY NUMBER BELOW IS A MIRROR, AND MIRRORS GO STALE.
    //
    // These are copies of the real chrome's measurements, and they drifted the
    // moment the responsive pass moved the originals: the rail became
    // 76/100px, the gutter became px-4 py-8 / sm:px-6 sm:py-10 / lg:px-8, and
    // the frame became h-dvh. A skeleton whose geometry disagrees with the page
    // it precedes does the one thing a skeleton exists to prevent — at ≥1024px
    // the content jumped 8px sideways when the real page landed, and below
    // 640px it jumped 32px sideways and 8px down.
    //
    // tests/page-width.test.ts pins this pair, class for class. It is the only
    // thing that does — which is how a brief experiment with an uncapped
    // container got its skeleton updated in the same breath, and how this one
    // got put back with it.
    //
    // Kept as literals rather than routed through AppFrame/PageContainer on
    // purpose: PageContainer is `<main id="main">` and carries `rise-in`, and a
    // fallback must not render a second main landmark (nor animate in, only to
    // animate in again when the real page arrives).
    <div className="flex h-dvh bg-background">
      {/* The sidebar's own width, and it has to be EXACTLY the sidebar's width.
          Pinned against `sidebar.tsx` by tests/page-width.test.ts, which caught
          this the moment the rail became a column.

          Its head band is a mirror too — the workspace control's 64px, with the
          hairline under it — so the seam that runs across the whole chrome is
          already drawn when the shimmer appears rather than arriving with the
          route.

          264 because the column went to 264 (40px rows with a 28px chip needed
          the room). ONLY the two measurements the test pins are mirrored: the
          search field, the ruled groups and the plan card below them are not
          drawn here, on this file's own argument — the real column is about to
          occupy this space, and a shimmering ghost of furniture that never
          moves is noise. Nothing in them changes the column's WIDTH, which is
          the only thing the page beside it can feel. */}
      <div className="w-[264px] shrink-0 border-r border-border bg-sidebar">
        <div className="h-16 border-b border-border" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* THE TOP BAR WAS MISSING ENTIRELY, AND IT IS 64px TALL.
            This file's whole argument is that a skeleton whose geometry
            disagrees with the page behind it does the one thing a skeleton
            exists to prevent — and it reserved the rail, the wash and the
            gutter while leaving out the bar above all of them. Content
            shimmered at the top of the canvas and then dropped 64px the moment
            the real chrome landed, on every first load of every route.

            Empty, like the rail column, for the same reason: the real bar is
            about to occupy it, and a shimmering placeholder under a wordmark
            that never moves is noise. */}
        <div className="h-16 shrink-0 border-b border-border bg-background" />
        {/* `overflow-y-auto`, matching AppShell's own surface — with
            `overflow-hidden` a classic scrollbar appeared only after the swap
            and stole width from the canvas column at the same moment. The wash
            is a mirror too: without it the skeleton is a white sheet where the
            app's working surface will be. */}
        <div className="flex-1 overflow-y-auto bg-canvas-bg">
          {/* Not <main>: PageContainer renders the page's one main landmark. */}
          <div
            className={`mx-auto w-full px-5 py-6 sm:px-8 sm:py-8 lg:px-10 ${
              width === "narrow" ? "max-w-3xl" : "max-w-6xl"
            }`}
          >
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
