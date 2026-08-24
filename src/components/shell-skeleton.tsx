import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * THE SHELL, HELD OPEN WHILE A PAGE STREAMS.
 *
 * Every authenticated route renders inside AppShell — dark rail on the left,
 * white canvas to its right. The root `loading.tsx` cannot know that, so a
 * navigation into one of those routes used to blank the whole viewport to
 * white and then paint the rail back: the chrome appeared to leave and return
 * for a frame, which reads as a broken page rather than a loading one.
 *
 * This holds the frame's shape — same wash, same 100px gutter — so only the
 * CONTENT shimmers. The rail column is deliberately empty rather than a
 * skeleton of itself: the real rail is about to occupy it, and shimmering
 * placeholders under icons that never move is noise.
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
    // Kept as literals rather than routed through AppFrame/PageContainer on
    // purpose: PageContainer is `<main id="main">` and carries `rise-in`, and a
    // fallback must not render a second main landmark (nor animate in, only to
    // animate in again when the real page arrives).
    <div className="bg-rail flex h-dvh">
      <div className="w-[76px] shrink-0 sm:w-[100px]" />
      {/* `overflow-y-auto`, matching AppShell's own surface — with
          `overflow-hidden` a classic scrollbar appeared only after the swap and
          stole width from the canvas column at the same moment. */}
      <div className="flex-1 overflow-y-auto bg-white">
        {/* Not <main>: PageContainer renders the page's one main landmark. */}
        <div
          className={`mx-auto w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8 ${
            width === "narrow" ? "max-w-3xl" : "max-w-5xl"
          }`}
        >
          <Skeleton className="h-8 w-48" />
          {children}
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
