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
}: {
  series: SeriesPoint[];
  accent: string;
  unit?: BucketUnit;
}) {
  const points = padSeries(series, unit);
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
  points.forEach((p, i) => {
    if (p.value == null) {
      open = false;
      return;
    }
    // `M p L p`, not `M p` — a lone moveto is never stroked, so an isolated
    // bucket vanished. See `LineChart`, which had the same bug.
    const at = `${x(i)} ${y(p.value)}`;
    runs.push(open ? `L ${at}` : `M ${at} L ${at}`);
    open = true;
  });

  return (
    <svg className="mt-3 h-8 w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <path
        d={runs.join(" ")}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The goal bar, in the kit's own colours — success once the goal is met,
 * because that is the one moment the tile has good news to give.
 */
export function GoalBar({ value, target, format }: { value: number; target: number; format: ChartFormat }) {
  const pct = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  const met = value >= target && target > 0;
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${met ? "bg-success" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 flex items-baseline justify-between text-tiny text-muted-foreground">
        <span>Goal {formatMetricValue(target, format)}</span>
        <span className="tnum">{Math.round(pct)}%</span>
      </p>
    </div>
  );
}
