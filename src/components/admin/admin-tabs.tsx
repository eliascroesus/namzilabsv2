"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * THE BACK OFFICE'S FIVE PLACES. Client-side only to know which one is open —
 * the layout that renders it is a server component and cannot see the path.
 */
const TABS = [
  { href: "/admin", label: "Overview", match: (p: string) => p === "/admin" },
  { href: "/admin/search", label: "Workspaces", match: (p: string) => p.startsWith("/admin/search") || p.startsWith("/admin/workspaces") },
  { href: "/admin/links", label: "Links", match: (p: string) => p.startsWith("/admin/links") },
  { href: "/admin/codes", label: "Codes", match: (p: string) => p.startsWith("/admin/codes") },
  { href: "/admin/log", label: "Log", match: (p: string) => p.startsWith("/admin/log") },
];

export function AdminTabs() {
  const path = usePathname() ?? "/admin";
  return (
    <nav aria-label="Admin" className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      {TABS.map((t) => {
        const on = t.match(path);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "rounded-control px-2.5 py-1.5 whitespace-nowrap transition-colors",
              on ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
