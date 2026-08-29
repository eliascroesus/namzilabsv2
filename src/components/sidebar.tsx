"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronRight, ChevronsUpDown, LayoutDashboard, Plug, Radio, Search, Settings, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
 * WHAT IT IS: the shape Miro, Figma and Make.com all converge on, wearing the
 * brand sheet. A 264px column on its own surface, flush with the page (no
 * notch), which opens with the workspace, then a search field, then two ruled
 * groups of 40px rows that read as text with an icon rather than icons with a
 * caption, then a foot with something in it.
 *
 * FOUR THINGS ALL THREE REFERENCES DO THAT THIS COLUMN DID NOT.
 *
 * · A SEARCH CONTROL, NOT A SEARCH ICON. All three put a bordered, full-width
 *   field directly under the workspace switcher, because it is the fastest way
 *   into a product that holds far more objects than it has nav items — and
 *   because a column that OPENS with a field reads as somewhere you can act
 *   rather than as a table of contents. Ours is inert for one commit; see the
 *   control itself for why it is a button and not an <input>.
 * · HAIRLINES BETWEEN THE GROUPS. A caps label on its own is a whisper: six
 *   items under two of them read as one long list with occasional small text,
 *   which is exactly the "all over the place" complaint. A rule across the full
 *   264px is what turns them into SECTIONS.
 * · 40px ROWS. Miro and Figma both sit there. These were 32 — the kit's `sm`
 *   CONTROL height, which is a size for a toolbar rather than for the six
 *   places this product goes.
 * · A FOOT WITH SOMETHING IN IT. Figma keeps "what's included / your plan and
 *   usage" in a bordered card down there; Miro keeps Spaces. This kept a sun
 *   icon and the word THEME — the least consequential control in the product,
 *   alone in the most protected space in the column.
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
 * THE ROWS ARE 40px, WHICH IS WHERE THE REFERENCES SIT. Every vertical measure
 * in the column is a multiple of 8 from here: a 28px chip inside the row (6px
 * of air either side), 16px of padding at the head and foot of each ruled
 * group, 8px in the foot's own band.
 */
const NAV: Array<{ label: string; href: string; icon: typeof LayoutDashboard; section: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "Workspace" },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, section: "Workspace" },
  // The two pale accents cannot ink their own glyph — pink on pink and yellow
  // on yellow are both under 2:1 — so they take the page's own text colour.
  // `foreground`, not the near-black literal it used to be: the accents are
  // fixed hexes that do not move with the theme, so in dark mode a near-black
  // icon sat on a dark plum wash and vanished. The role inverts; the hue does
  // not need to.
  { label: "Activity", href: "/dashboard/activity", icon: Radio, section: "Workspace" },
  { label: "Flows", href: "/dashboard/flows", icon: Workflow, section: "Build" },
  { label: "Apps", href: "/integrations", icon: Plug, section: "Build" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, section: "Build" },
];

/**
 * The workspace's initials, on the sheet's deep black.
 *
 * EXPORTED because the account menu lists the OTHER workspaces, and a switcher
 * whose rows are bare text beside a chipped trigger is two spellings of one
 * object.
 *
 * IT USED TO CARRY A HUE DERIVED FROM THE NAME, AND THE FILL LEFT WITHOUT THE
 * INK. When the six coloured rail chips were removed — they were the "different
 * icon colors" that read as weird — `workspaceAccent()` went with them and this
 * kept `text-white`, which had been white BECAUSE it sat on a saturated fill.
 * On a white sidebar that is white-on-white: the initials were still in the DOM,
 * still announced, and invisible at all five call sites in the light theme. Only
 * dark mode ever showed them, which is exactly why it survived review.
 *
 * `bg-foreground text-background` is the fix and also the right answer: it is
 * the top bar's own mark recipe, so the two first objects in the two chrome
 * columns are now the same object, and it inverts with the theme instead of
 * betting on the surface behind it.
 */
export function WorkspaceChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-control bg-foreground text-xs font-semibold text-background",
        className,
      )}
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
    //
    // 264, up from 248: Miro runs ~260 and Figma ~240, and the extra 16px is
    // what a 40px row with a 28px chip needs before its label starts truncating
    // — a column that clips "Dashboard" is a column that reads as cramped no
    // matter how well the rest of it is set.
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-sidebar">
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
                    putting "and who am I" on the same row made a 264px header
                    carry two different identities and read as clutter. */}
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            {/* The trigger's own width, read from Radix rather than typed: the
                panel is the control opening, not a card landing beside it, and
                a literal `232px` here was 248 minus this band's padding — two
                numbers in two files that only agreed by hand, and the column is
                264 now. */}
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

      {/* THE SEARCH FIELD, WHICH THIS COLUMN USED TO HAVE AND LOST.
          It sits directly under the workspace switcher because that is where
          all three references put it, and because the two answer consecutive
          questions: WHICH workspace, then WHAT in it.

          IT IS A BUTTON WEARING A FIELD'S CLOTHES, and that is the honest
          spelling rather than a shortcut. Search here will open the command
          palette (`ui/command.tsx` is already vendored) — you do not type into
          this box, you press it and type into that — so a real <input> would be
          a control that takes focus, accepts characters and does nothing with
          them, which is worse than an obvious button. It carries no handler for
          one commit; wiring it is an `onClick`, not a redesign.

          `h-10 border-input bg-card rounded-control` is the kit's own field
          recipe from ui/input.tsx, so this reads as the same object as every
          real field in the product — but at `px-3`, not the recipe's `px-4`.
          That 4px was written when `--radius-control` was 9999px and a pill's
          corner curve pushed text off its own left edge; the control radius is
          8px again, and here the only thing px-4 buys is a magnifier standing
          4px right of every icon below it. One text margin down the column.

          The hover is a WASH rather than the field's border-darkening:
          `hover:border-neutral-300` is a raw palette class and only
          `components/ui` may spell those. */}
      <div className="shrink-0 px-2 py-4">
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2.5 rounded-control border border-input bg-card px-3 text-left text-sm text-muted-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted"
        >
          <Search className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search</span>
          {/* A KEYCAP, NOT A PILL. The sheet's pills are buttons and chips;
              this is neither — it is a picture of a key, and every product that
              draws one draws a rounded rectangle. Mono, because a shortcut is a
              literal string and the proportional face renders ⌘K a hair narrow
              beside the word next to it. */}
          <kbd className="shrink-0 rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* `aria-label` because a column of links is only "the navigation" to
          somebody who can see where it sits on the page. */}
      <nav aria-label="Primary" className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
        {sections.map((section) => (
          // THE GROUPS ARE RULED, NOT MERELY LABELLED. The hairline is on the
          // section rather than between sections so the first one also draws
          // the line under the search field — the two are the same seam, and a
          // `first:border-t-0` would leave the field floating against the group
          // below it. The rule spans the full 264px (the padding is INSIDE
          // this div) so it reads as the chrome's own line, like the head
          // band's, rather than as an inset divider between two lists.
          <div key={section} className="border-t border-border px-2 py-4">
            {/* The kit's micro-label voice, verbatim from ui/badge.tsx: 12px,
                ALL CAPS, tracking-wide. `px-3` puts it on the same left edge as
                the rows' icons rather than on the pill's outer edge, so the
                column has one text margin instead of two. */}
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section}</p>
            <div className="space-y-0.5">
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
                        // THE RESTING LABEL IS FULL-CONTRAST NOW, not muted.
                        // Six grey labels with one violet row is a list of
                        // captions with a selection on it; Miro and Figma both
                        // set every destination in the column at full weight
                        // and let the FILL say which one you are standing in.
                        // The chrome stays quiet where quiet is free — the
                        // surface, the rules, the chips — and spends its
                        // contrast on the six words that are the column's
                        // actual content.
                        "flex h-10 items-center gap-2.5 rounded-control px-3 text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard)",
                        active
                          ? "bg-muted font-semibold text-foreground"
                          : "text-foreground hover:bg-sidebar-accent",
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
                          // 28px in a 40px row, holding a 16px glyph. The chip
                          // was 24 on a 32px row and grew with it: at 24 inside
                          // 40 the colour turns into a dot floating in a lot of
                          // air, which is the shape of a list that was resized
                          // without being redrawn.
                          "flex size-7 shrink-0 items-center justify-center rounded-control transition-colors",
                          // THE ACTIVE CHIP IS THE SHEET'S BLACK, and it is the
                          // second thing here that outlived its own background.
                          //
                          // It was `bg-background/15 text-background`: a veil of
                          // the row's ink, which worked while the active row was
                          // a solid VIOLET fill. That fill is now `bg-muted`, so
                          // the veil composites to within a few points of the row
                          // it sits on and the glyph is drawn in the page colour
                          // on top of it — measured at 1.41:1 in light and 1.14:1
                          // in dark, against the 3:1 that non-text needs. The
                          // icon of the destination you are STANDING IN was the
                          // one icon in the rail nobody could see.
                          //
                          // Inverting it is the fix and the sheet's own move: the
                          // row says where you are with a wash, the chip says it
                          // again in deep black, and both invert with the theme
                          // rather than betting on the surface behind them. Same
                          // recipe as the workspace chip and the top bar's mark.
                          active ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="truncate">{label}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      {/* THE FOOT OF THE COLUMN — A BLOCK, NOT A STRAY TOGGLE.
          It was a hairline, the word THEME and a sun: the least consequential
          control in the product, alone at the bottom of the navigation, which
          is the space every reference spends on the thing you would actually
          go and look at. Figma puts "See what's included / your plan and usage"
          in a bordered card there; Miro puts Spaces.

          THE CARD IS A ROUNDED RECTANGLE AT THE CARD RADIUS (10px), not a pill
          — the sheet pills buttons and chips and nothing else — and it is
          inset `p-2` so its own `p-3` lands its text on the same 20px left edge
          as the rows' chips above it. One text margin down the whole column.

          IT SAYS NO NUMBER, and that is deliberate rather than lazy. Billing is
          not wired, and a usage card is the one place in a product where
          invented figures are indistinguishable from real ones — "3 of 5 flows"
          would be a lie rendered as data. It names the plan (static until there
          is a plan to read) and points at where the detail will live, so
          arriving at the truth is a prop, not a redesign.

          The theme toggle keeps its row underneath at the rows' own scale —
          `size="icon"` is 44px, a control sized for a form — with its label in
          the kit's micro voice, because an unlabelled sun in a corner is the
          one control in the chrome nobody can identify without pressing it. */}
      <div className="shrink-0 space-y-2 border-t border-border p-2">
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-2 rounded-card border border-border bg-card p-3 shadow-xs transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your plan</span>
            <span className="mt-1 block truncate text-sm font-semibold text-foreground">Free workspace</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">Seats, usage and billing</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        <div className="flex items-center justify-between pl-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Theme</span>
          <ThemeToggle className="size-9" />
        </div>
      </div>
    </aside>
  );
}
