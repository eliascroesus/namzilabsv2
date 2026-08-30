"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, LayoutDashboard, Plug, Plus, Radio, Search, Settings, Workflow } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";
import { viewStrip, type BoardView } from "@/lib/board/types";

/**
 * THE ICON RAIL — 70px at rest, 240px under the pointer, and the left half of
 * one dark band.
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
 * AND IT OPENS. Point at it and the column widens IN PLACE to 240px and the
 * names fade in beside the chips: the wordmark, the two caps headings, every
 * destination, the ⌘K keycap. The reference is VoltOps, and the reason to copy
 * it is that it settles the argument the notes below used to lose — an icon
 * rail is unreadable until you have learned it, and the six names are the one
 * thing 70px genuinely could not hold. It holds them now, for as long as you
 * are looking at it.
 *
 * IT OVERLAYS, IT DOES NOT PUSH. The `<aside>` keeps a flat 70px footprint in
 * the layout and the panel inside it is `absolute`, so the 170px it gains are
 * taken from the page rather than given by it. The alternative — widening in
 * flow — reflows the entire board on a pointer-move, which on the dashboard
 * means every tile re-laying out and on the builder means the canvas resizing
 * under a drag. That is not a slower version of this, it is unusable.
 *
 * IT IS CSS, NOT STATE. `group-hover` and `group-focus-within` on one width
 * transition. A `useState` here would re-render this tree (and every child of
 * it) on entering and leaving the column, and it would do nothing at all until
 * hydration — a rail that ignores the pointer for the first second of a cold
 * load is worse than one that never moved.
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
 * hit area: 40px tall, and as WIDE as the column is at the moment you press it,
 * so an open rail lets you click the name as well as the picture. Colour is
 * spent in exactly one place — the row you are standing on is a solid `primary`
 * chip and the other six are neutral.
 *
 * WHAT THE 70px COULD NOT HOLD, AND WHERE EACH THING WENT. Every one of these
 * came BACK with the hover panel; what follows is what the collapsed column
 * still does not say, and where the answer is instead:
 *
 * · THE LABELS. Present in the DOM at all times and revealed by the panel —
 *   which is also what NAMES each control now. There is no `aria-label` on a
 *   row any more: the accessible name is the visible label, one string, so the
 *   two can no longer drift apart (they did, in the 264px column, twice). A
 *   clipped, transparent label is still in the accessibility tree; only
 *   `display:none` and `visibility:hidden` take a name away.
 * · THE SECTION HEADINGS ("Workspace" / "Build"). Back, and their line is
 *   RESERVED IN BOTH STATES — see the note on the group block for why a
 *   heading that grows on hover is a mis-click waiting to happen.
 * · THE WORKSPACE SWITCHER. It is in the TOP BAR now, behind the workspace
 *   avatar and its name — see the note there. It was the one control in the
 *   old column that needed a name to be usable at all ("which workspace am I
 *   in" cannot be answered by an icon), so it moved rather than shrank.
 * · THE PLAN CARD ("Your plan / Seats, usage and billing"). DROPPED. It was a
 *   264px-wide link to `/dashboard/settings` carrying no number — the rail
 *   still goes to Settings, one row down, so nothing became unreachable and
 *   the only loss is a signpost pointing at a door that is still in view.
 * · THE ⌘K KEYCAP. Back on the search row, where it was before the rail
 *   shrank. It is `aria-hidden` and the shortcut is announced properly by
 *   `aria-keyshortcuts`, so the keycap is a picture of a shortcut rather than
 *   part of the control's name.
 * · THE TOOLTIPS. GONE, all seven, and that is a decision rather than an
 *   omission. They existed to name a glyph for a pointer user; the panel now
 *   names it, at the same moment, from the same string. Worse, they were
 *   `side="right"` — anchored to a row that is now 210px wide, a tooltip opens
 *   ON TOP of the very label it duplicates. A control cannot be its own
 *   annotation.
 * · THE THEME TOGGLE. KEPT, in the foot, and it is the one control here that
 *   gets no label — see the note there.
 */

/** The product's name: the mark's accessible name, and the wordmark the open
 *  panel shows beside it. One literal, because it is one fact. */
const PRODUCT = "Namzilabs";

/**
 * The two groups, in order. `section` is what splits them: the first block is
 * where you LOOK at things, the second is where you BUILD them, and that
 * division is the same one the named column drew with a rule and a caps label.
 * It IS that caps label again — the string is the heading, not just the key.
 *
 * THE CALENDAR IS NOT HERE ANY MORE, and its absence is the point. It was a
 * destination of its own, which said it was a separate part of the product; it
 * is not — `materializeFlow` computes the dashboard's range pills, the chart
 * buckets and every calendar day in ONE pass and stores them side by side, so a
 * calendar is a third way of drawing numbers the board already has. It is a view
 * kind now, and it appears in the list of views nested under Dashboard below,
 * beside the reader's Columns and Custom boards.
 */
const NAV: Array<{ label: string; href: string; icon: typeof LayoutDashboard; section: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "Workspace" },
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
 * WHAT THE OPEN PANEL REVEALS — the one recipe every hidden thing in the rail
 * shares, so the names, the headings and the keycap all arrive together rather
 * than in three slightly different fades.
 *
 * OPACITY, NOT `hidden`. The strings stay in the DOM and in the accessibility
 * tree at every width — they are the accessible names of the controls they sit
 * in, and a name that only exists on hover is a name a screen reader never
 * hears. What hides them is the panel's own `overflow-hidden`: at 70px there is
 * nothing to the right of the chip to paint them in, which is also what stops a
 * transparent 150px label from swallowing pointer events over the page beside
 * it — a clipped box is not hit-testable.
 *
 * `group-focus-within` IS NOT A COURTESY. Tab into the rail with no pointer and
 * `group-hover` never fires: a keyboard user would arrive on a row whose name
 * is clipped out of view, with the tooltips that used to cover for it now gone.
 * Focus opens the panel exactly as the pointer does.
 *
 * NO reduced-motion guard here, deliberately. globals.css ends with a blanket
 * `@media (prefers-reduced-motion: reduce)` that drops every transition in the
 * document to 0.01ms with `!important` — a second, weaker guard spelled here
 * would only be a place for the two to disagree.
 */
const REVEAL =
  "opacity-0 transition-opacity duration-(--duration-fast) ease-(--ease-standard) group-hover/rail:opacity-100 group-focus-within/rail:opacity-100";

/**
 * The name beside a chip. `shrink-0` + `whitespace-nowrap` rather than a
 * flexible measure: a label that resolves its width against the ANIMATING
 * panel re-wraps and re-ellipsises on every frame of the open, which reads as
 * the text stuttering into place. Fixed at its natural width, it is simply
 * uncovered by the panel's edge, which is the motion the reference has.
 */
function RailLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("shrink-0 whitespace-nowrap text-sm font-medium text-ink-100", REVEAL, className)}>{children}</span>;
}

/**
 * THE ICON COLUMN — 40px, and it never moves.
 *
 * Every chip in the rail sits in one of these, so the mark, the six
 * destinations, the theme toggle, the "+" and the bell are on a single vertical
 * axis at 70px AND at 240px. The rail widens; the pictures do not budge, which
 * is the whole difference between a column opening and a column reflowing.
 */
const ICON_COL = "flex size-10 shrink-0 items-center justify-center";

/**
 * The row's own class string, shared by the mark, the nav links, the search
 * button and the bell so all of them are the same target with the same focus
 * ring.
 *
 * `w-full` IS WHAT MAKES THE OPEN ROW CLICKABLE. Collapsed it resolves to the
 * 40px square this rail has always had — the gutter is on the block, not on the
 * row, so the ring still hugs the chip at rest; open, it is the full 210px and
 * the label is part of the target.
 *
 * `justify-start` is not redundant: `Button`'s base variant centres its
 * contents, and a centred row whose content is wider than its box (which is
 * every row at 70px) pushes the chip left off the axis every other row sits on.
 *
 * `focus-ring-light` is not decoration either: globals.css draws one ring for
 * the whole product in `--ring`, which is invisible on near-black, and this
 * class is the sanctioned white twin.
 */
const SLOT = "group flex h-10 w-full shrink-0 items-center justify-start gap-3 rounded-control focus-ring-light";

/**
 * THE GUTTER, WRITTEN DOWN.
 *
 * 15px, which is what `items-center` used to compute on its own: half of what
 * is left when a 40px slot sits in a 70px column. It has to be a number now
 * because the rows are full-width — centring a 210px row centres nothing — and
 * it is the one measurement that keeps the open panel's chips standing exactly
 * where the closed one's were. It also gives the focus ring its 2px offset back
 * from the panel's clip, which a flush row would lose.
 *
 * THE MARK'S BLOCK SPELLS IT OUT INSTEAD OF READING IT, and that is not an
 * oversight to tidy up. tests/page-width.test.ts matches that block's class
 * attribute as a LITERAL — `className="flex h-… shrink-0 items-center` — to
 * check the rail's top block against the top bar's height, and a `cn()` call
 * there matches nothing and fails the file with "could not find the rail's top
 * block". Two spellings of 15px, and this is the note that keeps them in step.
 */
const GUTTER = "px-[15px]";

export function Sidebar({ hide, views = [] }: { hide?: string[]; views?: BoardView[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  /**
   * "Show all" is the only state in this rail, and it is deliberately not
   * persisted. The rail opens on hover and closes again; a fold the customer set
   * three days ago on a different machine is not a fact worth storing, and
   * restoring it would make the column open at two different heights depending
   * on history nobody can see.
   */
  const [allViews, setAllViews] = useState(false);
  /**
   * The strip's own order, and the same comparator the board uses. An adopted
   * default sorts first because its key was minted to; a view dragged elsewhere
   * keeps where it was put.
   */
  /**
   * EVERY VIEW, INCLUDING THE DEFAULT ONE — and yes, that means "Dashboard" can
   * appear nested under "Dashboard".
   *
   * This briefly filtered the default board out when its name still matched the
   * nav row above it, on the grounds that the two are the same destination. That
   * reads tidier on a workspace which has never renamed it, and it is wrong the
   * moment this list does anything more than point: the default board is a view
   * like the others, it can be renamed, and a list that silently omits one of
   * its members is a list you cannot trust to be complete. The parent row is the
   * section, not a duplicate of its first child.
   */
  const ordered = viewStrip(views);
  const NESTED_CAP = 5;
  const shown = allViews ? ordered : ordered.slice(0, NESTED_CAP);
  const activeView = params.get("view");
  /** The default board is `?view=` absent — and, once adopted, its own row. */
  const onDashboard = pathname === "/dashboard";
  const items = NAV.filter((i) => !hide?.includes(i.label));
  const sections = [...new Set(items.map((i) => i.section))];

  /**
   * THE VIEWS, NESTED UNDER DASHBOARD — Notion's shape, and Notion's rule that a
   * page's children live under it in the sidebar rather than in a second menu.
   *
   * IT COLLAPSES BY HEIGHT, NOT BY OPACITY, and that is the one structural
   * difference from every other label in this rail. The rest use `REVEAL` —
   * `opacity-0` that fades in on hover — because they sit BESIDE an icon that is
   * always there, so they cost no vertical space when invisible. These rows have
   * no icon and are their own lines: left at opacity zero they would push
   * Calendar, Activity and the whole BUILD section down the column at 70px, to
   * make room for words nobody can see. So the wrapper animates its grid row
   * from `0fr` to `1fr`, which collapses to nothing and needs no magic
   * max-height.
   *
   * `group-focus-within/rail` matters as much as the hover: a keyboard user
   * tabbing into a view link opens the column rather than moving focus into a
   * region of zero height.
   */
  const ViewList = () => (
    <div
      className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-(--duration-base) ease-(--ease-standard) group-hover/rail:grid-rows-[1fr] group-focus-within/rail:grid-rows-[1fr]"
    >
      <div className="overflow-hidden">
        {shown.map((v) => {
          /* The default board is the one with no `?view=` in the URL — and once
             it has been adopted it is an ordinary row with an id like any other,
             so both spellings have to resolve to the same tab. */
          const isDefault = v.isDefault || v.id == null;
          const href = v.id && !v.isDefault ? `/dashboard?view=${v.id}` : "/dashboard";
          const on = onDashboard && (isDefault ? !activeView : activeView === v.id);
          return (
            <Link
              key={v.id ?? "default"}
              href={href}
              aria-current={on ? "page" : undefined}
              /* Indented to the icon column's own axis, so the names line up
                 under Dashboard's word rather than under its chip. */
              /* 16px INSIDE the section's own 15px gutter. Flush against it the
                 dash sat hard on the rail's edge with nothing between it and the
                 column border, which reads as a rule the rail is drawing rather
                 than as a mark belonging to the row. One step in is enough to
                 make it a child of the Dashboard chip above without pushing it
                 out to the parent's label, which is where it started. */
              className={cn(
                "flex h-8 items-center rounded-control pl-4 pr-2 text-sm transition-colors duration-(--duration-fast)",
                on ? "bg-ink-800 font-medium text-ink-50" : "text-ink-400 hover:bg-ink-900 hover:text-ink-50",
              )}
            >
              {/* A DASH, DRAWN RATHER THAN TYPED. It marks these rows as
                  children of the one above without repeating an icon column
                  they do not have — and it is a rule, not an en-dash, because
                  the kit bans text glyphs used as marks and because `bg-current`
                  makes it inherit the row's own ink, so it lights with the name
                  on hover and on the active row instead of staying a fixed grey
                  beside text that moved. */}
              <span aria-hidden className="mr-2 h-px w-2 shrink-0 bg-current opacity-60" />
              <span className="truncate">{v.name}</span>
            </Link>
          );
        })}
        {ordered.length > NESTED_CAP && (
          /* A count rather than a bare "Show all": the number is the reason to
             press it, and without it the row asks you to guess how much is
             hidden. It is a real button because it changes nothing but this
             column — no URL, no navigation, nothing to share. */
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAllViews((v) => !v)}
            /* `pl-8` — the rows above are inset 16px and then pushed a further
               16px by their dash and its margin, so this is level with their
               NAMES. A fold that starts left of the names it folds reads as
               belonging to the section rather than to them. */
            className="h-8 w-full justify-start rounded-control pl-8 pr-2 text-xs font-medium text-ink-400 hover:bg-ink-900 hover:text-ink-50 active:bg-ink-900"
          >
            {allViews ? "Show less" : `Show all ${ordered.length}`}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    // THE FOOTPRINT, AND ONLY THE FOOTPRINT. This element is 70px in every
    // state; the panel inside it is what grows. The width is pinned against
    // `shell-skeleton.tsx` by tests/page-width.test.ts — the skeleton reserves
    // this exact column while a route streams, and the two drifting is content
    // jumping sideways at the moment the page lands. It reads the FIRST
    // `w-[…px]` in each file, which is this one, so nothing wider may be
    // written above it.
    //
    // 70, down from 264. It is not a shrunken column, it is a different object:
    // a 15px gutter either side of a 40px slot with a 28px chip in it, and
    // nothing else has to fit until the pointer arrives.
    //
    // `z-20` IS READ OFF THE LADDER IN globals.css, NOT INVENTED. That file
    // lists five rungs; the open panel is a DOCKED PANEL — the same thing as
    // the builder's config rail, chrome fixed to an edge and floating over the
    // page — so it takes 20. Above 10, because a card's own sticky chrome must
    // not surface through it. Below 30, because anchored surfaces (menus,
    // popovers, the field browser) have to open OVER the rail, and below 40/50
    // because a toast and a dialog outrank all chrome.
    <aside className="group/rail relative z-20 h-full w-[70px] shrink-0">
      {/* THE PANEL — the whole rail, floated out of the layout.
          `inset-y-0 left-0` pins it to the footprint above and `w-[70px]`
          keeps the two the same object at rest; the two `group-*` widths are
          the only thing that ever differs.

          THE HAIRLINE TRAVELS WITH IT. The band's seam is the panel's right
          edge, so opening the rail moves the seam rather than leaving a line
          behind at 70px with the panel spilling past it. For the seconds it is
          open the panel covers the top bar's left end — its workspace address —
          which is the cost of overlaying rather than pushing, and it is paid
          back the instant the pointer leaves.

          NO SHADOW, on purpose. Everything else in this app that floats over
          the page takes a rung of the elevation ladder; this is the BAND, and a
          band that lifts off the page on hover stops being the frame around it.
          Its own hairline is what separates it from what it covers. */}
      <div className="absolute inset-y-0 left-0 flex w-[70px] flex-col overflow-hidden border-r border-chrome-line bg-ink-950 transition-[width] duration-(--duration-base) ease-(--ease-standard) group-hover/rail:w-60 group-focus-within/rail:w-60">
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
            used to be: on `ink-950` a near-black mark is not a mark.

            THE ONE ROW THAT KEEPS AN `aria-label`, because its name is not its
            label: the accessible name says where the link GOES ("— dashboard"),
            which the wordmark beside it cannot. Both are built from `PRODUCT`,
            so there is still only one literal, and the visible string is
            contained in the announced one, which is what WCAG's Label in Name
            actually asks for. The "NA" tile is `aria-hidden` — without that the
            name would open with two letters nobody says out loud. */}
        <div className="flex h-[70px] shrink-0 items-center px-[15px]">
          <Link href="/dashboard" aria-label={`${PRODUCT} — dashboard`} className={SLOT}>
            <span className={ICON_COL}>
              <span
                aria-hidden
                className="flex size-9 items-center justify-center rounded-control bg-accent-yellow text-xs font-semibold text-neutral-900 transition-[filter] duration-(--duration-fast) ease-(--ease-standard) group-hover:brightness-95"
              >
                NA
              </span>
            </span>
            <RailLabel className="font-semibold text-white">{PRODUCT}</RailLabel>
          </Link>
        </div>

        {/* `aria-label` because a strip of icons is only "the navigation" to
            somebody who can see where it sits on the page. The group headings
            below name the two SETS; this names the region that holds them.

            IT SCROLLS. Eight slots plus the foot need ~600px, and a laptop in a
            video call has less than that; `overflow-y-auto` on this middle block
            means the mark stays at the top and the foot stays at the bottom
            while the destinations move, which is the only part safe to move.

            `overflow-x-hidden` IS LOAD-BEARING, not tidiness. A box that scrolls
            in one axis computes the other to `auto` too, so the labels
            overhanging a 70px column would raise a horizontal scrollbar across
            the foot of the rail at rest. Hidden, they are simply clipped, which
            is what the panel above does with the rows outside this scroller. */}
        <nav aria-label="Primary" className="quiet-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          {sections.map((section, index) => (
            /**
             * THE GROUPS ARE AIR AND A HEADING AGAIN.
             *
             * The 264px column drew a hairline across its full width to turn two
             * lists into two SECTIONS, because a caps label on its own is a
             * whisper. At 70px a hairline is 54px of line — a tick mark, not a
             * division — so the rule stays gone and the 16px paddings still do
             * the dividing when the rail is shut.
             *
             * THE HEADING'S LINE IS RESERVED IN BOTH STATES, and this is the
             * one measurement in the file that is worth arguing about. A caps
             * label that grows from 0 on hover pushes every row below it down
             * ~20px WHILE THE POINTER IS ON ONE OF THEM: you aim at Flows, the
             * rail opens, Activity slides under your cursor, and you click the
             * wrong page. Reserving the line costs the shut column 20px of blank
             * air per group and costs nobody a mis-navigation. `py-2` rather
             * than the old `py-4` gives most of it back: the heading now does
             * the separating that the extra padding was standing in for.
             */
            <div key={section} className={cn("flex flex-col gap-0.5 py-2", GUTTER)}>
              <div className="flex h-5 items-center">
                <span className={cn("truncate text-xs font-semibold tracking-wide text-ink-400 uppercase", REVEAL)}>
                  {section}
                </span>
              </div>

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
                  redesign.

                  THE KEYCAP IS BACK where the 264px column had it, and it is
                  spelled the way a shortcut should be: `aria-keyshortcuts` is
                  the announced fact and the chip is `aria-hidden`, so "⌘K" is a
                  picture of the shortcut rather than half of the button's
                  name. */}
              {index === 0 && (
                /* `iconSm` rather than the default size, and it is load-bearing:
                   that variant is the only one that carries no padding and sets
                   `[&_svg]:size-4`, so the glyph lands at 16px inside the 28px
                   chip. The ghost's own wash is switched OFF — the CHIP is what
                   lights on hover, and a second wash behind it would draw a
                   210px bar that no other row in the rail has. */
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-keyshortcuts="Meta+K"
                  className={cn(SLOT, "hover:bg-transparent active:bg-transparent")}
                >
                  <span className={ICON_COL}>
                    <RailChip tone="search">
                      <Search />
                    </RailChip>
                  </span>
                  <RailLabel className="text-ink-400 group-hover:text-ink-50">Search</RailLabel>
                  <span
                    aria-hidden
                    className={cn(
                      "ml-auto rounded-sm border border-chrome-line px-1.5 py-0.5 text-xs font-medium text-ink-400",
                      REVEAL,
                    )}
                  >
                    ⌘K
                  </span>
                </Button>
              )}
              {items
                .filter((i) => i.section === section)
                .map(({ label, href, icon: Icon }) => {
                  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                  return (
                    /* NO `aria-label`, and that is the fix rather than a
                       regression. The label is in the row, so it is the link's
                       accessible name — one string doing both jobs, which is the
                       only arrangement in which the announced name and the
                       printed name cannot drift. It stays announced at 70px
                       because clipping and `opacity: 0` hide a thing from the
                       eye and not from the tree. */
                    <Fragment key={href}>
                      <Link href={href} aria-current={active ? "page" : undefined} className={SLOT}>
                        <span className={ICON_COL}>
                          <RailChip tone={active ? "active" : "rest"}>
                            <Icon className="size-4" />
                          </RailChip>
                        </span>
                        <RailLabel className={active ? "text-ink-50" : "text-ink-400 group-hover:text-ink-50"}>
                          {label}
                        </RailLabel>
                      </Link>
                      {label === "Dashboard" && ordered.length > 0 && <ViewList />}
                    </Fragment>
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
            at the very bottom exactly as the export has them.

            IT IS ALSO THE ONE CONTROL THE OPEN PANEL DOES NOT NAME, and the
            reason is worth writing down because "add a label to it too" looks
            obviously right. Its accessible name is a sentence that changes with
            the state it is in — "Switch to the light theme" / "Switch to the
            dark theme" — and it is owned by `theme.tsx`, which is where it
            belongs. A visible "Theme" beside that announced name is a Label in
            Name failure (voice control users say what they read, and "theme"
            is not in the name); printing the sentence itself puts a clause in a
            column of nouns. So it keeps its 40px square, on the same axis as
            every chip above it, and says nothing. */}
        <div className={cn("mt-auto flex shrink-0 flex-col gap-0.5 pb-4", GUTTER)}>
          <ThemeToggle className="size-10 rounded-control text-ink-400 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-ring-light hover:bg-ink-800 hover:text-ink-50 active:bg-ink-800 [&_svg]:size-4" />

          {/* THE ONE COLOURED OBJECT IN THE FOOT, and it is the same neon as the
              mark 500px above it — the rail opens and closes on the brand.
              40px and unchipped: it IS the chip, because a "+" is a verb and a
              verb in this band gets the full slot rather than a picture inside
              one. IT STAYS 40px WHEN THE RAIL OPENS — the row grows around it
              and the name arrives beside it, because a 210px slab of neon is a
              banner, not a button, and the foot is allowed exactly one loud
              object at exactly one size.

              THE INK IS GREY, NOT BLACK, and that is a ratio decision rather
              than a soft one. Near-black on this yellow measures 15.18:1 and
              reads as a filled primary button demanding a press, which is too
              much presence for a control sitting under seven quieter rows;
              `--chrome-add-ink` is 6.30:1 on it — comfortably past AA — and lets
              the colour do the pointing instead of the ink. */}
          {/* IT BECOMES A BUTTON WHEN THERE IS ROOM TO BE ONE.
              Collapsed, the yellow is a 28px chip inside the 40px icon column,
              because a 70px rail has space for a mark and nothing else.
              Expanded, the fill moves OUT of the chip and onto the row itself,
              so "New flow" reads as the same full-width primary the top bar
              carries rather than as a coloured square with a caption beside it
              — which is what it looked like, and it is the one control in the
              foot that is a verb.
              The fill swaps rather than stacks: the chip goes transparent at
              the same moment the row fills, so there is never a yellow square
              sitting on a yellow bar. `-mx-1 px-1` lets the filled row breathe
              to the gutter's edge without moving the chip, which is the whole
              point of the icon column — every glyph in the rail stays on one
              vertical line in both states. */}
          <Link
            href="/dashboard/flows"
            className={cn(
              SLOT,
              "transition-colors duration-(--duration-fast) ease-(--ease-standard)",
              "group-hover/rail:-mx-1 group-hover/rail:w-[calc(100%+0.5rem)] group-hover/rail:justify-center group-hover/rail:rounded-full group-hover/rail:bg-accent-yellow group-hover/rail:px-1",
              "group-focus-within/rail:-mx-1 group-focus-within/rail:w-[calc(100%+0.5rem)] group-focus-within/rail:justify-center group-focus-within/rail:rounded-full group-focus-within/rail:bg-accent-yellow group-focus-within/rail:px-1",
              "hover:brightness-95",
            )}
          >
            <span
              aria-hidden
              className={cn(
                ICON_COL,
                "rounded-control border border-chrome-line bg-accent-yellow text-neutral-900 transition-colors duration-(--duration-fast) ease-(--ease-standard)",
                /* THE "+" LEAVES WHEN THE WORDS ARRIVE. Collapsed, the glyph IS
                   the control — it is the only thing a 70px rail can say.
                   Expanded, the row reads "New flow" in full, and a plus beside
                   those two words is the same instruction given twice. So the
                   chip is removed from the layout entirely rather than made
                   transparent: leaving a 40px invisible column in place would
                   push the label off the button's centre, which is the one
                   thing this control has to get right once it is a button. */
                "group-hover/rail:hidden group-focus-within/rail:hidden",
              )}
            >
              <Plus className="size-4" />
            </span>
            {/* SEMIBOLD, NOT MEDIUM, AND IT IS THE ONE LABEL IN THE RAIL THAT
                IS. The other seven are nav rows and take `font-medium` like
                every other destination in the product. This one is a BUTTON —
                the same button, with the same two words, that the top bar
                carries at 14px/600. Shipping it at 500 meant the identical
                control read at two weights depending on which end of the chrome
                you looked at, which is exactly the drift the kit exists to
                stop. */}
            <RailLabel className="font-semibold text-neutral-900">New flow</RailLabel>
          </Link>

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
          {/* The ghost's own wash is switched off and re-drawn on the ICON
              COLUMN, which is the same 40px square it used to be. Left on the
              button it would paint the whole 210px row on hover — the one shape
              nothing else in this rail draws. */}
          <Button variant="ghost" size="iconSm" className={cn(SLOT, "text-white hover:bg-transparent active:bg-transparent")}>
            <span
              className={cn(
                ICON_COL,
                "relative rounded-control transition-colors duration-(--duration-fast) ease-(--ease-standard) group-hover:bg-ink-800",
              )}
            >
              <Bell />
              {/* Measured off the ICON COLUMN, not the row and not the glyph:
                  the row is 40px wide at rest and 210px open, so a dot pinned to
                  its right edge would fly across the panel as it opens. The 40px
                  column centres a 16px icon at 12–28px, so `right-2.5 top-2.5`
                  lands on the bell's own top-right corner and stays there at
                  every width. */}
              <span aria-hidden className="absolute top-2.5 right-2.5 size-2 rounded-full bg-chrome-presence" />
            </span>
            <RailLabel className="text-ink-400 group-hover:text-ink-50">Notifications</RailLabel>
          </Button>
        </div>
      </div>
    </aside>
  );
}
