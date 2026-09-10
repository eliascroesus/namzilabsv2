import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE PAGE SHAPE. Six container widths and three gutters existed for the
 * same kind of page; every route now states only whether it is reading
 * (default) or filling a form (narrow).
 */
export function PageContainer({
  className,
  width = "default",
  ...props
}: React.ComponentProps<"main"> & { width?: "default" | "narrow" | "full" }) {
  return (
    <main
      // `id="main"` is the skip link's target, and it lives HERE rather than on
      // each page so that no route can forget it. It is also why this element
      // is the page's one landmark — see AppFrame's `ownsMain`.
      id="main"
      className={cn(
        /**
         * THE GUTTER IS 24px, AND IT STOPPED STEPPING WITH THE VIEWPORT.
         *
         * It ran `px-5 py-6 sm:px-8 sm:py-8 lg:px-10` — 20px on a phone, 32
         * from `sm`, 40 from `lg` — on the argument that a 390px window and a
         * 1440px one should not ask for the same margin. That argument is
         * right for a page of PROSE, where the margin is what protects the
         * measure. It is wrong for a console, and the reference is flatly the
         * other way: 24px, at every width, on every screen.
         *
         * The reason is the top bar. Its own inset is 24px and it does not step
         * — chrome cannot, because the workspace name would slide sideways as
         * you resize. So every rung the page stepped through was a rung where
         * the page's content and the bar's content stood on two different
         * vertical lines, and at `lg` they were 16px apart down the entire
         * left-hand side of every screen in the product.
         *
         * `py-6` (24px) is kept at every width for the same reason: it is what
         * the reference measures between the bar's rule and the page title.
         */
        "rise-in mx-auto w-full p-6",
        // `full` USED TO ADD ITS OWN OUTER MARGIN — `xl:px-14 2xl:px-24` — so
        // that an uncapped board did not hang off the rail on a wide display.
        // It goes with the stepping gutter above and for the same reason: the
        // reference runs its widest board at a flat 24px, and a board inset
        // 96px on a 2560px screen while the bar above it is inset 24px is the
        // misalignment this change exists to close, at its most visible.
        /**
         * THE PAGE HAS A WIDTH, AND IT DOES NOT CHASE THE WINDOW.
         *
         * This briefly had no cap on `default` — the boards ran edge to edge and
         * gained columns as the viewport grew. It was the wrong shape for this
         * product and was reverted on sight: a layout that reflows every time
         * you resize gives you no stable picture of your own dashboard, the
         * tiles change size depending on which monitor you opened it on, and
         * a grid re-laying out across a 2560px row is work the browser does on
         * every frame of a drag happening elsewhere on the page.
         *
         * Notion is the reference and the reason: its content column is a fixed
         * measure with real margin either side, and what changes between a
         * laptop and a 27" display is how much you SEE, never how big anything
         * is. Consistency is the feature.
         *
         * 1152px, which is three tile columns plus their gaps — the width the
         * board's own grid was measured against. `narrow` (768px) is the form
         * width; a form gets nothing from being wider, and a sentence run past
         * this is well over a readable measure.
         */
        /**
         * `full` IS THE BOARD'S OWN EXCEPTION, and it is the customer's call
         * rather than a reversal of the argument above.
         *
         * That argument still holds for a FORM and for a page of prose: a
         * measure that chases the window gives a sentence no stable shape. A
         * dashboard is the one page where the opposite is true — it is a grid
         * of fixed-size cards, so a wider window means MORE CARDS PER ROW and
         * not bigger cards, which is exactly what Notion's own full-width
         * database does and exactly what was asked for. The card is the stable
         * unit here; the column count is not supposed to be.
         */
        width === "narrow" ? "max-w-3xl" : width === "full" ? "" : "max-w-6xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * THE BOARD GRID — one spelling, every board in the product.
 *
 * The dashboard's tiles, the flows board and the connector catalogue all
 * already shared `sm:grid-cols-2 xl:grid-cols-3`, in three files, plus two
 * more copies in the skeletons that stand in front of two of them. Five
 * literals for one decision is precisely the drift `check:ui` exists to catch
 * everywhere else, so it is spelled here and imported.
 *
 * TWO RUNGS, NOT FOUR. It briefly carried `2xl:grid-cols-4 3xl:grid-cols-5` to
 * feed a container that filled the viewport. The container has a cap again (see
 * PageContainer), so those rungs could only ever fire inside 1152px — four
 * tiles at 270px each, which is narrower than the numeral they are built
 * around. Three is what the width is for.
 *
 * A skeleton that mirrors a board must import this too — a placeholder grid
 * that disagrees with the real one does the single thing a skeleton exists to
 * prevent.
 *
 * THE FIRST RUNG IS `md`, NOT `sm`, SINCE THE 4 SEPTEMBER RE-THEME.
 *
 * `sm:grid-cols-2` put two tiles abreast from 640px — inside the band where
 * the rail is no longer rendered and this page's own header has already
 * stacked, on a screen that is a large phone held sideways. Two 300px tiles
 * there are narrower than the 28px numeral they are built around, and the
 * board stops being readable exactly where the shell has just admitted it is
 * on a phone. One decision, one breakpoint: below `md` the console is a
 * single column of everything.
 */
export const BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3";

/**
 * THE HEADER'S TIME CONTROL — the groove, and the segments that sit in it.
 *
 * Every view answers "what span am I reading" in the same slot beside the page
 * title, and until this constant existed each one drew that answer itself: the
 * dashboard's six period links in one spelling, the calendar's month stepper in
 * another. They came out at different HEIGHTS on different SURFACES with
 * different RADII, which is exactly the drift `BOARD_GRID` is spelled here to
 * prevent one layout down — and it is the kind nobody files a bug for, because
 * each control looks fine until you switch tabs and the row moves.
 *
 * THE SEGMENTS FILL THE TRACK, AND THE TRACK IS A BUTTON'S HEIGHT.
 *
 * It was a 32px groove holding 28px segments with a 2px inset, which is the
 * classic segmented shape and the wrong one beside "Refresh all": the group
 * measured 32 but every option in it measured 28, so a row containing both had
 * two control heights in it and the one you press was the shorter.
 *
 * `h-full` on the segment and `overflow-hidden` on the track: each option is
 * the full 32, the active fill runs edge to edge, and the track's own corners
 * clip whatever sits inside it.
 *
 * 32px, DOWN FROM 40. This is the reference's control height and it is the
 * same 32 as every select, every date picker and every dense button in the
 * product — which is the point of shrinking it. At 40 it was the tallest
 * object in the page header and it sat beside a title that has just come DOWN
 * to 24px; the row read as a control with a caption rather than a page with a
 * filter.
 *
 * THE CORNERS HAVE NOW MOVED TWICE, AND THE 4 SEP 2026 FIGMA
 * (docs/superpowers/specs/2026-09-04-retheme-blue-design.md) IS THE LAST WORD.
 *
 * The first move was recorded here as a correction: a brief that said "all
 * buttons and timeline buttons have 999 radius" had been read as licence to
 * restyle the whole control, deleting the border, the fill and the enclosure
 * and leaving six bare labels floating on the page. Nobody asked for that, so
 * the groove came back as a bordered `bg-control` track with every segment a
 * full capsule inside it — a radius change, and only a radius change.
 *
 * The second move is this one, and it is the opposite correction for the
 * opposite reason: the groove was never asked to be a capsule AT ALL, only to
 * follow whatever the sheet said buttons were, and the sheet now says 8px,
 * everywhere, permanently. So `rounded-full` comes off the track and the
 * segment both, and `--radius-control` is what both now spell — the same
 * token the button beside them already uses. `overflow-hidden` plus `h-full`
 * still does the work of making them agree: a segment fills the track's full
 * 32px, so the first and last segment's outer corners land exactly on the
 * track's own 8px corners, and the lit segment reads as a rectangle inside a
 * rectangle rather than a shape fighting the one around it — there is no
 * smaller-radius-inside-a-bigger-clip seam to avoid any more, since track and
 * segment now share the identical radius.
 *
 * `bg-control` + `border-border`, and the three `--period-*` tokens stay
 * retired. They existed because this was "the one control that follows the
 * PAGE rather than the band" — a near-black pill group on a light page would
 * have been a second dark object competing with the chrome, so it needed its
 * own surface that inverted separately. There is one surface; a control is
 * `--control`.
 */
export const PERIOD_TRACK =
  "inline-flex h-8 items-center overflow-hidden rounded-control border border-border bg-control";

/** One control inside that groove — a period link, a month arrow, "This month". */
export const PERIOD_PILL =
  "inline-flex h-full shrink-0 items-center rounded-control px-3 text-sm font-medium transition-colors duration-(--duration-fast)";

/**
 * Title row: optional back link, one h1 recipe, optional lede, actions on
 * the right. The h1 is the ONLY page-title spelling in the product.
 */
export type PageHeaderProps = {
  /**
   * OPTIONAL SINCE 8 SEP 2026, AND ONLY THE BOARD LEAVES IT OUT.
   *
   * The board's header used to centre the view's name between its tab strip
   * and its actions. Node 49:5399 draws two zones and puts the name on its own
   * TAB, beside the options menu that already owns Rename — so a centred title
   * there was one string drawn twice on one row, with two routes to the same
   * edit. Every other call site passes a title and is untouched.
   */
  title?: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * THE TAB STRIP, AND THE THIRD ZONE THE FIGMA ADDS.
   *
   * Every route so far put a title on the left of this header and actions on
   * the right. The board's own page carries a THIRD object beside them — its
   * view tab strip — and the reference sets it to the LEFT of a title that
   * itself moves to the CENTRE of the row, actions staying right. Passing
   * `tabs` is what asks for that row; leave it out and the header renders
   * exactly as it always has — every one of the other seventeen call sites is
   * unaffected by this prop's existence.
   */
  tabs?: React.ReactNode;
  back?: { href: string; label: string };
  /** Render as the frame's full-bleed third bar rather than an in-content header. */
  band?: boolean;
  className?: string;
};

/**
 * THE TITLE BLOCK, SPELLED ONCE FOR BOTH LAYOUTS.
 *
 * The h1 recipe is "the ONLY page-title spelling in the product" per the doc
 * comment above — a claim `PageHeader` below used to make false by spelling
 * the h1 and its lede TWICE, once per branch, in near-identical JSX. One
 * `<h1>` and one lede `<p>` live here; each branch below supplies only the
 * wrapper alignment that actually differs between them (centred and stacked
 * in the three-zone row, left-aligned in the plain one) — see the note above
 * `PageHeader`'s `return` for why neither wrapper takes `min-w-0`.
 */
function HeaderTitle({
  title,
  lede,
  className,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  className: string;
}) {
  return (
    <div className={className}>
      <h1 className="text-display-xs font-semibold tracking-[0.07px] text-heading">{title}</h1>
      {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
    </div>
  );
}

export function PageHeader({ title, lede, actions, tabs, back, band, className }: PageHeaderProps) {
  /**
   * THE INSTITUTIONAL REASONING BEHIND FOUR CHOICES BELOW, KEPT IN ONE PLACE
   * NOW THAT THE TITLE MARKUP LIVES ONCE (`HeaderTitle`, above) RATHER THAN
   * ONCE PER BRANCH.
   *
   * NO `min-w-0` ON THE TITLE COLUMN, IN EITHER LAYOUT — THE FIX FOR "Vie…".
   * The two-zone row wraps; the three-zone row is a grid. In both, giving the
   * title its own `min-w-0` lets it shrink below its own content instead of
   * the row making room for it: on the flex row a 520px period control once
   * squeezed the h1 down to a few characters and a `truncate` span did the
   * rest — "View 2" rendered as "Vie…" with an entire empty row beneath it.
   * On the grid, the title's `auto` column doing the same thing would push
   * the SIDE tracks around instead: it is `tabs` and `actions` — the columns
   * that grow unpredictably — that carry `min-w-0` (see the grid comment
   * below) so THEY give way, and the title stays free to demand its natural
   * width in both layouts.
   *
   * `items-start` IN THE TWO-ZONE ROW, `items-center` IN THE THREE-ZONE ONE —
   * BOTH ARE THE SAME FIX FOR THE SAME BUG. A flex column stretches its
   * children by default, so an unconstrained title block let a title
   * `Button`'s hover wash run the full width of whichever row it sat in
   * rather than hug the word it was cast from — `justify-start` merely parks
   * the text at the edge of a wash that is already too wide. Cross-axis
   * alignment tracks the title's own alignment (left in the plain header,
   * centred beside a centred title) so the wash hugs the name in both cases,
   * because the name is what you press.
   *
   * THE TITLE IS 26px (`text-display-xs`), `text-heading` NOT
   * `text-foreground`. It was `text-xl` (20px) while `/design` printed
   * `display-xs` beside "Page titles (PageHeader)" — the product's one h1 and
   * the page documenting it had drifted a step. `text-heading` is the one
   * place besides the metric numeral this product reaches past body ink on
   * purpose: a page title in the same grey as the sentence under it is not a
   * title, and it was `text-white` once, which was correct in a one-theme
   * product and INVISIBLE the moment the light theme came back. 26/600 at
   * 34px leading with 0.07px tracking is what the reference measures; no
   * `.font-display`, because that class's -0.022em tracking is TIGHTER than
   * the reference's own +0.07px and belongs to the landing's 48–64px hero
   * instead. The lede sits at 14px under an 8px gap — a SUBTITLE naming the
   * page's scope in a phrase, not a second heading — and keeps `max-w-2xl`
   * for the pages that still put a whole sentence there.
   *
   * `actions` TAKES `min-w-0`, NOT `shrink-0`. `shrink-0` was free while this
   * slot held only buttons — `buttonVariants`' own base is already
   * `shrink-0`, so the wrapper's flag changed nothing for the pages that put
   * buttons here. It was NOT free for the board, whose period control was a
   * ~520px track: `shrink-0` pins a flex item at its max-content width even
   * after `flex-wrap` drops it onto its own line, which pushed the WHOLE PAGE
   * into horizontal scroll on a narrow viewport — the exact failure the
   * track's own internal scroller could not prevent from inside a parent
   * that refuses to narrow. The three-zone row's `tabs` and `actions`
   * columns carry the same `min-w-0` for the identical reason: a grid track
   * defaults to `min-width: auto`, the same bug in a different layout mode.
   */
  return (
    /**
     * NO RULE UNDER THE HEADER ANY MORE — the spacing survives, the hairline
     * does not.
     *
     * It was `border-b border-border`, drawn when the header was the only
     * thing between the page title and the content. On the board that rule now
     * lands one line above the tab strip's own 2px underline, so the top of the
     * page reads as two horizontal rules eight pixels apart, and the one that
     * MEANS something — which tab you are on — is the fainter of the two. The
     * `pb-4` stays: it is what stops a title touching the thing beneath it, and
     * dropping both would have been a different change.
     */
    // 16px, FLAT, AND IT NO LONGER HAS TO KNOW ABOUT THE TABS.
    //
    // Node 58:5951 puts the header row at y=0 of the content container and the
    // tile grid at y=48, the row itself 32 tall: a 16px gap, the same gutter
    // the grid below it uses. It was `pb-6` (24), so the board sat 8px low on
    // every route.
    //
    // It was then `tabs ? "pb-2" : "pb-4"` for one commit, compensating for the
    // 8px the tab strip's focus-ring padding added to the row. That worked and
    // was the wrong place: a header should not carry an offset for a child's
    // ring. `ViewStrip` cancels its own padding with `-my-1` now, so the row is
    // 32 whether or not it has tabs and this is one number again.
    //
    // Measured at 1920: the Add button's bottom edge sits at 121 and the board
    // starts at 137. `pnpm geometry` pins the board; the 12px this replaced was
    // reported by Elias before any check could see it.
    <header
      className={cn(
        /**
         * `band` IS THE FRAME'S THIRD BAR, AND IT HAS TO ESCAPE ITS CONTAINER.
         *
         * Node 0:5 draws the view tabs and the board controls as a full-bleed
         * 43px band — white, with the same #F1F1F1 hairline as the two bars
         * above it, running edge to edge. This header renders inside
         * `PageContainer`, which is `p-6`, so the band would otherwise sit
         * inside a 24px gutter with the page's own ground showing around it.
         *
         * `-m-6` cancels that padding on all four sides and `mb-6` puts the
         * 24px back underneath, which is the inset the board starts at. The
         * height falls out rather than being typed: 26px of button over 8+8 of
         * padding and the 1px rule is 43, and 57 + 49 + 43 is the 149 the frame
         * starts its content container at.
         */
        band ? "-m-6 mb-6 border-b border-topbar-border bg-topbar px-6 pb-4 pt-2" : "pb-4",
        className,
      )}
    >
      {back && (
        /**
         * AN 8px CONTROL, NOT A LINE OF TEXT. This was the one navigation
         * control in the app with no box at all: a 14px string with a 14px
         * glyph beside it, ~90px wide and 17px tall, which is under every
         * pointer-target minimum there is. `rounded-control` — the same 8px
         * rectangle every other pressable thing in the kit takes, per the
         * 4 Sep 2026 Figma — gives it a hit area and a hover state. Same
         * colour, same words, pulled left by its own padding so the words
         * still line up with the title beneath.
         */
        <Link
          href={back.href}
          className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-control pl-2 pr-3 text-sm text-muted-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={14} />
          {back.label}
        </Link>
      )}
      {tabs ? (
        /**
         * THE THREE-ZONE ROW: tabs | title | actions, and the middle one is
         * an `auto` column between two EQUAL `1fr` tracks — the grid trick
         * for a title that sits in the true centre of the row no matter how
         * wide the tab strip or the actions are, rather than merely centred
         * in whatever space `justify-content: center` happens to leave over.
         *
         * `min-w-0` on the side columns is the same fix `actions` has always
         * needed (see the note above the header's return): a grid track
         * defaults to `min-width: auto`, which refuses to shrink below its
         * content's own width — the same bug that once pushed a 520px period
         * track into horizontal page scroll, and a grid column inherits the
         * identical failure mode. The tab strip additionally scrolls inside
         * its own container (`overflow-x-auto`) rather than relying on that
         * shrink alone, per the spec's Mobile section.
         *
         * Base layout stacks below `md` — the tab strip in its own scroller,
         * then the title on its own line at the reading edge, then the actions
         * wrapping — in DOM order, which is the order the grid places them in
         * left to right above the breakpoint. `md` rather than `sm` because
         * that is where the shell's rail goes; see the row's own note.
         */
        <div
          className={cn(
            /**
             * IT BREAKS AT `md`, WHICH IS WHERE THE SHELL BREAKS. This stacked
             * at `sm` when it was written, on the reasonable-sounding rule that
             * three side-by-side zones need ~640px to be zones. The rail leaves
             * at 768 (see `Sidebar`), so between the two the page had a
             * three-zone header, no rail, and a board still trying for two
             * columns — one layout in three minds. One breakpoint for the whole
             * console is worth more than a header that is right on its own.
             *
             * `items-stretch`, NOT `items-center`, below the breakpoint: these
             * three are full-width rows on a phone, and centring them makes the
             * tab strip's scroller as narrow as its content, which is the one
             * shape a scroller must never take.
             */
            /**
             * THREE TRACKS WITH A TITLE, TWO WITHOUT.
             *
             * `1fr auto 1fr` is what puts a title in the row's TRUE centre
             * regardless of how wide the tabs or the actions are — equal side
             * tracks, rather than whatever `justify-content: center` leaves
             * over. With no title there is nothing to centre and the middle
             * `auto` track collapses to zero, which would leave the tabs and
             * the actions pushed to the ends by two `1fr` columns of dead
             * space — the same row, arrived at by accident. `1fr auto` says it
             * on purpose: the strip takes the slack, the actions take their
             * own width.
             */
            "flex flex-col items-stretch gap-3 md:grid md:items-center md:gap-x-4",
            title ? "md:grid-cols-[1fr_auto_1fr]" : "md:grid-cols-[1fr_auto]",
            back && "mt-3",
          )}
        >
          {/* THE STRIP SCROLLS RATHER THAN WRAPPING, AT EVERY WIDTH. A view bar
              is a horizontal object — the order is meaningful and draggable —
              and a phone with six views would otherwise turn the top of the
              board into three lines of tabs above the title they belong to.
              `quiet-scroll` is the same scrollbar the board's own lane
              scrollers wear.
              THERE IS NO `md:overflow-visible` ANY MORE. It handed the focus
              ring its room back above the breakpoint on the reasoning that
              nothing needs to scroll there — true of a short view list, false
              of one long enough to need scrolling in the first place, and the
              tabs are `shrink-0` with names up to 60 characters inside a `1fr`
              track: at 768–900px a single long name pushed a page-level
              sideways scroll, which is the exact failure this whole row exists
              to prevent. `overflow-x-auto` stays on at every width instead.
              `-mx-1 px-1`: a bare `overflow-x-auto` clips the first and last
              tab's focus ring at both ends — the same compensation the period
              track already carries in `app/dashboard/page.tsx`. */}
          {/* THE RING ROOM LIVES ON THE SCROLLER, WHICH IS WHY THERE IS NO
              VERTICAL SCROLLBAR. `overflow-x: auto` forces `overflow-y` to
              match, so this element scrolls in BOTH axes whether or not anyone
              wants it to. With the 4px of focus-ring padding on the strip
              INSIDE it, the strip's border box stood 4px proud of this one top
              and bottom — real vertical overflow, and Chromium drew a thumb for
              it: the black pill beside "+ Add".
              `py-1 -my-1` out here puts that padding INSIDE the scrolling box,
              so nothing overflows, while the negative margin keeps the row 32
              tall in the layout — which is what node 58:5951 measures. */}
          <div className="quiet-scroll -mx-1 -my-1 flex min-w-0 items-center overflow-x-auto px-1 py-1">{tabs}</div>
          {/* LEFT ON A PHONE, CENTRED ABOVE `md`. A centred title is what the
              4 Sep Figma drew BETWEEN two zones; on its own line with nothing
              either side of it, centring is just a heading that has come loose
              from the page's own reading edge.

              GUARDED, because the board no longer passes one (node 49:5399
              puts the name on its tab). Rendering `HeaderTitle` with an
              undefined title emits an EMPTY `<h1>` into the middle track — a
              heading with no text is a landmark that announces nothing and a
              grid cell that still claims its `auto` width. */}
          {title !== undefined && (
            <HeaderTitle
              title={title}
              lede={lede}
              className="flex flex-col items-start gap-2 text-left md:items-center md:text-center"
            />
          )}
          {actions && (
            /* WRAPS AT 8px, ALIGNED TO THE READING EDGE BELOW `md`. "+ Add",
               "Refresh All" and "Today ▾" are ~260px of `xs` controls: they fit
               on one line at 390px and wrap to two the moment a label grows,
               which is what `flex-wrap` is for and why none of them is
               `shrink-0`. */
            <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">{actions}</div>
          )}
        </div>
      ) : (
        <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", back && "mt-3")}>
          <HeaderTitle title={title} lede={lede} className="flex flex-col items-start gap-2" />
          {actions && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}

/**
 * The section eyebrow — the app's ONE h2. It was 14px uppercase in five
 * files, 11px uppercase in two, 17px sentence case on the kit page and
 * stock 18px on the legal pages. This is the survivor.
 *
 * It is also the sheet's micro-label voice, spelled the same way ui/badge.tsx
 * and the sidebar's section labels spell it: 12px, ALL CAPS, `tracking-wide`.
 * Caps is what makes a 12px string read as a LABEL rather than as a very small
 * sentence, and the tracking is what stops caps setting solid.
 *
 * `text-xs` is now the only spelling of 12px — the `text-micro` alias it was
 * chosen over has been deleted from the theme, and `check:ui` fails on it.
 */
export function SectionHeading({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}
