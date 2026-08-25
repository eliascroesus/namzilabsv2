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
        // asking for the same margin.
        "rise-in mx-auto w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8",
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
        width === "narrow" ? "max-w-3xl" : "max-w-6xl",
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
export const BOARD_GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

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
