"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The app's one navigation surface: a full-height rail that stays put while
 * everything beside it scrolls.
 *
 * IT IS NEAR-BLACK, NOT A GRADIENT. It used to be indigo-600 → violet-800,
 * which is the most common "we picked a colour" tell in early SaaS: it
 * competes with the content beside it, every coloured step icon on the canvas
 * has to shout over it, and it dates within a year. A near-black rail with a
 * blue cast recedes, gives the one accent colour something to mean, and is
 * where the tools people keep open all day — Linear, Vercel, Supabase — have
 * all landed. The tokens live in globals.css under `--color-ink-*`.
 *
 * 256px, not 192px. The old rail wrapped "Integrations" against its own icon
 * and left no room to ever add a second line of context under a label; 256 is
 * the width every comparable product converged on for the same reason.
 *
 * The active tab is derived from the path, so no page passes it in.
 */
const NAV: Array<{ href: string; label: string; icon: ReactNode; match: (p: string) => boolean }> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <DashboardIcon />,
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/metrics") || p.startsWith("/dashboard/funnels"),
  },
  { href: "/dashboard/flows", label: "Flows", icon: <FlowsIcon />, match: (p) => p.startsWith("/dashboard/flows") },
  {
    href: "/integrations",
    label: "Integrations",
    icon: <PlugIcon />,
    match: (p) => p.startsWith("/integrations") || p.startsWith("/connections"),
  },
  { href: "/dashboard/settings", label: "Settings", icon: <SettingsIcon />, match: (p) => p.startsWith("/dashboard/settings") },
];

export function Sidebar({ footer }: { footer?: ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-ink-950 text-ink-100">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5">
        {/* The one place the accent appears in the rail, so the wordmark reads
            as the brand rather than as another nav item. */}
        <span className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 text-small font-bold text-white" aria-hidden>
          N
        </span>
        <span className="text-lead font-semibold tracking-tight text-ink-50">Namzilabs</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center gap-3 rounded-control px-3 py-2 text-base font-medium transition-colors ${
                active ? "bg-ink-900 text-ink-50" : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              }`}
            >
              <span className={`shrink-0 transition-colors ${active ? "text-brand-400" : "text-ink-400 group-hover:text-ink-100"}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Account controls live at the bottom of the rail, the way every
          sidebar product does it — the top bar is for what you are looking
          at, not for who you are. */}
      {footer && <div className="border-t border-ink-700 p-3">{footer}</div>}
    </aside>
  );
}

function DashboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function FlowsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
      <path d="M7 11v3a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
