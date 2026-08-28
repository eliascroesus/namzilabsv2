"use client";

import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — identity and the two things you start from.
 *
 * Miro's shape, and the reason it is the right one here: the workspace you are
 * in and the actions that CREATE things are the same class of decision, and
 * they were split across three places. The workspace switcher was at the foot
 * of a 124px rail behind an avatar; "New flow" was a page action on exactly one
 * of nineteen routes; inviting somebody was four clicks into Settings and
 * discoverable only if you already knew it was there.
 *
 * They live together now, above everything, on every route — so the answer to
 * "which workspace am I in" and "how do I add something" never depends on which
 * page you happen to be standing on.
 *
 * The workspace switcher is NOT here — it lives at the top of the sidebar,
 * where the column it governs starts.
 */
export function TopBar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2 rounded-control px-1 py-1 transition-opacity hover:opacity-80"
        title="Namzilabs — dashboard"
      >
        <span className="flex size-7 items-center justify-center rounded-control bg-primary text-xs font-semibold text-primary-foreground">
          N
        </span>
        <span className="text-md font-semibold tracking-tight text-foreground">Namzilabs</span>
      </Link>

      {/* WHERE A PAGE PUTS ITS OWN CHROME.
          The flow builder used to float its entire toolbar over the canvas in
          a rounded island — Review & publish, run, on/off, the flow's name,
          save state, undo/redo — which meant the app had two top bars stacked,
          one of them covering the thing being edited. It portals into here
          instead, so there is one bar and the canvas gets its space back.

          A portal target rather than a prop because the controls are deep
          inside the canvas's own client tree, holding its undo stack and save
          state; lifting them would mean lifting all of that with them. */}
      <div id="topbar-slot" className="flex min-w-0 flex-1 items-center gap-2 pl-2" />

      <Link
        href="/dashboard/settings"
        className={cn(buttonVariants({ variant: "secondary" }))}
        title="Invite someone to this workspace"
      >
        <UserPlus />
        <span className="hidden sm:inline">Invite members</span>
      </Link>
      <Link href="/dashboard/flows" className={cn(buttonVariants())}>
        <Plus />
        <span className="hidden sm:inline">New flow</span>
      </Link>
    </header>
  );
}

/**
 * THE SECOND BAR — what the page below is currently showing.
 *
 * Split from the first on purpose. The top bar answers "where am I and what can
 * I make", which is true on every route; this one answers "which period, whose
 * data", which is true only where there is data to filter. Putting them in one
 * row made a board's range pills look like application chrome, and made the
 * workspace switcher look like a filter.
 *
 * It replaces the floating card the filters used to sit in. A bar that spans
 * the page and is separated by a hairline reads as part of the frame; the same
 * controls inside a rounded, shadowed island read as content — a widget on the
 * board rather than the thing governing it.
 */
export function SubBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        /**
         * ONE ROW, ALWAYS. This wrapped, and the second line landed on top of
         * the view tabs below it — the bar is pulled flush by negative margins,
         * so anything that wraps escapes its own height and overlaps whatever
         * the page drew next. A horizontal scroller cannot do that.
         */
        "flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
