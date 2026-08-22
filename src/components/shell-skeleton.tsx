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
export function ShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-rail flex h-screen">
      <div className="w-[100px] shrink-0" />
      <div className="flex-1 overflow-hidden bg-white">
        {/* Not <main>: PageContainer renders the page's one main landmark. */}
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
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
