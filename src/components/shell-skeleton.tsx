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

          70 because the named column became an icon rail. IT HAS NO HEAD BAND
          ANY MORE, and losing that inner div is a fix rather than a
          simplification: the rail draws no hairline under its top block now —
          the only seam it owns is its right edge — so a mirrored `border-b`
          here would paint a line the real chrome does not have and then remove
          it when the route landed.

          The COLOUR is mirrored instead, and it has to be: this band is
          `ink-950` in BOTH themes (the chrome does not invert — see the note in
          sidebar.tsx), so a skeleton drawing it in `bg-sidebar` would flash a
          white column in the light theme for exactly as long as the page takes
          to stream. Nothing else in the rail is drawn: the real one is about to
          occupy this space and a shimmering ghost of furniture that never moves
          is noise. Nothing in it changes the column's WIDTH, which is the only
          thing the page beside it can feel. */}
      <div className="w-[70px] shrink-0 border-r border-chrome-line bg-ink-950" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* THE TOP BAR WAS MISSING ENTIRELY, AND IT IS 70px TALL.
            This file's whole argument is that a skeleton whose geometry
            disagrees with the page behind it does the one thing a skeleton
            exists to prevent — and it reserved the rail, the wash and the
            gutter while leaving out the bar above all of them. Content
            shimmered at the top of the canvas and then dropped 70px the moment
            the real chrome landed, on every first load of every route.

            AND IT IS NEAR-BLACK, IN BOTH THEMES, because the bar behind it is:
            a pale band that turns dark the instant the route arrives is the
            same jump in the other dimension. The colour is the bar's own
            spelling — `bg-ink-950` with the chrome hairline under it — so the
            two cannot drift.

            Empty, like the rail column, for the same reason: the real bar is
            about to occupy it, and a shimmering placeholder under a wordmark
            that never moves is noise. */}
        <div className="h-[70px] shrink-0 border-b border-chrome-line bg-ink-950" />
        {/* `overflow-y-auto`, matching AppShell's own surface — with
            `overflow-hidden` a classic scrollbar appeared only after the swap
            and stole width from the canvas column at the same moment. The wash
            is a mirror too: without it the skeleton is a white sheet where the
            app's working surface will be — and it is `bg-ground`, the role
            AppFrame paints for every route, not the builder's `canvas-bg`.
            Those were the same colour while the page was off-white; the ground
            is near-black in dark now, so the stale spelling meant a pale sheet
            flashing behind every dark-theme navigation. */}
        <div className="flex-1 overflow-y-auto bg-ground">
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
