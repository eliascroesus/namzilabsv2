import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/format";
import { padSeries, type BucketUnit } from "@/lib/board/scale";
import type { ChartFormat, SeriesPoint } from "@/components/charts";

/**
 * A SHAPE, NOT A READING.
 *
 * The sparkline under a scorecard has no axis, no labels and no ticks on
 * purpose: the number above it IS the reading, and this says only which way
 * the number has been going. Anything more would be a bar chart apologising
 * for being small. Gaps break it, exactly as they break the full line — see
 * `padSeries`.
 */
export function Sparkline({
  series,
  accent,
  unit,
  pad,
}: {
  series: SeriesPoint[];
  accent: string;
  unit?: BucketUnit;
  /** Period + fill, so the chart spans what the pill promises. See `padSeries`. */
  pad?: Parameters<typeof padSeries>[2];
}) {
  const points = padSeries(series, unit, pad);
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A one-point sparkline sits in the middle rather than dividing by zero.
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  // Not `niceTicks`: a sparkline has no axis to be honest about, and anchoring
  // a 95→100 run at zero would flatten it into a line with no shape at all.
  const y = (v: number) => (hi === lo ? 50 : 90 - ((v - lo) / (hi - lo)) * 80);

  const runs: string[] = [];
  let open = false;
  /** The newest bucket that was actually measured — see the dot below. */
  let latest: string | null = null;
  points.forEach((p, i) => {
    if (p.value == null) {
      open = false;
      return;
    }
    // `M p L p`, not `M p` — a lone moveto is never stroked, so an isolated
    // bucket vanished. See `LineChart`, which had the same bug.
    const at = `${x(i)} ${y(p.value)}`;
    runs.push(open ? `L ${at}` : `M ${at} L ${at}`);
    latest = at;
    open = true;
  });

  return (
    // `overflow-visible` for the dot alone: its centre sits ON the right edge
    // of the viewBox, and an SVG root clips at that edge by default — so half
    // the dot would be sliced off. The 2px it spills lands inside the tile's
    // own padding, where there is nothing to collide with.
    <svg className="mt-3 h-8 w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <path
        d={runs.join(" ")}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* WHERE THE LINE IS NOW. A shape says which way the number has been
          going; without a terminal mark it does not say which end is today,
          and a sparkline read backwards is worse than no sparkline.

          Drawn as a zero-length segment with a round cap rather than a
          `<circle>`, because `preserveAspectRatio="none"` stretches the
          viewBox and would render a circle as an ellipse — the same reason
          every stroke in this kit is `non-scaling`. A cap is a screen-space
          circle whatever the box does to the coordinates. */}
      {latest && (
        <path
          d={`M ${latest} L ${latest}`}
          fill="none"
          stroke={accent}
          strokeWidth="4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/**
 * The goal bar, in the kit's own colours — success once the goal is met,
 * because that is the one moment the tile has good news to give.
 *
 * SPELLED LIKE `TargetBar` IN charts.tsx, deliberately. That is the same bar
 * on the other board, and the two had drifted: this one ran a raw `brand-600`
 * fill over a grey `muted` track and set its whole caption in one muted grey,
 * while the legacy board tinted the track in the fill's own colour and gave
 * the percentage the weight. A customer with both boards open was looking at
 * one measurement drawn two ways.
 *
 * The track is the fill at 15% rather than neutral: a goal bar reads as "how
 * much of THIS", and a grey gutter makes the empty part look like a different
 * quantity from the full part.
 */
export function GoalBar({ value, target, format }: { value: number; target: number; format: ChartFormat }) {
  const pct = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  const met = value >= target && target > 0;
  return (
    <div className="mt-3">
      <div className={cn("h-1.5 w-full overflow-hidden rounded-full", met ? "bg-success/15" : "bg-primary/15")}>
        <div className={cn("h-full rounded-full", met ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      {/* The kit's micro-label voice for the word, the figure in tabular
          numerals beside it, and the percentage carrying the emphasis — it is
          the one number in this row that changes, and once it passes 100 it is
          also the good news. */}
      <p className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-baseline gap-1 text-muted-foreground">
          <span className="uppercase tracking-wide">Goal</span>
          <span className="tnum truncate">{formatMetricValue(target, format)}</span>
        </span>
        <span className={cn("tnum shrink-0 font-semibold", met ? "text-success-ink" : "text-foreground")}>
          {`${Math.round(pct)}%`}
        </span>
      </p>
    </div>
  );
}
