"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutDashboard, Plug, Settings, Workflow } from "lucide-react";

/**
 * THE RAIL: a 76px icon column, ink-black, on every authenticated screen —
 * including the flow editor.
 *
 * It was 256px with word labels, and the editor had dropped it entirely,
 * which left the canvas with a bare left edge and moved navigation into a ⋮
 * menu nobody could see. Make's answer (and Notion Calendar's, and Height's)
 * is the middle size: icons with micro-labels, wide enough to be legible,
 * narrow enough that the editor keeps its room. One rail, both worlds — the
 * app never switches navigation furniture between screens again.
 *
 * The active item is derived from the path; no page passes it in.
 */
const NAV: Array<{ href: string; label: string; icon: ReactNode; match: (p: string) => boolean }> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard size={20} strokeWidth={1.9} />,
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/metrics") || p.startsWith("/dashboard/funnels"),
  },
  { href: "/dashboard/flows", label: "Flows", icon: <Workflow size={20} strokeWidth={1.9} />, match: (p) => p.startsWith("/dashboard/flows") },
  {
    href: "/integrations",
    label: "Apps",
    icon: <Plug size={20} strokeWidth={1.9} />,
    match: (p) => p.startsWith("/integrations") || p.startsWith("/connections"),
  },
  { href: "/dashboard/settings", label: "Settings", icon: <Settings size={20} strokeWidth={1.9} />, match: (p) => p.startsWith("/dashboard/settings") },
];

export function Sidebar({ account }: { account?: { initials: string; panel: ReactNode } }) {
  const pathname = usePathname() ?? "";
  return (
    <aside className="flex h-full w-[76px] shrink-0 flex-col items-center bg-ink-950 py-3">
      {/* The brand tile — the rail's only chroma, and the way home. */}
      <Link
        href="/dashboard"
        title="Namzilabs — dashboard"
        className="mb-4 flex h-9 w-9 items-center justify-center rounded-control bg-primary text-lead font-bold text-primary-foreground transition-all hover:brightness-110"
      >
        N
      </Link>

      <nav className="flex w-full flex-1 flex-col items-stretch gap-1 px-2">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group flex flex-col items-center gap-1 rounded-control px-1 py-2 transition-colors ${
                active ? "bg-ink-800 text-ink-50" : "text-ink-400 hover:bg-ink-900 hover:text-ink-100"
              }`}
            >
              <span className={`transition-colors ${active ? "text-brand-400" : "text-ink-400 group-hover:text-ink-100"}`}>{item.icon}</span>
              <span className="text-micro font-medium leading-none">{item.label}</span>
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
        className={`flex h-9 w-9 items-center justify-center rounded-full text-micro font-semibold transition-colors ${
          open ? "bg-ink-700 text-ink-50" : "bg-ink-800 text-ink-100 hover:bg-ink-700"
        }`}
      >
        {initials}
      </button>
      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-3 w-64 rounded-card border border-neutral-200 bg-white p-3 flow-shadow">
          {children}
        </div>
      )}
    </div>
  );
}
