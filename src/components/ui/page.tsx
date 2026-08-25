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
}: React.ComponentProps<"main"> & { width?: "default" | "narrow" }) {
  return (
    <main
      // `id="main"` is the skip link's target, and it lives HERE rather than on
      // each page so that no route can forget it. It is also why this element
      // is the page's one landmark — see AppFrame's `ownsMain`.
      id="main"
      className={cn(
        // The gutter steps with the viewport. At a flat px-6 the content of a
        // page sat 24px off a phone's edge, which is fine, and 24px off a 27"
        // display's rail, which is not — a 1440px window and a 390px one were
        // asking for the same margin. The 2xl rung is the fill's own: once the
        // content stops being centred in empty canvas, the gutter is the only
        // thing left holding it off the frame's edge.
        "rise-in mx-auto w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8 2xl:px-12",
        /**
         * DEFAULT FILLS. NARROW DOES NOT. That split is the whole rule.
         *
         * Every `default` route in the product is a BOARD — the dashboard's
         * tiles, the flows grid, the connector catalogue, the activity feed —
         * and a board's content is a repeating unit, so width buys another
         * column. The cap used to be 1152px, which meant a 2560px display
         * rendered the 15" laptop layout with 700px of dead canvas either
         * side, and the tiles the extra room was for never appeared.
         *
         * Every `narrow` route is a FORM, and width buys a form nothing. A
         * 2000px email input is worse than a 700px one, and a sentence run
         * across an ultrawide is roughly 300 characters a line — about four
         * times the measure anything is comfortably read at. So `narrow` is
         * unchanged at every viewport, deliberately, and is not a smaller
         * version of the same idea.
         *
         * There is no `max-w` on the fill and that is the point: the column
         * count is what steps (see the grids on the boards themselves), so a
         * wider screen gets MORE tiles rather than the same three stretched.
         */
        width === "narrow" && "max-w-3xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * THE BOARD GRID — one spelling, five rungs, every board in the product.
 *
 * The dashboard's tiles, the flows board and the connector catalogue all
 * already shared `sm:grid-cols-2 xl:grid-cols-3`, in three files, plus two
 * more copies in the skeletons that stand in front of two of them. Five
 * literals for one decision is precisely the drift `check:ui` exists to catch
 * everywhere else, and adding two rungs to the fill would have made it seven.
 *
 * The rungs are the fill's actual argument: a board's unit repeats, so a wider
 * viewport is worth another COLUMN rather than the same three tiles stretched.
 * Five is the ceiling because past it a dashboard numeral stops being the
 * loudest thing on its own card.
 *
 * A skeleton that mirrors a board must import this too — a placeholder grid
 * that disagrees with the real one does the single thing a skeleton exists to
 * prevent.
 */
export const BOARD_GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5";

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
    <header className={cn(className)}>
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-control text-base text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          {back.label}
        </Link>
      )}
      <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", back && "mt-3")}>
        <div className="min-w-0">
          {/* The display face's one in-app appearance besides the metric
              numeral. `.font-display` carries its own tracking, so no
              `tracking-tight` here — the two would compound. */}
          <h1 className="font-display text-display font-semibold text-foreground">{title}</h1>
          {/* `max-w-2xl`: a lede is a sentence, and a sentence that runs the
              full 1024px of the container is 140 characters a line — roughly
              twice the measure anything is comfortably read at. */}
          {lede && <p className="mt-1.5 max-w-2xl text-base text-muted-foreground">{lede}</p>}
        </div>
        {/* `items-center` on a wrapping row put the buttons half a line below
            the title whenever the lede pushed the left column taller. They
            align to the TOP of the header and hold the title's own line. */}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * The section eyebrow — the app's ONE h2. It was 14px uppercase in five
 * files, 11px uppercase in two, 17px sentence case on the kit page and
 * stock 18px on the legal pages. This is the survivor.
 */
export function SectionHeading({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("mb-3 text-micro font-semibold uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}
