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
  firstName,
  menu,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /**
   * The greeting's name. Optional, and the fallback is a greeting with NO name
   * in it — "Welcome back!" — rather than "Welcome back, there!". A product
   * that guesses at your name is worse than one that does not use it.
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
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-border bg-chrome px-6 py-2">
      {/* ── THE WAY IN, THEN THE MARK ────────────────────────────────────
          The menu button exists only below `md`, where there is no rail to
          the left of this bar — it is the phone's whole navigation, so it
          takes the reading edge and the mark steps right by 40px. Above
          `md` it is not rendered and this group is the wordmark alone,
          exactly where it was. */}
      <div className="flex shrink-0 items-center gap-2">
        {menu}
        <Link href="/dashboard" className="wordmark shrink-0 text-foreground">
          Namzilabs
        </Link>
      </div>

      {/* ── WHAT YOU ARE LOOKING AT ──────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div id="topbar-slot" className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
        {/* `max-sm:hidden`, NOT `hidden sm:block`, AND THE DIFFERENCE IS A
            BUG AVOIDED. This span already carries `peer-[:not(:empty)]:hidden`
            — the rule that gets out of the builder's way when its toolbar
            portals into the slot beside it. A base `hidden` plus `sm:block`
            would put a responsive variant into a fight with that peer rule
            that is settled by Tailwind's own emission order rather than by
            anything written here, and the losing case is a greeting sitting
            on top of the builder's toolbar. One `max-` variant hides it below
            `sm` and leaves the peer rule the only thing deciding anything at
            `sm` and above. */}
        <span className="truncate text-sm font-medium text-foreground max-sm:hidden peer-[:not(:empty)]:hidden">
          {greeting}
        </span>
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
            left up here on a phone is the menu, the mark and you, which is
            the export's own phone bar.
            The label's `hidden sm:inline` goes with the move: it was the
            narrow-viewport accommodation this replaces, and a control that is
            not rendered below `md` cannot need one. */}
        <Link
          href="/dashboard/settings"
          className={cn(buttonVariants({ variant: "secondary" }), "hidden md:inline-flex [&_svg]:size-4")}
          title="Invite someone to this workspace"
        >
          <UserPlus />
          <span>Invite members</span>
        </Link>
        <Link
          href="/dashboard/flows"
          className={cn(buttonVariants({ variant: "secondary" }), "hidden md:inline-flex [&_svg]:size-4")}
        >
          <Plus />
          <span>New flow</span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
          className="relative rounded-full bg-avatar text-foreground hover:bg-accent active:bg-accent"
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
              "rounded-full bg-avatar text-xs font-semibold text-foreground hover:bg-accent active:bg-accent",
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
