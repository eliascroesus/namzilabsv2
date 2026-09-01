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
          simplification: the rail draws no hairline under its top block now, so
          a mirrored `border-b` here would paint a line the real chrome does not
          have and then remove it when the route landed.

          IT HAS NO RIGHT EDGE EITHER, ANY MORE — the same lesson in the other
          axis. The charcoal rebrand took the rail's `border-r` off, because the
          band lightened to #2e2e2e and the ground beside it was #f5f5f5: a
          hairline drawn where two materials already differ by 40 points of
          luminance is a rule doing nothing.

          THE BORDER IS BACK, AND IT IS NOW LOAD-BEARING RATHER THAN DECORATIVE.
          The rail and the page are the same #1b191a, so `border-r` is the only
          thing that says where the column ends. Mirroring it is not tidiness:
          the rule occupies a pixel of the 48px footprint, and a skeleton
          without it shifts every route's content column 1px sideways at
          hydration — precisely the jolt this file exists to prevent.

          The COLOUR is mirrored too, and it is simply `bg-background` now. It
          was `bg-ink-950` in BOTH themes because the chrome did not invert and
          a skeleton drawing `bg-sidebar` would have flashed a white column in
          the light theme for as long as the page took to stream. There is one
          theme and one surface; the rail, this ghost and the page are all the
          same token. Nothing else in the rail is drawn: the real one is about to
          occupy this space and a shimmering ghost of furniture that never moves
          is noise. */}
      <div className="w-[56px] shrink-0 border-r border-border bg-background" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* THE TOP BAR WAS MISSING ENTIRELY ONCE, AND IT IS 56px TALL.
            This file's whole argument is that a skeleton whose geometry
            disagrees with the page behind it does the one thing a skeleton
            exists to prevent — and it reserved the rail, the wash and the
            gutter while leaving out the bar above all of them. Content
            shimmered at the top of the canvas and then dropped the bar's whole
            height the moment the real chrome landed, on every first load of
            every route. `tests/page-width.test.ts` reads this number out of
            `top-bar.tsx` rather than trusting the two to agree.

            `border-b` FOR THE SAME REASON THE RAIL REGAINED ITS `border-r`. It
            was correctly absent while the bar was charcoal closing onto an
            off-white ground — a step no hairline improves. The bar and the page
            are one colour now, so the rule IS the bar's bottom edge, and a
            skeleton without it drops the whole page 1px when the route lands.

            Empty, like the rail column, for the same reason: the real bar is
            about to occupy it, and a shimmering placeholder under a wordmark
            that never moves is noise. */}
        <div className="h-[60px] shrink-0 border-b border-border bg-background" />
        {/* `overflow-y-auto`, matching AppShell's own surface — with
            `overflow-hidden` a classic scrollbar appeared only after the swap
            and stole width from the canvas column at the same moment. The wash
            is a mirror too: without it the skeleton is a white sheet where the
            app's working surface will be — and it is `bg-background`, the role
            AppFrame paints for every route, not the builder's `canvas-bg`.
            Those two are no longer even close: the page is #1b191a and the
            canvas is frozen at #1b191a for this pass, so a skeleton borrowing
            the builder's spelling would flash six counts off the real page. */}
        <div className="flex-1 overflow-y-auto bg-background">
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
