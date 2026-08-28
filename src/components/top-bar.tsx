"use client";

import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
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
export function TopBar({ account }: { account?: { initials: string; panel: ReactNode } }) {
  return (
    // `bg-background` — the sheet's OFF-WHITE — rather than the sidebar's own
    // surface, and deliberately: the flow builder portals white, bordered
    // islands into the slot below, and those only read as floating surfaces
    // over a wash one step off white.
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      {/* THE MARK SITS ON THE SAME LEFT EDGE AS THE RAIL'S ICONS — the bar's
          16px plus this `p-1` puts the black square 20px in, which is exactly
          where the sidebar's chips land (its `px-2` column plus a row's
          `px-3`). The padding is symmetric now (`p-1`, not `py-1 pl-1`), so the
          hover wash is a shape centred on its contents rather than a box with
          the mark pressed into one corner.

          Hover is that WASH rather than `opacity-80`. Fading a black square
          toward the page is the one hover in the product that changes a colour
          instead of lighting a surface, and it reads as the mark going out. */}
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2.5 rounded-control p-1 pr-2.5 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted"
        title="Namzilabs — dashboard"
      >
        {/* DEEP BLACK, reached through the `foreground` ROLE rather than a
            near-black fill: it inverts with the theme, and it sidesteps the kit
            gate that bans `bg-neutral-900` as a brand fill. An 8px square, not a
            disc: the sheet pills BUTTONS and CHIPS, and a round mark beside a
            round avatar in the rail would be two circles claiming to be the
            same kind of object. */}
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
          state; lifting them would mean lifting all of that with them.

          THE HAIRLINE BEFORE IT IS DRAWN BY THE SLOT ITSELF, and only when the
          slot has something in it. A page's own chrome butted straight against
          the wordmark read as one long row of unrelated controls; a 24px rule
          is what Miro and Figma put between "the product" and "this document".
          `empty:` is the only thing that can know — a portal APPENDS DOM
          children, so the slot is `:empty` on every route that never fills it
          and is not on the builder, with no state to pass down and nothing for
          a future page to remember to set. (A `::before` does not count against
          `:empty`, which is what makes the pair work.) */}
      <div
        id="topbar-slot"
        className="flex min-w-0 flex-1 items-center gap-2 pl-1 before:mr-2 before:h-6 before:w-px before:shrink-0 before:bg-border before:content-[''] empty:before:hidden"
      />

      {/* THE BAR'S CONTROLS ARE `sm`, AND THE BAR IS THE REASON.
          A default Button is 44px in a 64px band — 10px of air top and bottom,
          so the pills crowd the hairlines and the bar reads as a toolbar that
          barely fits. At 36px there is 14px either side, the two buttons sit on
          the 8px baseline, and they stop competing with the page heading
          directly beneath them. Chrome is furniture; the page is the content. */}
      <Link
        href="/dashboard/settings"
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        title="Invite someone to this workspace"
      >
        <UserPlus />
        <span className="hidden sm:inline">Invite members</span>
      </Link>
      {/* THE ONE YELLOW ON THE SCREEN. Creating a flow is the act this
          product exists for, so it takes the hero; everything else in this bar
          is black or a hairline. See the ratio note in globals.css. */}
      <Link href="/dashboard/flows" className={cn(buttonVariants({ variant: "yellow", size: "sm" }))}>
        <Plus />
        <span className="hidden sm:inline">New flow</span>
      </Link>
      {/* THE ACCOUNT, TOP-RIGHT, where Miro, Notion and Figma all keep it —
          and where it stops the sidebar's workspace row from having to answer
          two questions at once. It sits LAST on the bar — after the hero — because
          that is where every reference puts it and because it is the control
          you reach for least. */}
      {account && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* The kit's Button, not a raw one — the gate is right to insist:
                a hand-rolled control here would re-spell the disabled and
                transition rules the other four in this bar get for free. */}
            <Button
              variant="soft"
              size="iconSm"
              aria-label="Account"
              className="text-xs font-semibold data-[state=open]:bg-brand-100"
            >
              {account.initials}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-0">
            {account.panel}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
         *
         * ITS PADDING IS THE PAGE'S GUTTER, RUNG FOR RUNG. The bar is pulled
         * flush by the caller's negative margins, so a flat `px-4` stood its
         * first pill 4px left of the heading under it on a phone and 24px left
         * of it on a desktop — near-misses against the one vertical line the
         * page actually has. Matching `PageContainer`'s ladder means the range
         * pills start exactly where the title does.
         */
        "quiet-scroll flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-5 sm:px-8 lg:px-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
