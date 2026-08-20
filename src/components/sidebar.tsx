"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutDashboard, Plug, Settings, Workflow } from "lucide-react";

/**
 * THE RAIL: a 100px icon column carrying the product's colour.
 *
 * It has been three things now — a saturated gradient, then near-black, then
 * graphite — and the graphite was right about contrast and wrong about
 * feeling: a grey bar down the side of a grey app is correct and joyless. The
 * wash is back, but built rather than picked: anchored on our own brand at
 * the top, warming through violet to fuchsia, on a rail whose icons and
 * labels were designed for it (they were not, the first time).
 *
 * This is the one place in the product allowed to be loud. Everything to the
 * right of it stays neutral, which is exactly what lets the rail carry colour
 * without the app becoming noisy.
 *
 * The rail no longer PAINTS that wash — it sits on it, transparent, and
 * AppFrame paints it for both the rail and the notches at the canvas's left
 * corners. One gradient rather than two identical declarations, so the two
 * cannot drift apart at the seam.
 *
 * The active item is derived from the path; no page passes it in.
 */
const NAV: Array<{ href: string; label: string; icon: ReactNode; match: (p: string) => boolean }> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard size={24} strokeWidth={2.1} />,
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/metrics") || p.startsWith("/dashboard/funnels"),
  },
  { href: "/dashboard/flows", label: "Flows", icon: <Workflow size={24} strokeWidth={2.1} />, match: (p) => p.startsWith("/dashboard/flows") },
  {
    href: "/integrations",
    label: "Apps",
    icon: <Plug size={24} strokeWidth={2.1} />,
    match: (p) => p.startsWith("/integrations") || p.startsWith("/connections"),
  },
  { href: "/dashboard/settings", label: "Settings", icon: <Settings size={24} strokeWidth={2.1} />, match: (p) => p.startsWith("/dashboard/settings") },
];

export function Sidebar({ account }: { account?: { initials: string; panel: ReactNode } }) {
  const pathname = usePathname() ?? "";
  return (
    <aside className="flex h-full w-[100px] shrink-0 flex-col items-center px-2.5">
      {/* THE WORDMARK IS THE TOP BAR'S HEIGHT.
          The rail's mark and the canvas's top island sit at the same y, so when
          they were different heights the two read as misaligned furniture. It
          now spans the island's WHOLE band — 24px inset + 58px island + 24px —
          so the mark's centre lands on the island's centre at y=53. Matching
          the band's bottom edge instead (74px) put the mark 8px high: a 44px
          round mark and a 58px bar read as aligned when their middles agree,
          not their edges.

          The 11px beneath is Make's: its logo centre sits at y=35 and its first
          icon centre at y=101 under a 70px band, leaving 101 - 20 - 70 = 11. */}
      <Link
        href="/dashboard"
        title="Namzilabs — dashboard"
        className="mb-[11px] flex h-[106px] w-full items-center justify-center text-title font-bold text-white transition-opacity hover:opacity-85"
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
          (and heavier) thing entirely. */}
      <nav className="flex w-full flex-col items-center gap-[30px]">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="group flex w-full flex-col items-center"
            >
              {/* The GLYPH is full white at every state — it is the item's
                  identifier, and an identifier you have to squint at is a poor
                  one. Selection is carried by the two things around it: the
                  tile's wash and the label's step up from 75% to full. */}
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-control text-white transition-colors ${
                  active ? "bg-white/22" : "group-hover:bg-white/12"
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
        className={`flex h-9 w-9 items-center justify-center rounded-full text-micro font-bold ring-1 ring-white/25 transition-all ${
          open ? "bg-white/35 text-white" : "bg-white/20 text-white hover:bg-white/30"
        }`}
      >
        {initials}
      </button>
      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-3 w-64 rounded-surface bg-white p-3 shadow-pop">
          {children}
        </div>
      )}
    </div>
  );
}
