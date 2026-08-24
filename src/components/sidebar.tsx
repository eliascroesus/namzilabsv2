"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, LayoutDashboard, Plug, Settings, Workflow } from "lucide-react";

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
    <aside className="flex h-full w-[76px] shrink-0 flex-col items-center px-2 sm:w-[100px] sm:px-2.5">
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
        className="mb-[11px] flex h-[72px] w-full items-center justify-center rounded-card text-title font-semibold text-white transition-opacity hover:opacity-85 focus-ring-light sm:h-[106px]"
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

          The 30px gap tightens to 22px below `sm`, where vertical room is the
          scarce thing rather than horizontal — four items at the desktop pitch
          pushed the account avatar off a short phone viewport. */}
      <nav className="flex w-full flex-col items-center gap-[22px] sm:gap-[30px]">
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

      <span className="flex-1" />

      <span className="pb-4">{account && <RailAccount initials={account.initials}>{account.panel}</RailAccount>}</span>
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
