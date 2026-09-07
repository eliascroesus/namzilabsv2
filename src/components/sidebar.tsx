"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Gift, LayoutDashboard, Monitor, PanelLeftClose, PanelLeftOpen, Plug, Plus, Radio, Search, Settings, UserPlus, Workflow } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHOICES } from "@/components/theme";
import { railSearchEntries } from "@/lib/rail-search";
import { useTheme } from "next-themes";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { viewStrip, type BoardView } from "@/lib/board/types";
import { GROUP_COLOR_KEYS, groupBadge, groupInk } from "@/components/flow/node-accent";

/**
 * THE ICON RAIL — 48px at rest, 240px under the pointer.
 *
 * WHAT IT WAS: 70px of `ink-950` running the full height, with the top bar
 * carrying the same charcoal across the rest. The two were ONE BAND wrapping a
 * lighter page, and the whole design followed from that: no hairline inside the
 * band (a 40-point luminance step finds its own edge), a notch cut out of the
 * band's inner corner, a chip under every glyph so the icons had a surface to
 * sit on, and a `focus-ring-light` because the product's one focus ring was
 * invisible on near-black.
 *
 * WHAT IT IS: 48px of `--background` — the SAME COLOUR as the top bar and the
 * page — separated from both by a 1px `--border` hairline and nothing else.
 * Every one of the five decisions above inverts with that. There is no band, so
 * there is no notch and no second material to avoid drawing a rule between;
 * there is one hairline down the right edge doing the entire job. The glyphs sit
 * directly on the ground at 12.9:1 with no chip, because a chip is a surface
 * step and there is nothing here to step away from. The focus ring is the
 * product's own — blue (`#3D9BFF`) at 6.65:1 on this exact colour, which is
 * the ring the light page provably could not carry.
 *
 * The rail's top block is still exactly the top bar's height, and that is still
 * the point: it is what makes the corner where the rail's rule meets the bar's
 * rule ONE seam rather than two that nearly meet. `tests/page-width.test.ts`
 * pins the two together.
 *
 * AND IT OPENS. Point at it and the column widens IN PLACE to 240px and the
 * names fade in beside the chips: the wordmark, the two caps headings and
 * every destination. The reference is VoltOps, and the reason to copy
 * it is that it settles the argument the notes below used to lose — an icon
 * rail is unreadable until you have learned it, and the six names are the one
 * thing 70px genuinely could not hold. It holds them now, for as long as you
 * are looking at it.
 *
 * IT OVERLAYS, IT DOES NOT PUSH. The `<aside>` keeps a flat 48px footprint in
 * the layout and the panel inside it is `absolute`, so the 192px it gains are
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
 * THERE IS NOTHING LEFT TO INVERT. This block used to argue that the band must
 * keep `bg-background` in BOTH themes while only the page inside it switched — the
 * thing Miro, Notion and Linear all do, on the grounds that a rail which flips
 * with the theme is a rail with no identity. The argument was right and it has
 * no subject: there is one theme, and the rail is `--background`, which is
 * exactly what the page is. What gives it identity now is not being a different
 * colour, it is the hairline and the fact that it is the only column on screen.
 *
 * EVERY ROW IS A 32px SLOT HOLDING A 24px CHIP, and the split matters. The CHIP
 * is the picture — a bare 16px glyph at 12.9:1, with no plate under it, because
 * on this ground there is no surface to lift it off. The SLOT is the hit area:
 * 32px tall, and as WIDE as the column is at the moment you press it, so an open
 * rail lets you click the name as well as the picture. Colour is spent in
 * exactly one place — the row you are standing on carries `--control` under
 * the WHOLE ROW and a blue glyph (`text-marker`) on top of it, with no fill
 * of its own under the chip, and the other four are plain.
 *
 * WHAT THE 48px COULD NOT HOLD, AND WHERE EACH THING WENT. Every one of these
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
 * · THE ⌘K KEYCAP. GONE AGAIN, 6 SEP 2026, at the owner's word — it came
 *   back with the panel and went out with the export, which draws a search
 *   field carrying a magnifier and a word and nothing else. The binding is
 *   untouched: `aria-keyshortcuts` on the button is the announced fact, and
 *   the chip was `aria-hidden`, so it was never part of the control's name.
 * · THE TOOLTIPS. GONE, all seven, and that is a decision rather than an
 *   omission. They existed to name a glyph for a pointer user; the panel now
 *   names it, at the same moment, from the same string. Worse, they were
 *   `side="right"` — anchored to a row that is now 216px wide, a tooltip opens
 *   ON TOP of the very label it duplicates. A control cannot be its own
 *   annotation.
 * · THE THEME TOGGLE. GONE, with the second theme it switched between.
 */

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
 * component is pinned by `tests/vendored-primitives.test.ts` at this path.
 *
 * THE COLOUR IS BACK, AND THE BUG THAT KILLED IT LAST TIME IS THE REASON THIS
 * VERSION SETS BOTH HALVES IN ONE PLACE.
 *
 * It used to sit on a saturated hue derived from the workspace name and drew
 * its initials in a hard-coded `text-white`. When those chips were removed the
 * FILL left and the INK stayed, so the letters were white-on-white at every
 * call site in the light theme — still in the DOM, still announced, invisible.
 * The lesson is not "do not colour it": it is that a fill and the ink solved
 * against that fill are ONE decision and must not be separable. So both come
 * out of the same `key` below, and neither is a class anything can override.
 *
 * THE PALETTE IS THE ONE THE BOARD ALREADY OWNS. `GROUP_ACCENT` is twelve hues
 * solved to 3.05:1 on white, with `groupBadge` (16% over the card) and
 * `groupInk` (60% into the theme's far end) already carrying a name legibly on
 * every one of them at both exposures. Minting a second workspace palette would
 * be two sets of nearly-identical hues in one product, which is the exact
 * near-miss the kit exists to prevent — and this one is theme-aware for free.
 *
 * `grey` is skipped: it is the palette's "no colour chosen" default, and a
 * workspace landing on it would look like the neutral chip this replaces rather
 * than like a workspace whose colour happens to be grey.
 */

/**
 * A STABLE HUE FOR A WORKSPACE. FNV-1a, and the choice of hash matters: this
 * renders on the server and again on the client, so anything with per-process
 * state or a random seed would hydrate to a different colour than it painted.
 * Keyed on the org's ID where the caller has one, so renaming a workspace does
 * not recolour it.
 */
function workspaceHue(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hues = GROUP_COLOR_KEYS.filter((k) => k !== "grey");
  return hues[h % hues.length];
}

export function WorkspaceChip({ id, name, className }: { id?: string; name: string; className?: string }) {
  const key = workspaceHue(id ?? name);
  return (
    <span
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-control text-xs font-semibold", className)}
      /* Inline, and together. See the note above: the fill and the ink it is
         solved against are one decision, and a class either half could be
         overridden by is how this went white-on-white last time. */
      style={{ background: groupBadge(key), color: groupInk(key) }}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * THE CHIP INSIDE A ROW — the 24px picture, at the control radius.
 *
 * REST IS NOTHING AT ALL: a bare `--foreground` glyph, which on this ground
 * measures 12.9:1 and needs no plate to be found. The hover wash is `neutral-700`
 * — one raised step — and it is the chip that lights rather than the row,
 * because a 210px bar lighting under the pointer is a shape nothing else in this
 * column draws.
 *
 * ACTIVE IS THE BRAND GLYPH, WITH THE ROW ITSELF RAISED — NOT THE CHIP — AND
 * THAT IS THE ONE PLACE THIS RAIL OVERRULES ITS REFERENCE.
 *
 * The reference draws the active row as a coloured glyph and nothing else — no
 * fill, no rule, no chip. That is colour carrying state on its own, which is the
 * failure WCAG 1.4.1 is about: it is invisible to a colour-blind
 * reader, who then has no way at all to tell which of six identical grey icons
 * is the page they are on. `aria-current="page"` covers the semantic half and
 * covers nothing for someone who can see the screen perfectly well and simply
 * cannot separate those two hues.
 *
 * So the colour stays — `text-marker`, 5.69:1 on `--control` in dark
 * (`#3D9BFF` on `#202020`), up from ≈4.0:1 on the `--accent` fill this
 * replaced — and `--control` goes under the WHOLE ROW (the `<Link
 * className={SLOT}>` below, not this chip): the SAME fill the search field
 * wears a few rows up, not the hover's `--accent` step (a visibly stronger
 * raise, reserved for what the pointer is over right now, which the active
 * row is not). The chip carries no fill of its own any more — with the row
 * already raised, a second, smaller raise directly under the glyph would be
 * one signal drawn twice. Two signals remain (the row's own fill, and a
 * colour that is not just a colour), and the row still looks like the
 * reference's.
 *
 * IT USED TO BE THE OTHER WAY ROUND: a filled yellow chip with dark ink, on the
 * argument that one filled object in a column settles the question so the other
 * six do not have to compete. That still holds, and the filled object is now the
 * "+" in the foot — the column's one VERB. Spending the fill on the active row
 * as well would have been two filled objects saying different things.
 */
function RailChip({ tone, children }: { tone: "rest" | "active"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-8 items-center justify-center rounded-control transition-colors duration-(--duration-fast) ease-(--ease-standard) [&_svg]:size-[18px]",
        /**
         * WHITE, NOT BLUE, AS OF 6 SEP 2026 — the owner's call, and the long
         * note above this component is what it overrules.
         *
         * That note defends a blue glyph as the second signal WCAG 1.4.1 asks
         * for, on the reading that the row's fill alone is "colour carrying
         * state on its own". It is not: `--control` under the whole row is a
         * SURFACE change, which is a non-colour signal in exactly the way a
         * hue swap between two grey icons is not, and the label goes to full
         * ink beside it. So the active row still carries two signals — a fill
         * and an ink step — and neither of them is a hue anybody has to be
         * able to distinguish. `aria-current="page"` is unchanged.
         *
         * `[&_svg]:fill-current` is the "completely filled" half: lucide draws
         * these as outlines, and the export's active glyph is solid. Filling
         * from the same `currentColor` keeps it one decision.
         *
         * NO HOVER FILL ON THE CHIP. It carried `group-hover:bg-accent` — a
         * 32px square lighting up under the pointer INSIDE a row that now
         * lights up as a whole. Two nested raises for one hover; the row's is
         * the one that survives (see `SLOT`'s own hover).
         */
        tone === "active"
          ? "text-foreground [&_svg]:fill-current"
          : "text-foreground",
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
  "opacity-0 transition-opacity duration-(--duration-fast) ease-(--ease-standard) group-hover/rail:opacity-100 group-focus-within/rail:opacity-100 group-data-[pinned=true]/rail:opacity-100";

/**
 * The name beside a chip. `shrink-0` + `whitespace-nowrap` rather than a
 * flexible measure: a label that resolves its width against the ANIMATING
 * panel re-wraps and re-ellipsises on every frame of the open, which reads as
 * the text stuttering into place. Fixed at its natural width, it is simply
 * uncovered by the panel's edge, which is the motion the reference has.
 */
function RailLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("shrink-0 whitespace-nowrap text-sm font-medium text-foreground", REVEAL, className)}>
      {children}
    </span>
  );
}

/**
 * THE ICON COLUMN — 24px, and it never moves.
 *
 * Every chip in the rail sits in one of these, so the mark, the five
 * destinations, the "+" and the bell are on a single vertical axis at 48px AND
 * at 240px. The rail widens; the pictures do not budge, which is the whole
 * difference between a column opening and a column reflowing.
 *
 * 24, down from 40, and the number is forced rather than chosen: the rail is
 * 48px with a 12px gutter either side, so 24 is exactly what is left. That is
 * also why the HIT TARGET is not this box — see `SLOT`, which is 32px tall and
 * full-width. A 24px square would meet WCAG 2.2's minimum by one pixel and feel
 * like it.
 */
const ICON_COL = "flex size-8 shrink-0 items-center justify-center";

/**
 * The glyph a search result wears — looked up from the SAME two tables the
 * column draws from, so a result and the row it points at can never show two
 * different pictures. A view has no icon of its own and borrows Dashboard's,
 * which is the row it nests under.
 */
function PageGlyph({ label }: { label: string }) {
  const Icon = NAV.find((n) => n.label === label)?.icon ?? LayoutDashboard;
  return <Icon className="size-[18px]" />;
}

function ThemeGlyph({ value }: { value: "light" | "dark" | "system" }) {
  const Icon = CHOICES.find((c) => c.value === value)?.Icon ?? Monitor;
  return <Icon className="size-[18px]" />;
}

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
 * every row at 48px) pushes the chip left off the axis every other row sits on.
 *
 * `focus-ring-light` IS GONE, and it went with the thing it was for. globals.css
 * draws one ring for the whole product in `--ring`; while that ring was violet
 * and this rail was the one dark surface in a light app, it was invisible here
 * and needed a sanctioned white twin. The ring is blue and reads clearly on
 * every one of the product's three dark grounds now (6.65:1 on the page,
 * 6.59:1 on the chrome, 6.20:1 on the panel), so the product's own ring is the
 * correct one and a second spelling would be a second answer.
 *
 * 32px TALL, ON A 24px PICTURE. The reference's rows are the glyph plus 6px of
 * padding, which is 28px — over WCAG 2.2's 24px minimum by four pixels and
 * under what a rail you click all day should ask for. The extra four cost
 * nothing: the chip is what you see and it is still 24.
 *
 * 44px BELOW `md`, AND IT IS THE SAME ROW, NOT A SECOND ONE.
 *
 * `h-9` is 36 — over WCAG 2.2's 24px minimum and right for a pointer, and
 * four pixels under what a finger asks for. `min-h-11` raises the computed
 * height to 44 on a phone without touching `h-9`, and `md:min-h-0` stands
 * down again above the breakpoint, so the rail keeps its density and the
 * drawer keeps its targets from one string.
 */
const SLOT = "group flex h-9 min-h-11 w-full shrink-0 items-center justify-start gap-2.5 rounded-control text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-control md:min-h-0";

/**
 * THE GUTTER, WRITTEN DOWN.
 *
 * 16px, which is what `node-id=14:44` measures on the open rail: its nav block
 * is `px-[16px]` and its 226.9px rows sit inside a 260px column. It was 14
 * (`px-3.5`) — a value carried over from the 48px collapsed rail, where it was
 * "exactly what is left when a 24px chip sits in a 48px column". That
 * arithmetic stopped applying the day the rail defaulted open, and two pixels
 * is enough to put every glyph in this column off the vertical line the page's
 * own 24px gutter sets up beside it.
 *
 * It has to be a number rather than an `items-center` because the rows are
 * full-width — centring a 216px row centres nothing — and it is the one
 * measurement that keeps the open panel's chips standing exactly where the
 * closed one's were.
 *
 * THE MARK'S BLOCK SPELLS IT OUT INSTEAD OF READING IT, and that is not an
 * oversight to tidy up. tests/page-width.test.ts matches that block's class
 * attribute as a LITERAL — `className="flex h-… shrink-0 items-center` — to
 * check the rail's top block against the top bar's height, and a `cn()` call
 * there matches nothing and fails the file with "could not find the rail's top
 * block". Two spellings of 12px, and this is the note that keeps them in step.
 */
const GUTTER = "px-4";

/**
 * THE RAIL'S CONTENT — one tree, rendered in two places.
 *
 * The phone has no hover, so it cannot have a hover rail; below `md` the
 * column is not rendered at all and a drawer carries the same rows (see
 * `mobile-drawer.tsx`). The thing that must not happen is the obvious one:
 * a second nav list, a second search row, a second answer to "which view am
 * I on", drifting apart on the first change to either. So this is the whole
 * of what the rail SAYS, and the rail and the drawer are two frames around
 * it — one 56px and hover-driven, one 280px and pressed open.
 *
 * IT NEEDS NO "EXPANDED" PROP, AND THAT IS THE POINT OF THE SPLIT. Every
 * label in here rides `REVEAL`, which fades on `group-hover/rail`,
 * `group-focus-within/rail` and `group-data-[pinned=true]/rail`. The drawer
 * wraps this in a `group/rail` carrying `data-pinned="true"`, so the third
 * variant fires and the labels, the keycap, the view list and the filled
 * "New flow" row all open exactly as they do in a pinned rail. Not one class
 * below knows a drawer exists.
 */
export function RailContent({
  hide,
  views = [],
  workspace,
  account,
  invite = false,
}: {
  hide?: string[];
  views?: BoardView[];
  workspace?: string;
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
  /**
   * Draw "Invite members" in the foot. The DRAWER sets it and the rail does
   * not, because this is where that control lands when the top bar sheds it
   * below `md` — above `md` it is still in the bar, and a second copy here
   * would be two routes to one settings page a centimetre apart.
   */
  invite?: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  // The workspace's initial for the switcher's square. `.trim()` first: an
  // org named " Acme" would otherwise render a blank blue square — the same
  // guard the old top-bar identity used.
  const initial = (workspace ?? "").trim().charAt(0).toUpperCase() || "W";
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

  /**
   * THE RAIL'S SEARCH — the field's text, and what it turns the column into.
   *
   * A NON-EMPTY QUERY REPLACES THE NAVIGATION with its matches. The alternative
   * — a panel floating under the field — cannot work here without a portal:
   * this column is `overflow-y-auto`, so an absolutely-positioned child is
   * clipped at its foot. Filtering in place also happens to be what the owner
   * asked for in the first place ("search like the different nav things").
   */
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * NO `useRouter` HERE, and that is worth a line: a result is a real <a href>,
   * so the browser navigates and a middle-click still opens a tab. It also
   * keeps `next/navigation`'s surface in this file to the two hooks
   * `tests/mobile-drawer.test.ts` already mocks — that file imports this one
   * and Vite throws on a static binding its mock does not provide, so a third
   * hook here would fail an unrelated suite at import time.
   */
  const { setTheme } = useTheme();

  /**
   * ⌘K FINALLY DOES SOMETHING. `aria-keyshortcuts="Meta+K"` has been on this
   * control since the 264px column, announcing a binding no code implemented —
   * an accessibility claim the product could not honour. It focuses the field.
   *
   * ON `window` RATHER THAN THE FIELD, because a shortcut whose only listener
   * is the thing it focuses can never fire. Capture phase for the reason
   * `input-modality.tsx` gives: the canvas and the modals stop propagation.
   *
   * MOUNTED TWICE ONLY WHILE THE PHONE DRAWER IS OPEN — `RailContent` is one
   * tree rendered by the desktop <aside> and by the drawer's <SheetContent>,
   * and Radix unmounts the latter when closed. Two listeners would both focus
   * their own field; the drawer's is the one on screen, and it wins because it
   * mounts second. Not worth a store to arbitrate.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  /**
   * The matches, over the SAME arrays the column renders — `items` is already
   * through the `hide` gate, so a rank-restricted member cannot find Apps here
   * after failing to find it above. Substring rather than fuzzy: the corpus is
   * a dozen short labels, and a fuzzy scorer on twelve strings mostly produces
   * surprises.
   */
  const q = query.trim().toLowerCase();
  const results = q
    ? railSearchEntries({ items, views: ordered, themes: CHOICES }).filter((e) => e.label.toLowerCase().includes(q))
    : [];

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
      className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-(--duration-base) ease-(--ease-standard) group-hover/rail:grid-rows-[1fr] group-focus-within/rail:grid-rows-[1fr] group-data-[pinned=true]/rail:grid-rows-[1fr]"
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
                "flex h-8 min-h-11 items-center rounded-control pl-4 pr-2 text-sm transition-colors duration-(--duration-fast) md:min-h-0",
                /* `bg-control` (#202020) FOR BOTH, which is the rule the whole
                   rail follows now: the row you are on and the row under the
                   pointer wear the SAME fill. `--accent` (#3A3A3A) was a second,
                   stronger raise reserved for hover, and having two of them
                   meant a hovered row looked more selected than the selected
                   one. See `SLOT`. */
                on
                  ? "bg-control font-medium text-foreground"
                  : "text-muted-foreground hover:bg-control hover:text-foreground",
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
            className="h-8 min-h-11 w-full justify-start rounded-control pl-8 pr-2 text-xs font-medium text-muted-foreground hover:bg-control hover:text-foreground active:bg-control md:min-h-0"
          >
            {allViews ? "Show less" : `Show all ${ordered.length}`}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
        {/* THE SWITCHER IS HERE NOW; THE MARK MOVED TO THE BAR.
            One wordmark in the chrome is enough, and the bar carries it full
            width now — this block used to be that mark, and it is the
            workspace switcher instead, which is where the Figma puts it: the
            head of the column you use to move between the things a
            WORKSPACE has, not the product's own name.

            THE SQUARE IS A FLAT BLUE TINT, NOT `WorkspaceChip`'s PER-WORKSPACE
            HUE. `WorkspaceChip` (below, and in `org-switcher.tsx`) draws a
            LIST, where colour is what tells several workspaces apart at a
            glance. This draws the ONE workspace you are already in, so the
            export's flat brand tint is the right answer — reusing
            `WorkspaceChip` here would answer a question ( "which of several" )
            that this row never asks.

            THE FILL IS `bg-primary text-primary-foreground`, NOT THE EXPORT'S
            `bg-brand-500/75`. White on `brand-500` at 75% composites to
            2.83:1 over the light chrome — under AA for a 13px/600 glyph, and
            in the collapsed rail this initial is the only thing on the row.
            `bg-primary` (brand-600, solid) holds 4.68:1 in both themes; dark
            gives up the 75% translucency the export drew, which cost nothing
            it was relying on for legibility.

            IT OPENS THE SAME PANEL THE BAR'S OLD IDENTITY CONTROL DID —
            `account.panel`, built once in `app-shell.tsx` and unchanged by
            this move: only the trigger relocated, not the workspace list, the
            identity band or the way out inside it.

            THE CHEVRON IS A PROMISE, so it only appears when there is a panel
            to open — the same rule the bar's own identity control followed:
            `account` present draws the dropdown, its absence draws plain
            text with no chevron pointing at nothing.

            THE INITIAL IS `text-xs font-semibold` — 13px at 600, which is what
            the kit's top weight is. The export draws it at 700; this is one of
            the several 700s the kit does not follow, because "a badge is not
            prose" would let every badge in the product past the weight lock
            and 600 already reads as a badge at 13px. `.wordmark` stays the ONE
            exception above 600 (see globals.css), and it needs no gate change
            because its weight is declared in CSS. */}
        <div className="flex h-[60px] shrink-0 items-center px-4">
          {workspace &&
            (account ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* `size="iconSm"` CARRIES NO PADDING OF ITS OWN, WHICH IS
                      THE POINT. With no `size` at all this fell back to the
                      "default" variant's `h-8 px-3 text-sm [&_svg]:size-4`,
                      and `px-3` is a class `cn(SLOT, …)` has nothing to
                      cancel it with — `SLOT` sets no horizontal padding — so
                      it survived the merge and pushed the 28px square 12px
                      off `ICON_COL`, 2px past the 56px rail's own edge,
                      clipped. `iconSm` (the search button below already uses
                      it) has no `px-*` of its own, so the row goes back to
                      being exactly as wide as `ICON_COL` says it should be;
                      `SLOT`'s own `w-full`/`h-9` still win the merge for the
                      row's actual size, the same way they already do for the
                      search button.

                      `[&_svg]:size-5` is not decoration: every size variant
                      ships its own `[&_svg]:size-*` (`iconSm`'s is `size-4`),
                      and that descendant rule beats the chevron's own class on
                      specificity no matter which order the two are written in
                      — overriding at the same level, on the button that owns
                      the rule, is the only spelling that actually lands. The
                      export draws this chevron at 24; 20 is the kit's nearest
                      rung and the one every other chevron in the product
                      stands on. It was 12, which is why the row read as a name
                      with a speck after it rather than as a control. */}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    /* `h-10` — 40px, which is what the export measures on this
                       one row (its search and its nav rows are 36). The head of
                       the column is the only thing above the search field, so
                       it carries the extra four pixels rather than the rail
                       opening on a row the same size as everything below it. */
                    className={cn(SLOT, "h-10 [&_svg]:size-5")}
                    aria-label={`${workspace} — workspace and account`}
                  >
                    <span className={ICON_COL}>
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-control bg-primary text-xs font-semibold text-primary-foreground"
                      >
                        {initial}
                      </span>
                    </span>
                    {/* `justify-between`, so the chevron sits on the rail's own
                        right edge rather than trailing the name. The export
                        draws the trigger as two ends of a full-width row: the
                        chip and the name together on the left, the chevron
                        alone on the right. */}
                    <span className={cn("flex min-w-0 flex-1 items-center justify-between gap-2", REVEAL)}>
                      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{workspace}</span>
                      <ChevronDown aria-hidden className="shrink-0 text-muted-foreground" />
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-64 p-0">
                  {account.panel}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className={SLOT}>
                <span className={ICON_COL}>
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-control bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    {initial}
                  </span>
                </span>
                <RailLabel className="font-semibold text-foreground">{workspace}</RailLabel>
              </span>
            ))}
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
        {/**
          * ONE FLAT STACK, AND THE SECTION HEADINGS HAVE GONE.
          *
          * This was two groups — "Workspace" and "Build" — each opening with a
          * caps label whose line was RESERVED at 70px so that it could fade in
          * on hover without moving anything. That reservation was correct and
          * the argument for it is worth keeping on the record: a heading that
          * grows from zero on hover pushes every row below it down ~20px WHILE
          * THE POINTER IS ON ONE OF THEM — you aim at Flows, the rail opens,
          * Activity slides under your cursor, and you click the wrong page.
          *
          * The export does not draw the headings, and it does not draw the air
          * they reserved: its seven slots are a single uniform column, 40px each
          * with a 2px gap, from the mark to the foot. There is no third option
          * here. Keeping the headings means keeping ~56px of blank charcoal in a
          * shut rail to hold two words nobody can see; collapsing them on hover
          * means reintroducing exactly the mis-click above. So they go, and with
          * them the only thing in this column that was not a destination.
          *
          * What is lost is a division between LOOKING and BUILDING. What is
          * gained is the rail the export draws, and five rows is under the count
          * at which a list needs to be sorted into groups to be read at all.
          */}
        <nav
          aria-label="Primary"
          /* `pt-1`, NOT `pt-3`. The head block above is exactly 60px (it has to
             be — it is what makes the rail's rule and the top bar's rule one
             seam, pinned by tests/page-width.test.ts), so this padding is the
             only thing deciding where the search field lands. At 12px it put
             the field at 132; the export draws it at 124, and every row below
             inherited the same 8px of slack. */
          className={cn("quiet-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pt-1 pb-4", GUTTER)}
        >
              {/* THE SEARCH CONTROL OPENS THE COLUMN, which is where all
                  three references (Miro, Figma, Make) put it: the fastest way
                  into a product that holds far more objects than it has nav
                  items.

                  IT IS A REAL FIELD NOW, 7 SEP 2026. It was a `<Button>` that
                  looked like a field, and the comment here argued that was "the
                  honest spelling" because pressing it would open the vendored
                  command palette. The palette was never wired: the button
                  carried no handler, `aria-keyshortcuts="Meta+K"` announced a
                  binding nothing implemented, and the whole control did
                  nothing at all. The owner asked the question that follows from
                  that — "why is the search a button and not an input field?" —
                  and the answer is that there was no reason, only an unbuilt
                  intention.

                  THE RESULTS REPLACE THE NAV RATHER THAN FLOATING OVER IT, and
                  that is a constraint rather than a preference. This <nav> is
                  `overflow-y-auto`, which makes it the clipping box for any
                  absolutely-positioned child: a dropdown panel under the field
                  would be cut off at the column's foot and would lengthen the
                  scroller behind it. Filtering the column in place has no such
                  problem, needs no portal, and is what "search the nav things"
                  literally means — the rows you are looking for are the rows
                  this column already draws.

                  THE KEYCAP STAYS GONE (6 Sep 2026, the owner's call) and the
                  BINDING IS REAL NOW: `aria-keyshortcuts` is still the
                  announced fact, and ⌘K finally does what it has been claiming
                  to do — see the effect above, which focuses this field. */}
              <div className="relative">
                <Search
                  aria-hidden
                  /* Inside the field, on `ICON_COL`'s own axis: the magnifier
                     has to stand on the same vertical line as the seven glyphs
                     below it or the column has a kink in it. 18px, like every
                     other icon in the rail — a 16px magnifier would be the one
                     picture here that is quietly a size smaller. */
                  className="pointer-events-none absolute left-[7px] top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Escape clears rather than blurs: the field is the rail's
                    // filter, so emptying it is what puts the navigation back.
                    if (e.key === "Escape") setQuery("");
                  }}
                  placeholder="Search"
                  aria-label="Search the navigation"
                  aria-keyshortcuts="Meta+K"
                  /* `cn(SLOT, …)` rather than a hand-spelled height: SLOT
                     carries the 44px touch minimum that `md:min-h-0` stands
                     down above the breakpoint, and spelling those two literals
                     again here would be a third copy inside the slice
                     tests/mobile-shell.test.ts counts. The field's own
                     `border`/`bg-control`/`rounded-control` come from `Input`;
                     what is overridden is the left padding, to clear the
                     magnifier standing in the icon column. */
                  className={cn(SLOT, "border-border pl-9 pr-2")}
                />
              </div>
              {/* THE CAPS LABEL IS BACK, ON THE FIGMA'S OWN TERMS THIS TIME.
                  It was removed because a heading reserved at 70px pushed
                  every row below it down while the pointer was still moving
                  onto one of them. `REVEAL` fades OPACITY rather than height,
                  so the label costs the same fixed slice of the column
                  whether it is visible or not — nothing moves under the
                  cursor, which is the fix, not a re-litigation of the old
                  argument (the row it labels simply always reserves the
                  space now, seen or not). */}
              {/* SENTENCE CASE, NOT CAPS — the export draws "Main Menu", and
                  it is the one caption in the product that does. The kit's
                  caps recipe (`SectionHeading`) is untouched and still right
                  for a column head or a menu's eyebrow; this label sits in the
                  chrome, where the argument for caps ("it makes a 12px string
                  read as a label rather than a very small sentence") is
                  answered instead by the eight ROWS under it, which are the
                  only other thing in this column and are unmistakably a list.

                  THE INK STAYS `--faint`, WHICH IS THE ONE VALUE HERE THAT
                  DELIBERATELY DOES NOT MATCH. The export sets this string in
                  #4A4A4A, which measures 2.13:1 on the chrome — not a label
                  anyone can read. `--faint` (#6E6E6E) is the tested substitute
                  at 3.70:1, and globals.css names the same deviation on the
                  role itself. Casing is a drawing decision and was adopted;
                  contrast is not, and was not. */}
              {/* ── THE MATCHES, IN PLACE OF THE COLUMN ──────────────────
                  A live query swaps the caption and the seven rows for what it
                  found. Nothing floats, nothing is portalled, and the rail's
                  own scroll keeps working — see the field's note above for why
                  a dropdown could not.

                  A THEME ROW IS NOT A LINK, so the two kinds are drawn as two
                  elements rather than one with a branch inside it: a
                  destination is an <a> the browser can open in a new tab, and
                  setting the theme is a press. Making both a <button> would
                  cost the first its middle-click; making both a link would
                  need an href for something that goes nowhere. */}
              {q ? (
                <div
                  role="listbox"
                  aria-label="Search results"
                  /* `gap-2 pb-1` — the same 8px the nav rows it replaces
                     stand at, and a class AFTER the gap on purpose: the
                     rail's gap pin reads `gap-(\S+)` greedily, so a class
                     string ENDING in a gap captures the closing quote with
                     it and fails on a value that is otherwise correct. */
                  className="flex flex-col gap-2 pb-1"
                >
                  {results.length === 0 && (
                    <p className={cn("px-1 py-2 text-xs text-muted-foreground", REVEAL)}>No matches.</p>
                  )}
                  {results.map((entry) =>
                    entry.kind === "theme" ? (
                      <Button
                        key={`theme:${entry.theme}`}
                        variant="ghost"
                        size="iconSm"
                        role="option"
                        aria-selected={false}
                        className={cn(SLOT, "hover:bg-control")}
                        onClick={() => {
                          setTheme(entry.theme);
                          setQuery("");
                        }}
                      >
                        <span className={ICON_COL}>
                          <RailChip tone="rest">
                            <ThemeGlyph value={entry.theme} />
                          </RailChip>
                        </span>
                        <RailLabel className="text-muted-foreground group-hover:text-foreground">
                          {entry.label}
                        </RailLabel>
                      </Button>
                    ) : (
                      <Link
                        key={`${entry.kind}:${entry.label}:${entry.href}`}
                        href={entry.href}
                        role="option"
                        aria-selected={false}
                        className={cn(SLOT)}
                        onClick={() => setQuery("")}
                      >
                        <span className={ICON_COL}>
                          <RailChip tone="rest">
                            {entry.kind === "page" ? <PageGlyph label={entry.label} /> : <LayoutDashboard className="size-[18px]" />}
                          </RailChip>
                        </span>
                        <RailLabel className="text-muted-foreground group-hover:text-foreground">
                          {entry.label}
                        </RailLabel>
                      </Link>
                    ),
                  )}
                </div>
              ) : (
                <>
              <p className={cn("px-1 pb-1 pt-2 text-xs font-normal text-faint", REVEAL)}>Main Menu</p>
              {items
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
                    /* `bg-control` ON THE ROW, NOT THE CHIP — the same fill
                       the search field wears (see `RailChip`'s own doc
                       comment for the rest of the argument). Spec: "active
                       row `--control` fill". */
                    <Fragment key={href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(SLOT, active && "bg-control")}
                      >
                        <span className={ICON_COL}>
                          <RailChip tone={active ? "active" : "rest"}>
                            <Icon className="size-[18px]" />
                          </RailChip>
                        </span>
                        <RailLabel
                          className={active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}
                        >
                          {label}
                        </RailLabel>
                      </Link>
                      {label === "Dashboard" && ordered.length > 0 && <ViewList />}
                    </Fragment>
                  );
                })}
                </>
              )}
        </nav>

        {/* THE FOOT — what you can START, then what is waiting for you.
            `mt-auto` rather than a `justify-between` on the column: the nav above
            is the flexible child and it has to keep its own scroll, so the foot
            is pinned by the space the nav gives back instead of by the column's
            distribution.

            THE THEME TOGGLE WAS HERE AND IS GONE, along with the preference it
            expressed. It was the app's only control for a theme the app
            actually shipped, and dropping it while two themes existed would
            have left the light one reachable only by changing the operating
            system's. There is one theme, so the control has nothing to say. */}
        {/* `gap-4 pb-6` — the export's own 16px between the foot's two acts and
            24px under them. It was 8 and 16, which stacked two filled buttons
            close enough to read as one two-line control. */}
        <div className={cn("mt-auto flex shrink-0 flex-col gap-4 pb-6", GUTTER)}>
          {/* THE "+" IS THE COLUMN'S ONE FILLED OBJECT, AND THAT IS WHY IT CAN
              BE THE ONLY BRAND FILL IN THE RAIL.
              It has been a yellow slab, then a white chip with a hairline, and
              the argument each time was about how much brand a column could
              carry. That argument resolves cleanly here: the workspace
              switcher's square at the head of the column is its own flat
              brand TINT (identity — see `Sidebar`'s head block above), the
              active row is a brand GLYPH on the row's own neutral fill
              (location — the chip itself carries no fill; see the note
              above), and this is the single FILL (action). Three appearances of one
              colour in three different shapes, each doing a different job,
              rather than three fills competing to be the thing you press.

              THE INK IS WHITE, NOT THE GROUND — and that it ever read
              otherwise here is a tell for which era this comment was last
              true. `--primary-foreground` is `#ffffff` in both themes: the
              fill is `--primary` (the brand blue), and blue wants light ink
              for contrast in light and dark alike. A DARK ink was the right
              constant on the old YELLOW slab this replaced; it stayed
              written down a full re-theme after the fill it described
              actually went blue.

              24px, ON THE `ICON_COL` AXIS. The chip is the same size as every
              other picture in the column, so the rail's own vertical line
              runs unbroken from the switcher's square to the Get Free Access
              bell below — a DIFFERENT bell from the one the top bar carries
              for notifications; this one is the rail's own upsell row. */}
          {/* IT BECOMES A BUTTON WHEN THERE IS ROOM TO BE ONE.
              Collapsed, the brand is a 24px chip inside the icon column,
              because a 48px rail has space for a mark and nothing else.
              Expanded, the fill moves OUT of the chip and onto the row itself,
              so "New flow" reads as a full-width primary — the row's OWN
              filled state, not a match for the top bar's copy of the same
              shortcut, which stays the ordinary secondary grey (blue is
              reserved for the controls that add something, and this row
              already is one of them without needing the bar's to agree too)
              — which is what it looked like, and it is the one control in the
              foot that is a verb.
              The fill swaps rather than stacks: the chip is removed at the same
              moment the row fills, so there is never a brand square sitting on
              a brand bar. `-mx-1 px-1` lets the filled row breathe to the
              gutter's edge without moving the chip, which is the whole point of
              the icon column — every glyph in the rail stays on one vertical
              line in both states. */}
          <Link
            href="/dashboard/flows"
            className={cn(
              SLOT,
              /* 32px, NOT the rail's 36. This is a filled BUTTON wearing a
                 row's shape, and the owner's rule is that everything with a
                 background stands at 32 — the top bar's buttons, the header's
                 three, and this. The export measures it at 32 in the foot
                 while the row above it ("Get Free Access") stays 36, which is
                 the same split: one is an act, the other is a destination. */
              "h-8",
              "transition-colors duration-(--duration-fast) ease-(--ease-standard)",
              "group-hover/rail:-mx-1 group-hover/rail:w-[calc(100%+0.5rem)] group-hover/rail:justify-center group-hover/rail:rounded-control group-hover/rail:bg-primary group-hover/rail:px-1",
              "group-focus-within/rail:-mx-1 group-focus-within/rail:w-[calc(100%+0.5rem)] group-focus-within/rail:justify-center group-focus-within/rail:rounded-control group-focus-within/rail:bg-primary group-focus-within/rail:px-1",
              // PINNED IS THE THIRD STATE, and every reveal in this file has to
              // name it. A rail held open by choice that still showed a bare
              // "+" chip and a collapsed view list was open in width only.
              "group-data-[pinned=true]/rail:-mx-1 group-data-[pinned=true]/rail:w-[calc(100%+0.5rem)] group-data-[pinned=true]/rail:justify-center group-data-[pinned=true]/rail:rounded-control group-data-[pinned=true]/rail:bg-primary group-data-[pinned=true]/rail:px-1",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-8 shrink-0 items-center justify-center [&_svg]:size-[18px]",
                "rounded-control bg-primary text-primary-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) group-hover:bg-primary-hover",
                /* THE "+" LEAVES WHEN THE WORDS ARRIVE. Collapsed, the glyph IS
                   the control — it is the only thing a 48px rail can say.
                   Expanded, the row reads "New flow" in full, and a plus beside
                   those two words is the same instruction given twice. So the
                   chip is removed from the layout entirely rather than made
                   transparent: leaving a 40px invisible column in place would
                   push the label off the button's centre, which is the one
                   thing this control has to get right once it is a button. */
                "group-hover/rail:hidden group-focus-within/rail:hidden group-data-[pinned=true]/rail:hidden",
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
            {/* `text-button` — 14px, because when the rail is open this row IS
                a filled button and the kit's filled controls are all 14. The
                rail's other labels stay at the body's 15: they are
                destinations, not controls. */}
            <RailLabel className="text-button font-semibold text-primary-foreground">New flow</RailLabel>
          </Link>

          {/* GET FREE ACCESS — the upsell row the old bell placeholder becomes.
              That control had no store behind it to read and nothing to do
              when pressed; this is the row the export actually draws at the
              foot of the rail, and it goes to the same place the dropped plan
              card used to: Settings, where billing lives. */}
          {/* A FILLED BUTTON, NOT A NAV ROW, and a PRESENT rather than a bell.
              `node-id=14:44` draws this as `bg-[#333]` at 32px with its glyph
              and label centred — the kit's `secondary` exactly — sitting under
              the blue "New flow" as the second of two acts in the foot. It was
              a `SLOT` row wearing a bell with a blue dot, which read as a
              notification you had missed rather than as an offer, and put a
              third left-aligned destination under two centred buttons.

              The bell is also the top bar's own glyph for actual unread
              notifications, so spending it here meant one picture for two
              unrelated things in one chrome. A gift says what the row does.

              `size="sm"` and `w-full`: the kit's filled rung is already 32px
              at 14px type, so the height and the label size come from the
              button rather than being spelled again here. */}
          <Button asChild variant="secondary" size="sm" className="w-full">
            <Link href="/dashboard/settings">
              <Gift />
              <RailLabel className="text-button font-medium text-secondary-foreground">Get Free Access</RailLabel>
            </Link>
          </Button>
          {/* INVITE MEMBERS, WHICH IS A GUEST OF THIS FOOT RATHER THAN A
              RESIDENT. It is a top-bar control; below `md` the bar has room
              for a menu button, the mark and your avatar and nothing else, so
              it comes here with "New flow" rather than being dropped. The rail
              never sets `invite`, because up there the bar still carries it. */}
          {invite && (
            <Link
              href="/dashboard/settings"
              className={cn(SLOT, "text-muted-foreground hover:text-foreground")}
            >
              <span className={ICON_COL}>
                <UserPlus className="size-[18px]" />
              </span>
              <RailLabel className="text-muted-foreground group-hover:text-foreground">Invite members</RailLabel>
            </Link>
          )}
        </div>
      </>
  );
}

/**
 * THE HOVER RAIL — the frame around `RailContent`, and nothing else.
 *
 * What is left here is the geometry the CONTENT does not care about: the
 * footprint the page is laid out against, the panel that overlays rather
 * than pushes, the pin cookie, and the toggle straddling the hairline. The
 * rows, the search field and the foot are all `RailContent`, which the
 * phone's drawer renders too.
 *
 * IT IS NOT RENDERED BELOW `md`. A hover rail on a touch screen is a column
 * of unlabelled glyphs that can never open — the panel's whole vocabulary is
 * `hover` and `focus-within`, and a finger produces neither. `hidden
 * md:block` on the FOOTPRINT rather than on the panel: hiding the panel
 * alone would leave 56px of empty column down the left of every phone
 * screen, laid out and painted, holding nothing.
 */
export function Sidebar({
  hide,
  views = [],
  /**
   * PINNED OPEN, READ ON THE SERVER FROM A COOKIE.
   *
   * It arrives as a prop rather than being read here because the alternative
   * is a layout jump on every cold load: `localStorage` is not knowable
   * during render, so a pinned rail would paint at 56px and snap to 260px a
   * frame later — dragging the top bar and the whole page with it. That is
   * the exact failure `tests/page-width.test.ts` exists for, and a
   * preference is not worth reintroducing it. `AppShell` reads the cookie;
   * this only toggles it.
   *
   * THE FALLBACK IS OPEN, matching the cookie's own default — see the note in
   * `app-shell.tsx` for why the 6 Sep 2026 export settles that. It matters
   * beyond tidiness: `/design` and `/design/overview` mount this frame without
   * passing the prop, so a `false` here drew the kit and the reference screen
   * at a rail width the product no longer uses, which is the one thing those
   * pages exist not to do.
   */
  pinned: initialPinned = true,
  workspace,
  account,
}: {
  hide?: string[];
  views?: BoardView[];
  pinned?: boolean;
  workspace?: string;
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
}) {
  /**
   * Local state as well as the cookie, so the press is instant. The cookie is
   * for the NEXT page load; this is for this one. Writing only the cookie
   * would mean the rail did nothing until you navigated.
   */
  const [pinned, setPinned] = useState(initialPinned);
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    // A year, path-wide, Lax: it is a display preference, so it wants to
    // survive a restart and does not want to ride on cross-site requests.
    document.cookie = `rail=${next ? "pinned" : "hover"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <aside className={cn("relative z-20 hidden h-full shrink-0 md:block", pinned ? "w-65" : "w-[56px]")}>
      {/* THE PANEL — the whole rail, floated out of the layout. The hairline
          travels with it: the rail and the panel beside it are two surfaces
          now, and `border-r` is where one stops. `group/rail` is HERE and not
          on the <aside>, which is what stops the toggle's own focus holding
          the column open — see the note on the toggle below. */}
      <div
        className={cn(
          "peer group/rail absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-border bg-chrome transition-[width] duration-(--duration-base) ease-(--ease-standard)",
          pinned ? "w-65" : "w-[56px] hover:w-65 focus-within:w-65",
        )}
        /* Read by `REVEAL` through `group-data-[pinned=true]/rail:`, so every
           label, the keycap, the view list and the "New flow" fill open
           together without any of them taking a prop. The drawer sets the
           same attribute by hand for exactly that reason. */
        data-pinned={pinned}
      >
        <RailContent hide={hide} views={views} workspace={workspace} account={account} />
      </div>
      {/* THE TOGGLE FOLLOWS THE PANEL'S EDGE, NOT THE FOOTPRINT'S, and it is
          a sibling of the panel rather than a child: pressing it FOCUSES it,
          and while it sat inside `group/rail` that focus held the panel open
          after a collapse.

          `-top-3` CENTRES IT ON THE ASIDE'S OWN TOP EDGE, NOT ON y=60 ANY
          MORE. This used to read `top-12`, correctly, for a layout where the
          bar sat BESIDE the rail: both started at y=0, the bar was 60px tall,
          and a 24px (`iconXs`) button centred on that seam sits with its top
          at 60 − 12 = 48, i.e. `top-12`. Task 7 moved the bar ABOVE this row
          instead — so the aside's own top edge (its local y=0) now IS that
          seam, 60px lower on the page than it used to be. `top-12` did not
          adjust with it: it kept centring 48px into the aside's OWN frame,
          which floated the button into the middle of the switcher's head
          block, ~60px below the bar/rail corner it is supposed to sit on.
          Centring a 24px button ON a point that is now the box's own edge
          puts half of it outside the box: top = 0 − 12 = −12, i.e. `-top-3`
          — half the button sits over the bar's own bottom-left corner, half
          over the rail's, which is what "on the corner" has to mean once the
          corner IS the aside's edge rather than a point inside it. */}
      <Button
        variant="ghost"
        size="iconXs"
        onClick={togglePin}
        aria-pressed={pinned}
        aria-label={pinned ? "Collapse the navigation" : "Keep the navigation open"}
        className={cn(
          "absolute -top-3 z-10 -translate-x-1/2 rounded-control border border-border bg-card text-muted-foreground shadow-card transition-[left] duration-(--duration-base) ease-(--ease-standard) hover:bg-accent hover:text-foreground",
          pinned ? "left-65" : "left-14 peer-hover:left-65 peer-focus-within:left-65",
        )}
      >
        {pinned ? <PanelLeftClose /> : <PanelLeftOpen />}
      </Button>
    </aside>
  );
}
