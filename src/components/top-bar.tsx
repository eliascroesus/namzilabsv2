"use client";

import { Link2, Moon, Sun } from "lucide-react";
import { InvitePicker } from "@/components/invite-picker";
import { NotificationBell } from "@/components/notifications";
import type { Notice } from "@/lib/notices";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — ONE BAND OF 56px, WHICH IS ONE FEWER THAN YESTERDAY.
 *
 * Node 0:5 stacked three bands: 57px of search and account, 49px of page title
 * and app controls, 43px of view tabs and board controls. The 10 September
 * frames (35:5917 / 35:6331 / 35:6745) draw TWO, and the one that went is the
 * first: node 35:6027 is a single 56px strip carrying the page title on the
 * left and the app controls on the right, over the board's own white row.
 *
 * SO FOUR THINGS LEFT THIS FILE, AND THREE OF THEM MOVED RATHER THAN DIED.
 * The search field went back to the rail (node 35:5931 draws it there and
 * draws none here — the reverse of 0:5), the account avatar went to the rail's
 * foot beside the settings glyph (node 35:6000), and the page title arrived
 * from bar two. The fourth is the WORDMARK, and it is deleted: these frames
 * draw no product name anywhere in the chrome, and the argument that took it
 * off once already still holds — naming the product in the corner of a product
 * you are already inside says nothing. The gift went with it; node 51:5756 put
 * it here and no 10 September frame draws it.
 *
 * THE TITLE IS A CLUSTER, NOT A STRING. Node 35:6028 is three children on an
 * 8px gap: the view's name at 24/700, a bare "-" at 13/400, and the resolved
 * WINDOW in dates at 13/400 — "Overview - Sat, 1 Sep - Sat, 1 Sep". The dash
 * and the dates are muted; only the name takes the heading ink. It arrives
 * through `#topbar-title` for the reason the freshness does: the bar is global
 * and cannot know what page it is on or which days that page is showing.
 *
 * THE BAND HAS NO RULE UNDER IT ANY MORE. It had `border-b`, and node 35:6027
 * draws none — the hairline belongs to the board's own row beneath it (node
 * 35:6044, `border-bottom: 1px solid #E1E1E1`, which is `PageHeader band`).
 * Two rules 51px apart is the double-seam this kit argues against.
 *
 * THE CENTRE IS STILL THE BUILDER'S. `#topbar-slot` portals the flow builder's
 * whole toolbar into this bar — its controls hold the canvas's undo stack and
 * save state, so they cannot be lifted out of it. Losing the id does not
 * degrade the builder, it breaks it: `document.getElementById("topbar-slot")`
 * (see `FlowToolbar.tsx`) returns null and the toolbar renders nowhere.
 *
 * IT SITS BESIDE THE RAIL, NOT ABOVE IT — the frame is a row, and this bar is
 * a child of the content column, inside the panel's 8px gutter.
 */


export function TopBar({
  menu,
  ruled = false,
  notices = [],
  inviteLink,
}: {
  /**
   * DRAW THE HAIRLINE HERE, because nothing below is going to.
   *
   * The note above explains why this bar has no rule of its own on the board:
   * the board's own controls row carries one 49px lower, and two rules that
   * close together is the double seam the kit argues against. That reasoning
   * only ever held where a band EXISTS. On Activity, Apps, Settings and every
   * other route there is no band, so the chrome simply ran into the page with
   * no edge at all — which is what the owner saw.
   *
   * `AppFrame` passes `!band`, so the rule appears exactly where the board's
   * does not, and the two cases cannot both draw one. Same token as the band's
   * (`border-topbar-border`), so the line is the same line in both themes
   * rather than a second grey that happens to look close.
   */
  ruled?: boolean;
  /**
   * The phone's way into the navigation — `MobileDrawer`, built by `AppFrame`
   * and handed down as a node. It is the ONLY thing in this bar that is not
   * in the Figma, and it has to be: below `md` the rail is not rendered at
   * all, so without this there is no route to any of it.
   */
  menu?: ReactNode;
  /**
   * WHAT IS BROKEN IN THIS WORKSPACE, read on the server by `AppShell` and
   * handed straight through. It replaced `unread?: number`, which defaulted to
   * `1` and was never passed by anybody — so the badge was a constant, not a
   * count.
   *
   * DEFAULTS TO EMPTY, which is the opposite of what it replaced and the whole
   * lesson: the failure mode of a notification count must be "says nothing",
   * never "says one".
   */
  notices?: Notice[];
  /**
   * This person's own referral link, derived on the server. Absent means no
   * session — the Share control simply does not render, rather than opening a
   * dialog with an empty field in it.
   */
  inviteLink?: string;
}) {
  return (
    /* 64px = 16 above a 32px control row and 16 below it — SYMMETRIC, which
       is the 11 Sep 2026 adjustment. It was `pt-4 pb-2` (16/8) with the band
       beneath carrying `pt-2` (8), so the 16px between the two rows was split
       across them and this bar was lopsided inside its own box. The gap is
       unchanged on screen: 16 under this row plus 0 above the band is the same
       16 that 8-plus-8 was, and the two bands still sum to 113 — 64 + 49 where
       it was 56 + 57 — so nothing below them moves.
       The prose sits ABOVE the tag deliberately: tests/page-width.test.ts
       reads a bar's height by matching `<header className="…"`, and a comment
       between the two breaks it. */
    <header
      className={cn(
        "flex h-16 shrink-0 items-center gap-2 bg-topbar px-6 py-4",
        ruled && "border-b border-topbar-border",
      )}
    >
      {menu}

      {/* THE TITLE CLUSTER'S SLOT — a row, not an <h1>, because the page now
          supplies the heading element along with the dash and the dates. See
          `topbar-slots.tsx`. `empty:hidden` so a route that names nothing
          costs the bar no space. */}
      <div id="topbar-title" className="flex min-w-0 items-center gap-2 empty:hidden" />

      {/* KEEP THE ID — see the note above. `peer` + `empty:hidden` is
          unchanged: the slot claims no width while empty, and nothing has to
          know whether the builder is on screen. */}
      <div id="topbar-slot" className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />

      {/* `ml-auto` rather than leaning on `justify-between`: the two slots to
          the left are both `empty:hidden`, and a row whose only child is this
          group would otherwise centre it. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* "Updated just now" lands HERE, from the page that knows. A bar
            cannot honestly claim a freshness it has not measured, so this
            stays a slot rather than a string. */}
        <div id="topbar-status" className="flex shrink-0 items-center p-2 text-xs leading-4 text-topbar-muted empty:hidden" />

        <ShareLink inviteLink={inviteLink} />
        <ThemeToggle />

        {/* THE BELL MOVED OUT, AND IT NOW OPENS SOMETHING. It was a `Button`
            with no handler and a badge fed by `unread = 1` — a DEFAULT nobody
            ever passed, so every workspace carried a permanent blue "1" over a
            control that did nothing. `NotificationBell` owns the button, the
            count and the panel behind it; the bar just gives it the slot. */}
        <NotificationBell notices={notices} />
      </div>
    </header>
  );
}

/**
 * SHARE — AND IT NOW SHARES SOMETHING.
 *
 * The Figma draws "Share" behind a chain glyph (node 49:5711), and for months
 * this put `window.location.href` on the clipboard because there was no sharing
 * FEATURE to hang it off: no permissions, no invited viewers, no per-view ACL.
 * Honest, and not much use — the URL it copied is one an unauthenticated
 * stranger cannot open.
 *
 * There is a real answer now, and it is the same one the refer page reaches
 * for: bringing somebody in. So Share opens `InvitePicker`, which is where the
 * two kinds of "bring somebody in" are already told apart — a referral link for
 * a person who should get their OWN workspace, or the members page for somebody
 * who needs to see THIS one. Pressing Share and being asked which is the whole
 * point: the two have opposite consequences and the bar cannot know which was
 * meant.
 *
 * THE LINK IS DERIVED ON THE SERVER AND HANDED DOWN. `AppShell` computes it
 * from the WorkOS user id with no database touch at all; the row that makes it
 * RESOLVE is written by `claimReferralCode` when somebody actually copies.
 */
function ShareLink({ inviteLink }: { inviteLink?: string }) {
  const [open, setOpen] = useState(false);

  // No link means no session to derive one from — a signed-out shell, or a
  // harness. A control that opens an empty dialog is worse than one that is not
  // there, which is the rule `ViewTab` already states.
  if (!inviteLink) return null;

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        /* THE KIT'S BUTTON, STRIPPED TO A LABEL. `check:ui` bans a raw <button>
           here and is right to — a hand-rolled control is how the app grew two
           primaries — but the Figma draws this as a glyph and a word sitting on
           the bar with no box. `h-auto px-0` takes the rung's height and padding
           off while keeping the variant's states, its focus ring and its
           disabled handling, which is the half that actually matters.
           NO `font-normal` AND NO `leading-5`: Share is 13/16/400 at node
           35:6039, which is now exactly what `text-button` means. */
        className="hidden h-auto shrink-0 gap-1.5 rounded-control p-2 text-button text-topbar-foreground hover:bg-topbar-control active:bg-topbar-control md:inline-flex [&_svg]:size-3.5"
      >
        <Link2 aria-hidden />
        Share
      </Button>
      {open && <InvitePicker link={inviteLink} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * THE MOON, WHICH IS THE ONE CONTROL IN THIS BAR THE FIGMA DRAWS AND THE
 * PRODUCT ALREADY HAD.
 *
 * `ThemeChoice` (FOUR radio rungs since 10 Sep 2026 — light, mix, dark,
 * system) lives on the profile page and stays there; this is the one-press
 * version the chrome asks for. It toggles between light and dark explicitly
 * rather than cycling, because a four-state control behind one glyph cannot
 * say which state it is in — and `mix` in particular is a deliberate choice
 * rather than a step on a ramp, so landing on it by pressing a moon twice
 * would be worse than not reaching it here at all.
 *
 * FROM `mix`, THIS GOES TO DARK, which is the honest answer: `resolvedTheme`
 * is "mix", so `dark` is false, so the glyph is a moon and the moon means
 * "make it dark". Getting back to mix is a trip to the profile page or the
 * palette (`nav-search.tsx` offers all four), which is the cost of a mode the
 * OS cannot report.
 *
 * MOUNTED-GUARDED. `useTheme` returns `undefined` on the server and on the
 * first client render, so painting a glyph before that resolves means
 * rendering a sun into a dark page for one frame. Rendering the BOX and not
 * the glyph keeps the bar's geometry stable — the alternative jumps every
 * control to its left when the icon arrives.
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      className="size-8 shrink-0 rounded-control p-0 text-topbar-foreground hover:bg-topbar-control active:bg-topbar-control [&_svg]:size-4"
    >
      {mounted && (dark ? <Sun aria-hidden /> : <Moon aria-hidden />)}
    </Button>
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
