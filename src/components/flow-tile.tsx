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
    /**
     * THE TILE'S SHELL, AND THE ONE DECISION INSIDE IT: the number is the only
     * thing on this card allowed to be loud.
     *
     * `tile` (16px radius, the pointer response) is the kit's own rung — see
     * ui/card.tsx — so this and the canvas board's `ChartFrame` cannot drift.
     * The padding is `none` because the card is now two BANDS rather than one
     * padded box: a body that holds the number and its qualifications, and a
     * tray at the bottom that holds the provenance and the two actions. The
     * tray is where "premium surface" comes from that a heavier shadow could
     * not buy — the actions stop floating in the same white as the figure.
     *
     * `flex-col` + `flex-1` on the body pins that tray to the bottom edge, so
     * a row of tiles stretched to equal height lines its Refresh buttons up
     * instead of hanging them wherever each chart happened to end.
     */
    <Card variant="tile" padding="none" className="lift group/tile flex flex-col overflow-hidden">
      <div className="flex flex-1 flex-col p-6 pb-5">
        {/* HEAD: the name, and a status marker that is quiet when there is
            nothing to say. A healthy tile carries a 6px dot; only a tile that
            needs something wears a full pill. Eight green "Up to date" badges
            on one board is eight pieces of furniture reporting no news. */}
        <div className="flex items-start justify-between gap-3">
          {/* THE KIT'S MICRO-LABEL VOICE — ALL CAPS, tracking-wide, muted.
              It was 16px semibold in the foreground colour, which put a heading
              and a 36px numeral an inch apart both asking to be read first. A
              metric's name is a LABEL for the figure under it, and labelling it
              as one is the whole of the hierarchy this card was missing.

              A row whose tile jsonb is null has never computed successfully, so
              there is no stored name — the output id is the only honest handle. */}
          <h3 className="min-w-0 truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground">
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
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
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
            the title attribute (the same trick the timestamp below uses).

            A TINTED BLOCK AT 12px, not 16px prose. It was set one step ABOVE
            the tile's own title, so a broken tile's loudest element after the
            em-dash was its stack trace. The danger wash carries the weight the
            size used to — the same `soft`/`ink` pairing `ImportProgress` uses
            two lines down, so the two qualifications read as one family.
            `ChartFrame` keeps its plain line: a canvas tile can be four rows
            tall, and a padded block there eats the mark. */}
        {row.status === "error" && row.error && (
          <p className="mt-2.5 rounded-card bg-danger-soft px-2.5 py-2 text-tiny text-danger-ink" title={row.error}>
            {row.error.length > 200 ? `${row.error.slice(0, 200)}…` : row.error}{" "}
            <Link href={`/dashboard/flows/${row.flowId}`} className="font-medium underline underline-offset-2">
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
      </div>

      {/* THE TRAY: provenance on the left, actions on the right, on its own
          faint surface behind a hairline.
          The honesty marker (G.3): every materialized number says WHEN it was
          true, and it says the WORD now — a bare "2 hours ago" under a figure
          left the reader to guess whether it dated the number or the data.
          A stale tile's timestamp shows exactly how far behind it is.

          The wash is `foreground` at 3% rather than `muted`, because it has to
          work in both themes from one value: 3% of near-black darkens the light
          card, 3% of near-white lifts the dark one, and a tray that reads as
          recessed in one theme and invisible in the other is not a tray. */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-foreground/3 px-6 py-2.5">
        {row.computedAt ? (
          // NO "Updated " PREFIX. It was added with the tray and it does not
          // fit: at three columns the tray has room for a relative time and two
          // pills, and the prefix pushed every tile on the board to
          // "Updated 2…". The tray IS the context — a timestamp sitting under a
          // number, beside Refresh, is not ambiguous about what it timestamps.
          <span
            className="min-w-0 truncate text-micro text-muted-foreground"
            title={formatDateTime(new Date(row.computedAt))}
          >
            {relativeTime(new Date(row.computedAt))}
          </span>
        ) : (
          <span />
        )}
        {/* Two matched ghost pills. They were a link-variant button beside a
            bare anchor — the same weight, two different components, neither
            with a hit area bigger than its word. Pills are what the sheet draws
            buttons as, and a tray is where a pill can be quiet and still read
            as pressable.

            NO YELLOW HERE, and that is the ratio rule doing its job rather than
            an omission: the hero colour is at most one per SCREEN, and a board
            renders twelve of these. The single spot of colour a tile spends is
            the accent that arrives under the pointer on `Open`. */}
        <span className="flex shrink-0 items-center gap-1">
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={row.flowId} />
            {/* A submit, so it stays a real button. */}
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-micro [&_svg]:size-3.5"
              title="Recompute this tile now"
            >
              Refresh
            </Button>
          </form>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2.5 text-micro hover:text-accent-foreground [&_svg]:size-3.5"
          >
            <Link href={`/dashboard/flows/${row.flowId}`}>
              Open
            </Link>
          </Button>
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
      /**
       * STILL A 6px DOT (docs/BRAND_KIT.md says so, and the quiet-when-fine
       * rule depends on it staying small) — now sitting in a 16px wash of its
       * own colour. A bare 6px dot at the corner of a 24px-padded card read as
       * a speck of dust; the halo gives it a shape to be, at no extra ink.
       * It is also what makes the healthy state and the pill states the same
       * SIZE, so the head does not reflow when a tile goes stale.
       */
      <span
        className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-success/15"
        title="Up to date"
        role="img"
        aria-label="Up to date"
      >
        <span className="size-1.5 rounded-full bg-success" />
      </span>
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
