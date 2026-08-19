"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutDashboard, Plug, Settings, Workflow } from "lucide-react";

/**
 * THE RAIL — Zapier's shape: narrow, solid, icons only.
 *
 * It has been 256px with labels, then 76px with labels under a gradient, and
 * the labels were the problem: four words stacked down the side of a canvas
 * app, each in 11px, reading as a list rather than a rail. Zapier's is 60px of
 * icons with nothing else, and it disappears until you want it — which is the
 * correct behaviour for navigation in a tool you spend hours inside.
 *
 * Labels move to tooltips. That is a real trade: a first-time user has to
 * hover to learn "Apps". Four destinations with distinct glyphs is inside the
 * budget where that is fine, and the icons are the standardised 24px from the
 * kit rather than a smaller set drawn for a narrow rail.
 *
 * SOLID, not a gradient. A wash needs height to read as one, and at 60px it
 * was a smear; the deep navy that anchored it carries the colour on its own.
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
    <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-1 bg-ink-950 py-3">
      <Link
        href="/dashboard"
        title="Namzilabs — dashboard"
        className="mb-2 flex h-10 w-10 items-center justify-center rounded-control bg-primary text-lead font-bold text-primary-foreground transition-all hover:brightness-110"
      >
        N
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-1">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-control transition-colors ${
                active ? "bg-white/12 text-white" : "text-white/45 hover:bg-white/8 hover:text-white/85"
              }`}
            >
              {item.icon}
            </Link>
          );
        })}
      </nav>

      {account && <RailAccount initials={account.initials}>{account.panel}</RailAccount>}
    </aside>
  );
}

/**
 * The account control, at the rail's foot: an avatar that opens a light panel
 * beside the rail (workspace switcher + sign-out live in there). A panel
 * rather than inline controls, because a 76px column cannot hold a workspace
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
        className={`flex h-9 w-9 items-center justify-center rounded-full text-micro font-bold transition-colors ${
          open ? "bg-white/25 text-white" : "bg-white/12 text-white/85 hover:bg-white/20 hover:text-white"
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
