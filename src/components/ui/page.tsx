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
 */
export const BOARD_GRID = "grid gap-6 sm:grid-cols-2 xl:grid-cols-3";

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
  title: React.ReactNode;
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
  className?: string;
};

export function PageHeader({ title, lede, actions, tabs, back, className }: PageHeaderProps) {
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
    <header className={cn("pb-6", className)}>
      {back && (
        /**
         * A PILL, NOT A LINE OF TEXT. The sheet's shape rule is pill-first, and
         * this was the one navigation control in the app with no box at all: a
         * 14px string with a 14px glyph beside it, ~90px wide and 17px tall,
         * which is under every pointer-target minimum there is. Same colour,
         * same words, now with a hit area and a hover state — pulled left by
         * its own padding so the words still line up with the title beneath.
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
         * `min-w-0` on the side columns is the same fix `actions` always
         * needed below: a grid track defaults to `min-width: auto`, which
         * refuses to shrink below its content's own width — the same bug
         * that once pushed a 520px period track into horizontal page scroll,
         * and a grid column inherits the identical failure mode.
         *
         * Base layout stacks (title, then tabs, then actions) below `sm`,
         * where three side-by-side zones have no room left to be zones.
         */
        <div
          className={cn(
            "flex flex-col items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-x-4",
            back && "mt-3",
          )}
        >
          <div className="flex min-w-0 items-center">{tabs}</div>
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-display-xs font-semibold tracking-[0.07px] text-heading">{title}</h1>
            {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
          </div>
          {actions && (
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 sm:justify-end">{actions}</div>
          )}
        </div>
      ) : (
        <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", back && "mt-3")}>
          <div className="flex flex-col items-start gap-2">
            <h1 className="text-display-xs font-semibold tracking-[0.07px] text-heading">{title}</h1>
            {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
          </div>
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
