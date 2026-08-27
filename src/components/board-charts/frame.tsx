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
    <Card variant="surface" className="flex h-full flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-baseline text-small font-semibold text-foreground">
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
        <span className="flex shrink-0 items-center gap-1.5">
          {status && <Freshness status={status} />}
          {computedAt && (
            <span className="text-tiny text-muted-foreground" title={formatDateTime(new Date(computedAt))}>
              {relativeTime(new Date(computedAt))}
            </span>
          )}
        </span>
      </div>

      {headline !== undefined && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <p className={cn("stat-numeral text-stat leading-none", headline == null && "text-muted-foreground")}>
            {headline ?? "—"}
          </p>
          {delta}
        </div>
      )}

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col justify-center">
        {blocked ? (
          <p className="text-tiny text-muted-foreground" title={blocked}>
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
        <p className="mt-2 text-tiny text-danger-ink">
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
  return <p className="mt-2 text-tiny text-muted-foreground">{children}</p>;
}
