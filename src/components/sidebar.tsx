"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, LayoutDashboard, Plug, Plus, Radio, Search, Settings, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";

/**
 * THE ICON RAIL — 70px, and the left half of one dark band.
 *
 * WHAT IT WAS: a 264px named column on the app's own white surface, opening
 * with a workspace switcher, then a search field, then two ruled groups of
 * 40px rows set as text-with-an-icon, then a foot holding a plan card and a
 * theme toggle. It was a good column and it is the wrong shape for this
 * product now, for one reason that has nothing to do with taste: the page it
 * borders became DARK. A white 264px column beside a near-black board is the
 * loudest object on the screen and it is the object with the least to say —
 * six destinations, spelled out in full, taking a fifth of the viewport away
 * from the numbers this app exists to show.
 *
 * WHAT IT IS: 70px of `ink-950` running the full height, with the top bar
 * carrying the same colour across the rest. The two are ONE BAND wrapping the
 * page, which is why the rail's right hairline and the bar's bottom hairline
 * are the same `--chrome-line` and why the rail's top block is exactly the
 * bar's 70px — the two seams meet at one corner instead of nearly meeting.
 *
 * THE BAND DOES NOT INVERT. `bg-ink-950` in BOTH themes; only the page inside
 * it switches. That is the repo's own 60/30/10 doctrine (globals.css: "white
 * canvas is the 60, this rail is the 30, and the accent is the 10") and it is
 * what Miro, Notion and Linear all do. A rail that flips with the theme is a
 * rail with no identity — the one shape that should stay put while everything
 * inside it changes.
 *
 * EVERY ROW IS A 40px SLOT HOLDING A 28px CHIP, and the split matters. The
 * CHIP is the picture — a pale rounded square that lifts a 16px glyph off the
 * near-black, because a bare icon on this surface is a smudge. The SLOT is the
 * hit area, and it is the thing you actually press: 40px, the same target the
 * 264px column's rows had, so nothing got harder to click when the labels
 * left. Colour is spent in exactly one place — the row you are standing on is
 * a solid `primary` chip and the other six are neutral.
 *
 * WHAT THE 70px COULD NOT HOLD, AND WHERE EACH THING WENT. Every one of these
 * is still reachable; none was simply deleted:
 *
 * · THE LABELS. Gone from the surface, kept in the ACCESSIBILITY tree and in a
 *   tooltip on every control. An icon rail with no names is unusable with a
 *   screen reader and merely a guessing game with a mouse, so `aria-label` is
 *   not optional here — it is the row's only name.
 * · THE SECTION HEADINGS ("Workspace" / "Build"). A caps label needs a line of
 *   text to sit on. The grouping SURVIVES as the thing it always was: two
 *   blocks with 16px of air at each end, so the two sets read as two sets.
 * · THE WORKSPACE SWITCHER. It is in the TOP BAR now, behind the workspace
 *   avatar and its name — see the note there. It was the one control in the
 *   old column that needed a name to be usable at all ("which workspace am I
 *   in" cannot be answered by an icon), so it moved rather than shrank.
 * · THE PLAN CARD ("Your plan / Seats, usage and billing"). DROPPED. It was a
 *   264px-wide link to `/dashboard/settings` carrying no number — the rail
 *   still goes to Settings, one row down, so nothing became unreachable and
 *   the only loss is a signpost pointing at a door that is still in view.
 * · THE ⌘K KEYCAP. Dropped from the surface, kept in the search control's
 *   tooltip, which is where a shortcut belongs once the control is an icon.
 * · THE THEME TOGGLE. KEPT, in the foot, and it is the one thing here the
 *   Figma does not draw — see the note on the foot for why it stayed.
 */

/**
 * The two groups, in order. `section` is what splits them: the first block is
 * where you LOOK at things, the second is where you BUILD them, and that
 * division is the same one the named column drew with a rule and a caps label.
 */
const NAV: Array<{ label: string; href: string; icon: typeof LayoutDashboard; section: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "Workspace" },
  { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, section: "Workspace" },
  { label: "Activity", href: "/dashboard/activity", icon: Radio, section: "Workspace" },
  { label: "Flows", href: "/dashboard/flows", icon: Workflow, section: "Build" },
  { label: "Apps", href: "/integrations", icon: Plug, section: "Build" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, section: "Build" },
];

/**
 * The workspace's initials, on the app's own deep black.
 *
 * IT NO LONGER APPEARS IN THIS FILE'S OWN MARKUP, and it still lives here.
 * The rail's top block is the PRODUCT's mark now and the workspace moved to
 * the top bar, so the only callers left are the account panel's switcher rows
 * in `org-switcher.tsx` — which is exactly the reason not to move it: this
 * component is pinned by `tests/vendored-primitives.test.ts` at this path,
 * against a bug worth remembering. It drew its initials in `text-white`
 * because it once sat on a saturated hue derived from the workspace name; when
 * those coloured chips were removed the FILL left and the INK stayed, so the
 * letters were white-on-white at every call site in the light theme — still in
 * the DOM, still announced, invisible. `bg-foreground text-background` carries
 * its own fill and inverts with the theme instead of betting on the surface
 * behind it.
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

/**
 * THE CHIP INSIDE A ROW — the 28px picture, at the control radius.
 *
 * Three states and no more. The pale chip is the resting one; `primary` is the
 * page you are standing on, and it drops the hairline because a filled object
 * does not need an edge to be found; `search` is the same shape in white,
 * which is what marks it as the row that is NOT a destination.
 *
 * The hairline is `--chrome-line` — the band's own seam colour — so the chips,
 * the rail's right edge and the top bar's underside are one line drawn in
 * three places rather than three greys that happen to be close.
 */
function RailChip({ tone, children }: { tone: "rest" | "active" | "search"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-control transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        tone === "active"
          ? "bg-primary text-primary-foreground"
          : cn(
              "border border-chrome-line text-neutral-500 group-hover:text-neutral-900",
              tone === "search" ? "bg-white group-hover:bg-neutral-200" : "bg-neutral-100 group-hover:bg-white",
            ),
      )}
    >
      {children}
    </span>
  );
}

/**
 * The 40px slot's own class string, shared by the rows and the foot's controls
 * so a nav row, the search button and the bell are all the same target with
 * the same focus ring. `focus-ring-light` is not decoration: globals.css draws
 * one ring for the whole product in `--ring`, which is invisible on near-black,
 * and this class is the sanctioned white twin.
 */
const SLOT = "group flex size-10 shrink-0 items-center justify-center rounded-control focus-ring-light";

export function Sidebar({ hide }: { hide?: string[] }) {
  const pathname = usePathname();
  const items = NAV.filter((i) => !hide?.includes(i.label));
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    // The width is pinned against `shell-skeleton.tsx` by tests/page-width.test.ts
    // — the skeleton reserves this exact column while a route streams, and the
    // two drifting is content jumping sideways at the moment the page lands.
    // It reads the FIRST `w-[…px]` in each file, which is this one.
    //
    // 70, down from 264. It is not a shrunken column, it is a different object:
    // 8px of padding either side of a 40px slot with a 28px chip in it, and
    // nothing else has to fit.
    <aside className="flex h-full w-[70px] shrink-0 flex-col border-r border-chrome-line bg-ink-950">
      {/* THE TOP BLOCK IS THE TOP BAR'S OWN HEIGHT, AND THAT IS THE POINT.
          70px with the bar's hairline landing exactly at its foot means the
          band's two seams meet at one corner and the chrome reads as a single
          shape rather than as two components bolted together. Pinned to the
          bar's height by tests/page-width.test.ts.

          THE MARK IS HERE NOW rather than in the bar, because the bar carries
          the WORKSPACE — its avatar, its name, the setup ring — and a band
          that says "Namzilabs" in one corner and shows the workspace in the
          other is answering two different questions in two different places,
          which is right. A band that said the product's name twice would not.

          It is a LINK HOME, which is what a mark in this position is
          everywhere else, and it is the neon rather than the black square it
          used to be: on `ink-950` a near-black mark is not a mark. */}
      <div className="flex h-[70px] shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/dashboard"
              aria-label="Namzilabs — dashboard"
              className="flex size-9 items-center justify-center rounded-control bg-accent-yellow text-xs font-semibold text-neutral-900 transition-[filter] duration-(--duration-fast) ease-(--ease-standard) focus-ring-light hover:brightness-95"
            >
              NA
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Namzilabs</TooltipContent>
        </Tooltip>
      </div>

      {/* `aria-label` because a strip of icons is only "the navigation" to
          somebody who can see where it sits on the page — and here it is the
          only thing naming the region at all, since the group headings are
          gone with the labels.

          IT SCROLLS. Eight slots plus the foot need ~560px, and a laptop in a
          video call has less than that; `overflow-y-auto` on this middle block
          means the mark stays at the top and the foot stays at the bottom
          while the destinations move, which is the only part safe to move. */}
      <nav aria-label="Primary" className="quiet-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        {sections.map((section, index) => (
          /**
           * THE GROUPS ARE AIR, NOT RULES. The named column drew a hairline
           * across its full 264px to turn two lists into two SECTIONS, because
           * a caps label on its own is a whisper. At 70px a hairline is 54px
           * of line — a tick mark, not a division — and the 32px the two 16px
           * paddings make between the blocks does the job on its own. The
           * `py-4` is on the block rather than between blocks so the first
           * group also gets its own air under the mark.
           */
          <div key={section} className="flex flex-col items-center gap-0.5 px-2 py-4">
            {/* THE SEARCH CONTROL OPENS THE FIRST GROUP, which is where all
                three references (Miro, Figma, Make) put it: the fastest way
                into a product that holds far more objects than it has nav
                items. It is WHITE rather than the rows' off-white so it reads
                as a different KIND of thing — an action, not a place.

                It is a button, not an `<input>`, and that is the honest
                spelling rather than a shortcut: search here opens the command
                palette (`ui/command.tsx` is vendored), so you do not type into
                this box, you press it and type into that. It carries no
                handler for one commit; wiring it is an `onClick`, not a
                redesign. The ⌘K that used to be a keycap on the field is in
                the tooltip, which is where a shortcut goes once its control is
                an icon. */}
            {index === 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* `iconSm` rather than the default size, and it is load-
                      bearing: that variant is the only one that carries no
                      padding and sets `[&_svg]:size-4`, so the button is a
                      bare 40px box around a 28px chip around a 16px glyph.
                      The ghost's own wash is switched OFF — the CHIP is what
                      lights on hover, and a second wash behind it would draw a
                      40px square that no other row in the rail has. */}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label="Search"
                    className={cn(SLOT, "hover:bg-transparent active:bg-transparent")}
                  >
                    <RailChip tone="search">
                      <Search />
                    </RailChip>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Search ⌘K</TooltipContent>
              </Tooltip>
            )}
            {items
              .filter((i) => i.section === section)
              .map(({ label, href, icon: Icon }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Tooltip key={href}>
                    <TooltipTrigger asChild>
                      {/* `aria-label` AND a tooltip, deliberately both. The
                          tooltip is a sighted pointer user's only way to learn
                          what a glyph means; the label is what a screen reader
                          and a keyboard user get, and Radix's tooltip content
                          is not announced as the link's name. One without the
                          other leaves half the room out. */}
                      <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={SLOT}>
                        <RailChip tone={active ? "active" : "rest"}>
                          <Icon className="size-4" />
                        </RailChip>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                );
              })}
          </div>
        ))}
      </nav>

      {/* THE FOOT — what you can START, then what is waiting for you.
          `mt-auto` rather than a `justify-between` on the column: the nav above
          is the flexible child and it has to keep its own scroll, so the foot
          is pinned by the space the nav gives back instead of by the column's
          distribution.

          THE THEME TOGGLE IS THE ONE THING HERE THE FIGMA DOES NOT DRAW, and
          it stayed. It is the app's only control for a preference the app
          actually ships, and dropping it would leave the light theme reachable
          only by changing the operating system's. It is drawn as a BARE GLYPH
          rather than a chip, which is also the argument for where it sits: the
          foot's grammar is "one loud object and some quiet ones", so it joins
          the bell as a quiet one and leaves the yellow "+" and the bell pair
          at the very bottom exactly as the export has them. */}
      <div className="mt-auto flex shrink-0 flex-col items-center gap-0.5 pb-4">
        <ThemeToggle className="size-10 rounded-control text-ink-400 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-ring-light hover:bg-ink-800 hover:text-ink-50 active:bg-ink-800 [&_svg]:size-4" />

        {/* THE ONE COLOURED OBJECT IN THE FOOT, and it is the same neon as the
            mark 500px above it — the rail opens and closes on the brand.
            40px and unchipped: it IS the chip, because a "+" is a verb and a
            verb in this band gets the full slot rather than a picture inside
            one.

            THE INK IS GREY, NOT BLACK, and that is a ratio decision rather
            than a soft one. Near-black on this yellow measures 15.18:1 and
            reads as a filled primary button demanding a press, which is too
            much presence for a control sitting under seven quieter rows;
            `--chrome-add-ink` is 6.30:1 on it — comfortably past AA — and lets
            the colour do the pointing instead of the ink. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/dashboard/flows"
              aria-label="New flow"
              className="flex size-10 shrink-0 items-center justify-center rounded-control border border-chrome-line bg-accent-yellow text-chrome-add-ink transition-[filter] duration-(--duration-fast) ease-(--ease-standard) focus-ring-light hover:brightness-95"
            >
              <Plus className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">New flow</TooltipContent>
        </Tooltip>

        {/* THE BELL, AND ITS DOT IS A PROMISE THIS COMMIT CANNOT KEEP.
            Notifications have no store yet, so the control is inert — the same
            standing the search field had for a commit, and comment-marked for
            the same reason. The 8px dot is drawn because the export draws it;
            it says PRESENCE ("there is something") rather than a count, and it
            is `--chrome-presence` green rather than `--success` on purpose:
            the success trio means a row SUCCEEDED, and a dot that borrows it
            turns a notification into a result.

            When notifications land, the dot takes a prop and the button takes
            a handler. Until then this note is the honest record that the dot
            is decoration. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Notifications"
              className={cn(SLOT, "relative text-white hover:bg-ink-800 hover:text-white active:bg-ink-800")}
            >
              <Bell />
              {/* Measured off the SLOT, not the glyph: the 40px box centres a
                  16px icon at 12–28px, so a `right-2.5 top-2.5` dot lands on
                  the bell's own top-right corner and stays there whatever the
                  icon's internal padding does. */}
              <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-chrome-presence" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Notifications</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
