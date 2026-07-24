"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The app's static left navigation (Make.com-style): a full-height, colourful
 * rail — never white — that stays fixed while the page content scrolls beside
 * it. The active tab is derived from the current path, so no page needs to pass
 * it in.
 */
const NAV: Array<{ href: string; label: string; icon: ReactNode; match: (p: string) => boolean }> = [
  { href: "/dashboard", label: "Dashboard", icon: <DashboardIcon />, match: (p) => p === "/dashboard" || p.startsWith("/dashboard/metrics") || p.startsWith("/dashboard/funnels") },
  { href: "/dashboard/flows", label: "Flows", icon: <FlowsIcon />, match: (p) => p.startsWith("/dashboard/flows") },
  { href: "/integrations", label: "Integrations", icon: <PlugIcon />, match: (p) => p.startsWith("/integrations") || p.startsWith("/connections") },
];

export function Sidebar() {
  const pathname = usePathname() ?? "";
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-gradient-to-b from-indigo-600 via-indigo-700 to-violet-800 text-white">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-bold ring-1 ring-white/20">N</span>
        <span className="text-[15px] font-semibold tracking-tight">Namzilabs</span>
      </Link>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-white/15 text-white ring-1 ring-white/15" : "text-indigo-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className={`shrink-0 ${active ? "text-white" : "text-indigo-200"}`}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="px-5 py-4 text-[11px] font-medium text-indigo-200/70">Analytics that match your data.</p>
    </aside>
  );
}

function DashboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function FlowsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
      <path d="M7 11v3a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}
