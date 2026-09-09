"use client";

import Link from "next/link";
import { Bell, Gift, Link2, Moon, Sun } from "lucide-react";
import { NavSearch } from "@/components/nav-search";
import type { BoardView } from "@/lib/board/types";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — TWO BANDS OF THE FIGMA'S THREE.
 *
 * Node 0:5 stacks three: 57px of search and account, 49px of page title and app
 * controls, 43px of view tabs and board controls. The third belongs to the
 * board and lives in `board-controls.tsx`; these two are the app's.
 *
 * THE HEIGHTS ARE NOT FREE NUMBERS. 57 + 49 + 43 = 149, which is exactly where
 * the frame starts its content container. Each is its own content plus 8+8 of
 * padding and a 1px rule: 40 of search, 32 of control, 26 of button. Get one
 * wrong and the board sits at the wrong y with every class still correct — see
 * `scripts/geometry-check.mjs`, which exists because that happened.
 *
 * THIS BAND IS WHITE NOW, ON LIGHT. It was `--chrome` at #121214 in both
 * themes, and the reasoning was sound for the frames it was drawn from: 49:5268
 * and 58:5824 draw the rail and the bar byte-identical. Node 0:5 draws the rail
 * #121214 and the bar WHITE in the same picture, so the one token became two —
 * `--rail-*` keeps every value it had, `--topbar-*` moved. Neither can borrow
 * the content's vocabulary, which is why both are role families rather than
 * `--foreground` and `--border`.
 *
 * TWO THINGS HERE REVERSE A DECISION THIS FILE USED TO ARGUE FOR, and they are
 * the owner's call against an unambiguous frame rather than a drift. The
 * wordmark is back at the reading edge, having left on the argument that naming
 * the product inside the product says nothing; and the promo sentence that took
 * the centre is deleted. The account's NAME went with it — the search occupies
 * that space now, and node 0:5 draws avatar and gift alone.
 *
 * THE CENTRE IS STILL THE BUILDER'S. `#topbar-slot` portals the flow builder's
 * whole toolbar into bar one — its controls hold the canvas's undo stack and
 * save state, so they cannot be lifted out of it. The mark is the centre's
 * resting state and yields the moment the slot is occupied.
 *
 * IT SITS BESIDE THE RAIL, NOT ABOVE IT — the frame is a row, and these bars
 * are children of the content column, 1660 of the frame's 1920.
 */


export function TopBar({
  account,
  views,
  hide,
  menu,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /** The workspace's views, for the bar's search. */
  views?: BoardView[];
  /** Nav rows a restricted rank cannot reach, so search cannot find them either. */
  hide?: string[];
  /**
   * The phone's way into the navigation — `MobileDrawer`, built by
   * `AppFrame` and handed down as a node.
   */
  menu?: ReactNode;
  /** Unread notifications. Placeholder until notifications have a store. */
  unread?: number;
}) {
  return (
    <>
      {/* ── BAR ONE, 57px ─────────────────────────────────────────────────
          40px of search over 8+8 padding and a hairline. The three heights in
          this file are not free numbers: 57 + 49 + 43 is 149, which is exactly
          where node 0:5 starts its content container. If one of them is wrong
          the sum breaks and the whole board sits at the wrong y.

          The prose sits ABOVE the tag deliberately: tests/page-width.test.ts
          reads a bar's height by matching `<header className="…"`, and a
          comment between the two breaks it. */}
      <header className="flex h-[57px] shrink-0 items-center justify-between gap-4 border-b border-topbar-border bg-topbar px-6 py-2">
        {/* ── WHO YOU ARE, AND WHAT YOU ARE LOOKING FOR ──────────────────
            480px, `gap-2`. The menu button exists only below `md`, where there
            is no rail to the left of this bar — it is the phone's whole
            navigation, so it takes the reading edge. */}
        {/* 480 IS THE FRAME'S NUMBER, AND THE FRAME IS 1920 WIDE. Below `md`
            a fixed 480 is wider than the phone it is on, so the group takes the
            width it has and claims the Figma's only where there is room —
            `tests/mobile-content.test.ts` fails on the unguarded version. */}
        <div className="flex w-full min-w-0 items-center gap-2 md:w-[480px] md:shrink-0">
          {menu}
          <NavSearch views={views} hide={hide} />
          {account && (
            <Link
              href="/dashboard/profile"
              aria-label="Your profile"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "size-8 shrink-0 rounded-full bg-topbar-accent text-xs font-semibold text-topbar-accent-foreground hover:brightness-110 active:brightness-95",
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

          {/* THE OFFER, WITH A DOT ON IT. It was "Get Free Access" — a filled
              secondary button at the foot of the rail — and it is a bare glyph
              here, because a filled button beside an avatar reads as an act you
              are being pushed toward rather than an offer you may take.
              The dot is `--primary`: decoration, not a count, so `aria-hidden`
              keeps it from being announced as an unread number. */}
          <Link
            href="/dashboard/settings"
            aria-label="Get free access"
            title="Get free access"
            className="relative flex size-5 shrink-0 items-center justify-center text-topbar-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:text-topbar-muted [&_svg]:size-5"
          >
            <Gift />
            <span aria-hidden className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary" />
          </Link>
        </div>

        {/* ── WHAT YOU ARE BUILDING, OR WHAT THE PRODUCT IS ────────────────
            KEEP THE ID. Losing `#topbar-slot` does not degrade the builder, it
            breaks it: `document.getElementById("topbar-slot")` (see
            `FlowToolbar.tsx`) returns null and the toolbar renders nowhere.

            THE MARK IS BACK AT THE READING EDGE, and this file used to argue
            against that: the wordmark left on the reasoning that naming the
            product in the corner of a product you are already inside says
            nothing. Node 0:5 puts it back, at 24/700 on the right, and deletes
            the promo sentence that took the centre. Both are the owner's call
            and the frame is unambiguous.

            `peer` + `empty:hidden` + `peer-[:not(:empty)]:hidden` is unchanged:
            the slot claims no width while empty, and the mark yields the moment
            the builder fills it. Neither page has to know the other exists. */}
        <div id="topbar-slot" className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
        <p className="shrink-0 text-2xl text-topbar-foreground peer-[:not(:empty)]:hidden">
          Namzilabs
        </p>
      </header>

      {/* ── BAR TWO, 49px ─────────────────────────────────────────────────
          A 32px control over 8+8 and a hairline. It is GLOBAL rather than the
          dashboard's, because Share, the moon and the bell are app controls
          and putting them on one page's header would take the theme toggle
          away from every other route.

          The title arrives through a slot for the same reason the freshness
          does: this bar cannot know what page it is on, and the nineteen
          callers of `PageHeader` keep their in-content <h1> untouched. */}
      <header className="flex h-[49px] shrink-0 items-center justify-between gap-4 border-b border-topbar-border bg-topbar px-6 py-2">
        <h1 id="topbar-title" className="text-2xl text-topbar-foreground empty:hidden" />

        {/* `ml-auto` rather than leaning on `justify-between`: the title beside
            this is a SLOT, and an unfilled slot is `empty:hidden`, which leaves the
            row one child and pushes the controls to the reading edge. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* "Updated just now" lands HERE, from the page that knows. A bar
              cannot honestly claim a freshness it has not measured, so this
              stays a slot rather than a string. */}
          <div id="topbar-status" className="flex shrink-0 items-center p-2 text-[13px] leading-4 text-topbar-muted empty:hidden" />

          <ShareLink />
          <ThemeToggle />

          <Button
            variant="ghost"
            size="icon"
            aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
            className="relative size-8 shrink-0 rounded-control text-topbar-foreground hover:bg-topbar-control active:bg-topbar-control [&_svg]:size-4"
          >
            <Bell />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-topbar bg-primary text-2xs font-semibold leading-none text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>
        </div>
      </header>
    </>
  );
}

/**
 * SHARE — A CHAIN LINK, SO IT COPIES A LINK.
 *
 * The Figma draws "Share" behind a chain glyph (node 49:5711). There is no
 * sharing FEATURE in the product — no permissions, no invited viewers, no
 * per-view ACL — and shipping a button that opens nothing would be worse than
 * the design not having one, so this does the thing the glyph actually
 * promises: it puts the current URL on the clipboard.
 *
 * That is honest and complete on its own terms. The day view-sharing exists,
 * this is the control it hangs off.
 *
 * The confirmation is the LABEL, not a toast. A toast for a clipboard write is
 * a notification about something the person just did on purpose; swapping the
 * word for two seconds says the same thing where they are already looking.
 */
function ShareLink() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      onClick={() => {
        navigator.clipboard?.writeText(window.location.href).then(
          () => setCopied(true),
          // A denied clipboard permission is not an error worth a dialog; the
          // label simply does not change, which reads as "that did nothing".
          () => {},
        );
      }}
      /* THE KIT'S BUTTON, STRIPPED TO A LABEL. `check:ui` bans a raw <button>
         here and is right to — a hand-rolled control is how the app grew two
         primaries — but the Figma draws this as a glyph and a word sitting on
         the bar with no box. `h-auto px-0` takes the rung's height and padding
         off while keeping the variant's states, its focus ring and its
         disabled handling, which is the half that actually matters. */
      className="hidden h-auto shrink-0 gap-1 rounded-control p-2 text-[13px] font-normal leading-4 text-topbar-foreground hover:bg-topbar-control active:bg-topbar-control md:inline-flex [&_svg]:size-3"
    >
      <Link2 aria-hidden />
      {/* `aria-live` so the change is announced rather than only seen. */}
      <span aria-live="polite">{copied ? "Copied" : "Share"}</span>
    </Button>
  );
}

/**
 * THE MOON, WHICH IS THE ONE CONTROL IN THIS BAR THE FIGMA DRAWS AND THE
 * PRODUCT ALREADY HAD.
 *
 * `ThemeChoice` (three radio rungs — light, dark, system) lives in the rail's
 * account panel and stays there; this is the one-press version the chrome
 * asks for. It toggles between light and dark explicitly rather than cycling
 * through `system`, because a three-state control behind one glyph cannot say
 * which state it is in.
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
