import Link from "next/link";
import { PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMetricValue, relativeTime } from "@/lib/format";
import { isForwardRange } from "@/lib/metrics/range";
import { refreshFlowAction } from "@/app/dashboard/flows/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill, type StatusPillProps } from "@/components/ui/badge";
import { Delta, GroupBars, ImportProgress, Sparkbars, TargetBar } from "@/components/charts";
import type { ImportCoverage } from "@/connectors/types";

/**
 * The stored tile, as this component reads it. Kept in step with `TileSpec`
 * in lib/flow/types — this used to omit "duration" from `format` and omit
 * `durationDisplay` entirely, which cost nothing at runtime (the row is cast
 * from `unknown` and the fields ride through the spread into
 * `formatMetricValue`) and was a type that disagreed with its own data: the
 * next person to build a Tile literal would have dropped both, and a
 * speed-to-lead would have published as a bare number again.
 */
type Tile = {
  name?: string;
  description?: string;
  viz?: string;
  format?: "number" | "percent" | "currency" | "duration";
  unit?: string;
  durationDisplay?: string;
  currency?: string;
  precision?: number;
  target?: number | null;
  /** Stamped at materialize. `shape` is what tells the two series apart — see `drawsItsSeries`. */
  facts?: { kind?: string; shape?: string };
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  groups?: Array<{ label: string; value: number }>;
  byRange?: Record<
    string,
    {
      value?: number;
      series?: Array<{ bucket: string; value: number }>;
      /** This period's own bucket size, when it carries a series. */
      unit?: string;
      /** The series was built for the charts, not measured — see `withTrends`. */
      assembled?: boolean;
      groups?: Array<{ label: string; value: number }>;
      unavailable?: string;
      undated?: number;
    }
  >;
};

export type FlowResultRow = {
  flowId: string;
  outputNodeId: string;
  tile: unknown;
  status: string;
  /**
   * What broke, when status is "error" — materializeFlow stores the failing
   * node's message on the row. A tile that shows a red pill and nothing else
   * tells the customer their number is broken while withholding the one fact
   * they could act on.
   */
  error: string | null;
  computedAt: Date | null;
  /**
   * Phase 8 — set when a stream this number was computed from is still reaching
   * backwards through history. Joined at render time, never stored on the row,
   * so every flow on one importing stream says the same thing.
   */
  importing?: ImportCoverage;
  /**
   * The flow's draft would not produce this number any more — someone edited
   * the steps and has not published since. A DIFFERENT AXIS FROM `status`: the
   * row can be "fresh" and carry this at the same time, and that combination is
   * exactly the one that burned a customer (a number recomputed every hour,
   * faithfully, from a version of the flow they had replaced three days
   * earlier). Joined for the whole board at render time — see
   * `unpublishedFlowIds` — so it can never be a stale copy of itself.
   */
  unpublished?: boolean;
};

function fmt(value: number | undefined, t: Tile): string {
  return formatMetricValue(value, t);
}

/**
 * THE NUMBER THIS TILE IS SHOWING, OR NULL WHERE IT SHOWS AN EM-DASH.
 *
 * Exported because the dashboard's "Value high→low" group sort has to rank
 * tiles by the figure the customer can SEE, and every other way of getting it
 * would be a second opinion about the three-state range logic twenty lines
 * below — the state that already cost a customer three days when the all-time
 * figure appeared under the "Today" pill.
 *
 * It mirrors that block exactly and must keep mirroring it: an unanswered range
 * and a range with no entry are both "no number", never zero, because a sort
 * that treats an absent figure as small puts a broken metric in the middle of a
 * healthy list. `tests/flow-tile-range.test.ts` pins the agreement.
 */
export function tileValueForRange(tile: unknown, rangeKey?: string): number | null {
  const stored = (tile ?? {}) as Tile;
  const windowed = rangeKey ? stored.byRange?.[rangeKey] : undefined;
  // A range added after this row was last materialized is absent from it — the
  // ordinary state of every board for one recompute after a pill ships.
  if (rangeKey != null && stored.byRange != null && windowed == null) return null;
  if (windowed?.unavailable) return null;
  const v = windowed ? windowed.value : stored.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Renders one materialized flow Output as a dashboard tile. */
export function FlowTile({ row, rangeKey }: { row: FlowResultRow; rangeKey?: string }) {
  const stored = (row.tile ?? {}) as Tile;
  /**
   * The dashboard's range, applied. Every range was derived from the run the
   * materializer already did (see `tileByRange`), so switching pills is a
   * lookup rather than a recompute.
   *
   * THREE STATES, AND THEY MUST STAY DISTINGUISHABLE. A tile written before
   * ranges existed has no `byRange` at all and keeps rendering what it always
   * did. A range that was answered renders its own number. A range that could
   * not be answered — a percentage with nothing in its denominator this
   * morning, most often — renders nothing and says why. Collapsing the last two
   * is what put the all-time figure under the "Today" pill behind a green
   * "Up to date" badge.
   */
  const windowed = rangeKey ? stored.byRange?.[rangeKey] : undefined;
  const missing = rangeKey != null && stored.byRange != null && windowed == null;
  /**
   * WHY there is no number, in the words of whatever decided there wasn't one.
   *
   * A range added after a tile was last materialized is absent from every
   * already-stored row, so `missing` is the ordinary state of every board for
   * one recompute after a pill ships — and the fixed sentence this used to
   * render ("No data for this period.") reported that as the customer having
   * nothing, with the real reason hidden in a `title` nobody hovers. The stored
   * message is rendered instead, at the one length the tile can hold.
   */
  /**
   * "Refresh to compute it" is advice, and advice is a claim too: on a row
   * whose last run FAILED, a recompute reproduces the failure, so telling the
   * customer to press it sends them at a button that cannot help. The error
   * itself is already rendered below — the missing range is a consequence of
   * it, not a separate errand.
   */
  const unavailable =
    windowed?.unavailable ??
    (missing
      ? row.status === "error"
        ? "Not computed for this range — the last run of this flow failed."
        : "Not computed yet for this range — Refresh to compute it."
      : undefined);
  const t: Tile = windowed && !unavailable ? { ...stored, value: windowed.value, series: windowed.series, groups: windowed.groups } : stored;
  // Nothing to compare a missing number against.
  const delta = unavailable ? null : deriveDelta(stored, t, rangeKey);

  /**
   * ONE CARD, AND AN UNANSWERED RANGE REMOVES ONLY THE NUMBER. The unavailable
   * state used to return a card of its own, ABOVE the error block, the
   * freshness marker and the footer — so under a range no stored row had an
   * entry for yet, a flow that had FAILED rendered as a calm em-dash with no
   * red pill, no reason, no as-of and no Refresh: a broken number wearing an
   * empty one's face. Everything that qualifies a number qualifies its absence.
   */
  return (
    // `surface` (16px) and the full 20px padding: the tile is the product's
    // payoff and it sits on the warm canvas like every other floating thing in
    // the app, so it wears the same radius as the builder's step cards and the
    // config panel. `shadow-card-hover` is the ladder's hover rung — the `lift`
    // translate alone moved the card without changing the light on it.
    <Card variant="surface" className="lift group/tile hover:shadow-card-hover">
      {/* HEAD: the name, and a status marker that is quiet when there is
          nothing to say. A healthy tile carries a 6px dot; only a tile that
          needs something wears a full pill. Eight green "Up to date" badges
          on one board is eight pieces of furniture reporting no news. */}
      <div className="flex items-start justify-between gap-2">
        {/* A row whose tile jsonb is null has never computed successfully, so
            there is no stored name — the output id is the only honest handle. */}
        <h3 className="min-w-0 truncate text-base font-semibold text-foreground">
          {t.name ?? `Output ${row.outputNodeId.slice(0, 8)}`}
        </h3>
        {/* "Up to date" is about the ROW, and on a range this row predates it
            contradicts the body two lines down ("not computed yet"). The row
            being fresh is true and useless there — what the customer asked
            about has no answer — so the healthy marker is withheld and only
            the states that still mean something (refreshing, computing,
            error) keep their pill. */}
        {missing && row.status === "fresh" ? null : <Freshness status={row.status} />}
      </div>

      {/* An em-dash, not a 0: "no answer for this period" and "the answer is
          zero" are different facts, and the tile that conflates them is the one
          nobody can trust. Same stat size as a real number, so switching ranges
          never makes the tile jump. */}
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className={cn("stat-numeral text-stat leading-none", unavailable && "text-muted-foreground")}>
          {unavailable ? "—" : fmt(t.value, t)}
        </p>
        {delta && <Delta current={delta.current} previous={delta.previous} format={t} since={delta.since} />}
      </div>

      {/* No number means no chart either: `t` has fallen back to the stored
          tile, whose series and target are the flow's OWN all-time figures —
          drawing them under a range that has no answer is the all-time-number-
          under-the-Today-pill fallback wearing bars. */}
      {unavailable ? (
        <p className="mt-2.5 text-tiny text-muted-foreground" title={unavailable}>
          {unavailable.length > 160 ? `${unavailable.slice(0, 160)}…` : unavailable}
        </p>
      ) : t.series && t.series.length > 0 && drawsItsSeries(windowed?.assembled === true, stored, t) ? (
        <Sparkbars series={t.series} format={t} />
      ) : t.groups && t.groups.length > 0 ? (
        <GroupBars groups={t.groups} total={t.value} format={t} />
      ) : t.target != null ? (
        <TargetBar value={t.value ?? 0} target={t.target} format={t} />
      ) : null}

      {/* Directly under the number, because it is about the number: everything
          below this point qualifies it too, and this is the qualification that
          decides whether the figure means anything at all. */}
      {row.unpublished && <NotLive flowId={row.flowId} />}

      {/* The red pill alone says "broken" while withholding WHY. The stored
          message names the failing node's error — truncated here, complete in
          the title attribute (the same trick the timestamp below uses). */}
      {row.status === "error" && row.error && (
        <p className="mt-2 text-base text-danger-ink" title={row.error}>
          {row.error.length > 200 ? `${row.error.slice(0, 200)}…` : row.error}{" "}
          <Link href={`/dashboard/flows/${row.flowId}`} className="underline">
            Fix in the editor
          </Link>
        </p>
      )}

      {/* A record with no date in this metric's time reference belongs to no
          period, so it is in "All time" and in none of the pills. Saying so is
          the same rule the import bar follows: a number that leaves data out
          has to admit it, or the gap reads as an answer. */}
      {windowed?.undated ? (
        <p className="mt-2 text-tiny text-warn-ink">
          {windowed.undated} record{windowed.undated === 1 ? "" : "s"} carry no date, so they are counted only in All time.
        </p>
      ) : null}

      {/* Phase 8 — a number computed over an import that is still running is
          accurate and INCOMPLETE, and "Data as of <now>" says only the first
          half. This says the second: a freshly computed tile can cover twelve
          days of a ninety-day window, and without this the timestamp actively
          misleads. */}
      {row.importing && <ImportProgress importing={row.importing} />}

      {/* FOOT: provenance on the left, actions on the right, one line.
          The honesty marker (G.3): every materialized number says WHEN it was
          true. A stale tile's timestamp shows exactly how far behind it is.
          The actions sit at rest in muted grey and take the accent on hover —
          present without competing with the number above them. */}
      <div className="mt-3 flex items-center justify-between gap-2 text-tiny text-muted-foreground">
        {row.computedAt ? (
          <span className="truncate" title={formatDateTime(new Date(row.computedAt))}>
            {relativeTime(new Date(row.computedAt))}
          </span>
        ) : (
          <span />
        )}
        <span className="flex shrink-0 items-center gap-2">
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={row.flowId} />
            {/* A submit, so it stays a real button; sized to sit level with
                the "Open" link beside it. */}
            <Button
              type="submit"
              variant="link"
              size="sm"
              className="h-auto p-0 text-tiny font-medium text-muted-foreground hover:text-primary"
              title="Recompute this tile now"
            >
              Refresh
            </Button>
          </form>
          <Link
            href={`/dashboard/flows/${row.flowId}`}
            className="rounded-control font-medium transition-colors hover:text-primary"
          >
            Open
          </Link>
        </span>
      </div>
    </Card>
  );
}

/**
 * DOES THIS BOARD DRAW THIS SERIES? — the render half of a gate that used to
 * live in the engine.
 *
 * `buildTile` computed a dataset's series only when the publisher had asked for
 * a time chart: `spec.timeField && (viz === "line" || viz === "bar") &&
 * dataset`. The viz clause left that gate so a custom view could switch a tile
 * to bars later without a republish — right for the canvas, where the chart is
 * chosen per tile, and it silently changed THIS board, where the mark is picked
 * from presence. Every dataset metric with a time reference gained a series,
 * and tiles that had shown a bare number for months grew a chart under it.
 *
 * The condition was never about whether the data should EXIST. It was about
 * whether the groups board should draw it, so it belongs here.
 *
 * TWO SOURCES OF `series`, and only one of them was ever gated:
 *   · `facts.shape === "dataset"` — the branch that widened. Ask the viz, as
 *     the engine used to.
 *   · anything else, including a natively bucketed `"series"` metric — never
 *     gated, always drawn. Gating on the viz alone would have stripped these.
 *
 * A ROW WITH NO `facts` DRAWS, and that is not a guess: it predates the stamp,
 * so under the old engine its dataset-derived series could only exist if the
 * viz already allowed it. Having one is proof it passed the test.
 */
function drawsItsSeries(assembled: boolean, stored: Tile, t: Tile): boolean {
  /**
   * AN ASSEMBLED TREND WAS MADE FOR THE CHARTS, NOT MEASURED BY THE METRIC.
   *
   * Acceptance Rate has ONE number per period. Its per-bucket points exist so a
   * custom view can draw a line over them — see `withTrends` — and drawing them
   * here would grow sparkbars under every rate, revenue and duration card on a
   * board nobody asked to change. `Sparkbars` normalises to its own max, so a
   * rate living between 90% and 95% renders as a row of near-full blocks: the
   * exact regression the rest of this function was written to undo.
   *
   * THE SLOT SAYS SO ITSELF. Two inferences were tried first and both were
   * wrong for real stored rows: `facts.shape === "scalar"` misses a legacy
   * Output tile, which carries no facts at all, and "no top-level series"
   * misses a tile that legitimately holds one per range and none at the top.
   * The code that assembles a trend is the only thing that knows it did.
   */
  if (assembled) return false;
  return stored.facts?.shape !== "dataset" || t.viz === "line" || t.viz === "bar";
}

/**
 * The slice of a tile the delta rules read — structural, so the custom tile's
 * own narrower type satisfies it without importing this file's whole `Tile`.
 * EXPORTED because the canvas fabricated its own comparison once (`?? 0`
 * printed "+100%" whenever yesterday was missing) and one set of honesty rules
 * is the entire point of these.
 */
export type DeltaTile = {
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  byRange?: Record<string, { value?: number; unavailable?: string; assembled?: boolean }>;
};

/**
 * WHAT THIS NUMBER CAN HONESTLY BE COMPARED TO.
 *
 * Only two comparisons exist in the data, and neither is invented:
 *
 *  - "Today" has "Yesterday" sitting beside it in `byRange` — both were
 *    computed from the same run, so it is a real like-for-like period.
 *  - A bucketed series carries its own history, so the newest COMPLETE bucket
 *    can be read against the one before it. The final bucket is skipped
 *    because it is still filling: comparing a partial day to a whole one
 *    manufactures a decline every morning.
 *
 * Every other range (7d, 30d, 90d, all) has no stored predecessor — there is
 * no "previous 7 days" bucket — so those tiles show no delta rather than a
 * guess. Returning null is the point: a dashboard that fabricates a
 * comparison is worse than one that omits it.
 *
 * A FORWARD RANGE HAS NO "PRIOR" AT ALL, and the series rule inverts under it.
 * The bucket still filling is the FIRST one (the period we are inside), not the
 * last; the last is the furthest-future, complete one. So the skip-the-final
 * rule dropped the most informative bucket and compared two arbitrary future
 * buckets under a headline that is the whole future total. There is no honest
 * answer to "compared to what" for the future — a booking made for next month
 * is not a movement against anything — so Upcoming gets no delta.
 */
export function deriveDelta(
  stored: DeltaTile,
  t: DeltaTile,
  rangeKey?: string,
): { current: number; previous: number; since: string } | null {
  const current = t.value;
  if (current == null || !Number.isFinite(current)) return null;
  if (isForwardRange(rangeKey)) return null;

  if (rangeKey === "today") {
    const y = stored.byRange?.yesterday;
    if (y && !y.unavailable && y.value != null && Number.isFinite(y.value)) {
      return { current, previous: y.value, since: "vs yesterday" };
    }
  }

  const series = t.series;
  // The window's own slot knows whether its points were measured or assembled.
  const assembled = rangeKey ? stored.byRange?.[rangeKey]?.assembled === true : false;
  /**
   * The same rule `drawsItsSeries` states: an assembled trend draws a SHAPE, it
   * does not yield numbers. "+8 pts vs prior" off two single days, under a
   * headline that is a thirty-day rate, is a comparison the card is not making.
   */
  // The same rule, same reason: an assembled trend draws a shape, it does not
  // yield numbers. "+8 pts vs prior" off two single days, under a headline that
  // is a thirty-day rate, is a comparison the card is not making.
  if (series && series.length >= 3 && !assembled) {
    const last = series[series.length - 2];
    const prior = series[series.length - 3];
    if (last?.value != null && prior?.value != null) {
      return { current: last.value, previous: prior.value, since: "vs prior" };
    }
  }
  return null;
}

/**
 * THE NUMBER IS FROM A FLOW THAT NO LONGER EXISTS AS DRAWN.
 *
 * Warn-toned and worded as the whole sentence, because the failure it reports
 * is one of BELIEF: the tile looked right, the timestamp was recent, the dot
 * was green, and the figure was computed from filters the customer had
 * replaced. Nothing here can fix that except saying it, in the same place the
 * number is read.
 *
 * Not a `StatusPill` in the head: that slot answers "how current is this
 * number" (fresh / refreshing / error), and a fresh number CAN be a
 * not-live one. Two claims, two places — see the Freshness note below.
 *
 * The link lands on the editor, where the toolbar carries the other half of
 * this fix and the same words on its primary button.
 */
export function NotLive({ flowId }: { flowId: string }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-tiny text-warn-ink">
      <PencilLine size={14} className="mt-px shrink-0" aria-hidden />
      <span>
        Edited since publishing — this is the published version&rsquo;s number.{" "}
        <Link
          href={`/dashboard/flows/${flowId}`}
          className="rounded-control font-medium underline underline-offset-2 hover:no-underline"
        >
          Review &amp; publish
        </Link>{" "}
        to make your changes live.
      </span>
    </p>
  );
}

/**
 * QUIET WHEN FINE, LOUD WHEN NOT.
 *
 * A healthy tile says so with a 6px dot; anything else wears the full pill.
 * Every tile used to carry a green "Up to date" badge, which is a board full
 * of labels reporting no news — and it made the one tile that DID need
 * attention just another badge in a row of badges. Plain English throughout:
 * "stale" reads as broken to a customer when it means a refresh is on its way.
 *
 * THIS VOCABULARY IS ABOUT TIME, NOT ABOUT VERSIONS. "Up to date" means the
 * stored value was verified against the source recently; it says nothing about
 * WHICH graph produced it. Unpublished draft changes are the other axis and
 * get their own line (`NotLive`) — folding them in here would make a fresh
 * number computed from an old flow indistinguishable from an honest one.
 */
export function Freshness({ status }: { status: string }) {
  if (status === "fresh") {
    return (
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success"
        title="Up to date"
        role="img"
        aria-label="Up to date"
      />
    );
  }
  const meta: Record<string, { tone: StatusPillProps["tone"]; label: string }> = {
    stale: { tone: "warn", label: "Refreshing soon" },
    computing: { tone: "pending", label: "Computing…" },
    error: { tone: "danger", label: "Error" },
  };
  const m = meta[status] ?? { tone: "pending", label: status };
  return (
    <StatusPill tone={m.tone} className="shrink-0">
      {m.label}
    </StatusPill>
  );
}
