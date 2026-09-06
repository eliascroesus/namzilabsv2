import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportProgress } from "@/components/charts";
import { Freshness, NotLive } from "@/components/flow-tile";
import type { ImportCoverage } from "@/connectors/types";

/**
 * THE FRAME EVERY CHART RENDERS INSIDE — and the reason forgetting a state is
 * structurally impossible rather than merely discouraged.
 *
 * A tile has three answers about its number and two qualifications of it, and
 * the difference matters:
 *
 *   CAN'T ANSWER (`unavailable`) and NOTHING TO DRAW (`emptyReason`) REPLACE
 *   the mark. Not dim it, not draw it over stale data — replace it. The mark
 *   is passed as `children`, and a React element is inert until something
 *   renders it, so on these paths the mark's component function is NEVER
 *   INVOKED. That is the guarantee: a pie cannot silently draw last week's
 *   slices under a period it could not answer, because the code that would
 *   draw them does not run.
 *
 *   UNPUBLISHED and IMPORTING render ALONGSIDE the number, because they
 *   qualify what it means without replacing what it is: a number computed from
 *   a flow the customer has since rewritten is still a number, and saying so
 *   beside it is the only honest option. `flow-tile.tsx` settled this argument
 *   for the groups board; this is the same settlement, and the same components.
 *
 * PRIORITY: unavailable > error > empty > mark. An erroring flow whose stored
 * value is still readable shows the error rather than a confident chart.
 *
 * The freshness vocabulary is IMPORTED, not re-spelled — one dot, one set of
 * pills, one meaning of "stale" across both boards.
 */
export function ChartFrame({
  title,
  rangeLabel,
  headline,
  delta,
  status,
  computedAt,
  unavailable,
  emptyReason,
  error,
  flowId,
  unpublished,
  importing,
  footer,
  children,
}: {
  title: string;
  /**
   * ACCEPTED AND NO LONGER DRAWN. It said what a tile was drawn AS — "Line",
   * "Bars" — under a picture of exactly that. Kept in the type because
   * `custom-tile.tsx` passes it, and removing it would mean editing call
   * sites to say nothing.
   */
  chartLabel?: string;
  /** Set ONLY when this tile overrides the board's period — see the header. */
  rangeLabel?: string;
  /**
   * Pre-formatted, because the formatter lives where the data does. `null`
   * prints the em-dash ("no answer" and "the answer is zero" are different
   * facts); `undefined` prints no headline row at all — a funnel, a pipeline
   * and a table have no single figure to head.
   */
  headline?: string | null;
  delta?: ReactNode;
  status?: string;
  computedAt?: Date | string | null;
  /** The period could not be answered. Replaces the mark. */
  unavailable?: string;
  /** The chart is legal and this period is simply empty. Replaces the mark. */
  emptyReason?: string;
  error?: string | null;
  flowId?: string;
  unpublished?: boolean;
  importing?: ImportCoverage;
  /** An honesty line the mark itself computed — "Top 4 of 11", excluded slices. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const blocked = unavailable ?? emptyReason;
  return (
    // `data-tile-card` marks the chrome a BLOCK must not have. The harness and
    // `tests/board-blocks.test.ts` both used to look for the literal classes
    // `rounded-surface` / `shadow-card` / `bg-card`, which made "a heading wears
    // no card" a statement about Tailwind rather than about the tile.
    //
    // `tile` is the kit's own rung (ui/card.tsx) — the same shell the groups
    // board's `FlowTile` wears, so the two boards' cards cannot drift apart.
    // `padding="compact"` is the 16px this always had as a className override;
    // it is load-bearing arithmetic, not taste (see `tests/board-blocks.test.ts`
    // — at ROW_UNIT_PX 48 (24px gap) the cartesian floor is measured against it).
    /**
     * THE HEAD, WHICH IS NO LONGER RULED — see `CardHeader` in ui/card.tsx.
     *
     * This block used to open "THE RULED HEAD" and describe every card as two
     * bands closed by a hairline. That was read off an earlier reference;
     * `node-id=14:4` sets the header frame `border-0` and the render confirms
     * it, so the rule came off and the NAME went muted to do the separating
     * that the rule had been doing.
     *
     * What survives from the old argument is the shape: the title is not a
     * caps micro-label. It was 13px ALL-CAPS with the chart kind and the
     * freshness on one line, which made every tile read as a caption with a
     * graph under it, two steps below the body text everywhere else.
     *
     * `padding="none"` is still the pairing: the header and the body each
     * bring their own 16px, so a `CardHeader` inside an already-padded Card
     * would sit its content 32px in from the card's edge.
     */
    <Card data-tile-card variant="tile" padding="none" className="flex h-full flex-col overflow-hidden">
      <CardHeader className="gap-2">
        {/* `flex-1` IS WHAT MAKES `truncate` FIRE. Without a basis this column
            sizes to its CONTENT inside the header's `justify-between` row, so
            there is no width for an ellipsis to trigger against and a long name
            simply wraps. `min-w-0` alone is not enough — it permits shrinking,
            it does not cause it. Same fix, same reason, as the metric tile's
            own h3: "Speed To Lead (Armaan)" was the name that showed both. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* ONE LINE, ALWAYS. A canvas tile's height is its row span, so a
              header that wraps steals it from the mark below and pushes a goal
              bar's own caption out through the bottom edge. `truncate` here is
              therefore a height guarantee rather than a width preference. */}
          <CardTitle title={title}>{title}</CardTitle>
          {/* THE CHART-KIND LINE IS GONE, 6 SEP 2026 — "I dont want to have
              the chart type text on the cards". It read "Line · Today" under
              the name: the tile describing the picture directly beneath it.

              `rangeLabel` STAYS, AND THE DISTINCTION IS THE WHOLE POINT. It is
              not decoration and it is not the chart's kind — it is set only
              when THIS TILE OVERRIDES THE BOARD'S PERIOD, so without it a tile
              reading "Last 7 days" sits in a board set to Today and says
              nothing about the difference. `tests/custom-tile-render.test.ts`
              calls a silent override "the failure", and it is right: the two
              labels were sharing one line, so removing the noisy half is what
              lets the honest half be seen at all. */}
          {rangeLabel && <CardDescription className="truncate">{rangeLabel}</CardDescription>}
        </div>
        {/* `pr-6` IS THE KEBAB'S LANE, and it is reserved rather than negotiated.
            The board floats a tile menu at `absolute right-2 top-2` — 8px in,
            28px square — which lands inside this header's own 16px padding and
            straight on top of "16 min ago". The two components cannot see each
            other: the menu belongs to the board's cell wrapper and this belongs
            to the card, so there is nothing to measure against at runtime.
            Reserving the width unconditionally costs 24px of air on the tiles
            that have no menu and buys every card's freshness landing on the
            same line as every other card's. Shifting it on hover instead would
            move the text under the cursor, which is worse than the overlap. */}
        <span className="flex shrink-0 items-center gap-1.5 pr-6 text-xs text-muted-foreground">
          {status && <Freshness status={status} />}
          {computedAt && (
            <span className="whitespace-nowrap" title={formatDateTime(new Date(computedAt))}>
              {relativeTime(new Date(computedAt))}
            </span>
          )}
        </span>
      </CardHeader>
      {/* NO TOP PADDING — the header above already opened the card's 16px box
          and stopped, so a `p-4` here would insert a second 16px between the
          name and the figure. The export sets the numeral directly under the
          name; 16px of air there is what made the head look like a band even
          after its rule came off. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">

      {/* THE PAYOFF AND ITS COMPARISON, ON ONE ROW, PUSHED TO OPPOSITE ENDS.
          The delta used to sit UNDER the numeral (`mt-1.5`) on the argument
          that a chip on the number's own baseline competes with it for the
          first read. The export settles it the other way and it is the same
          row the metric card already draws: the figure against the card's left
          edge, the chip against its RIGHT one, with the whole width between
          them. That gap is what stops them competing — a chip trailing the
          number by six pixels is a suffix on the figure, a chip at the far end
          of the row is the card's second column.

          `justify-between` with no gap of its own, exactly as `MetricCard`
          spells it, so the two cards cannot drift apart again. */}
      {headline !== undefined && (
        <div className="flex items-center justify-between gap-3">
          {/* NO `leading-none`. The step's own line-height is 40px
              (`--text-display-md--line-height`) and that is exactly what the
              export measures on a chart card's figure — the metric card is
              the one that overrides it, down to 36. `leading-none` was 28 on
              both, which is why the name and the number sat welded together
              with no air between them.

              `text-heading` for the same reason the metric card says it out
              loud: in dark it is the same white as the inherited ink and
              nothing catches it, in light it is #313131 against #000000. */}
          <p
            className={cn(
              "stat-numeral text-display-md text-heading",
              headline == null && "text-muted-foreground",
            )}
          >
            {headline ?? "—"}
          </p>
          {delta}
        </div>
      )}

      {/* `justify-end` rather than `justify-center`: a mark that does not fill
          its tile should sit ON the card's floor, not float in the middle of it
          with dead space above and below. A tall breakdown tile used to leave a
          third of a card empty under two bars. */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col justify-end">
        {blocked ? (
          <p className="text-xs text-muted-foreground" title={blocked}>
            {blocked.length > 160 ? `${blocked.slice(0, 160)}…` : blocked}
          </p>
        ) : (
          children
        )}
      </div>

      {footer}

      {/* The qualifications — beside the number, never instead of it. */}
      {unpublished && flowId && <NotLive flowId={flowId} />}
      {status === "error" && error && (
        <p className="mt-2 text-xs text-danger-ink">
          {error.length > 160 ? `${error.slice(0, 160)}…` : error}{" "}
          {flowId && (
            <Link
              href={`/dashboard/flows/${flowId}`}
              className="rounded-control font-medium underline underline-offset-2 hover:no-underline"
            >
              Fix in the editor
            </Link>
          )}
        </p>
      )}
      {importing && <ImportProgress importing={importing} />}
      </div>
    </Card>
  );
}

/** The honesty line under a mark that showed you less than it has. */
export function ChartFooter({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-muted-foreground">{children}</p>;
}
