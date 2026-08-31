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
 * cartesian floor is computed against it at ROW_UNIT_PX 40), and a tile there
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
 * A LEADING EDGE IN THE GROUP'S COLOUR. The one new device, and borrowed rather
 * than invented: the builder's step card wears 4px of its own colour on exactly
 * this edge. A tile sits inside a coloured COLUMN whose tint it floated on
 * without ever referring to, so the board was throwing away the one fact the
 * arrangement encodes. It arrives as `--tile-edge`, set by the lane in
 * `board-column.tsx` — which means a card dragged into another column changes
 * allegiance with no prop threaded anywhere, and the ungrouped row above the
 * columns falls back to the ordinary hairline instead of claiming a group.
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
        {/* THE EDGE. `--tile-edge` is the group's accent, set by the lane; the
            fallback is the ordinary hairline, so an ungrouped tile keeps the
            same geometry without borrowing a colour that would mean it belongs
            somewhere. `aria-hidden` because it duplicates the group name the
            column header already states. */}
        <span
          aria-hidden
          className="w-1 shrink-0"
          style={{ background: "var(--tile-edge, var(--border))" }}
        />
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex items-start justify-between gap-3">
              {/* THE KIT'S MICRO-LABEL VOICE. A metric's name LABELS the figure
                  under it; setting it at 16px in the foreground colour put a
                  heading and a 36px numeral in the same breath, both asking to
                  be read first. Caps and muted is what makes the NUMBER the
                  loud thing — which is the whole thesis. */}
              <h3 className="flex min-w-0 items-baseline text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="truncate">{title}</span>
                {titleSuffix}
              </h3>
              {marker}
            </div>

            {headline !== undefined && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <p className={cn("stat-numeral text-display-md leading-none", headline == null && "text-muted-foreground")}>
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
