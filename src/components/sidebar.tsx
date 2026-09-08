"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, LayoutDashboard, Monitor, Plug, Plus, Radio, Search, Settings, UserPlus, Workflow } from "lucide-react";
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
 * THE NAVIGATION COLUMN — 260px, always.
 *
 * WHAT IT WAS, THROUGH THREE SHAPES. A 70px band of near-black running the
 * full height beside a lighter page. Then 56px of `--chrome` separated from
 * the page by one hairline, opening to 260px under the pointer and holding
 * that width on a pin cookie. Now: 260px, permanently, drawn by node 49:5269.
 *
 * EVERY MECHANISM THE MIDDLE SHAPE NEEDED IS GONE, and they were all one
 * mechanism. `REVEAL` faded the labels in on `group-hover/rail`,
 * `group-focus-within/rail` and `group-data-[pinned=true]/rail`. The panel was
 * `absolute` inside a narrower `<aside>` so its extra width came out of the
 * page rather than out of the layout — widening in FLOW on a pointer-move
 * would re-lay-out every tile on the dashboard as the cursor passed, and
 * resize the builder's canvas under a drag. A toggle sat on the hairline, and
 * a cookie carried the choice so the server could render the right width in
 * the first paint instead of snapping a frame later.
 *
 * All of it existed to make a column that can be SHUT usable. Nothing here can
 * be shut, so the labels are simply present, the `<aside>` is simply 260px,
 * and there is no state, no cookie and no toggle. See `Sidebar` at the foot of
 * this file for what the retirement leaves behind, and `page-width.test.ts`,
 * which now asserts the ABSENCE of each piece — the mechanism was subtle
 * enough that it would otherwise be reintroduced by a well-meaning "restore
 * the collapse".
 *
 * WHAT THE COLUMN HOLDS, top to bottom: a workspace switcher (a tinted 28px
 * square, the name, a chevron), a search field on `--control`, a "Main Menu"
 * caption at the faint step, the nav rows with the active one filled, a nested
 * view list under Dashboard, and a foot carrying an Invite Members CARD over
 * the lime "New". The last two arrived on 8 Sep 2026 from the top bar, which
 * gave up both acts and took the gift in exchange.
 *
 * EVERY ROW IS A 36px SLOT HOLDING A 32px ICON BOX, and the split still
 * matters. The BOX is the picture, a bare 18px glyph on the column's own
 * ground — no plate, because there is no surface here to lift it off. The SLOT
 * is the hit area, the full width of the column, so the name is as clickable
 * as the glyph. Colour is spent in exactly one place: the row you are standing
 * on takes `--control` under the WHOLE ROW, and its label goes white and
 * semibold. There is no second raise — a hover that reached `--accent` made a
 * hovered row look more selected than the selected one, which
 * `controls-and-rail.test.ts` pins against.
 *
 * IT IS NOT RENDERED BELOW `md`. 260px of permanent column on a 390px screen
 * is two thirds of the viewport; `MobileDrawer` renders this same tree there.
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
 * THE REVEAL RECIPE IS GONE, AND SO IS THE THING IT REVEALED.
 *
 * `REVEAL` was `opacity-0` plus three ways of getting back to `opacity-100` —
 * `group-hover/rail`, `group-focus-within/rail` and `group-data-[pinned=true]`
 * — because the rail rested at 56px and opened to 260. The 8 September Figma
 * draws no closed state: the column is 260px, always, and there is nothing left
 * to uncover. Every label it used to fade is simply present.
 *
 * The careful parts of that mechanism are worth recording as retired rather
 * than lost, because they were each fixing a real bug. Opacity rather than
 * `hidden`, so a control's accessible name existed at every width. Focus as
 * well as hover, so a keyboard user did not land on a row whose name was
 * clipped out of view. Both problems only exist for a column that can be shut.
 */

/**
 * The name beside a chip. `shrink-0` + `whitespace-nowrap` rather than a
 * flexible measure: the column is a fixed 260px and a label that tries to
 * resolve a flexible width inside it re-ellipsises against its siblings for no
 * benefit. Fixed at its natural width, it simply sits where it is put.
 */
function RailLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("shrink-0 whitespace-nowrap text-sm font-medium text-foreground", className)}>{children}</span>;
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
}: {
  hide?: string[];
  views?: BoardView[];
  workspace?: string;
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
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
      className="grid grid-rows-[1fr]"
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
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
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
                    <p className="px-1 py-2 text-xs text-muted-foreground">No matches.</p>
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
              <p className="px-1 pb-1 pt-2 text-xs font-normal text-faint">Main Menu</p>
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
          {/* THE FOOT THE 8 SEPTEMBER FIGMA DRAWS — a card and an act, in that
              order, and both of them changed hands.

              INVITE MEMBERS STOPS BEING A GUEST. It used to appear here only
              in the phone's drawer, because above `md` the top bar carried it
              and two routes to one settings page a centimetre apart is worse
              than either. Node 49:5734 moves it into the rail permanently and
              takes it OUT of the bar, so there is still exactly one of it —
              the `invite` prop that gated it has no second state left and is
              gone with the arrangement that needed it.

              It is a CARD rather than a row: two strings, a title and a line
              of copy under it, which is not a shape the 36px nav slot can
              hold. `--control` on the card is the same step the search field
              takes at the head of the column, which is what makes the two read
              as the same kind of object — a thing you act on, not a
              destination you travel to. */}
          <Link
            href="/dashboard/settings"
            /* THE HOVER RAISES THE EDGE, NOT THE FILL, and the column's own
               rule is why. The rail has ONE raise — `--control` under the
               active row — and a second one (`--accent`) made a hovered row
               look more selected than the selected one, which is what
               controls-and-rail.test.ts pins. This card RESTS on `--control`,
               so it has nowhere to raise to that is not that mistake. Its
               border brightens instead: feedback that costs no fill. */
            className="flex w-full items-center gap-3 rounded-card border border-border bg-control px-3 py-2 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-rule"
          >
            <UserPlus className="size-4 shrink-0 text-foreground" />
            {/* NO GAP, and the rail's spacing rule is why. Every column in this
                file stacks on 8 or 16 (pinned by page-width.test.ts), and the
                Figma's 2px here is neither — it is the slack between two 16px
                leadings rather than a gap anyone chose. `leading-4` on both
                lines produces it without spending an off-scale number. */}
            <span className="flex flex-col">
              {/* 12px BOTH, and the weight is the only thing separating them.
                  The Figma sets the title at 600 and the line under it at 400
                  on the same size, which is what keeps a two-line card from
                  reading as a heading with a caption — they are one object. */}
              <span className="text-xs font-semibold leading-4 text-foreground">Invite Members</span>
              <span className="text-xs leading-4 text-muted-foreground">Collaborate with your team.</span>
            </span>
          </Link>

          {/* "NEW", NOT "NEW FLOW", AND IT IS A BUTTON THE WHOLE TIME.
              The old row spent three blocks of classes becoming a button on
              hover, on focus-within and on pinned — a chip that swapped for a
              fill, a "+" that left when the words arrived — because it had to
              be legible as a 48px glyph AND as a 260px control. The column no
              longer has a narrow state, so all three collapse into what the
              Figma actually draws: a full-width lime fill, 36px, with a plus
              and one word centred in it.

              GET FREE ACCESS IS NOT HERE ANY MORE. Its gift moved to the top
              bar (node 51:5756), where it sits beside the account as an offer
              rather than under two acts as a third one. */}
          {/* `accent` NAMED, not inherited. The default variant is `default`
              (a bordered `--card` fill), and this button is the one act in the
              column — the Figma fills it with the brand. Relying on a default
              here is how the identical control ends up drawn two ways in two
              files, which is what happened to "+ Add" in the board header. */}
          <Button asChild variant="accent" size="sm" className="h-9 w-full">
            <Link href="/dashboard/flows">
              <Plus />
              <span className="text-button font-semibold">New</span>
            </Link>
          </Button>
        </div>
      </>
  );
}

/**
 * THE RAIL, WHICH NO LONGER HOVERS.
 *
 * What is left here is the geometry the CONTENT does not care about: a fixed
 * 260px column and the hairline down its right edge. The rows, the search field
 * and the foot are all `RailContent`, which the phone's drawer renders too.
 *
 * THREE MECHANISMS RETIRED TOGETHER, and they were one mechanism really. The
 * column rested at 56px and opened to 260 on `hover` and `focus-within`; a pin
 * cookie let you hold it open; `AppShell` read that cookie on the server so a
 * pinned rail would not paint at 56 and snap to 260 a frame later, dragging the
 * top bar and the page with it. The 8 September Figma draws one width, so the
 * open state IS the state — there is nothing to reveal, nothing to remember,
 * and no frame in which the two disagree.
 *
 * The layout-jump problem that the cookie existed to dodge is gone with it,
 * rather than solved: a constant width cannot arrive late. `ShellSkeleton`
 * still mirrors this number for the same reason it always did, and
 * `tests/page-width.test.ts` still pins the two together.
 *
 * IT OVERLAYS NO MORE EITHER. The panel used to be `absolute` inside a
 * narrower footprint so its extra 204px were taken from the page rather than
 * given by it — widening in flow would have re-laid-out every tile on a
 * pointer-move, and resized the builder's canvas under a drag. A column that
 * never changes width can simply BE in the layout, which is one fewer stacking
 * context and one fewer thing for a dropdown to escape.
 *
 * IT IS STILL NOT RENDERED BELOW `md`. 260px of permanent column on a phone is
 * most of the screen; the drawer renders the same `RailContent` there.
 */
export function Sidebar({
  hide,
  views = [],
  workspace,
  account,
}: {
  hide?: string[];
  views?: BoardView[];
  workspace?: string;
  account?: { initials: string; avatarUrl?: string | null; panel: ReactNode };
}) {
  return (
    <aside className="relative z-20 hidden h-full w-65 shrink-0 flex-col overflow-hidden border-r border-border bg-chrome md:flex">
      <RailContent hide={hide} views={views} workspace={workspace} account={account} />
    </aside>
  );
}
