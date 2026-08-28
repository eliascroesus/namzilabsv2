"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronsUpDown, LayoutDashboard, Plug, Radio, Settings, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GROUP_ACCENT, GROUP_COLOR_KEYS } from "@/components/flow/node-accent";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";

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
 * WHAT IT IS: Notion's shape, wearing the brand sheet. A 248px column on its
 * own surface, flush with the page (no notch), holding compact rows that read
 * as text with an icon rather than icons with a caption. Sections are separated
 * by an ALL-CAPS label, not by a gap.
 *
 * THE SHEET SHOWS UP IN TWO PLACES HERE, AND ONLY TWO.
 *
 * · SHAPE. Every row is a PILL (`rounded-control` is 9999px), which is the
 *   sheet's one structural instruction. A stadium row is also what makes a
 *   filled active state legible at this size — a filled rectangle in a column
 *   of text reads as a banner.
 * · THE VIOLET. Exactly one row is filled with it at a time. `--primary` is the
 *   sheet's VIBRANT VIOLET and the sheet's rule is that FILLS take it, so the
 *   current page is a solid violet pill and everything else is neutral. The
 *   tint-and-violet-ink treatment this had before (`bg-accent`
 *   `text-accent-foreground`) is the sheet's "pressed" state, not its selected
 *   one, and at a glance it read as a row merely being hovered.
 *
 * THE ROWS ARE 32px, on the 8px baseline and the same height as the kit's `sm`
 * control. They were 30 — a number from no scale — and before that 40 with a
 * 12px caption, at which the six items occupied more vertical space than most
 * of the pages they lead to.
 */
const NAV: Array<{ label: string; href: string; icon: typeof LayoutDashboard; section: string; tint: string; soft: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "Workspace", tint: "bg-primary text-primary-foreground", soft: "bg-brand-100 text-brand-700" },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, section: "Workspace", tint: "bg-accent-orange text-white", soft: "bg-accent-orange/20 text-accent-orange" },
  { label: "Activity", href: "/dashboard/activity", icon: Radio, section: "Workspace", tint: "bg-accent-pink text-neutral-900", soft: "bg-accent-pink/30 text-neutral-900" },
  { label: "Flows", href: "/dashboard/flows", icon: Workflow, section: "Build", tint: "bg-accent-peri text-white", soft: "bg-accent-peri/25 text-accent-peri" },
  { label: "Apps", href: "/integrations", icon: Plug, section: "Build", tint: "bg-accent-yellow text-neutral-900", soft: "bg-accent-yellow/40 text-neutral-900" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, section: "Build", tint: "bg-foreground text-background", soft: "bg-foreground/10 text-foreground" },
];

/**
 * The workspace's initials, on its derived colour. A circle rather than a
 * rounded square: the sheet is pill-first, and this is the one place in the
 * chrome that carries a colour of its own, so it should read as a token rather
 * than as an app icon.
 */
function WorkspaceChip({ name }: { name: string }) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-control text-xs font-semibold text-white"
      style={{ background: workspaceAccent(name) }}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

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
  const name = workspace ?? "Workspace";

  return (
    // The width is pinned against `shell-skeleton.tsx` by tests/page-width.test.ts
    // — the skeleton reserves this exact column while a route streams, and the
    // two drifting is content jumping sideways at the moment the page lands.
    // It reads the FIRST `w-[…px]` in each file, which is this one.
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      {/* THE HEAD BAND IS THE TOP BAR'S OWN HEIGHT, AND THAT IS THE POINT.
          h-16 with a hairline under it means the sidebar's rule and the top
          bar's rule are one continuous line across the application, the way
          Figma's and Notion's are. At the 44px this used to be, the two
          hairlines missed each other by 20px and the chrome read as two
          components bolted together.

          THE WORKSPACE, AT THE HEAD OF THE COLUMN IT GOVERNS. It went to the
          top bar for one commit and that was wrong: switching workspace changes
          what every item BELOW it points at, so it belongs at the top of that
          list, not in a bar beside the product's own mark — where it also read
          as a second wordmark saying the same word twice. */}
      <div className="flex h-16 shrink-0 items-center border-b border-border px-2">
        {account ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-11 w-full items-center gap-2.5 rounded-control px-2 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted"
              >
                <WorkspaceChip name={name} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            {/* Matched to the trigger's own width (248 less the band's 8px
                either side) so the panel reads as the control opening rather
                than as a card landing beside it. */}
            <DropdownMenuContent align="start" className="w-[232px] p-0">
              {account.panel}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // No account means no menu to open — but the band still renders, so
          // the seam with the top bar does not appear and disappear with it.
          <div className="flex h-11 w-full items-center gap-2.5 px-2">
            <WorkspaceChip name={name} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</span>
          </div>
        )}
      </div>

      {/* `aria-label` because a column of links is only "the navigation" to
          somebody who can see where it sits on the page. */}
      <nav aria-label="Primary" className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {sections.map((section) => (
          <div key={section} className="mb-5 last:mb-0">
            {/* The kit's micro-label voice, verbatim from ui/badge.tsx: 12px,
                ALL CAPS, tracking-wide. `px-3` puts it on the same left edge as
                the rows' icons rather than on the pill's outer edge, so the
                column has one text margin instead of two. */}
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section}</p>
            <div className="space-y-0.5">
              {items
                .filter((i) => i.section === section)
                .map(({ label, href, icon: Icon, tint, soft }) => {
                  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                    // `group/nav` so the chip can answer the ROW's hover.
                    data-nav
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-control px-3 text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard)",
                        active
                          ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      )}
                    >
                      {/* The icon takes the ROW's colour rather than naming one.
                          It used to hard-code a neutral for the rest state and
                          the accent for the active one, which is two more
                          values to keep in step with a fill that already
                          decides both — and on the violet pill a named colour
                          would have been the one thing not inverting with it. */}
                    {/* THE ICON SITS IN ITS OWN COLOURED CHIP, which is most of
                        why Miro, Notion and Figma's rails read as playful rather
                        than as a list of grey text. Full strength when you are
                        here; a neutral wash otherwise — so the colour identifies
                        the destination at rest instead of only announcing the
                        one you already picked. */}
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-control transition-colors",
                        // AT REST IT KEEPS ITS HUE, softened. Colouring only the
                        // ACTIVE row leaves five of six chips grey, which is the
                        // greyscale rail again with one exception — the colour is
                        // supposed to identify the destination, not announce the
                        // one you already chose.
                        active ? tint : soft,
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                      <span className="truncate">{label}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-end border-t border-border p-2">
        <ThemeToggle />
      </div>
    </aside>
  );
}
