import type { ReactNode } from "react";
import { formatMetricValue } from "@/lib/format";
import { bucketLabel, niceTicks, padSeries, type BucketUnit } from "@/lib/board/scale";
import type { ChartFormat, SeriesPoint } from "@/components/charts";

/**
 * THE CARTESIAN MARKS — line, area and vertical bars, over one axis grid.
 *
 * GEOMETRY IN SVG, TEXT IN HTML, and that split is the whole layout decision.
 * A tile is resized by dragging its corner, from three rows to twenty, and the
 * card does not re-render while that happens — so the mark cannot know its
 * pixel size. Two options survive that: a fixed viewBox scaled to fit, which
 * makes the axis labels grow with the box until a tall tile is shouting; or a
 * stretched viewBox with the text OUTSIDE it. The second is what a chart
 * actually wants — strokes stay 1px via `vector-effect="non-scaling-stroke"`,
 * every label is device-crisp at every size, and CSS ellipsis works because
 * the labels are spans rather than `<text>`.
 *
 * The frame is `grid-cols-[auto_1fr] grid-rows-[1fr_auto]`: the y-gutter takes
 * its intrinsic width (so "$1.5M" and "44" each get exactly what they need,
 * with no guessing), the plot takes the rest, and the x-labels sit under the
 * plot only — indented past the gutter by the grid itself rather than by a
 * hardcoded padding that would drift from it.
 *
 * EVERY AXIS LABEL GOES THROUGH `formatMetricValue`, so a duration axis reads
 * "2h 10m" rather than 7800 and a currency axis carries its symbol. An axis
 * that disagrees with the headline above it is two claims about one number.
 */

const AXIS_LABEL = "tnum whitespace-nowrap text-micro leading-none text-muted-foreground";

/** Where a value sits in the plot, as a percentage from the TOP. */
const yPct = (v: number, lo: number, hi: number) => (hi === lo ? 100 : ((hi - v) / (hi - lo)) * 100);

function AxisFrame({
  ticks,
  format,
  labels,
  children,
}: {
  ticks: number[];
  format: ChartFormat;
  labels: string[];
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-2">
      {/* The gutter, top tick first — reversed so the largest reads at the top,
          which is where it is drawn. */}
      <div className="flex flex-col justify-between pb-px text-right">
        {[...ticks].reverse().map((t) => (
          <span key={t} className={AXIS_LABEL}>
            {formatMetricValue(t, format)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0">{children}</div>
      <span aria-hidden />
      {/* First, middle and last. Three is what fits at the narrowest tile the
          grid allows, and the server cannot measure to promise more. */}
      <div className="mt-1 flex justify-between gap-2 overflow-hidden">
        {labels.map((l, i) => (
          <span key={`${l}-${i}`} className={AXIS_LABEL}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** First / middle / last, deduped — two buckets should not print three labels. */
function edgeLabels(buckets: string[], unit?: BucketUnit): string[] {
  if (buckets.length === 0) return [];
  const idx = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
  return idx.map((i) => bucketLabel(buckets[i], unit));
}

function Gridlines({ ticks, lo, hi }: { ticks: number[]; lo: number; hi: number }) {
  return (
    <>
      {ticks.map((t) => (
        <line
          key={t}
          x1="0"
          x2="100"
          y1={yPct(t, lo, hi)}
          y2={yPct(t, lo, hi)}
          // The zero line is the one you read magnitude against, so it is a
          // shade heavier than the rest.
          stroke={t === 0 ? "var(--color-neutral-300)" : "var(--color-border)"}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

/**
 * A LINE, OR AN AREA UNDER IT.
 *
 * Missing buckets break the path into subpaths rather than diving to the floor
 * — see `padSeries`. That is the difference between "nothing happened on the
 * Tuesday" and "the metric collapsed on the Tuesday", and only one of them is
 * a claim the data supports.
 */
export function LineChart({
  series,
  format,
  accent,
  unit,
  area = false,
  target,
}: {
  series: SeriesPoint[];
  format: ChartFormat;
  accent: string;
  unit?: BucketUnit;
  area?: boolean;
  target?: number | null;
}) {
  const points = padSeries(series, unit);
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  // The target bounds the axis in BOTH directions. Folded into the max alone,
  // a negative goal put the dashed line 250% below the viewBox — invisible,
  // with nothing to say the goal existed.
  const { ticks, lo, hi } = niceTicks(Math.min(...values, target ?? Infinity), Math.max(...values, target ?? -Infinity));
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);

  /**
   * One `M` per unbroken run, so a gap is a gap.
   *
   * A NEW RUN OPENS WITH A ZERO-LENGTH SEGMENT — `M p L p`, not `M p` — and
   * that is not decoration. An isolated bucket is a run of ONE, and a lone
   * `moveto` is never stroked by any SVG renderer: a series of alternate days
   * drew a completely blank plot. The zero-length line picks up
   * `stroke-linecap="round"` and reads as the dot it should always have been,
   * and costs a multi-point run nothing but a repeated first coordinate.
   */
  const runs: string[] = [];
  let open = false;
  points.forEach((p, i) => {
    if (p.value == null) {
      open = false;
      return;
    }
    const at = `${x(i)} ${yPct(p.value, lo, hi)}`;
    runs.push(open ? `L ${at}` : `M ${at} L ${at}`);
    open = true;
  });

  /**
   * The fill is closed to the zero line, not to the bottom of the box: an area
   * hanging under a negative value should hang from zero.
   *
   * ONE POLYGON PER RUN, for the same reason the stroke breaks into subpaths.
   * A single polygon over the non-null points ran the fill straight across
   * every quiet bucket — a confident filled shape covering days that have no
   * data, under a line that had honestly broken. That is precisely the claim
   * `padSeries` exists to prevent, told in a different colour.
   */
  const base = yPct(Math.max(lo, Math.min(hi, 0)), lo, hi);
  const areaRuns: string[] = [];
  let run: Array<{ i: number; v: number }> = [];
  const flush = () => {
    if (run.length > 0) {
      const pts = run.map((r) => `L ${x(r.i)} ${yPct(r.v, lo, hi)}`).join(" ");
      areaRuns.push(`M ${x(run[0].i)} ${base} ${pts} L ${x(run[run.length - 1].i)} ${base} Z`);
    }
    run = [];
  };
  points.forEach((p, i) => (p.value == null ? flush() : run.push({ i, v: p.value })));
  flush();

  return (
    <AxisFrame ticks={ticks} format={format} labels={edgeLabels(points.map((p) => p.bucket), unit)}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <Gridlines ticks={ticks} lo={lo} hi={hi} />
        {area && areaRuns.length > 0 && <path d={areaRuns.join(" ")} fill={accent} fillOpacity={0.12} />}
        {target != null && (
          <line
            x1="0"
            x2="100"
            y1={yPct(target, lo, hi)}
            y2={yPct(target, lo, hi)}
            stroke="var(--color-neutral-400)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={runs.join(" ")}
          fill="none"
          stroke={accent}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* A one-point series has no line to draw, so it draws its point. */}
        {points.length === 1 && points[0].value != null && (
          <circle cx="50" cy={yPct(points[0].value, lo, hi)} r="2" fill={accent} vectorEffect="non-scaling-stroke" />
        )}
        {/* Invisible hit bands — deliberately the full plot height and fatter
            than the mark, because pointing at a 1.5px line is not a thing
            anyone should be asked to do. */}
        {points.map((p, i) => (
          <rect
            key={p.bucket}
            x={points.length === 1 ? 0 : Math.max(0, x(i) - 50 / (points.length - 1))}
            y="0"
            width={points.length === 1 ? 100 : 100 / (points.length - 1)}
            height="100"
            fill="transparent"
            data-tip={`${bucketLabel(p.bucket, unit)} · ${p.value == null ? "no data" : formatMetricValue(p.value, format)}`}
          />
        ))}
      </svg>
    </AxisFrame>
  );
}

/**
 * VERTICAL BARS, ANCHORED AT ZERO — `niceTicks` guarantees the axis includes
 * it, so a bar's height is its magnitude rather than its distance from an
 * arbitrary floor. Flat tops: a rounded cap is a radius measured against the
 * bar's WIDTH, and twelve buckets across a wide tile renders as a row of domes
 * (the lesson `Sparkbars` carries in its own comment).
 */
export function BarsVertical({
  series,
  format,
  accent,
  unit,
  target,
  showLabels = false,
}: {
  series: SeriesPoint[];
  format: ChartFormat;
  accent: string;
  unit?: BucketUnit;
  target?: number | null;
  showLabels?: boolean;
}) {
  const points = padSeries(series, unit);
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  // The target bounds the axis in BOTH directions. Folded into the max alone,
  // a negative goal put the dashed line 250% below the viewBox — invisible,
  // with nothing to say the goal existed.
  const { ticks, lo, hi } = niceTicks(Math.min(...values, target ?? Infinity), Math.max(...values, target ?? -Infinity));
  const zero = yPct(Math.max(lo, Math.min(hi, 0)), lo, hi);
  const slot = 100 / points.length;

  return (
    <AxisFrame ticks={ticks} format={format} labels={edgeLabels(points.map((p) => p.bucket), unit)}>
      <div className="absolute inset-0">
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <Gridlines ticks={ticks} lo={lo} hi={hi} />
          {points.map((p, i) => {
            // A null slot draws NOTHING — the gap is the rendering.
            if (p.value == null) return null;
            const y = yPct(p.value, lo, hi);
            return (
              <rect
                key={p.bucket}
                x={i * slot + slot * 0.15}
                width={slot * 0.7}
                y={Math.min(y, zero)}
                height={Math.max(0.5, Math.abs(zero - y))}
                fill={accent}
              />
            );
          })}
          {target != null && (
            <line
              x1="0"
              x2="100"
              y1={yPct(target, lo, hi)}
              y2={yPct(target, lo, hi)}
              stroke="var(--color-neutral-400)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.bucket}`}
              x={i * slot}
              y="0"
              width={slot}
              height="100"
              fill="transparent"
              data-tip={`${bucketLabel(p.bucket, unit)} · ${p.value == null ? "no data" : formatMetricValue(p.value, format)}`}
            />
          ))}
        </svg>
        {/* Value labels ride ABOVE the SVG in HTML, so they stay crisp and
            unstretched. Bucket count, not pixel width, decides whether they
            fit — the server cannot measure, and twelve is where they collide
            at the narrowest tile the grid allows. */}
        {showLabels && points.length <= 12 && (
          <div className="pointer-events-none absolute inset-0">
            {points.map((p, i) =>
              p.value == null ? null : (
                <span
                  key={`lab-${p.bucket}`}
                  className={`absolute -translate-x-1/2 -translate-y-full ${AXIS_LABEL}`}
                  style={{ left: `${i * slot + slot / 2}%`, top: `${Math.min(yPct(p.value, lo, hi), zero)}%` }}
                >
                  {formatMetricValue(p.value, format)}
                </span>
              ),
            )}
          </div>
        )}
      </div>
    </AxisFrame>
  );
}
