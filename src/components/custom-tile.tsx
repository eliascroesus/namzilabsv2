"use client";

import { AlertTriangle } from "lucide-react";
import { formatMetricValue } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Delta, type ChartFormat, type GroupRow, type SeriesPoint } from "@/components/charts";
import { FunnelView } from "@/components/funnel-view";
import { deriveDelta } from "@/components/flow-tile";
import { ChartFooter, ChartFrame } from "@/components/board-charts/frame";
import { GoalBar, Sparkline } from "@/components/board-charts/scorecard";
import { BarsVertical, LineChart } from "@/components/board-charts/cartesian";
import { BarsHorizontal, groupsFooter } from "@/components/board-charts/bars-horizontal";
import { PieChart, pieFooter } from "@/components/board-charts/pie";
import { Pipeline } from "@/components/board-charts/pipeline";
import { ChartTable } from "@/components/board-charts/table";
import { ChartHover } from "@/components/chart-hover";
import {
  CHARTS,
  asChartId,
  blockKindOf,
  blockTileKey,
  chartsFor,
  shapeOfClassic,
  shapeOfTile,
  type BlockId,
  type ChartId,
} from "@/lib/board/charts";
import { accentOf, composes, honoured, PARTS_SLOT, type TileConfig } from "@/lib/board/tile-config";
import { composeFunnel, composePie, isRefusal, type ComposeMember, type MemberUnits } from "@/lib/board/compose";
import { RANGE_OPTIONS, resolveRange } from "@/lib/metrics/range";
import { bucketLabel, type BucketUnit } from "@/lib/board/scale";
import type { AggregateResult, FunnelResult } from "@/lib/metrics/compute";
import type { ImportCoverage } from "@/connectors/types";

/**
 * ONE CHART ON A CUSTOM VIEW — the tile that draws what it was ASKED to draw.
 *
 * `FlowTile` picks its mark from data presence: series, then groups, then
 * target, then nothing. That is right for the groups board, where nobody chose
 * a chart and the tile is doing its best with what it has. It is wrong here,
 * where choosing the chart is the entire interaction — so this branches on
 * `chart` and on nothing else.
 *
 * The consequence is a component that can be asked for a drawing the data
 * cannot support, which a presence-driven one never could. It says so rather
 * than substituting — and it cannot FORGET to, because `ChartFrame` refuses to
 * render the mark at all unless the state is clean.
 *
 * THE TWO SOURCES ARE NORMALISED FIRST. A stored flow tile and a live classic
 * result answer the same four questions — a value, a series, a breakdown, a
 * funnel — in different shapes, and every branch below reads the normalised
 * answer. Two parallel render trees is how the classic path fell behind the
 * flow path the first time.
 */

type StoredTile = {
  name?: string;
  format?: string;
  currency?: string;
  precision?: number;
  unit?: string;
  durationDisplay?: string;
  target?: number | null;
  timeUnit?: string;
  /** Which date field windows this metric — disclosed when members disagree. */
  timeField?: string | null;
  facts?: { kind?: string; shape?: string; countable?: boolean; additive?: boolean };
  value?: number;
  series?: SeriesPoint[];
  groups?: GroupRow[];
  byRange?: Record<
    string,
    {
      value?: number;
      series?: SeriesPoint[];
      /** THIS window's bucket size, which is not the metric's declared one. */
      unit?: string;
      groups?: GroupRow[];
      unavailable?: string;
      undated?: number;
    }
  >;
};

/**
 * ONE SIBLING METRIC THIS TILE IS COMPOSED FROM — resolved on the server, where
 * the board's map of every published tile already lives, and carried here as
 * the few facts the rules actually ask about.
 *
 * DELIBERATELY NOT THE WHOLE TILE. A tile carries its series, its groups and
 * (off this path) its byDay, and none of that is ever drawn for a part: a part
 * contributes exactly one number. Six-or-seven numbers and a label is ~130B on
 * the wire against a tile's several KB.
 *
 * ALL SIX MATERIALIZED RANGES, NOT THE ACTIVE ONE — because that is what keeps
 * switching the board's period a client-side operation. Resolving a part to a
 * single number on the server would have put a round trip behind every press of
 * a range pill, on a board whose whole performance story is that it does not.
 * The active key is added alongside them when it is a DRAWN window, which is
 * not one of the six.
 *
 * ITS OWN FORMAT BAG, and that is the currency fix. The renderer builds one bag
 * from the ANCHOR and hands it to the mark, so a pie whose whole is "Revenue"
 * (USD) and whose part is "Deals Closed" would otherwise print that slice as
 * $37 — in the legend, the tooltip and the screen-reader line alike.
 */
export type ComposedPart = {
  label: string;
  timeField?: string | null;
  /**
   * Loose on purpose — this is a stored jsonb's own fields, and nothing
   * FORMATS a part. It exists only so `compose.ts` can refuse a composition
   * whose members are measured in different things.
   */
  format: MemberUnits;
  countable?: boolean;
  additive?: boolean;
  /** False for a row written before `byRange` existed — see `compose.ts`. */
  hasPeriods: boolean;
  byRange: Record<string, number | null>;
};

export type CustomTileSource =
  | {
      kind: "flow";
      tile: unknown;
      computedAt?: Date | string | null;
      status?: string;
      unpublished?: boolean;
      importing?: ImportCoverage;
      error?: string | null;
      flowId?: string;
      /**
       * The metrics named by `config.parts`, in the author's stored order —
       * absent when this tile composes nothing. A key that no longer resolves
       * (unpublished, deleted, or hidden by the viewer's rank) is simply not in
       * this list, and `compose.ts` refuses on the resulting short array rather
       * than drawing a funnel with a stage quietly missing from the middle.
       */
      parts?: ComposedPart[];
    }
  | { kind: "classic"; result: AggregateResult | FunnelResult | null; target: number | null };

/** What every mark below reads, whichever source it came from. */
type Windowed = {
  value?: number;
  series?: SeriesPoint[];
  /** The same window shifted back by its own length — see `TileSpec.byRange`. */
  compare?: SeriesPoint[];
  groups?: GroupRow[];
  funnel?: FunnelResult;
  undated?: number;
  unavailable?: string;
};

/**
 * A tile pointing at a metric that no longer exists.
 *
 * It keeps its box and says so rather than vanishing. A placement on the
 * groups board is filtered away silently when its metric goes, and that is
 * right there — nobody positioned it. Here somebody chose this chart, put it in
 * this spot and sized it, and republishing the flow brings the number back.
 */
function DeadTile({ title }: { title: string }) {
  return (
    // The same shell and the same label voice as a living tile — it is one of
    // this board's cards in a state, not a different object. What changes is
    // that the number's slot carries a warn CHIP instead of a figure: the
    // sheet pills chips, the trio owns the colour, and a tinted badge is
    // legible at a glance across a board in a way a grey sentence is not.
    <Card data-tile-card variant="tile" padding="compact" className="flex h-full flex-col">
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-3 flex flex-1 flex-col items-start justify-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-control bg-warn-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warn-ink">
          <AlertTriangle size={13} />
          Metric unavailable
        </span>
        <p className="text-xs text-muted-foreground">
          It isn&rsquo;t published any more. Publish it again, or point this tile at another metric.
        </p>
      </div>
    </Card>
  );
}

/**
 * FURNITURE, NOT A CARD.
 *
 * A heading is text ON the canvas, not a card containing text, and a divider is
 * a rule rather than a box — so these deliberately skip `Card` and the whole
 * `ChartFrame` apparatus. There is no freshness to report, no period to window,
 * no headline and nothing that can fail to be computed: every state the frame
 * exists to carry is a state a block cannot be in.
 *
 * THEY RENDER BEFORE THE DEAD-METRIC CHECK, which is the load-bearing detail.
 * A block's `source` is null exactly as a deleted metric's is — it points at
 * nothing on purpose — so any order but this one draws every heading on every
 * board as "It isn't published any more. Publish it again."
 *
 * Empty content renders a PLACEHOLDER rather than nothing at all: an empty
 * block is invisible, and an invisible tile still occupies its grid box, so a
 * board would have a hole in it that can only be found by dragging into it.
 */
function Block({ kind, text }: { kind: "heading" | "text" | "divider"; text?: string }) {
  if (kind === "divider") {
    // Centred in its row rather than sitting at the top of it, so the tile's
    // height reads as the space around the rule instead of space under it.
    return (
      <div className="flex h-full items-center" role="presentation">
        <span className="h-px w-full bg-border" />
      </div>
    );
  }
  const empty = !text;
  const words = text || (kind === "heading" ? "Heading" : "Write a note…");
  return (
    <div className={`flex h-full min-w-0 flex-col justify-center ${empty ? "text-muted-foreground" : ""}`}>
      {kind === "heading" ? (
        <h3 className="truncate text-lg font-semibold text-foreground">{words}</h3>
      ) : (
        // `whitespace-pre-line` so a paragraph typed with line breaks keeps
        // them; the tile's own height decides how much of it is on screen.
        <p className="min-h-0 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-muted-foreground quiet-scroll">
          {words}
        </p>
      )}
    </div>
  );
}

export function CustomTile({
  chart: rawChart,
  title,
  rangeKey: boardRange,
  source,
  config: rawConfig = {},
  cols = 6,
}: {
  chart: string;
  title: string;
  /** The BOARD's period. A tile may override it — see `config.rangeKey`. */
  rangeKey: string;
  source: CustomTileSource | null;
  /** The tile's presentation. Facts stay with the metric; these are choices. */
  config?: TileConfig;
  /** The tile's width in grid columns — only the pie's legend side reads it. */
  cols?: number;
}) {
  const chart = asChartId(rawChart);
  /**
   * BEFORE the dead-metric check — see `Block`. A block points at no metric, so
   * its `source` is null for a completely different reason than a deleted one's.
   */
  const block = blockKindOf(blockTileKey(chart as BlockId));
  if (block) return <Block kind={block} text={honoured(chart, rawConfig).text} />;

  if (!source) return <DeadTile title={title} />;
  /**
   * ONLY THE SETTINGS THIS CHART USES. Switching a tile from bar to pie leaves
   * the old `color` in the bag, and the pie draws from `SLICE_ORDER` — so
   * without this the stored key would sit there being read by nothing, and the
   * panel and the renderer would need to agree separately about that. They
   * read one table instead. See `CONFIG_FIELDS`.
   */
  const config = honoured(chart, rawConfig);
  const accent = accentOf(config.color);

  /**
   * WHOSE PERIOD THIS TILE ANSWERS FOR.
   *
   * A flow tile carries every materialized range in its `byRange`, so an
   * override is a different key read from data already in hand. A CLASSIC
   * metric is computed live for the one range the page resolved, so its
   * override is ignored here rather than trusted — reading `byRange` it does
   * not have would silently answer for the board's period while the title
   * claimed otherwise, which is the one failure a per-tile range must not have.
   */
  const overridden = source.kind === "flow" && config.rangeKey != null && config.rangeKey !== boardRange;
  const rangeKey = overridden ? config.rangeKey! : boardRange;
  const rangeLabel = overridden ? RANGE_OPTIONS.find((r) => r.key === rangeKey)?.label : undefined;

  // ── normalise both sources to one shape ───────────────────────────────────
  const stored: StoredTile = source.kind === "flow" ? ((source.tile ?? {}) as StoredTile) : {};
  let slotOf: NonNullable<StoredTile["byRange"]>[string] | undefined;
  let w: Windowed;
  let legal: boolean;
  let bag: ChartFormat;
  let target: number | null;
  /**
   * WHY A COMPOSED CHART WOULD BE A LIE IF IT DREW — one sentence, decided by
   * pure functions in `compose.ts` rather than by a branch down in the ladder,
   * so every rule is a return value a test can assert red before it is green.
   */
  let composeRefusal: string | undefined;
  /**
   * WHAT THE DRAWING CANNOT SAY FOR ITSELF. Composition has two failure modes
   * that are undetectable from anything stored — a funnel's stages are not a
   * cohort, and a pie's parts are assumed not to overlap — so they are never
   * refused and never optional. They render under the mark, every time.
   */
  let composeNotes: string[] = [];

  if (source.kind === "flow") {
    const slot = stored.byRange?.[rangeKey];
    slotOf = slot;
    /**
     * A PIN THE TILE CANNOT HONOUR IS A MISSING PERIOD, not a licence to fall
     * back. Without `|| overridden`, a tile whose stored jsonb predates
     * `byRange` (no slot map at all) answered a pin by dropping through to its
     * un-windowed top-level figures — printing an all-time number under a
     * "Today" marker, which is precisely the confident wrong answer the marker
     * was added to prevent.
     */
    const missing = slot == null && (stored.byRange != null || overridden);
    w = {
      ...(slot ?? { value: stored.value, series: stored.series, groups: stored.groups }),
      unavailable:
        slot?.unavailable ??
        (missing
          ? source.status === "error"
            ? "The last run of this flow failed."
            : "Not computed yet for this period — Refresh to compute it."
          : undefined),
    };
    /**
     * Legality is a property of the METRIC, not of this period — see
     * `shapeOfTile`. A quiet Tuesday must not turn a bar chart into an error;
     * it turns it into "no trend in this period", below.
     */
    legal = chartsFor(shapeOfTile(stored)).includes(chart);
    bag = { ...stored, precision: config.precision ?? stored.precision };
    target = config.target !== undefined ? config.target : (stored.target ?? null);

    /**
     * A FUNNEL OR A PIE ASSEMBLED FROM SIBLING METRICS — the anchor first.
     *
     * IT WRITES INTO `w`, WHICH IS THE WHOLE INTEGRATION. A funnel becomes
     * `w.funnel` and a pie becomes `w.groups`, so `PieChart`, `pieFooter`,
     * `BarsHorizontal`, `tableRows` and every existing empty-reason rung below
     * keep working with no knowledge that anything was composed — and a
     * composed pie can be drawn as a category bar or listed as a table for
     * free. Handing the mark a parallel `composed` prop instead would have left
     * the pie unreachable behind the `!hasGroups` rung that fires further down.
     *
     * The anchor's own value can be `undefined` when the slot is missing;
     * `null` is what the rules read as "cannot answer", and an unavailable slot
     * is exactly that rather than a zero.
     */
    /**
     * WHEN COMPOSITION TAKES OVER THE DRAWING — and the two charts answer
     * differently, because one of them has another way to exist.
     *
     * A FUNNEL OR PIPELINE ON A FLOW TILE IS ALWAYS COMPOSED. No stored flow
     * shape produces a `FunnelResult`, so there is no second source for it to
     * compete with — which means an UNCONFIGURED one must reach `composeFunnel`
     * too, and come back with "Add at least one more stage in the tile's
     * settings". Gated on parts being present, it would instead fall through to
     * "Only a funnel metric can be drawn this way": a dead end printed over
     * what is really an unfinished setup, and the exact sentence this feature
     * exists to stop showing somebody who just chose this chart.
     *
     * A PIE HAS A SECOND DOOR — a tile carrying its own `groups` draws them
     * directly — so composition only takes over when the author has actually
     * named parts. That is the precedence rule stated once, here: `config.parts`
     * is a deliberate act and wins over the metric's own shape; absent it, the
     * grouped pie behaves exactly as it always has.
     */
    if (composes(chart) && ((config.parts?.length ?? 0) > 0 || chart === "funnel" || chart === "pipeline")) {
      const anchor: ComposeMember = {
        label: stored.name ?? title,
        value: w.unavailable == null && typeof w.value === "number" ? w.value : null,
        countable: stored.facts?.countable,
        additive: stored.facts?.additive,
        hasPeriods: stored.byRange != null,
        timeField: stored.timeField,
        format: bag,
      };
      const members: ComposeMember[] = [
        anchor,
        ...(source.parts ?? []).map((p) => ({
          label: p.label,
          value: p.byRange[rangeKey] ?? null,
          countable: p.countable,
          additive: p.additive,
          hasPeriods: p.hasPeriods,
          timeField: p.timeField,
          format: p.format,
        })),
      ];
      const slot = PARTS_SLOT[chart];
      const out = chart === "pie" ? composePie(members, slot) : composeFunnel(members, slot);
      if (isRefusal(out)) composeRefusal = out.refusal;
      else if ("result" in out) {
        w.funnel = out.result;
        composeNotes = out.notes;
      } else {
        w.groups = out.groups;
        composeNotes = out.notes;
      }
    }
  } else {
    const r = source.result;
    const funnel = r && "stages" in r ? r : undefined;
    const agg = r && "kind" in r ? r : undefined;
    const series = agg?.kind === "series" ? agg.series : undefined;
    w = {
      funnel,
      series,
      // The classic engine's series carries no total, so the headline is the
      // sum of its buckets — the same arithmetic `MetricTile` does.
      value: agg?.kind === "scalar" ? agg.value : series?.reduce((a, b) => a + b.value, 0),
    };
    legal = chartsFor(shapeOfClassic(r, source.target)).includes(chart);
    bag = { format: "number", precision: config.precision ?? 2 };
    target = config.target !== undefined ? config.target : source.target;
  }

  /**
   * THE SLICE'S OWN BUCKET SIZE, falling back to the metric's declared one.
   *
   * Each window is bucketed to suit its length, so "Last 7 days" is days even
   * on a metric that declares itself monthly. Labelling those days with the
   * metric's unit would print "Aug '26" seven times; the slot carries the size
   * that was actually used. Absent = a row written before this shipped, whose
   * series really is in the metric's declared unit.
   */
  const unit = ((source.kind === "flow" ? stored.byRange?.[rangeKey]?.unit : undefined) ??
    stored.timeUnit) as BucketUnit | undefined;
  const fmt = (v?: number) => formatMetricValue(v, bag);
  const hasSeries = (w.series?.length ?? 0) > 0;
  const hasGroups = (w.groups?.length ?? 0) > 0;
  const undated = w.undated ?? 0;
  /**
   * A SERIES COMPUTED BEFORE WINDOWS CARRIED THEIR OWN BUCKET SIZE.
   *
   * Each range is bucketed to suit its length now, and the size travels in the
   * slot. A slot with a series but NO unit was written by the old engine, which
   * bucketed every window by the metric's declared `timeUnit` — "month" by
   * default, so seven days came back as a single point. That is a stale ROW,
   * not a short period, and telling somebody to "pick a longer range" when
   * Last 90 days would answer the same way is advice that cannot work.
   *
   * Every tile recomputes at least once per UTC day, and "Refresh all" does it
   * now, so this window is temporary — but it is exactly the window somebody is
   * looking at the first time they see it.
   */
  const stale = source.kind === "flow" && !!slotOf?.series && slotOf.unit == null;
  const chartLabel = (CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label.toLowerCase();
  /** "an area", "a line". One rule beats a table of exceptions for this list. */
  const anChart = `${/^[aeiou]/.test(chartLabel) ? "an" : "a"} ${chartLabel}`;

  /**
   * SPAN THE PERIOD, AND KNOW WHAT A QUIET BUCKET MEANT.
   *
   * The engine emits only buckets that had records, so a series starts at the
   * first record: "Last 30 days" drew a chart beginning eleven days in, which
   * reads as the metric having been switched on then. Handing the mark the
   * window makes it span what the pill above the board is promising.
   *
   * And the FACT decides what an absent bucket means. A count with no matching
   * records counted zero — measured, not guessed — so the line reaches the
   * floor instead of stopping short. A ratio has no denominator and a duration
   * has no samples, so those stay holes; `scale.ts`'s header argues why that is
   * the right default everywhere the caller cannot be sure.
   *
   * "All time" gets no period: its start is whenever the data starts, which is
   * exactly what the series already says.
   */
  const factKind =
    stored.facts?.kind ??
    (stored.format === "duration" ? "duration" : stored.format === "percent" ? "ratio" : "count");
  const pad = (() => {
    if (source.kind !== "flow" || rangeKey === "all") return { fill: factKind === "count" ? 0 : null };
    const { range } = resolveRange(rangeKey);
    return { fill: factKind === "count" ? 0 : null, period: { from: range.from.getTime(), to: range.to.getTime() } };
  })();

  /**
   * WHY THIS PERIOD HAS NOTHING TO DRAW — distinct from "can't answer", and
   * distinct again from "this metric can never be drawn this way". Three
   * different facts, three different sentences, none of them a blank box.
   */
  const emptyReason = !legal
    ? "This metric can’t be drawn this way — change the chart."
    : /**
       * THE COMPOSED CHART'S OWN REFUSAL OUTRANKS EVERY RUNG BELOW, and the
       * order is load-bearing rather than tidy.
       *
       * A composed chart that refuses has NO `w.groups` and NO `w.funnel` — so
       * left further down, it would be overtaken by "No breakdown in this
       * period" (the pie's `!hasGroups` rung) or by "Only a funnel metric can
       * be drawn this way", which is the exact sentence this whole feature
       * exists to stop printing on a tile somebody has just finished
       * configuring. Both would describe the metric when the truth is about the
       * configuration.
       *
       * It sits BELOW `!legal` deliberately: whether this chart may draw this
       * metric at all is a bigger fact than whether its parts are in order.
       */
      composeRefusal
      ? composeRefusal
      : (chart === "line" || chart === "area" || chart === "bar") && !hasSeries
      ? "No trend in this period."
      : /**
         * ONE POINT IS NOT A TREND: a line through it drew a lone dot on an
         * empty grid while a bar drew one full-height block — both of which
         * read as a broken chart rather than as the honest "there is only one
         * number here". The headline above already says what that number is.
         *
         * "TODAY" USED TO BE THE STOCK EXAMPLE HERE and no longer reaches it:
         * a window of two days or fewer is bucketed by HOUR, so Today and
         * Yesterday arrive with a couple of dozen points. What still lands here
         * is the genuinely single reading — an `all` window on a young
         * workspace, or a row the engine has not recomputed yet.
         */
        (chart === "line" || chart === "area" || chart === "bar") && (w.series?.length ?? 0) < 2
        ? stale
          ? `This ${chartLabel} hasn’t been recomputed since periods started carrying their own buckets — press Refresh all above.`
          : `Only one point in this period — ${anChart} needs at least two.`
      : (chart === "category" || chart === "pie") && !hasGroups
        ? "No breakdown in this period."
        : chart === "pie" && !(w.groups ?? []).some((g) => g.value > 0)
          ? /**
             * A PIE OF NOTHING-ABOVE-ZERO. `pieSlices` excludes non-positive
             * values — a share of a negative is not a thing — so a breakdown
             * of refunds alone left the mark area blank, with the reason
             * exiled to the footnote, slipping past `ChartFrame`'s guarantee
             * that a blocked state REPLACES the mark rather than emptying it.
             */
            "Nothing above zero to divide into shares."
          : chart === "progress" && !(target != null && target > 0)
            ? /**
               * A GOAL OF ZERO IS NOT A GOAL. `target == null` alone let a
               * mistyped 0 through to `GoalBar`, whose own `target > 0` guard
               * then reported 0% however large the number — a bar of progress
               * against nothing, indistinguishable from an honest zero.
               */
              target == null
              ? "No goal set — add one in the tile’s settings."
              : "A goal of zero has nothing to progress toward."
          : (chart === "funnel" || chart === "pipeline") && !w.funnel
            ? "Only a funnel metric can be drawn this way."
            : chart === "table" && !hasSeries && !hasGroups
              ? "Nothing to list in this period."
              : undefined;

  const delta =
    chart === "number" && config.showDelta !== false ? deriveDelta(stored, { ...stored, ...w }, rangeKey) : null;

  /**
   * THE LEGEND IS GONE, AND SO IS THE ARITHMETIC THAT BUILT IT.
   *
   * Both 8 September frames put one on the card's floor (nodes 58:6094,
   * 58:6157, 35:7205): a dot in the series' colour and the period it covers.
   * It was one entry, because one series is drawn, with a second appearing
   * only when `w.compare` actually carried a second line — that care is why it
   * never named a series that was not there.
   *
   * The owner asked it out on 11 Sep 2026 so the chart could have the space.
   * The cost was always higher than it looked: the one entry read "Last 7
   * days", which repeats the range control two rows above it, and its swatch
   * pointed at the only mark on the card.
   *
   * `w.compare` IS STILL DRAWN — this deleted the label, not the line. See
   * `comparable` at the mark itself.
   */

  const tableRows = hasSeries
    ? w.series!.map((p) => ({ label: bucketLabel(p.bucket, unit), value: fmt(p.value) }))
    : (w.groups ?? []).map((g) => ({ label: g.label, value: fmt(g.value) }));

  /** This tile is drawing a composition, and it worked. */
  const composed = composeNotes.length > 0;

  /**
   * A COMPOSED PIE ROLLS UP NOTHING, and `limit` is how that is enforced.
   *
   * `pieSlices` caps at `limit` and folds the overflow into a slice it names
   * "Other" — which is exactly the label composition already used for its
   * arithmetic residual. Two different remainders under one name, both painted
   * the palette's reserved grey, is the one outcome the 5-part cap exists to
   * make impossible; handing it the actual row count closes the other half.
   *
   * The panel additionally hides the `limit` control on a composed pie, because
   * a setting whose value is overridden here would be a control that lies.
   */
  const pieLimit = composed ? (w.groups?.length ?? 6) : (config.limit ?? 6);

  const footer =
    chart === "category"
      ? groupsFooter(w.groups ?? [], config.limit)
      : /**
         * A COMPOSED PIE SPEAKS THROUGH ITS NOTES INSTEAD. `pieFooter` reports
         * a top-N roll-up and a count of non-positive rows; composition has no
         * roll-up, refuses on a negative part, and already names a zero one.
         * Printing both would say the same thing twice and contradict itself
         * about "Other".
         */
        chart === "pie" && !composed
        ? pieFooter(w.groups ?? [], config.limit ?? 6)
        : null;

  return (
    <ChartFrame
      title={title}
      /* A scorecard is just the number, so naming it adds nothing; every mark
         that DRAWS something says which drawing it is. */
      /**
       * THE CHART LABEL YIELDS BEFORE THE METRIC'S NAME DOES.
       *
       * Two tiles of one metric drawn two ways carry the same title and the
       * same number, so naming the drawing is what tells them apart — but only
       * once the NAME is legible. On a narrow tile the pair shared one line and
       * the name lost, which is how a card ended up headed "PICK…".
       *
       * `cols` is this tile's width in grid columns and is already in hand, so
       * the qualifier simply stands down below four of them. A scorecard names
       * no drawing at all: it is just the number, so saying "number" adds
       * nothing.
       */
      chartLabel={chart === "number" || cols < 4 ? undefined : (CHARTS.find((c) => c.id === chart) ?? CHARTS[0]).label}
      rangeLabel={rangeLabel}
      /* A funnel, a pipeline and a table have no single figure to head. */
      headline={
        chart === "funnel" || chart === "pipeline" || chart === "table" ? undefined : w.unavailable ? null : fmt(w.value)
      }
      delta={delta ? <Delta current={delta.current} previous={delta.previous} format={bag} since={delta.since} /> : null}
      status={source.kind === "flow" ? source.status : undefined}
      unavailable={w.unavailable}
      emptyReason={emptyReason}
      error={source.kind === "flow" ? source.error : undefined}
      flowId={source.kind === "flow" ? source.flowId : undefined}
      unpublished={source.kind === "flow" ? source.unpublished : undefined}
      importing={source.kind === "flow" ? source.importing : undefined}
      footer={
        <>
          {footer && <ChartFooter>{footer}</ChartFooter>}
          {/* THE COMPOSED DISCLOSURES DO NOT RENDER HERE ANY MORE — the owner's
              call on 11 Sep 2026, and the screenshot that prompted it makes the
              case better than an argument would: three stacked sentences under a
              three-stage pipeline on a four-column card, taking more of the tile
              than the mark and pushing the last stage's bar under the fold.
              Prose that crowds out the chart it is qualifying has stopped
              qualifying anything.

              THE SENTENCES ARE NOT DELETED, they moved to where they cost no
              pixels: `title` on the mark itself (hover, and read out by screen
              readers), and the settings panel, which is where a composition is
              built and therefore where "these stages are not a cohort" is
              actually actionable.

              WHAT STILL CANNOT BE TURNED OFF is the REFUSAL. A composition that
              would mislead does not draw at all — `compose.ts` returns a
              sentence instead of a chart, and that sentence replaces the mark
              rather than sitting under it. The disclosures were only ever for
              charts honest enough to draw; the guarantee lives in the refusal,
              not in the footnote. */}
          {!w.unavailable && undated > 0 && (
            <p className="mt-2 text-xs text-warn-ink">
              {/* ONE STRING, NO JSX TEXT NODES AT ALL — and that is not
                  fussiness, it is the second fix for this sentence.

                  It shipped as "3 records carryno date". The first repair kept
                  an expression next to wrapped prose and asserted the rendered
                  output, which PASSED under vitest and stayed broken in the
                  browser: esbuild keeps the space that begins a text node on
                  the same line as the expression before it, and Next's SWC
                  transform drops it. A test cannot arbitrate that — it runs
                  under the transform that agrees with it.

                  So the sentence does not ask. Nothing here is a JSX text node,
                  so no transform gets an opinion about its whitespace. */}
              {`${undated === 1 ? "1 record carries" : `${undated} records carry`} no date in this metric’s time reference — counted in All time, in no period.`}
            </p>
          )}
        </>
      }
    >
      <ChartHover>
        {chart === "number" ? (
          <>
            {config.showSpark && hasSeries && <Sparkline series={w.series!} accent={accent} unit={unit} pad={pad} />}
            {config.showGoal && target != null && <GoalBar value={w.value ?? 0} target={target} format={bag} />}
          </>
        ) : chart === "line" || chart === "area" ? (
          <LineChart
            series={w.series!}
            compare={w.compare}
            format={bag}
            accent={accent}
            unit={unit}
            pad={pad}
            area={chart === "area"}
            target={config.showGoal ? target : null}
          />
        ) : chart === "bar" ? (
          <BarsVertical
            series={w.series!}
            format={bag}
            accent={accent}
            unit={unit}
            pad={pad}
            target={config.showGoal ? target : null}
            showLabels={config.showLabels}
          />
        ) : chart === "category" ? (
          <BarsHorizontal groups={w.groups!} format={bag} accent={accent} sort={config.sort} limit={config.limit} />
        ) : chart === "pie" ? (
          <div className="flex min-h-0 flex-1 flex-col" title={composeNotes.join("\n") || undefined}>
            <PieChart
              groups={w.groups!}
              format={bag}
              donut={config.donut}
              limit={pieLimit}
              legend={config.legend ?? (cols >= 5 ? "right" : "bottom")}
            />
          </div>
        ) : chart === "progress" ? (
          <GoalBar value={w.value ?? 0} target={target!} format={bag} />
        ) : chart === "funnel" ? (
          /* THE DISCLOSURES, COSTING NO PIXELS. They used to be three stacked
             paragraphs under the mark; `title` keeps every word reachable — on
             hover, and to a screen reader — without taking a single row from the
             chart. Joined with newlines because a native tooltip honours them. */
          <div className="min-h-0 flex-1 overflow-y-auto quiet-scroll" title={composeNotes.join("\n") || undefined}>
            <FunnelView result={w.funnel!} composed={composed} />
          </div>
        ) : chart === "pipeline" ? (
          <div className="flex min-h-0 flex-1 flex-col" title={composeNotes.join("\n") || undefined}>
            <Pipeline result={w.funnel!} accent={accent} composed={composed} cols={cols} />
          </div>
        ) : chart === "table" ? (
          <ChartTable head={[hasSeries ? "Period" : "Group", "Value"]} rows={tableRows} />
        ) : null}
      </ChartHover>
    </ChartFrame>
  );
}

export type { ChartId };
