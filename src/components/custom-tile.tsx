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
import { asChartId, chartsFor, shapeOfClassic, shapeOfTile, type ChartId } from "@/lib/board/charts";
import { accentOf, type TileConfig } from "@/lib/board/tile-config";
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
  value?: number;
  series?: SeriesPoint[];
  groups?: GroupRow[];
  byRange?: Record<
    string,
    { value?: number; series?: SeriesPoint[]; groups?: GroupRow[]; unavailable?: string; undated?: number }
  >;
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
    }
  | { kind: "classic"; result: AggregateResult | FunnelResult | null; target: number | null };

/** What every mark below reads, whichever source it came from. */
type Windowed = {
  value?: number;
  series?: SeriesPoint[];
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
    <Card variant="surface" className="flex h-full flex-col p-4">
      <p className="truncate text-small font-semibold text-muted-foreground">{title}</p>
      <div className="mt-3 flex flex-1 flex-col items-start justify-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-tiny font-semibold text-warn-ink">
          <AlertTriangle size={13} />
          Metric unavailable
        </span>
        <p className="text-tiny text-muted-foreground">
          It isn&rsquo;t published any more. Publish it again, or point this tile at another metric.
        </p>
      </div>
    </Card>
  );
}

export function CustomTile({
  chart: rawChart,
  title,
  rangeKey,
  source,
  config = {},
  cols = 6,
}: {
  chart: string;
  title: string;
  rangeKey: string;
  source: CustomTileSource | null;
  /** The tile's presentation. Facts stay with the metric; these are choices. */
  config?: TileConfig;
  /** The tile's width in grid columns — only the pie's legend side reads it. */
  cols?: number;
}) {
  if (!source) return <DeadTile title={title} />;
  const chart = asChartId(rawChart);
  const accent = accentOf(config.color);

  // ── normalise both sources to one shape ───────────────────────────────────
  const stored: StoredTile = source.kind === "flow" ? ((source.tile ?? {}) as StoredTile) : {};
  let w: Windowed;
  let legal: boolean;
  let bag: ChartFormat;
  let target: number | null;

  if (source.kind === "flow") {
    const slot = stored.byRange?.[rangeKey];
    const missing = stored.byRange != null && slot == null;
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

  const unit = stored.timeUnit as BucketUnit | undefined;
  const fmt = (v?: number) => formatMetricValue(v, bag);
  const hasSeries = (w.series?.length ?? 0) > 0;
  const hasGroups = (w.groups?.length ?? 0) > 0;
  const undated = w.undated ?? 0;

  /**
   * WHY THIS PERIOD HAS NOTHING TO DRAW — distinct from "can't answer", and
   * distinct again from "this metric can never be drawn this way". Three
   * different facts, three different sentences, none of them a blank box.
   */
  const emptyReason = !legal
    ? "This metric can’t be drawn this way — change the chart."
    : (chart === "line" || chart === "area" || chart === "bar") && !hasSeries
      ? "No trend in this period."
      : (chart === "category" || chart === "pie") && !hasGroups
        ? "No breakdown in this period."
        : chart === "progress" && target == null
          ? "No goal set — add one in the tile’s settings."
          : (chart === "funnel" || chart === "pipeline") && !w.funnel
            ? "Only a funnel metric can be drawn this way."
            : chart === "table" && !hasSeries && !hasGroups
              ? "Nothing to list in this period."
              : undefined;

  const delta =
    chart === "number" && config.showDelta !== false ? deriveDelta(stored, { ...stored, ...w }, rangeKey) : null;

  const tableRows = hasSeries
    ? w.series!.map((p) => ({ label: bucketLabel(p.bucket, unit), value: fmt(p.value) }))
    : (w.groups ?? []).map((g) => ({ label: g.label, value: fmt(g.value) }));

  const footer =
    chart === "category"
      ? groupsFooter(w.groups ?? [], config.limit)
      : chart === "pie"
        ? pieFooter(w.groups ?? [], config.limit ?? 6)
        : null;

  return (
    <ChartFrame
      title={title}
      /* A funnel, a pipeline and a table have no single figure to head. */
      headline={
        chart === "funnel" || chart === "pipeline" || chart === "table" ? undefined : w.unavailable ? null : fmt(w.value)
      }
      delta={delta ? <Delta current={delta.current} previous={delta.previous} format={bag} since={delta.since} /> : null}
      status={source.kind === "flow" ? source.status : undefined}
      computedAt={source.kind === "flow" ? source.computedAt : undefined}
      unavailable={w.unavailable}
      emptyReason={emptyReason}
      error={source.kind === "flow" ? source.error : undefined}
      flowId={source.kind === "flow" ? source.flowId : undefined}
      unpublished={source.kind === "flow" ? source.unpublished : undefined}
      importing={source.kind === "flow" ? source.importing : undefined}
      footer={
        <>
          {footer && <ChartFooter>{footer}</ChartFooter>}
          {!w.unavailable && undated > 0 && (
            <p className="mt-2 text-tiny text-warn-ink">
              {/* The whole subject-and-verb is ONE string, not three ternaries
                  spliced between text nodes. JSX drops the whitespace around an
                  expression when the surrounding text wraps, and it shipped
                  "3 records carryno date" — invisible to every source-text
                  assertion, caught by looking at the page. */}
              {undated === 1 ? "1 record carries" : `${undated} records carry`} no date in this metric&rsquo;s time
              reference — counted in All time, in no period.
            </p>
          )}
        </>
      }
    >
      <ChartHover>
        {chart === "number" ? (
          <>
            {config.showSpark && hasSeries && <Sparkline series={w.series!} accent={accent} unit={unit} />}
            {config.showGoal && target != null && <GoalBar value={w.value ?? 0} target={target} format={bag} />}
          </>
        ) : chart === "line" || chart === "area" ? (
          <LineChart
            series={w.series!}
            format={bag}
            accent={accent}
            unit={unit}
            area={chart === "area"}
            target={config.showGoal ? target : null}
          />
        ) : chart === "bar" ? (
          <BarsVertical
            series={w.series!}
            format={bag}
            accent={accent}
            unit={unit}
            target={config.showGoal ? target : null}
            showLabels={config.showLabels}
          />
        ) : chart === "category" ? (
          <BarsHorizontal groups={w.groups!} format={bag} accent={accent} sort={config.sort} limit={config.limit} />
        ) : chart === "pie" ? (
          <PieChart
            groups={w.groups!}
            format={bag}
            donut={config.donut}
            limit={config.limit ?? 6}
            legend={config.legend ?? (cols >= 5 ? "right" : "bottom")}
          />
        ) : chart === "progress" ? (
          <GoalBar value={w.value ?? 0} target={target!} format={bag} />
        ) : chart === "funnel" ? (
          <div className="min-h-0 flex-1 overflow-y-auto quiet-scroll">
            <FunnelView result={w.funnel!} />
          </div>
        ) : chart === "pipeline" ? (
          <Pipeline result={w.funnel!} accent={accent} />
        ) : chart === "table" ? (
          <ChartTable head={[hasSeries ? "Period" : "Group", "Value"]} rows={tableRows} />
        ) : null}
      </ChartHover>
    </ChartFrame>
  );
}

export type { ChartId };
