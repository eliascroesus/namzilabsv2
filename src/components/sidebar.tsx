"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, LayoutDashboard, Plug, Radio, Settings, Workflow } from "lucide-react";

/**
 * THE RAIL: an icon column carrying the product's one dark surface.
 *
 * IT HAS BEEN FOUR THINGS. A saturated indigo→violet gradient (Make's, not
 * ours), then near-black, then cool graphite, and now the warm near-black it
 * should have been from the start. The graphite was right about contrast and
 * wrong about material: a COOL grey bar down the side of a warm app is two
 * different greys that never quite agree, and the eye reads that as a
 * component bolted on rather than as part of the same object.
 *
 * `ink-950` is cut from the same warm ramp as the paper to its right, so the
 * rail and the page are one material at two exposures. It is deliberately NOT
 * the accent: this is the 30 in a 60/30/10, and primary ultramarine needs
 * something to pop against.
 *
 * The rail does not PAINT its own background — it sits transparent on the one
 * AppFrame paints, which also fills the notches at the canvas's left corners.
 * One declaration rather than two, so the rail and the notch cannot drift
 * apart at the seam.
 *
 * The active item is derived from the path; no page passes it in.
 */
const NAV: Array<{ href: string; label: string; icon: ReactNode; match: (p: string) => boolean }> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard size={24} strokeWidth={2} />,
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/metrics") || p.startsWith("/dashboard/funnels"),
  },
  // Directly under Dashboard, because it is the same numbers seen a different
  // way — the board answers "what is this metric right now", the calendar
  // answers "which days made it". Nav order is a claim about relatedness.
  {
    href: "/dashboard/calendar",
    label: "Calendar",
    icon: <CalendarDays size={24} strokeWidth={2} />,
    match: (p) => p.startsWith("/dashboard/calendar"),
  },
  // Third, and that is the ordering claim again: the two above are the same
  // numbers seen two ways, and this is the RECORDS those numbers are made of.
  // It sits after them and before Flows, so the rail reads outward from the
  // answer — what it says, which days made it, what arrived, how it is built,
  // where it comes from. It used to be a card at the foot of the dashboard,
  // competing with the tiles for one glance while answering a different
  // question entirely ("is data still coming in").
  {
    href: "/dashboard/activity",
    label: "Activity",
    icon: <Radio size={24} strokeWidth={2} />,
    match: (p) => p.startsWith("/dashboard/activity"),
  },
  { href: "/dashboard/flows", label: "Flows", icon: <Workflow size={24} strokeWidth={2} />, match: (p) => p.startsWith("/dashboard/flows") },
  {
    href: "/integrations",
    label: "Apps",
    icon: <Plug size={24} strokeWidth={2} />,
    match: (p) => p.startsWith("/integrations") || p.startsWith("/connections"),
  },
  { href: "/dashboard/settings", label: "Settings", icon: <Settings size={24} strokeWidth={2} />, match: (p) => p.startsWith("/dashboard/settings") },
];

export function Sidebar({
  account,
  hide,
}: {
  account?: { initials: string; panel: ReactNode };
  /** NAV labels to omit. Dumb on purpose: the shell decides WHO sees what. */
  hide?: string[];
}) {
  const pathname = usePathname() ?? "";
  return (
    // NARROWER BELOW `sm`. At a flat 100px the rail took a quarter of a 390px
    // phone for four icons, and every table to its right paid for it. 76px
    // still holds the 40px tile and its label; the tile itself never shrinks,
    // because it is the touch target.
    // THE ASIDE ITSELF MUST NOT SCROLL, and this is a trap worth naming because
    // the obvious fix for a too-tall rail walks straight into it. Activity made
    // the stack six items, which on a short viewport (a phone in landscape, a
    // half-height window) can push the account avatar past the bottom edge — so
    // `overflow-y-auto` here looks exactly right. It is not: when one axis is
    // `visible` and the other is not, CSS computes the visible one to `auto`
    // too, so this element becomes a scroll container on BOTH axes. The account
    // panel is `absolute left-full` — it renders entirely outside this 76px
    // column — so it would be clipped to nothing, taking the workspace switcher
    // and Sign out with it.
    //
    // The scroll belongs to the NAV, which is the part that actually grows. See
    // below.
    <aside className="flex h-full w-[84px] shrink-0 flex-col items-center px-2 sm:w-[124px] sm:px-3">
      {/* THE WORDMARK IS THE TOP BAR'S HEIGHT.
          The rail's mark and the canvas's top island sit at the same y, so when
          they were different heights the two read as misaligned furniture. It
          now spans the island's WHOLE band — 24px inset + 58px island + 24px —
          so the mark's centre lands on the island's centre at y=53. Matching
          the band's bottom edge instead (74px) put the mark 8px high: a 44px
          round mark and a 58px bar read as aligned when their middles agree,
          not their edges.

          The 11px beneath is Make's: its logo centre sits at y=35 and its first
          icon centre at y=101 under a 70px band, leaving 101 - 20 - 70 = 11.

          That 106px is a DESKTOP measurement — it exists to line the mark up
          with the builder's top island, and the builder is not a phone screen.
          Below `sm` it collapses to 72px, which buys back a whole nav item's
          worth of vertical space on a short viewport. */}
      <Link
        href="/dashboard"
        title="Namzilabs — dashboard"
        className="mb-[11px] flex h-[72px] w-full shrink-0 items-center justify-center rounded-card text-title font-semibold text-white transition-opacity hover:opacity-85 focus-ring-light sm:h-[106px]"
      >
        {/* THE MARK IS NOT A NAV TILE. It used to be a white wash like the
            active item's, and once resting glyphs stopped dimming it became the
            only washed tile on an unselected rail — so it read as a selected
            fifth item. The accent makes it unmistakably the product rather than
            a destination, and it is the one spot of brand colour on the rail. */}
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-primary text-primary-foreground">N</span>
      </Link>

      {/* Make's rail, measured: 80px wide, a 40px rounded tile holding the
          icon, and an 11px label on a 15px line sitting FLUSH beneath the tile
          — no gap. That flushness is measured, not guessed: icon centre to
          label centre is 27px, and 40/2 + 15/2 = 27.5, which only works with
          the two touching. The 15px line is confirmed independently by items
          whose label wraps, which grow the pitch by exactly one line (67 -> 82).

          What we keep from that measurement is the SHAPE: the 40px tile, and
          the label flush beneath it with no gap. The rest is the user's own
          call on top of it and is not to be "corrected" back to Make's — the
          rail is 100px (80px of content, the width Make had, plus 10px of air
          each side), the items breathe at 30px rather than 12, and the label
          is text-tiny (12px) on a 16px line so it sits on our type scale
          instead of one-off 11-on-15. Pitch is therefore 40 + 16 + 30 = 86.

          The ACTIVE state highlights the tile only — not the label. Ours
          highlighted the whole item as one white pill, which is a different
          (and heavier) thing entirely.

          The 30px gap tightens to 18px below `sm`, where vertical room is the
          scarce thing rather than horizontal — four items at the desktop pitch
          pushed the account avatar off a short phone viewport. It was 22px for
          five items; Activity makes six, and 18px buys back exactly the 20px
          the new one costs, so the mobile stack ends where it did before.

          THE NAV IS THE SCROLL REGION, not the rail (see the aside's note): it
          takes the leftover height with `flex-1 min-h-0` and scrolls inside it,
          so the mark above and the account control below stay pinned and the
          panel that opens beside the avatar is not clipped by anything. This is
          the shape every rail-and-account product uses, and it is what makes a
          seventh item free.

          `-mx-1.5 px-1.5` is the range track's trick, for the same reason: a
          bare scrollport clips its children's focus ring, so the first and last
          item lose their outline exactly when a keyboard user reaches them. The
          outline is 2px at 2px offset — 4px — and the 6px of padding holds it,
          while the negative margin keeps every tile at the width it had. `-my-1
          py-1` does the same at the two ends the scroll actually cuts.

          `justify-start` so a short list stays at the top rather than centring
          itself in the leftover space. */}
      <nav className="-mx-1.5 -my-1 flex w-[calc(100%+0.75rem)] min-h-0 flex-1 flex-col items-center justify-start gap-[18px] overflow-y-auto overscroll-contain px-1.5 py-1 sm:gap-[30px]">
        {NAV.filter((item) => !hide?.includes(item.label)).map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="group flex w-full flex-col items-center rounded-control focus-ring-light"
            >
              {/* The GLYPH is full white at every state — it is the item's
                  identifier, and an identifier you have to squint at is a poor
                  one. Selection is carried by the two things around it: the
                  tile's wash and the label's step up from 75% to full. */}
              {/* `rounded-card`, matching the mark above it. At the control
                  radius the four tiles were 8px in a column headed by a 12px
                  mark, beside a page whose own corner is cut at 32 — three
                  roundnesses down one 100px strip. One step rounder is all it
                  takes for the rail to read as one family. */}
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-card text-white transition-colors duration-(--duration-fast) ${
                  active ? "bg-white/15" : "group-hover:bg-white/10"
                }`}
              >
                {item.icon}
              </span>
              <span
                className={`px-1 text-center text-tiny font-medium leading-4 transition-colors ${
                  active ? "text-white" : "text-white/75 group-hover:text-white"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* The `flex-1` spacer that used to sit here is gone: the nav above now
          takes the leftover height itself, which is what lets it scroll instead
          of overflowing. Two `flex-1` children would split that space between
          them and the nav would never fill enough of the column to need a
          scrollbar — it would simply run past the avatar again. */}
      <span className="shrink-0 pb-4">{account && <RailAccount initials={account.initials}>{account.panel}</RailAccount>}</span>
    </aside>
  );
}

/**
 * The account control, at the rail's foot: an avatar that opens a light panel
 * beside the rail (workspace switcher + sign-out live in there). A panel
 * rather than inline controls, because a 100px column cannot hold a workspace
 * name and should not try.
 */
function RailAccount({ initials, children }: { initials: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Account"
        aria-label="Account"
        aria-expanded={open}
        className={`flex h-9 w-9 items-center justify-center rounded-full text-micro font-semibold text-white ring-1 ring-white/25 transition-colors duration-(--duration-fast) focus-ring-light ${
          open ? "bg-white/25" : "bg-white/15 hover:bg-white/25"
        }`}
      >
        {initials}
      </button>
      {/* `shadow-panel`, not `pop`: this popover draws a real border, and
          pop's 1px spread ring under one reads as a second, darker hairline. */}
      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-3 w-64 rounded-surface border border-border bg-card p-3 shadow-panel">
          {children}
        </div>
      )}
    </div>
  );
}
