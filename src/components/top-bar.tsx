"use client";

import Link from "next/link";
import { Bell, Gift, Link2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE TOP BAR — who you are, what the product is selling, and the state of
 * what you are looking at. Three zones, and all three changed on 8 Sep 2026.
 *
 * THE MARK LEFT, AND THE PERSON TOOK ITS PLACE. The wordmark sat at the reading
 * edge on the argument that the bar had nothing else to say there once the
 * workspace switcher moved into the rail. Node 49:5370 disagrees: the reading
 * edge is the ACCOUNT — avatar, name, and an offer — and the product's name
 * appears once, in the centre, inside the sentence selling it. Saying
 * "Namzilabs" in the corner of a product you are already inside is the same
 * observation the rail's own head block made about the switcher.
 *
 * THE TWO ACTS LEFT TOO, IN OPPOSITE DIRECTIONS. "Invite members" went DOWN
 * into the rail's foot as a card (node 49:5734) and "New flow" went down as the
 * lime "New" button under it; the gift that used to be the rail's "Get Free
 * Access" came UP here (node 51:5756). The bar and the rail swapped an act for
 * an offer, and each ended up where it has room to say what it is.
 *
 * THE CENTRE IS SHARED, AND THE BUILDER STILL WINS IT. `#topbar-slot` portals
 * the flow builder's whole toolbar into this bar — its controls hold the
 * canvas's undo stack and save state, so they cannot be lifted out of it.
 * The promo line is the centre's RESTING state and yields the moment the slot
 * is occupied, which is what the retired `peer` machinery used to do for the
 * greeting. It is back for the same reason it existed: two things want one
 * position and neither page should have to say which.
 *
 * 65px (node 58:5926), `--chrome` fill, `--chrome-border` bottom rule.
 *
 * IT SITS BESIDE THE RAIL, NOT ABOVE IT — the frame is a row, and this bar is
 * a child of the content column, 1660 of the frame's 1920. See `app-frame.tsx`
 * for why that reversed.
 *
 * EVERY INK HERE IS A `--chrome-*` ROLE, and that is the point of them. This
 * band is #121214 in BOTH themes — 49:5268 and 58:5824 draw it identically —
 * so `text-foreground` would be near-black on it the moment the light theme is
 * on, and `border-border` would be #E1E1E1. A permanently dark surface cannot
 * borrow the content's vocabulary, because it is not on the content's ground.
 */

export function TopBar({
  account,
  accountName,
  menu,
  unread = 1,
}: {
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /**
   * The signed-in person's name, beside their avatar (node 58:5930).
   *
   * IT WAS `firstName`, AND IT WAS BOTH UNUSED AND MISNAMED. The prop spent
   * three re-themes accepted-and-never-passed — it was the greeting's name, the
   * greeting was deleted, and it stayed on the type because a caller was
   * *believed* to pass it. None did, so the bar rendered the avatar and the
   * gift with a gap where the name goes, on every route, and nothing failed
   * because an optional prop nobody sets is not an error.
   *
   * Renamed with the fix: `AppShell` supplies `profile.displayName`, which is
   * the whole name the customer set — "Elias Andersson" in the Figma, not
   * "Elias". A prop called `firstName` holding a full name is the kind of lie
   * that survives for years.
   */
  accountName?: string;
  /**
   * The phone's way into the navigation — `MobileDrawer`, built by
   * `AppFrame` and handed down as a node.
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
    <header className="flex h-[65px] shrink-0 items-center justify-between gap-4 border-b border-topbar-border bg-topbar px-6 py-4">
      {/* ── WHO YOU ARE ──────────────────────────────────────────────────
          The menu button exists only below `md`, where there is no rail to the
          left of this bar — it is the phone's whole navigation, so it takes
          the reading edge and the account steps right by 40px. */}
      <div className="flex shrink-0 items-center gap-4">
        {menu}
        {account && (
          <Link
            href="/dashboard/profile"
            aria-label="Your profile"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "rounded-full bg-topbar-accent text-xs font-semibold text-topbar-foreground hover:brightness-110 active:brightness-95",
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
        {accountName && (
          <span className="hidden shrink-0 text-sm font-semibold text-topbar-foreground sm:inline">{accountName}</span>
        )}

        {/* THE OFFER, WITH A DOT ON IT. It was "Get Free Access" — a filled
            secondary button at the foot of the rail — and it is a bare glyph
            here, because a filled button beside an avatar reads as an act you
            are being pushed toward rather than an offer you may take.
            The dot is `--primary`, and it is the one place in this bar the
            brand appears as a fill. It is decoration, not a count: `aria-hidden`
            so it is never announced as an unread number, which is the bell's
            job three controls to the right. */}
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

      {/* ── WHAT THE PRODUCT IS, OR WHAT YOU ARE BUILDING ────────────────
          KEEP THE ID. Losing `#topbar-slot` does not degrade the builder, it
          breaks it: `document.getElementById("topbar-slot")` (see
          `FlowToolbar.tsx`) returns null and the toolbar renders nowhere.

          `peer` + `empty:hidden` + `peer-[:not(:empty)]:hidden` is the
          arbitration: the slot claims no width while empty, and the promo
          removes itself the moment the slot has anything in it. Neither page
          has to know the other exists. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div id="topbar-slot" className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
        {/* ALL THREE SPANS ARE ITALIC, and only the middle one carries weight
            and colour — which is how the Figma sets it (node 51:5788): the
            sentence leans, the NAME is what stands out inside it. `<em>` is
            already italic, so the class would be a second spelling of the tag. */}
        <p className="hidden shrink-0 text-sm italic text-topbar-foreground peer-[:not(:empty)]:hidden lg:block">
          <em>Try </em>
          <em className="font-black text-rail-brand">Namzilabs</em>
          <em> for free</em>
        </p>
      </div>

      {/* ── THE STATE OF WHAT YOU ARE LOOKING AT ─────────────────────────── */}
      <div className="flex shrink-0 items-center gap-4">
        {/* "Updated just now" lands HERE, from the page that knows. A bar
            cannot honestly claim a freshness it has not measured, so this
            stays a slot rather than a string — the builder already fills it,
            and it is where the dashboard's own freshness belongs. */}
        <div id="topbar-status" className="flex shrink-0 items-center text-sm text-topbar-muted empty:hidden" />

        <ShareLink />
        <ThemeToggle />

        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
          className="relative rounded-full text-topbar-foreground hover:bg-topbar-accent active:bg-topbar-accent"
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
      className="hidden h-auto shrink-0 px-0 text-sm font-semibold text-topbar-foreground hover:bg-transparent hover:text-topbar-muted active:bg-transparent md:inline-flex [&_svg]:size-3.5"
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
      className="h-auto shrink-0 px-0 text-topbar-foreground hover:bg-transparent hover:text-topbar-muted active:bg-transparent [&_svg]:size-4"
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
