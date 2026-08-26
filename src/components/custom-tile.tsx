import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetricValue, relativeTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Delta, GroupBars, Sparkbars, TargetBar } from "@/components/charts";
import { FunnelView } from "@/components/funnel-view";
import { asChartId, chartsFor, shapeOfClassic, shapeOfTile, type ChartId } from "@/lib/board/charts";
import type { AggregateResult, FunnelResult } from "@/lib/metrics/compute";

/**
 * ONE CHART ON A CUSTOM VIEW — and the first tile in this product that draws
 * what it was ASKED to draw.
 *
 * `FlowTile` picks its mark from data presence: series, then groups, then
 * target, then nothing. That is right for the groups board, where nobody chose
 * a chart and the tile is doing its best with what it has. It is wrong here,
 * where choosing the chart is the entire interaction — so this branches on
 * `chart` and on nothing else.
 *
 * The consequence is that this component can be asked for a drawing the data
 * cannot support, which `FlowTile` never could. It says so rather than
 * substituting: a bar chart over a metric with no trend renders "No trend in
 * this period", never the number, never a different mark. Silently drawing
 * something else is the exact failure the whole feature exists to correct, and
 * it would be worse here than in `FlowTile` because here someone explicitly
 * asked.
 *
 * A SERVER COMPONENT, like `FlowTile`, and for the same reason: the data is a
 * stored `flow_results` row or a live classic compute, both server-side. It is
 * rendered on the page and handed to the client board as an opaque `node`.
 */

/** The stored tile's shape, as much of it as a chart reads. */
type StoredTile = {
  name?: string;
  format?: string;
  currency?: string;
  precision?: number;
  unit?: string;
  durationDisplay?: string;
  target?: number | null;
  value?: number;
  series?: Array<{ bucket: string; value: number }>;
  groups?: Array<{ label: string; value: number }>;
  byRange?: Record<
    string,
    {
      value?: number;
      series?: Array<{ bucket: string; value: number }>;
      groups?: Array<{ label: string; value: number }>;
      unavailable?: string;
    }
  >;
};

export type CustomTileSource =
  /** A published flow tile: a stored `flow_results` row, windowed per range. */
  | { kind: "flow"; tile: unknown; computedAt?: Date | string | null; status?: string }
  /**
   * A classic metric, computed LIVE for the active range on every render — so
   * unlike a flow tile it carries no `byRange` and needs no windowing here. It
   * is already the answer to the range the page was asked for.
   */
  | { kind: "classic"; result: AggregateResult | FunnelResult | null; target: number | null };

/**
 * A tile pointing at a metric that no longer exists.
 *
 * It keeps its box and says so, rather than vanishing. A placement on the
 * groups board is filtered away silently when its metric goes, and that is
 * right there — nobody positioned it, it just sat in a column. Here somebody
 * chose this chart, put it in this spot and sized it, and a republish of the
 * flow brings the number straight back. Dropping it would lose all of that to
 * an edit the customer is probably halfway through.
 */
function DeadTile({ title }: { title: string }) {
  return (
    <Card variant="surface" className="flex h-full flex-col p-4">
      <p className="text-small font-semibold text-muted-foreground">{title}</p>
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

/** The empty state a chart draws when this period has nothing for it. */
function NoData({ reason }: { reason: string }) {
  return (
    <div className="flex flex-1 items-center">
      <p className="text-tiny text-muted-foreground" title={reason}>
        {reason.length > 160 ? `${reason.slice(0, 160)}…` : reason}
      </p>
    </div>
  );
}

export function CustomTile({
  chart: rawChart,
  title,
  rangeKey,
  source,
  rows = 6,
}: {
  chart: string;
  /** The tile's own name — the config override, or the metric's. */
  title: string;
  rangeKey: string;
  /** `null` when nothing on the board matches this tile's metric any more. */
  source: CustomTileSource | null;
  /**
   * The tile's height in grid rows, which is the only thing a mark needs to know
   * about its box: a breakdown dragged taller should show more groups rather
   * than the same four with more air around them.
   */
  rows?: number;
}) {
  if (!source) return <DeadTile title={title} />;
  const chart = asChartId(rawChart);

  if (source.kind === "classic") {
    const r = source.result;
    const funnel = r && "stages" in r ? r : null;
    const agg = r && "kind" in r ? r : null;
    const series = agg?.kind === "series" ? agg.series : undefined;
    /**
     * The classic engine's series carries no `total` — unlike a flow's, which
     * exists precisely because a consumer holding only buckets cannot recover
     * it — so the headline is the sum of the buckets. `MetricTile` does the
     * same arithmetic for the same reason.
     */
    const value = agg?.kind === "scalar" ? agg.value : series?.reduce((a, b) => a + b.value, 0);
    const legal = chartsFor(shapeOfClassic(r, source.target)).includes(chart);
    /** Classic tiles have no stored format bag; the legacy tile hardcodes this too. */
    const bag = { format: "number", precision: 2 } as const;

    return (
      <Card variant="surface" className="flex h-full flex-col p-4">
        <p className="truncate text-small font-semibold text-foreground">{title}</p>
        {chart !== "funnel" && (
          <p className={cn("stat-numeral mt-1.5 text-stat leading-none", value == null && "text-muted-foreground")}>
            {value == null ? "—" : formatMetricValue(value, bag)}
          </p>
        )}
        <div className="mt-2.5 flex flex-1 flex-col justify-center">
          {!legal ? (
            <NoData reason="This metric can’t be drawn this way — change the chart." />
          ) : chart === "funnel" && funnel ? (
            <div className="flex-1 overflow-y-auto">
              <FunnelView result={funnel} />
            </div>
          ) : chart === "bar" ? (
            series && series.length > 0 ? (
              <Sparkbars series={series} format={bag} className="h-full min-h-10" />
            ) : (
              <NoData reason="No trend in this period." />
            )
          ) : chart === "progress" ? (
            typeof source.target === "number" ? (
              <TargetBar value={value ?? 0} target={source.target} format={bag} />
            ) : (
              <NoData reason="No target set on this metric." />
            )
          ) : null}
        </div>
      </Card>
    );
  }

  const stored = (source.tile ?? {}) as StoredTile;
  /**
   * The three payload fields are swapped for the ACTIVE range's, exactly the
   * way `FlowTile` does it — the presentation fields (format, currency,
   * precision, target) always come from the stored tile, because they describe
   * the metric rather than the period.
   */
  const windowed = stored.byRange?.[rangeKey];
  const missing = stored.byRange != null && windowed == null;
  const unavailable =
    windowed?.unavailable ??
    (missing
      ? source.status === "error"
        ? "The last run of this flow failed."
        : "Not computed yet for this period — Refresh to compute it."
      : undefined);
  const t: StoredTile = windowed && !unavailable ? { ...stored, ...windowed } : stored;

  /**
   * Is the stored chart still a legal drawing of this METRIC? Not of this
   * period — see `shapeOfTile`. A quiet Tuesday must not turn a bar chart into
   * an error; it turns it into "no trend in this period", below.
   *
   * This is also what answers `funnel` on a flow tile. `shapeOfTile` never
   * reports one — `FunnelView` eats a classic `FunnelResult` and no flow shape
   * produces one — so the chart is simply illegal here and there is deliberately
   * no separate branch for it below. The picker cannot offer it either; the
   * state is only reachable by repointing a tile at a different metric.
   */
  const legal = chartsFor(shapeOfTile(stored)).includes(chart);
  const fmt = (v: number | undefined) => formatMetricValue(v, t);

  return (
    <Card variant="surface" className="flex h-full flex-col p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-small font-semibold text-foreground">{title}</p>
        {source.computedAt && (
          <span className="shrink-0 text-tiny text-muted-foreground">{relativeTime(new Date(source.computedAt))}</span>
        )}
      </div>

      {/* THE HEADLINE, on every chart but the funnel. A chart without its
          number makes you read a shape to learn a figure that was already
          known — every reference dashboard prints both. */}
      {chart !== "funnel" && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <p className={cn("stat-numeral text-stat leading-none", unavailable && "text-muted-foreground")}>
            {/* An em-dash, not a 0 — "no answer for this period" and "the
                answer is zero" are different facts. */}
            {unavailable ? "—" : fmt(t.value)}
          </p>
          {chart === "number" && !unavailable && typeof t.value === "number" && rangeKey === "today" && (
            <Delta current={t.value} previous={stored.byRange?.yesterday?.value ?? 0} format={t} since="yesterday" />
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-1 flex-col justify-center">
        {unavailable ? (
          <NoData reason={unavailable} />
        ) : !legal ? (
          /* The stored chart cannot draw this metric at all — the metric was
             repointed, or republished into a different shape. Say so and offer
             nothing; substituting a mark is the failure this file exists for. */
          <NoData reason="This metric can’t be drawn this way — change the chart." />
        ) : chart === "bar" ? (
          t.series && t.series.length > 0 ? (
            <Sparkbars series={t.series} format={t} className="h-full min-h-10" />
          ) : (
            <NoData reason="No trend in this period." />
          )
        ) : chart === "category" ? (
          t.groups && t.groups.length > 0 ? (
            <GroupBars groups={t.groups} total={t.value} format={t} show={Math.max(3, Math.floor(rows / 2))} />
          ) : (
            <NoData reason="No breakdown in this period." />
          )
        ) : chart === "progress" ? (
          typeof stored.target === "number" ? (
            <TargetBar value={t.value ?? 0} target={stored.target} format={t} />
          ) : (
            <NoData reason="No target set on this metric." />
          )
        ) : null}
      </div>
    </Card>
  );
}

/** Re-exported so the picker and the page agree on the vocabulary. */
export type { ChartId };
