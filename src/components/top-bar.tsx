"use client";

import { Bell, Link2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
  unread = 1,
}: {
  /**
   * The phone's way into the navigation — `MobileDrawer`, built by `AppFrame`
   * and handed down as a node. It is the ONLY thing in this bar that is not
   * in the Figma, and it has to be: below `md` the rail is not rendered at
   * all, so without this there is no route to any of it.
   */
  menu?: ReactNode;
  /** Unread notifications. Placeholder until notifications have a store. */
  unread?: number;
}) {
  return (
    /* 56px = 16 of top padding, a 32px control row, and 8 under it — node
       35:6027's own box, and the reason this is `pt-4 pb-2` rather than a
       symmetric `py`. The prose sits ABOVE the tag deliberately:
       tests/page-width.test.ts reads a bar's height by matching
       `<header className="…"`, and a comment between the two breaks it. */
    <header className="flex h-14 shrink-0 items-center gap-2 bg-topbar px-6 pb-2 pt-4">
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
      /* NO `font-normal` AND NO `leading-5` ANY MORE — both were overrides of
         a base that has come round to the frame's own values. Share is
         13/16/400 at node 35:6039, which is now exactly what `text-button`
         means, so spelling either here would be a call site re-stating the
         rung it already stands on. */
      className="hidden h-auto shrink-0 gap-1.5 rounded-control p-2 text-button text-topbar-foreground hover:bg-topbar-control active:bg-topbar-control md:inline-flex [&_svg]:size-3.5"
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
