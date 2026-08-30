import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
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
  chartLabel,
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
   * WHAT THIS TILE IS DRAWN AS, beside the metric's name.
   *
   * Two tiles of one metric drawn two ways carry the same title and the same
   * number, and were indistinguishable at a glance — the whole point of a
   * custom view is putting exactly that pair side by side.
   */
  chartLabel?: string;
  /** Set only when this tile overrides the board's period. See the header. */
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
    // — at ROW_UNIT_PX 40 the cartesian floor is measured against it).
    <Card data-tile-card variant="tile" padding="compact" className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        {/* ONE LINE, ALWAYS. A canvas tile's height is its row span, so a
            header that wraps steals it from the mark below and pushes a goal
            bar's own caption out through the bottom edge. `truncate` here is
            therefore a height guarantee rather than a width preference — and it
            is safe to keep only because the qualifiers below now yield first on
            a narrow tile (see `chartLabel` in custom-tile.tsx), which is what
            leaves the name the whole line it needs. */}
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground" title={title}>
          {title}
        </p>
        {/* THE CHART LABEL AND THE PERIOD MOVED OFF THE NAME'S LINE.
            They used to share it, with `truncate` on the name so the markers
            survived — which is how a tile ended up headed "PICK…". Letting the
            name wrap instead cost a second line, and a canvas tile has a FIXED
            height (its row span), so the extra line pushed a goal bar's own
            "GOAL 20 / 60%" caption out through the bottom edge. Both fixes were
            wrong in the same place: the header was carrying three facts on one
            line and something had to give.
            So the qualifiers sit on the right, beside the freshness marker,
            where they are already `shrink-0` and cost no height at all — and
            the name gets the whole line to itself and needs no ellipsis. */}
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {chartLabel && <span className="whitespace-nowrap">{chartLabel}</span>}
          {rangeLabel && <span className="whitespace-nowrap">· {rangeLabel}</span>}
          {status && <Freshness status={status} />}
          {computedAt && (
            <span className="text-xs text-muted-foreground" title={formatDateTime(new Date(computedAt))}>
              {relativeTime(new Date(computedAt))}
            </span>
          )}
        </span>
      </div>

      {/* THE PAYOFF, AND THE COMPARISON SITS UNDER IT RATHER THAN BESIDE IT.
          A delta on the numeral's own baseline competes with the figure for the
          first read, and on a narrow tile it wrapped into it. Under, at label
          size, it reads as what it is: the sentence qualifying the number. */}
      {headline !== undefined && (
        <div className="mt-1.5">
          <p className={cn("stat-numeral text-display-md leading-none", headline == null && "text-muted-foreground")}>
            {headline ?? "—"}
          </p>
          {delta && <div className="mt-1.5">{delta}</div>}
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
    </Card>
  );
}

/** The honesty line under a mark that showed you less than it has. */
export function ChartFooter({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-muted-foreground">{children}</p>;
}
