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
    <div className="flex h-dvh bg-rail">
      {/* THE RAIL'S GHOST — FIRST, AND FULL HEIGHT. Its width is pinned against
          `sidebar.tsx` by `tests/page-width.test.ts`; `--chrome` matches the
          real rail, and `--chrome-border` is the only thing marking where it
          ends, because the rail and the panel beside it are two different
          materials in both themes.
          NOTHING IS RESERVED FOR IT BELOW `md`, because nothing is drawn there
          — see `Sidebar`. A ghost the real chrome will not replace is 260px of
          content jumping left when the route lands. */}
      {/* NO `border-r` — the real rail dropped its right rule on 10 Sep 2026
          (node 35:5918 draws none), and a ghost that keeps a rule the frame
          lost paints a hairline for one frame and then removes it, which is
          exactly the flicker this mirror exists to prevent. */}
      <div className="hidden w-65 shrink-0 bg-rail md:block" />
      {/* THE GUTTER'S GHOST — three-sided, `md:` only, exactly as in
          `app-frame.tsx`. If this mirror misses the 8px the real frame takes,
          the whole panel slides 8px up and left at hydration, which is the
          class of jump this file exists to prevent. */}
      <div className="flex min-w-0 flex-1 flex-col md:py-frame md:pr-frame">
        {/* THE PANEL'S GHOST — one cornered, hairlined box holding the bars
            and the content, mirroring the real panel. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel md:rounded-frame md:border md:border-border">
          {/* THE BAR'S GHOST — ONE, 56px, because the real chrome is one band
              since 10 Sep 2026 (node 35:6027). It was two, 57 and 49, and
              mirroring the old pair under the new chrome is 50px of content
              jumping the moment the route lands — the whole failure this file
              exists to prevent, caused by the file meant to prevent it.
              NO `border-b`: the real bar dropped its rule to the board's own
              row below it. Empty: a shimmering placeholder under controls that
              never move is noise. */}
          <div className="h-16 shrink-0 bg-topbar" />
          {/* THE BOARD'S BAND, which is chrome again as of 11 Sep 2026 — a
              real sibling of the bar rather than a sticky child of the panel.
              A mirror that misses it is 57px of content jumping down the
              moment the route lands, which is the whole failure this file
              exists to prevent. 49 = a 32px control row + 16 below it + its
              rule; the 8 that used to sit above it moved into the bar when
              that band's padding was made symmetric, and 64 + 49 is the same
              113 as the 56 + 57 it replaces. */}
          <div className="h-[49px] shrink-0 border-b border-topbar-border bg-topbar" />
          <div className="min-h-0 flex-1 overflow-y-auto bg-panel">
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
