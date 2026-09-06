"use client";

import Link from "next/link";
import { Bell, Plus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — the product's name, what you're looking at, and the two
 * things you start from.
 *
 * THE MARK LIVES HERE NOW. It used to sit in the rail's head block, on the
 * argument that this bar was answering "which workspace, how much of it is
 * measured" and a second "Namzilabs" here would say the product's name
 * twice. The workspace switcher moved OUT of this bar and into the rail's
 * own head block (see `Sidebar`) — this bar no longer answers "which
 * workspace" at all, so the mark has somewhere to go that isn't a second
 * corner saying the same word.
 *
 * THE OLD IDENTITY GROUP IS GONE — workspace avatar, name, chevron, and the
 * dropdown that opened the account panel. That dropdown's TRIGGER is the
 * rail's switcher row now, and `account.panel` is passed straight through to
 * `Sidebar` rather than read here.
 *
 * SO IS THE METRICS-SETUP RING, AND THAT IS A DELETION RATHER THAN A MOVE.
 * The Figma's bar has no ring. The fact it reported — how many of six metrics
 * a workspace has built — is already on the dashboard's own setup checklist,
 * where there is room to say what to do about it instead of only how far
 * along you are; a 24px arc in the chrome was the same claim with no room for
 * the second half. Everything behind it goes in the same commit: this file's
 * radius and circumference constants, its six-metric goal, the tracked/arc/
 * message derivations built from them, and the count prop that fed all of it
 * off `TopBar`, `AppFrame`, `AppShell` and the dashboard page that computed
 * it. A prop chain whose only consumer has been deleted still reads as a
 * feature to whoever finds it next.
 *
 * 60px, `--chrome` fill, `--border` bottom rule — the bar, the rail beside
 * it and the page below the panel are three different surfaces now, so this
 * rule is the only thing marking where the bar's material stops.
 */

export function TopBar({
  account,
  menu,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /**
   * ACCEPTED AND UNREAD. It was the greeting's name; the greeting is gone (see
   * the centre zone below). Kept on the type because `AppShell` passes it and
   * removing it would mean editing the caller to say nothing — and because the
   * bar is where a greeting would come back if one ever should. Deliberately
   * NOT destructured, so it cannot look like a value this component uses.
   */
  firstName?: string;
  /**
   * The phone's way into the navigation — `MobileDrawer`, built by
   * `AppFrame` and handed down as a node.
   *
   * A NODE RATHER THAN FOUR PROPS. The drawer needs the workspace, the
   * account, the view list and the hidden-items list; this bar needs none of
   * them and has just finished giving two of them back (see the file note).
   * Passing the built control keeps the bar's signature about the BAR, which
   * is the same reason `account.panel` arrives as a node rather than as a
   * workspace list.
   */
  menu?: ReactNode;
  /** Unread notifications. Placeholder until notifications have a store. */
  unread?: number;
}) {

  return (
    // The prose sits ABOVE the tag deliberately: tests/page-width.test.ts
    // reads this bar's height by matching `<header className="…"`, and a
    // comment between the two breaks the check that keeps the loading
    // skeleton's band the same height as the real one.
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-border bg-chrome px-6 py-2">
      {/* ── THE WAY IN, THEN THE MARK ────────────────────────────────────
          The menu button exists only below `md`, where there is no rail to
          the left of this bar — it is the phone's whole navigation, so it
          takes the reading edge and the mark steps right by 40px. Above
          `md` it is `display:none` and this group is the wordmark alone,
          exactly where it was. */}
      <div className="flex shrink-0 items-center gap-2">
        {menu}
        <Link href="/dashboard" className="wordmark shrink-0 text-foreground">
          Namzilabs
        </Link>
      </div>

      {/* ── WHAT YOU ARE LOOKING AT ──────────────────────────────────────
          `#topbar-slot` PORTALS the flow builder's entire toolbar into this
          bar — its controls sit deep in the canvas's own client tree, holding
          its undo stack and its save state, so lifting them out of the canvas
          would mean lifting all of that with them.

          KEEP THE ID. Losing `#topbar-slot` does not degrade the builder, it
          breaks it: `document.getElementById("topbar-slot")` (see
          `FlowToolbar.tsx`) returns null and the toolbar renders nowhere at
          all.

          THE GREETING IS GONE, 6 SEP 2026, at the owner's word. "Welcome
          back!" sat in the centre of the bar on every page of the product —
          the most prominent horizontal position on the screen, spent on a
          string that says nothing, changes never, and is read once. The slot
          keeps the centre for the one thing that has something to say there:
          the builder's toolbar.

          THE PEER MACHINERY WENT WITH IT. `peer` + `empty:hidden` +
          `peer-[:not(:empty)]:hidden` existed for exactly one reason — to let
          an occupied slot push the greeting aside without any page having to
          say which was which. With one occupant there is nothing to arbitrate,
          and a `peer` with no sibling reading it is a rule that looks load-
          bearing to whoever finds it next. `empty:hidden` stays: it is what
          keeps an unfilled slot from claiming width in this row.

          `firstName` stays on the signature — `AppShell` passes it, and the
          bar is where a greeting would return if one ever should. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div id="topbar-slot" className="flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
      </div>

      {/* ── WHAT YOU CAN START ───────────────────────────────────────────
          NO RING HERE ANY MORE. This cluster used to open with a 24px arc
          counting metrics towards six; the Figma has none, and the dashboard's
          setup checklist already carries the same number with somewhere to put
          the next step. See the file note above for what went with it. */}
      <div className="flex shrink-0 items-center gap-4">
        <div id="topbar-status" className="flex shrink-0 items-center empty:hidden" />

        {/* BOTH ACTS LEAVE THE BAR BELOW `md`, AND NEITHER IS LOST. They are
            in the drawer's foot — "New flow" is the rail's own filled row and
            has always been there, and "Invite members" is a guest of that
            foot for exactly as long as this bar has no room for it. What is
            left up here on a phone is the menu, the mark, the bell and you —
            the bell stays at every width, unlike these two, because it is
            reachable nowhere else on a phone — which is the export's own
            phone bar.
            The label's `hidden sm:inline` goes with the move: it was the
            narrow-viewport accommodation this replaces, and a control that is
            not rendered below `md` cannot need one.
            `[&_svg]:size-4` is gone from both: `buttonVariants`' own default
            size already sets it (`h-8 px-3 text-sm [&_svg]:size-4`), so the
            explicit copy here was setting a class to the value it already
            had. */}
        <Link
          href="/dashboard/settings"
          className={cn(buttonVariants({ variant: "secondary" }), "hidden md:inline-flex")}
          title="Invite someone to this workspace"
        >
          <UserPlus />
          <span>Invite members</span>
        </Link>
        <Link
          href="/dashboard/flows"
          className={cn(buttonVariants({ variant: "secondary" }), "hidden md:inline-flex")}
        >
          <Plus />
          <span>New flow</span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
          className="relative rounded-full border border-input bg-avatar text-foreground hover:bg-accent active:bg-accent"
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-chrome bg-primary text-2xs font-semibold leading-none text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>

        {account && (
          <Link
            href="/dashboard/profile"
            aria-label="Your profile"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "rounded-full border border-input bg-avatar text-xs font-semibold text-foreground hover:bg-accent active:bg-accent",
            )}
          >
            {account.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.avatarUrl} alt="" className="size-full rounded-full object-cover" />
            ) : (
              account.initials
            )}
          </Link>
        )}
      </div>
    </header>
  );
}

/**
 * THERE IS NO SECOND BAR ANY MORE.
 *
 * `SubBar` lived here and carried the dashboard's period pills, source filter
 * and Refresh all as a third full-bleed band — app bar, then filter bar, then
 * the view-tab row, all before a single number. Miro has ONE chrome bar and
 * puts its filters IN the content beside the view controls; three stacked
 * bands is most of what "the navs look messy" was.
 *
 * Those controls are the BOARD's, not the app's, so they went back to the
 * board: an ordinary toolbar row on the page, above the tabs. Deleted rather
 * than left exported, because a bar nothing renders is a bar someone
 * reintroduces.
 */
