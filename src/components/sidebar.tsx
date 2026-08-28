"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronsUpDown, LayoutDashboard, Plug, Radio, Settings, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GROUP_ACCENT, GROUP_COLOR_KEYS } from "@/components/flow/node-accent";

/**
 * A WORKSPACE'S OWN COLOUR, derived rather than stored.
 *
 * One saturated chip is most of what stops a navigation column reading as
 * chrome. The hue comes from the name, through the palette the boards already
 * use, so two workspaces are reliably different and the same workspace is the
 * same colour on every device without a column to store it in.
 */
function workspaceAccent(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  // `grey` is the palette's "no colour" entry — skip it, or a third of
  // workspaces get a chip that looks like a disabled control.
  const keys = GROUP_COLOR_KEYS.filter((k) => k !== "grey");
  return GROUP_ACCENT[keys[h % keys.length]];
}
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
 * gap. The workspace switcher and the mark went UP to the top bar with the
 * create actions, which left this column doing one job: navigation.
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
  hide,
  workspace,
  account,
}: {
  hide?: string[];
  workspace?: string;
  account?: { initials: string; panel: ReactNode };
}) {
  const pathname = usePathname();
  const items = NAV.filter((i) => !hide?.includes(i.label));
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* THE WORKSPACE, AT THE HEAD OF THE COLUMN IT GOVERNS.
          It went to the top bar for one commit and that was wrong: switching
          workspace changes what every item BELOW it points at, so it belongs at
          the top of that list, not in a bar beside the product's own mark —
          where it also read as a second wordmark saying the same word twice. */}
      {account && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mx-2 mt-2 flex h-11 items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-muted"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-control text-micro font-semibold text-white"
                style={{ background: workspaceAccent(workspace ?? "Workspace") }}
                aria-hidden
              >
                {(workspace ?? "W").slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
                {workspace ?? "Workspace"}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          {/* Matched to the trigger's own width so the panel reads as the
              control opening rather than as a card landing beside it. */}
          <DropdownMenuContent align="start" className="w-[232px] p-0">
            {account.panel}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <nav className="quiet-scroll min-h-0 flex-1 overflow-y-auto p-2 pt-4">
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
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-neutral-400")} />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-end border-t border-border p-2">
        <ThemeToggle />
      </div>
    </aside>
  );
}
