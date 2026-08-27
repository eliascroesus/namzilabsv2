"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronsUpDown,
  LayoutDashboard,
  Plug,
  Radio,
  Search,
  Settings,
  Workflow,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";

/**
 * THE SIDEBAR — rebuilt from an icon rail into a named column.
 *
 * WHAT IT WAS: an 84/124px strip of 40px tiles with a 12px label under each,
 * painted on the product's one dark surface, with the page cut into it by a
 * 32px notch. It was handsome and it was the wrong shape for this app. Six
 * destinations do not need a wall; they need a list. And a dark column beside a
 * light page is a strong statement to make on every screen forever — it made
 * the chrome the loudest thing in a product whose whole thesis is that the
 * NUMBER should be.
 *
 * WHAT IT IS: Notion's shape. A 248px column on a recessed surface, flush with
 * the page (no notch), holding compact rows that read as text with an icon
 * rather than icons with a caption. Sections are separated by a label, not a
 * gap. The workspace sits at the top where you look for it, and the account and
 * theme sit at the foot.
 *
 * The rows are 30px, not 40: this is a list you scan, and Notion, Linear and
 * Vercel all sit between 28 and 32. At 40 with a 12px label the six items
 * occupied more vertical space than most of the pages they lead to.
 */
const NAV: Array<{ label: string; href: string; icon: typeof LayoutDashboard; section: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "Workspace" },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, section: "Workspace" },
  { label: "Activity", href: "/dashboard/activity", icon: Radio, section: "Workspace" },
  { label: "Flows", href: "/dashboard/flows", icon: Workflow, section: "Build" },
  { label: "Apps", href: "/integrations", icon: Plug, section: "Build" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, section: "Build" },
];

export function Sidebar({
  account,
  hide,
}: {
  account?: { initials: string; panel: ReactNode };
  hide?: string[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((i) => !hide?.includes(i.label));
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* THE WORKSPACE, AT THE TOP. It was at the bottom, inside the account
          panel, two clicks from anywhere — which is fine when you have one
          workspace and wrong the moment you have two. */}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="mx-2 mt-2 flex h-11 items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-sidebar-accent"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-control bg-primary text-micro font-semibold text-primary-foreground">
              N
            </span>
            <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">Namzilabs</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[232px]">
          {account?.panel}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Search is a row, not an icon. It is the fastest way into anything and
          it should say so in words. */}
      <button
        type="button"
        className="mx-2 mt-1 flex h-8 items-center gap-2 rounded-control px-2 text-left text-base text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <Search className="size-4 shrink-0" />
        Search
      </button>

      <nav className="quiet-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sections.map((section) => (
          <div key={section} className="mb-3">
            <p className="px-2 pb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              {section}
            </p>
            {items
              .filter((i) => i.section === section)
              .map(({ label, href, icon: Icon }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-[30px] items-center gap-2 rounded-control px-2 text-base transition-colors",
                      active
                        ? "bg-sidebar-accent font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-1 border-t border-border p-2">
        {account && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-semibold text-muted-foreground">
            {account.initials}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <ThemeToggle />
      </div>
    </aside>
  );
}
