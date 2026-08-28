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
 * THE SHEET SHOWS UP IN THREE PLACES HERE, AND ONLY THREE.
 *
 * · SHAPE. Every row is a rounded RECTANGLE at the control radius — 8px, the
 *   same corner as an input and a menu row. The sheet pills BUTTONS and CHIPS
 *   and nothing else, and this file said "pill" for as long as
 *   `--radius-control` was briefly 9999px.
 * · THE VIOLET. Exactly one row is filled with it at a time. `--primary` is the
 *   sheet's VIBRANT VIOLET and the sheet's rule is that FILLS take it, so the
 *   current page is a solid violet row and everything else is neutral. The
 *   tint-and-violet-ink treatment this had before (`bg-accent`
 *   `text-accent-foreground`) is the sheet's "pressed" state, not its selected
 *   one, and at a glance it read as a row merely being hovered.
 * · THE ACCENT FOUR, behind the icons. Orange, pink, periwinkle and the neon
 *   are DECORATION — which of six places this is — and never state, so they
 *   colour the chip and never the row. That is the whole difference between
 *   this column and the grey list of links every dashboard ships with.
 *
 * THE ROWS ARE 32px, on the 8px baseline and the same height as the kit's `sm`
 * control. They were 30 — a number from no scale — and before that 40 with a
 * 12px caption, at which the six items occupied more vertical space than most
 * of the pages they lead to.
 */
const NAV: Array<{ label: string; href: string; icon: typeof LayoutDashboard; section: string; soft: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "Workspace", soft: "bg-brand-100 text-brand-700" },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, section: "Workspace", soft: "bg-accent-orange/20 text-accent-orange" },
  // The two pale accents cannot ink their own glyph — pink on pink and yellow
  // on yellow are both under 2:1 — so they take the page's own text colour.
  // `foreground`, not the near-black literal it used to be: the accents are
  // fixed hexes that do not move with the theme, so in dark mode a near-black
  // icon sat on a dark plum wash and vanished. The role inverts; the hue does
  // not need to.
  { label: "Activity", href: "/dashboard/activity", icon: Radio, section: "Workspace", soft: "bg-accent-pink/30 text-foreground" },
  { label: "Flows", href: "/dashboard/flows", icon: Workflow, section: "Build", soft: "bg-accent-peri/25 text-accent-peri" },
  { label: "Apps", href: "/integrations", icon: Plug, section: "Build", soft: "bg-accent-yellow/40 text-foreground" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, section: "Build", soft: "bg-foreground/10 text-foreground" },
];

/**
 * The workspace's initials, on its derived colour.
 *
 * EXPORTED because the account menu lists the OTHER workspaces, and a switcher
 * whose rows are bare text beside a chipped trigger is two spellings of one
 * object. The colour is derived from the name (above), so a second call site
 * cannot draw the same workspace in a different hue — but only while both call
 * sites go through this component rather than re-deriving it.
 */
export function WorkspaceChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-control text-xs font-semibold text-white",
        className,
      )}
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
              {/* `px-3`, so the chip lands on the same 20px left edge as the
                  rows below it (this column's `px-2` plus a row's `px-3`) while
                  the hover wash still starts where theirs does. It was `px-2`,
                  which stood the head of the list 4px to the left of the list —
                  a miss too small to name and big enough to see.

                  `data-[state=open]` keeps the trigger lit for as long as its
                  panel is open. Without it the control returns to rest the
                  moment the pointer moves into the menu, so the menu appears to
                  belong to nothing — the one state a trigger has that a link
                  does not, and it is free from Radix. */}
              <button
                type="button"
                title={name}
                className="flex h-11 w-full items-center gap-2.5 rounded-control px-3 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted data-[state=open]:bg-muted"
              >
                <WorkspaceChip name={name} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</span>
                {/* The account moved to the TOP BAR, where Miro, Notion and
                    Figma all keep it. This control answers "which workspace";
                    putting "and who am I" on the same row made a 248px header
                    carry two different identities and read as clutter. */}
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            {/* The trigger's own width, read from Radix rather than typed: the
                panel is the control opening, not a card landing beside it, and
                a literal `232px` here was 248 minus this band's padding — two
                numbers in two files that only agreed by hand. */}
            <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) p-0">
              {account.panel}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // No account means no menu to open — but the band still renders, so
          // the seam with the top bar does not appear and disappear with it.
          <div className="flex h-11 w-full items-center gap-2.5 px-3">
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
                .map(({ label, href, icon: Icon, soft }) => {
                  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-control px-3 text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard)",
                        active
                          ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      )}
                    >
                      {/* THE ICON SITS IN ITS OWN COLOURED CHIP, which is most
                          of why Miro's, Notion's and Figma's rails read as
                          playful rather than as a list of grey text. The chip
                          keeps its hue AT REST — colouring only the active row
                          leaves five of six chips grey, which is the greyscale
                          rail again with one exception, and the colour is here
                          to identify a destination rather than to announce the
                          one you already chose.
                          The GLYPH names no colour at all: it takes the row's,
                          so the fill decides both and there is nothing left to
                          keep in step with it. */}
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-control transition-colors",
                          // ON THE VIOLET ROW THE CHIP BECOMES A VEIL, and it
                          // has to. It carried its destination's colour at full
                          // strength there, which put a violet chip on a violet
                          // fill — Dashboard's vanished outright — and an orange
                          // one on it next door: six chips that agree at rest
                          // and disagree at the one moment the row is loud. A
                          // wash of the row's own ink is one treatment for all
                          // six, and it is the fill, not the chip, that says
                          // where you are.
                          active ? "bg-primary-foreground/20" : soft,
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

      {/* THE FOOT OF THE COLUMN, ON THE COLUMN'S OWN RHYTHM.
          `size="icon"` is 44px — a control sized for a form, sitting alone
          under a list of 32px rows and making the footer taller than two of
          them. `size-9` puts it at the rows' scale and the band at 52px, and
          the label names what the icon does: an unlabelled sun in a corner is
          the one control in the chrome nobody can identify without pressing
          it. The caption takes the kit's micro voice, the same one the section
          headings above it use. */}
      <div className="flex items-center justify-between border-t border-border py-2 pl-5 pr-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Theme</span>
        <ThemeToggle className="size-9" />
      </div>
    </aside>
  );
}
