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
 * where the column it governs starts, and the two share this bar's height so
 * their hairlines meet.
 *
 * THE BAR HOLDS ONE VIOLET, AND IT IS THE VERB.
 *
 * The brand sheet's three colours are DEEP BLACK, OFF-WHITE and VIBRANT VIOLET,
 * and the violet is the one that means "press this". So the row reads black →
 * neutral → violet from left to right: the mark is the black, "Invite members"
 * is the secondary in card-on-hairline, and "New flow" is the only filled
 * violet on the screen apart from whichever sidebar row you are standing on.
 * A violet mark AND a violet button would have been two of them competing, with
 * the one you cannot press drawn first.
 */
export function TopBar() {
  return (
    // `bg-background` — the sheet's OFF-WHITE — rather than the sidebar's own
    // surface, and deliberately: the flow builder portals white, bordered
    // islands into the slot below, and those only read as floating surfaces
    // over a wash one step off white.
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2.5 rounded-control py-1 pl-1 pr-2 transition-opacity duration-(--duration-fast) ease-(--ease-standard) hover:opacity-80"
        title="Namzilabs — dashboard"
      >
        {/* DEEP BLACK, reached through the `foreground` ROLE rather than a
            near-black fill: it inverts with the theme, and it sidesteps the kit
            gate that bans `bg-neutral-900` as a brand fill. Round, because the
            sheet is pill-first and a squircle mark beside pill controls is the
            one shape in the chrome that would belong to nothing. */}
        <span className="flex size-8 items-center justify-center rounded-control bg-foreground text-sm font-semibold text-background">
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
      {/* THE ONE YELLOW ON THE SCREEN. Creating a flow is the act this
          product exists for, so it takes the hero; everything else in this bar
          is black or a hairline. See the ratio note in globals.css. */}
      <Link href="/dashboard/flows" className={cn(buttonVariants({ variant: "yellow" }))}>
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
         *
         * h-14 rather than h-12: it carries pill controls, and the kit's pills
         * are 32 and 40px tall, which leaves 4px of air above and below a
         * default-size button in a 48px bar. It is also the 8px rhythm the rest
         * of the chrome is set on.
         */
        "quiet-scroll flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
