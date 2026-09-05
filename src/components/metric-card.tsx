import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * THE METRIC CARD — one shell, every tile on the board.
 *
 * WHY THIS FILE EXISTS. The dashboard rendered its numbers through THREE
 * components that had drifted into three different cards, sitting in one grid:
 *
 *   `FlowTile`    variant="tile"     p-4   the micro-label voice   tray
 *   `MetricTile`  variant="surface"  p-4   the micro-label voice   "Drill in"
 *   `ChartFrame`  variant="tile"     p-4   the micro-label voice   footer line
 *
 * ALL THREE ARE 16px NOW. This tile ran `p-5` — twenty — against a kit whose
 * card padding is sixteen and a page whose gutter is twenty-four. One tile
 * padded four pixels wider than every other card on the same board is not a
 * hierarchy, it is the near-miss that makes a row of tiles look hand-placed.
 *
 * `MetricTile`'s own comment claimed it was "kept in step with FlowTile's shape
 * on purpose" — it disagreed on the shell, the padding, the title recipe and
 * the footer. A workspace with one legacy metric beside one flow metric showed
 * two different objects and no reason for the difference. The two of them come
 * through here now, so the shape is decided once.
 *
 * `ChartFrame` deliberately does NOT: its `padding="compact"` is measured
 * arithmetic on the canvas board (see tests/board-blocks.test.ts, where the
 * cartesian floor is computed against it at ROW_UNIT_PX 48), and a tile there
 * can be four grid rows tall. It shares this file's VOICE — the same micro
 * label, the same headline recipe — without sharing its geometry.
 *
 * ── THE SHAPE, AND THE TWO ARGUMENTS BEHIND IT ──────────────────────────────
 *
 * NO TRAY. The old card ended in a band with a hairline above it and a 3% wash
 * behind it — a whole surface deployed to say "this row is quieter", which type
 * and space already say. The card is one block of padding now, which is what
 * every other surface in the kit is.
 *
 * NO LEADING EDGE, AS OF THE 4 SEP 2026 BLUE RETHEME. The card used to wear
 * 4px of its group's colour on this edge, borrowed from the builder's step
 * card — the one device that let a tile floating loose in a coloured COLUMN
 * refer back to the tint it sat on. The Figma's default board draws no such
 * edge on any tile, so the strip is gone from here. `--tile-edge` is not:
 * the lane in `board-column.tsx` still sets it per group, unread by anything
 * on this board now, kept alive for the canvas board this spec does not
 * touch.
 *
 * ── THE SPLIT THAT KEEPS A ROW FROM READING AS A PILE ───────────────────────
 *
 * Content takes the slack; the footline does not. Dropping the tray also drops
 * the thing that pinned the two acts to the bottom edge, and the first draft
 * let each card's footline sit wherever its content happened to end — three
 * cards in a row, three heights for "Refresh". §5 of the kit is explicit that a
 * ragged row of footers is the difference between a board and a pile. So the
 * body is `flex-1 justify-center` (a bare scalar centres its figure instead of
 * hanging it off the top of a stretched card, which is the dead space the old
 * card had) and the footline is its sibling, welded to the bottom.
 */
export function MetricCard({
  title,
  /** Chips that qualify the name — a chart label, an overridden period. */
  titleSuffix,
  /** The freshness marker: a 6px dot when fine, a pill when not. */
  marker,
  /**
   * Pre-formatted. `null` prints the em-dash — "no answer for this period" and
   * "the answer is zero" are different facts and the card must not conflate
   * them. `undefined` prints no headline row at all, for a tile whose mark IS
   * the answer (a funnel has no single figure to head).
   */
  headline,
  delta,
  /** The mark: sparkbars, a goal bar, a breakdown, a funnel. */
  children,
  /** Beside the number, never instead of it — errors, imports, undated rows. */
  qualifications,
  /** Bottom left. A relative timestamp, or nothing where there is none. */
  provenance,
  /** Bottom right. Refresh / Open, or a single Drill in. */
  actions,
  className,
  ...rest
}: {
  title: ReactNode;
  titleSuffix?: ReactNode;
  marker?: ReactNode;
  headline?: string | null;
  delta?: ReactNode;
  children?: ReactNode;
  qualifications?: ReactNode;
  provenance?: ReactNode;
  actions?: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"div">, "title" | "children">) {
  return (
    <Card variant="tile" padding="none" className={cn("lift flex flex-col overflow-hidden", className)} {...rest}>
      <div className="flex flex-1">
        {/* NO EDGE, AS OF THE 4 SEP 2026 BLUE RETHEME — see the file note
            above. `--tile-edge` stays defined and `board-column.tsx` still
            sets it per lane; nothing in this shell reads it any more. This
            wrapper is a one-child flex div now — harmless, and left alone
            rather than reflowing every line below it for a width the edge no
            longer needs. */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex items-start justify-between gap-3">
              {/* A CARD TITLE, NOT A MICRO-LABEL — AND MUTED AGAIN AS OF THE
                  4 SEP 2026 BLUE RETHEME. This was 13px ALL-CAPS semibold
                  muted, on the argument that a metric's name LABELS the figure
                  under it and that caps-and-muted is what keeps the NUMBER the
                  loud thing. The size half of that overcorrected: every tile
                  read as a caption with a graph under it, two steps below the
                  body text everywhere else in the product, so the name moved
                  up to body size (`text-sm`, 15px) against a 28px numeral —
                  still a two-step gap, the number is in no danger.
                  THE INK HALF CAME BACK MUTED. The body-size name briefly
                  carried `font-medium text-foreground`, on the argument that a
                  name the customer wrote earned full ink; the Figma draws it
                  `text-muted-foreground` at body weight instead, so the
                  numeral stays the one full-ink object the card has. The
                  micro-label voice is still the wrong one here — it is for a
                  STATUS or a column head, strings you scan, not a name someone
                  wrote — the size argument above still holds at 15px muted. */}
              {/* `flex-1` IS WHAT MAKES `truncate` WORK. The h3 had `min-w-0`
                  and its span had `truncate`, and a long name still wrapped to
                  two lines — because without a flex basis the h3 sizes to its
                  CONTENT inside a `justify-between` row, so there is no width
                  for the ellipsis to trigger against. "Speed To Lead (Armaan)"
                  was the case that showed it. */}
              <h3 className="flex min-w-0 flex-1 items-baseline text-sm font-normal text-muted-foreground">
                <span className="truncate">{title}</span>
                {titleSuffix}
              </h3>
              {/* The same reserved lane the chart frame's header keeps — see the
                  note there. The board's tile menu floats over this corner. */}
              <span className="flex shrink-0 items-center pr-6">{marker}</span>
            </div>

            {headline !== undefined && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {/* `text-heading`, SAID OUT LOUD. It used to inherit
                    `--card-foreground` and looked right, because in the dark
                    theme `--heading` and `--foreground` are the same white. In
                    light they are not — #313131 against #000000 — and the spec
                    asks for the heading step. `cn` still lets the em-dash case
                    win: tailwind-merge drops `text-heading` when
                    `text-muted-foreground` is appended for a null headline. */}
                <p className={cn("stat-numeral text-display-md leading-none text-heading", headline == null && "text-muted-foreground")}>
                  {headline ?? "—"}
                </p>
                {delta}
              </div>
            )}

            {children}
            {qualifications}
          </div>

          {(provenance || actions) && (
            <div className="mt-4 flex items-center justify-between gap-2">
              {provenance ?? <span />}
              {/* Pulled right by its own padding so the last label's edge lines
                  up with the content above it rather than with its hit area. */}
              {actions && <span className="-mr-2.5 flex shrink-0 items-center gap-1">{actions}</span>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
