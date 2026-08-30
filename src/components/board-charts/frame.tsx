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
        {/* THE KIT'S MICRO-LABEL VOICE, matching `FlowTile`: a metric's name
            LABELS the figure under it, and setting it at 14px in the
            foreground colour put a heading and a 36px numeral in the same
            breath. Caps and muted is what makes the number the loud thing. */}
        <p className="flex min-w-0 items-baseline text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {/* The TITLE truncates; the period marker does not. It sits at the
              end of the line, and `truncate` ellipsises the END — so with one
              truncating span the marker was the first thing to disappear, on
              exactly the narrow tiles most likely to carry a pin. A tile
              answering a different period than the pill above it with no
              visible sign is the one failure this marker exists to prevent, so
              it is the title that yields. */}
          <span className="truncate">{title}</span>
          {/* THE TILE'S OWN PERIOD, PRINTED ONLY WHEN IT DISAGREES with the
              board's pills. A tile silently answering a different question
              from the one the pill above says is being asked is the whole risk
              a per-tile range carries, so the override announces itself — and
              a tile following the board says nothing, because there is nothing
              to say. Inside the truncating line on purpose: the metric's name
              yields first, since the period is the shorter and the surprising
              half. */}
          {chartLabel && (
            <span className="ml-1.5 shrink-0 whitespace-nowrap font-medium text-muted-foreground">· {chartLabel}</span>
          )}
          {rangeLabel && (
            <span className="ml-1.5 shrink-0 whitespace-nowrap font-medium text-muted-foreground">· {rangeLabel}</span>
          )}
        </p>
        {/* The marker and the as-of, in that order: one says whether the number
            can be trusted, the other says as of when. `gap-1.5` and the dot's
            own 16px wash keep them on one baseline whichever state is showing. */}
        <span className="flex shrink-0 items-center gap-1.5">
          {status && <Freshness status={status} />}
          {computedAt && (
            <span className="text-xs text-muted-foreground" title={formatDateTime(new Date(computedAt))}>
              {relativeTime(new Date(computedAt))}
            </span>
          )}
        </span>
      </div>

      {/* THE PAYOFF. `mt-2` is one baseline step off the label — close enough
          to belong to it, far enough that the numeral is not sitting on it. */}
      {headline !== undefined && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <p className={cn("stat-numeral text-display-md leading-none", headline == null && "text-muted-foreground")}>
            {headline ?? "—"}
          </p>
          {delta}
        </div>
      )}

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col justify-center">
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
