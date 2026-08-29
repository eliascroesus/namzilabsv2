"use client";

import Link from "next/link";
import { Bell, ChevronDown, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — who you are, how far in you are, and the two things you start
 * from.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A RESKIN.
 *
 * The bar was 64px of OFF-WHITE carrying the product's own mark. It is 70px of
 * near-black now, and the mark has gone to the rail's top block — because the
 * rail and this bar are one continuous band around the page, and a band that
 * says "Namzilabs" twice in its two corners is saying it once too often. What
 * this bar carries instead is the answer to WHICH WORKSPACE and HOW FAR IN:
 * the workspace avatar, its name, and the setup ring. Those are facts about
 * your account, and they were previously split between a rail footer and
 * nowhere at all.
 *
 * THE CHROME DOES NOT INVERT — and that is the one design decision in this file
 * worth arguing for. `bg-ink-950` in BOTH themes, with only the PAGE below
 * switching. It is the repo's own 60/30/10 doctrine (see globals.css: "white
 * canvas is the 60, this rail is the 30, and the accent is the 10") and it is
 * what Miro, Notion and Linear all do. A rail that flips with the theme is a
 * rail with no identity: you lose the one shape that stays put while everything
 * inside it changes.
 *
 * `dark` ON THE HEADER IS HOW THAT IS PAID FOR, NOT A SHORTCUT.
 *
 * globals.css declares `@custom-variant dark (&:where(.dark, .dark *))` and
 * puts the dark ROLE values in a plain `.dark {}` block — so the class scopes,
 * and any subtree can be told "you are on dark material" without the document
 * being on it. That matters here for exactly one reason: the flow builder
 * PORTALS its whole toolbar into `#topbar-slot` below, and every one of those
 * controls is spelled in roles — `text-foreground`, `bg-card`, `border-border`.
 * On a light document those resolve to near-black ink on a white island, which
 * on this bar would be near-black on near-black: an invisible toolbar on the
 * one screen that cannot function without it. Scoping `dark` here re-inks the
 * portal's contents for the surface they actually land on, and costs nothing in
 * the dark theme, where it is a no-op nested inside the document's own `.dark`.
 *
 * Everything this file draws ITSELF is spelled in constants — `bg-ink-950`,
 * `bg-white`, `text-neutral-900`, the `--chrome-*` roles, which are declared
 * only in `:root` on purpose — so the scoped class never moves the bar's own
 * furniture. It moves only what other files render into it.
 *
 * THE BAR HOLDS ONE YELLOW, AND IT IS THE VERB. Creating a flow is the act this
 * product exists for. Everything else here is a hairline, a grey chip, or the
 * one blue that means "identity".
 */

/** The setup ring's geometry: r=10 in a 24px box, so a 2px stroke sits inside. */
const RING_RADIUS = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function TopBar({
  account,
  workspace,
  firstName,
  progress = { done: 0, total: 6 },
  unread = 1,
}: {
  account?: { initials: string; panel: ReactNode };
  /**
   * The active workspace's own name. A DEFAULT rather than a required prop
   * because the frame's membership lookup can come back short, and a bar that
   * throws because WorkOS was slow is worse than a bar that says "Workspace".
   */
  workspace?: string;
  /**
   * The greeting's name. Optional, and the fallback is a greeting with NO name
   * in it — "Welcome back!" — rather than "Welcome back, there!". A product
   * that guesses at your name is worse than one that does not use it.
   */
  firstName?: string;
  /** Onboarding steps completed. Placeholder until the checklist has a store. */
  progress?: { done: number; total: number };
  /** Unread notifications. Placeholder until notifications have a store. */
  unread?: number;
}) {
  // The workspace's initial for the avatar. `.trim()` first: an org named
  // " Acme" would otherwise render a blank blue square.
  const initial = (workspace ?? "").trim().charAt(0).toUpperCase() || "W";
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
  const done = Math.max(0, Math.min(progress.done, progress.total));
  const arc = progress.total > 0 ? (RING_CIRCUMFERENCE * done) / progress.total : 0;

  // The identity group: avatar, name, chevron. Rendered once and placed either
  // inside a menu trigger or bare, because a CHEVRON IS A PROMISE — the old
  // note in this file put it exactly right, that "a chevron on something that
  // does not open is a promise the bar cannot keep". The account panel is the
  // thing that holds the workspace switcher, so when there is a panel this
  // group opens it and the chevron is honest; when there is no panel (the
  // design route renders the frame without an account) the group is text and
  // the chevron is dropped rather than left pointing at nothing.
  const identity = (
    <>
      {/* THE ONE COLOUR IN THE CHROME THAT IS NEITHER BRAND NOR STATE. It is
          IDENTITY — which workspace you are in — and it is drawn from its own
          role precisely so it can differ per workspace one day without ever
          colliding with selection violet or the yellow hero. A square at the
          control radius, not a disc: the account avatar at the far end of this
          bar is the disc, and two circles side by side would claim to be the
          same kind of object. */}
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-chrome-avatar text-md font-semibold text-white"
      >
        {initial}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-md font-bold text-white">{workspace}</span>
        {account && <ChevronDown aria-hidden className="size-3 shrink-0 text-neutral-300" />}
      </span>
    </>
  );

  return (
    // 70px, and the height is not arbitrary: the rail's top block is 70px too,
    // so the bar's bottom hairline and the rail's right hairline meet at one
    // corner and the chrome reads as a single seam rather than two edges that
    // nearly line up.
    //
    // `dark` — see the long note above. It re-inks the PORTAL's contents, not
    // this bar's own.
    <header className="dark flex h-[70px] shrink-0 items-center justify-between gap-4 border-b border-chrome-line bg-ink-950 py-2.5">
      {/* ── WHERE YOU ARE ───────────────────────────────────────────────────
          Workspace, then a slash, then how far through setup you are. It reads
          as a path because it IS one: the workspace is the root and the ring is
          your position inside it. */}
      {/* THE ADDRESS, AND IT IS ALL OR NOTHING. Everything in this group —
          the avatar, the name, the slash, the setup ring — answers "where am
          I". The builder supplies none of it on purpose (no membership fetch
          per editor load), so on that one route the whole group stands down
          rather than inventing a blue "W" and a 0/6 ring for a checklist it
          never shows. The bar then opens with the portalled toolbar, which is
          what that screen is actually about. */}
      {workspace && (
      <div className="flex min-w-0 items-center gap-6 pl-6">
        {account ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The kit's Button, not a raw one. `-mx-2 px-2` gives the hover
                  wash a shape around the group while leaving the avatar's left
                  edge exactly 24px from the bar's edge — the padding gives back
                  precisely what the negative margin took. */}
              <Button
                variant="ghost"
                // `[&_svg]:size-3` is not decoration: the size variant ships
                // `[&_svg]:size-[18px]`, and a descendant rule beats the
                // chevron's own `size-3` on specificity no matter which order
                // they are written in. Overriding at the same level is the only
                // spelling that actually lands.
                className="-mx-2 h-auto min-w-0 gap-6 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-ink-800 active:bg-ink-800 [&_svg]:size-3"
                aria-label={`${workspace} — workspace and account`}
              >
                {identity}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 p-0">
              {account.panel}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="flex min-w-0 items-center gap-6">{identity}</span>
        )}

        {/* The separator is a real slash rather than a hairline, because the two
            things either side of it are levels of one address, not two unrelated
            groups. `aria-hidden`: a screen reader announcing "slash" between a
            workspace name and a progress figure is noise.

            IT GOES WHEN THE ADDRESS DOES. The builder renders `AppFrame` with no
            workspace — deliberately, to avoid a WorkOS membership fetch on every
            editor load — and `workspace` used to default to the literal word
            "Workspace". So the one screen whose bar is already fighting for
            width spent ~250px on a blue "W", the word Workspace and a setup ring
            that belongs to a checklist it never shows. No address, no slash. */}
        {workspace && (
          <span aria-hidden className="text-md text-white">
            /
          </span>
        )}

        {/* ── HOW FAR IN ──────────────────────────────────────────────────
            A ring and a fraction saying the same number twice, which is
            deliberate: the ring is the thing you notice from across the room
            and the fraction is the thing you read. The arc is drawn from the
            VALUE rather than being a static shape, so the day the checklist has
            a store this fills in by itself; at 0 it is a bare track, which is
            what an untouched checklist should look like. */}
        <span className="flex shrink-0 items-center gap-2" title="Setup steps completed">
          <span className="relative flex size-6 items-center justify-center">
            {/* `-rotate-90` starts the arc at twelve o'clock — an arc that
                begins at three reads as a dial rather than as progress. */}
            <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 size-6 -rotate-90">
              <circle cx="12" cy="12" r={RING_RADIUS} fill="none" strokeWidth="2" className="stroke-ink-700" />
              {arc > 0 && (
                <circle
                  cx="12"
                  cy="12"
                  r={RING_RADIUS}
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE - arc}
                  className="stroke-neutral-600"
                />
              )}
            </svg>
            {/* Hidden from the reading order — the fraction beside it already
                carries this number, and announcing "0, 0 of 6" is a stutter. */}
            <span aria-hidden className="relative text-xs font-bold leading-none text-ink-400">
              {done}
            </span>
          </span>
          <span className="text-md font-bold text-white">
            {done}/{progress.total}
          </span>
        </span>
      </div>
      )}

      {/* ── WHAT YOU ARE LOOKING AT ─────────────────────────────────────────
          One centred region with two occupants that are never both present.

          THE SLOT IS WHERE A PAGE PUTS ITS OWN CHROME. The flow builder used to
          float its entire toolbar over the canvas in a rounded island — the
          flow's name, save state, run, undo, redo, publish — which meant the
          app had two top bars stacked, one of them covering the thing being
          edited. It portals into here instead, so there is one bar and the
          canvas gets its space back. A portal target rather than a prop because
          those controls sit deep inside the canvas's own client tree, holding
          its undo stack and its save state; lifting them would mean lifting all
          of that with them.

          KEEP THE ID. Losing `#topbar-slot` does not degrade the builder, it
          breaks it: `getElementById` returns null and the toolbar renders
          nowhere at all.

          THE HAIRLINE BEFORE IT IS DRAWN BY THE SLOT ITSELF, and only when the
          slot has something in it — `empty:` is the only thing that can know,
          because a portal APPENDS DOM children and there is no state to pass
          down. (A `::before` does not count against `:empty`, which is what
          makes the pair work.) It is kept alongside `empty:hidden` on purpose:
          the hidden rule is what stops an empty slot claiming the centre from
          the greeting, and the `before:` rule is the one that would still be
          correct if the slot ever went back to being laid out when empty.

          THE GREETING IS THE OTHER OCCUPANT, and it steps aside rather than
          sharing: `peer` + `:not(:empty)` lets the slot's own contents do the
          hiding, so no page has to remember to tell this bar what it is doing.
          On the builder there is a toolbar here; everywhere else there is a
          greeting. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div
          id="topbar-slot"
          className="peer flex min-w-0 flex-1 items-center gap-2 pl-1 before:mr-2 before:h-6 before:w-px before:shrink-0 before:bg-chrome-line before:content-[''] empty:hidden empty:before:hidden"
        />
        <span className="truncate text-md font-bold text-white peer-[:not(:empty)]:hidden">{greeting}</span>
      </div>

      {/* ── WHAT YOU CAN START ──────────────────────────────────────────────
          Two acts, then two objects that are about you rather than about the
          product. Both buttons are LIGHT on this dark band and stay light in
          both themes — they are the same pills the page below wears, and a bar
          whose buttons invert while its ground does not is a bar with two
          materials in it. */}
      <div className="flex shrink-0 items-center gap-4 pr-10">
        {/* `sm` — 36px in a 70px band. The bar is furniture; the page is the
            content, and a 44px default here would put the chrome's controls at
            the same weight as the page's own. */}
        <Link
          href="/dashboard/settings"
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            // The secondary variant is spelled in ROLES, which the scoped
            // `dark` above would answer in dark — a near-black pill on a
            // near-black bar. Pinned to the constants the Figma measures
            // instead: white card, the app's own hairline, near-black ink.
            "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-100",
          )}
          title="Invite someone to this workspace"
        >
          <UserPlus />
          <span className="hidden sm:inline">Invite members</span>
        </Link>
        {/* THE ONE YELLOW ON THE SCREEN. `yellow` is already spelled in
            constants — the neon and near-black ink — so it needs no pinning and
            is the same object at both exposures. No icon: this is the widest
            word in the group and the colour is doing the pointing. */}
        <Link href="/dashboard/flows" className={cn(buttonVariants({ variant: "yellow", size: "sm" }))}>
          <span>New flow</span>
        </Link>

        {/* THE BELL, ON A LIGHT CHIP. A bare glyph floating on the band would be
            the only unhoused control in the bar; the chip makes it an object
            sitting ON the chrome, matching the avatar beside it. The badge is
            BLUE and neither of the two colours it might have been — danger
            would make an unread message a failure, and brand would give a count
            the same colour as selection. Its hairline is the near-white the
            numeral is set in, so the badge reads as lifted OFF the chip rather
            than punched into it. */}
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
          className="relative bg-chrome-chip text-neutral-800 hover:bg-neutral-300 hover:text-neutral-900 active:bg-neutral-400"
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-neutral-50 bg-chrome-badge text-xs font-semibold leading-none text-neutral-50">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>

        {/* THE ACCOUNT, LAST, where Miro, Notion and Figma all keep it — and it
            is the control you reach for least, which is why it sits after the
            hero rather than before it. Violet initials on the grey chip: violet
            is the sheet's identity colour, and the 700 is the step that carries
            text (the 500 is a fill and only 4.42:1). */}
        {account && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Account"
                className="bg-chrome-chip text-xs font-semibold text-brand-700 hover:bg-neutral-300 hover:text-brand-800 active:bg-neutral-400 data-[state=open]:bg-neutral-300"
              >
                {account.initials}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-0">
              {account.panel}
            </DropdownMenuContent>
          </DropdownMenu>
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
