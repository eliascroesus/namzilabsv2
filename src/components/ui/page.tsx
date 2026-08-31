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
 * THE HEADER'S TIME CONTROL — the groove, and the pills that sit in it.
 *
 * Every view answers "what span am I reading" in the same slot beside the page
 * title, and until this constant existed each one drew that answer itself: the
 * dashboard's six period links in one spelling, the calendar's month stepper in
 * another. They came out at different HEIGHTS on different SURFACES with
 * different RADII, which is exactly the drift `BOARD_GRID` is spelled here to
 * prevent one layout down — and it is the kind nobody files a bug for, because
 * each control looks fine until you switch tabs and the row moves.
 *
 * 32px AROUND 24px PILLS, DOWN FROM 40 AROUND 32. This is the reference's
 * control height and it is the same 32 as every select, every date picker and
 * every dense button in the product — which is the point of shrinking it. At 40
 * it was the tallest object in the page header and it sat beside a title that
 * has just come DOWN to 24px; the row read as a control with a caption rather
 * than a page with a filter.
 *
 * THE GROOVE IS A ROUNDED RECTANGLE, NOT A CAPSULE. Pills are for buttons and
 * chips; the reference draws every segmented and dropdown control at
 * `rounded-card` (10px), which is also the radius of the cards the control
 * filters. A capsule here was the one shape in the header that matched nothing
 * below it.
 *
 * `bg-control` + `border-border`, and the three `--period-*` tokens are retired.
 * They existed because this was "the one control that follows the PAGE rather
 * than the band" — a near-black pill group on a #f5f5f5 page would have been a
 * second dark object competing with the chrome, so it needed its own surface
 * that inverted separately. There is one surface; a control is `--control`.
 */
export const PERIOD_TRACK =
  "inline-flex h-9 items-center gap-0.5 rounded-card border border-border bg-control p-0.5";

/** One control inside that groove — a period link, a month arrow, "This month". */
export const PERIOD_PILL =
  "inline-flex h-7 shrink-0 items-center rounded-[calc(var(--radius-card)-3px)] px-3 text-sm font-medium transition-colors duration-(--duration-fast)";

/**
 * Title row: optional back link, one h1 recipe, optional lede, actions on
 * the right. The h1 is the ONLY page-title spelling in the product.
 */
export type PageHeaderProps = {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
};

export function PageHeader({ title, lede, actions, back, className }: PageHeaderProps) {
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
      {/* `items-center`, and this time it is right — see the note on `actions`
          below for why it was `items-start` and what changed. */}
      <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", back && "mt-3")}>
        {/* THE TITLE BLOCK IS A COLUMN WITH A GAP, not a paragraph with a
            top margin. 8px, stated once, so the pair sets as one object and
            a page with no lede is not a title carrying an invisible `mt-1.5`
            underneath it. */}
        {/* NO `min-w-0`, AND THAT IS THE FIX FOR "Vie…".
            This row wraps. With `min-w-0` the title block was allowed to
            shrink below its own content, so a 520px period control on the
            right squeezed the h1 down to a few characters and the `truncate`
            on the span did the rest — "View 2" rendered as "Vie…" on a
            1440px screen with an entire empty row beneath it. Flex would
            rather shrink a shrinkable item than wrap. Take the permission
            away and it wraps instead, which is what the wrap was for. */}
        {/* `items-start` — THE FIX FOR THE HOVER WASH THAT WAS WIDER THAN THE
            WORD. A flex column stretches its children by default, so the title
            Button filled this block's whole width and its hover background ran
            the length of the header while `justify-start` merely parked the
            text at the left of it. The wash has to hug the name, because the
            name is what you press. */}
        <div className="flex flex-col items-start gap-2">
          {/* THE TITLE IS 24px, WHICH IS THE STEP THE KIT ALREADY NAMES FOR IT.
              It was set at `text-xl` — 20px — while `/design` printed
              `display-xs` beside the words "Page titles (PageHeader)", so the
              product's one h1 and the page documenting it had drifted by a
              step. 24 is also the size the brand sheet's own headings are cut
              at, and it is what gives a page a head rather than a first line.

              The display face's one in-app appearance besides the metric
              numeral. `.font-display` carries its own tracking (-0.022em), so
              no `tracking-tight` here — the two would compound. */}
          {/* `text-white`, NOT `text-foreground`, and it is the one place in the
              product that reaches past the ink ramp's top rung on purpose. The
              body ink is #dcdcdc; a page title in it is the same weight of grey
              as the sentence under it, and the reference draws the title in
              pure white for exactly that reason — it is the one heading with
              nothing above it to defer to, so it gets the one value nothing
              else may have.

              24px (`display-xs`), DOWN FROM 30. It went UP to 30 when the title
              shared its row with a 40px period band and read as a caption
              beside it; that control is 32px now and the row no longer
              overpowers a 24px heading. 24/600 at 32px leading with 0.07px
              tracking is what the reference measures, and it is also the step
              `/design` has printed beside "Page titles" the whole time.

              NO `.font-display`. That class is now purely a -0.022em tracking
              utility (the display face and the app face are one stack), and
              -0.022em at this size is 0.57px TIGHTER per character — while the
              reference tracks its title at +0.07px, which is essentially
              normal. A heading set tighter than the sentence under it reads as
              a different typeface rather than as a heading, and `.font-display`
              stays where the negative tracking is actually right: the landing's
              48–64px hero. */}
          <h1 className="text-display-xs font-semibold tracking-[0.07px] text-white">{title}</h1>
          {/* 14px, DOWN FROM 16, and the old argument for 16 is retired rather
              than overruled by taste. It said a lede has to be 16px "to read
              as a sentence rather than as a caption of the heading" — true when
              the header was a title and a paragraph, and no longer what this
              slot is. Paired at 8px under a 24px title it is a SUBTITLE: it
              names the page's scope in a phrase, and at 16px a phrase that
              short reads as a second heading competing with the first.

              `max-w-2xl` survives for the pages that still put a whole sentence
              here: one running the full 1152px of the container is ~150
              characters a line, roughly twice a comfortable measure. */}
          {lede && <p className="max-w-2xl text-sm font-normal leading-5 text-muted-foreground">{lede}</p>}
        </div>
        {/* THE RIGHT SLOT, AND IT CENTRES NOW.
            It was `items-start` because a wrapping row put buttons half a line
            below a title whenever the lede made the left column taller — the
            right fix when the right slot held page ACTIONS, which read as
            hanging off the title's own line. What sits here on the board is a
            40px segmented track, and a control that tall pinned to the top of a
            52px title block sits visibly high of the block it belongs to. The
            row centres; `flex-wrap` still drops the slot onto its own line
            before anything can be squeezed.

            AND IT CAN SHRINK NOW — `min-w-0`, where it was `shrink-0`.
            `shrink-0` was free while this slot held only buttons, because
            `buttonVariants`' own base is already `shrink-0`: the buttons were
            never going to compress whatever the wrapper said, so removing it
            changes nothing for the five pages that put buttons here.

            It is NOT free for the board, whose period control is a ~520px
            track of six pills. `shrink-0` pins a flex item at its max-content
            width even after `flex-wrap` has dropped it onto a line of its own,
            so on a 390px viewport that track pushed the WHOLE PAGE into
            horizontal scroll — the one failure the track's own internal
            scroller (`min-w-0 overflow-x-auto`) exists to prevent, and which
            it cannot prevent from inside a parent that refuses to narrow. */}
        {actions && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
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
