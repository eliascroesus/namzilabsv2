/**
 * THE CHART KIT'S ARITHMETIC — every number the marks draw from, computed here
 * and nowhere else.
 *
 * The `grid.ts` precedent, applied to a second geometry: pure functions, no
 * DOM, no `"use client"`, heavily tested, and deliberately the ONLY answer to
 * each question. When the arc, the legend and the tooltip each compute their
 * own share of a pie, they disagree by a rounding error and the chart reads as
 * broken; when `pieSlices` computes it once, they agree by construction.
 *
 * Two honesty rules live here rather than in the marks, so no mark can forget
 * them:
 *
 *   ZERO IS ALWAYS ON THE AXIS. A bar not anchored at zero lies about
 *   magnitude — a 4% dip drawn over a truncated axis looks like a collapse.
 *   `niceTicks` spans the data AND zero, whatever the data does.
 *
 *   A QUIET BUCKET IS A GAP, NOT A ZERO. The engine only emits buckets that
 *   had records, so a silent Tuesday is ABSENT from the series. For a count,
 *   zero would happen to be true; for an average it would be fabricated — so
 *   the one honest universal rendering is a hole: `padSeries` inserts
 *   null-valued slots, and a null breaks the line into subpaths rather than
 *   drawing a confident dive to the floor.
 */

/** The time units `bucketKey` in the engine can produce, spelled the same way. */
export type BucketUnit = "hour" | "day" | "week" | "month" | "quarter" | "year";

/**
 * THE STEPS A TIME AXIS MAY LAND ON, in SECONDS.
 *
 * A count axis steps on the decimal ladder — 1, 2, 2.5, 5 times a power of ten
 * — because that is what reads as round in base ten. Time is not base ten, and
 * running the decimal ladder over it produces steps like 1000 seconds, which
 * is 16 minutes 40 seconds: a round number of the wrong unit, and the reason
 * an axis read "0s / 16m 40s / 33m 20s".
 *
 * These are the boundaries a person actually thinks in. The ladder is coarse
 * on purpose past an hour: nobody reads a 45-minute gridline on a 12-hour
 * chart.
 */
const DURATION_TICK_STEPS_SEC = [
  1, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1_800,
  3_600, 7_200, 10_800, 21_600, 43_200,
  86_400, 172_800, 604_800,
];

/**
 * The same ladder expressed in whatever unit the VALUES are in, so a metric
 * stored in minutes and one stored in seconds snap to the same wall-clock
 * boundaries. An unrecognised unit falls back to the decimal ladder rather
 * than guessing — see `formatDuration`, which takes the same position.
 */
export function durationTickSteps(valueUnit: string): number[] | undefined {
  const per: Record<string, number> = { seconds: 1, minutes: 60, hours: 3_600, days: 86_400 };
  const p = per[valueUnit];
  return p == null ? undefined : DURATION_TICK_STEPS_SEC.map((s) => s / p);
}

/**
 * Nice axis ticks covering `[min(0, lo), max(0, hi)]`.
 *
 * Steps snap to the {1, 2, 2.5, 5} × 10^n ladder by default, so an axis reads
 * 0 / 25 / 50 rather than 0 / 23.7 / 47.4 — or to an explicit ladder when the
 * caller has one, which is how a DURATION axis lands on 0 / 15m / 30m instead
 * of on a round number of the wrong unit. Degenerate inputs get a real axis
 * rather than a crash: an all-zero series spans [0, 1].
 */
export function niceTicks(
  lo: number,
  hi: number,
  count = 4,
  /**
   * An explicit ladder of allowed steps, ascending, in the values' own unit.
   * Omitted, the decimal ladder is used — which is right for every axis that
   * counts things and wrong for every axis that measures time.
   */
  steps?: number[],
): { ticks: number[]; lo: number; hi: number } {
  let min = Math.min(0, lo, hi);
  let max = Math.max(0, lo, hi);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  if (min === 0 && max === 0) max = 1;

  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = steps
    ? // Past the ladder's top, keep stepping by its largest rung rather than
      // collapsing to one tick: a 3-week duration axis is still readable at a
      // week per division, where a single step would draw no grid at all.
      (steps.find((s) => s >= raw) ?? steps[steps.length - 1] * Math.ceil(raw / steps[steps.length - 1]))
    : ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);

  const lo2 = Math.floor(min / step) * step;
  const hi2 = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Walk by index, not by accumulation — adding 0.25 forty times drifts.
  for (let i = 0; lo2 + i * step <= hi2 + step / 2; i++) ticks.push(round10(lo2 + i * step));
  return { ticks, lo: round10(lo2), hi: round10(hi2) };
}

/** Kill the 0.30000000000000004s a step of 0.1 produces. */
function round10(v: number): number {
  return Math.round(v * 1e10) / 1e10;
}

/**
 * Insert null-valued slots for the buckets the engine omitted.
 *
 * Only when the unit is KNOWN and every key parses — a categorical or
 * unrecognised series passes through untouched, because inventing gaps in a
 * sequence whose rhythm is unknown fabricates exactly what this exists to
 * prevent.
 */
/**
 * THE BUCKET A TIMESTAMP FALLS IN — the same spelling `bucketKey` uses in the
 * engine, which is what makes the two sets of keys comparable at all.
 *
 * Duplicated rather than imported: `engine.ts` is the whole flow runtime and
 * this runs in a client component. `tests/board-scale.test.ts` pins the two
 * against each other across every unit, so a divergence fails rather than
 * silently producing keys that never line up.
 */
export function bucketKeyOf(ms: number, unit: BucketUnit): string {
  const d = new Date(ms);
  const iso = d.toISOString();
  const y = d.getUTCFullYear();
  if (unit === "hour") return iso.slice(0, 13);
  if (unit === "year") return String(y);
  if (unit === "month") return iso.slice(0, 7);
  if (unit === "quarter") return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  if (unit === "week") {
    // ISO week, Thursday rule — the same arithmetic `isoWeek` does.
    const t = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return iso.slice(0, 10);
}

/**
 * FILL THE GAPS — and, when a window is given, fill out to its EDGES.
 *
 * Two separate honesty problems, one function:
 *
 *   WHERE THE CHART STARTS. The engine emits only buckets that had records, so
 *   a series began at the first record rather than at the start of the period:
 *   "Last 30 days" drew a chart starting eleven days in, which reads as the
 *   metric having been switched on then rather than as a month with a quiet
 *   first half. Given the window, the series is extended to cover it.
 *
 *   WHAT A QUIET BUCKET MEANS. `fill` is `null` by default and that stays the
 *   right universal answer — see the file header. But the caller sometimes
 *   KNOWS: a COUNT with no matching records counted zero, which is not a guess,
 *   and drawing it as a hole makes a line stop short of the floor it genuinely
 *   reaches. A ratio with no denominator is unknown and keeps its gap.
 *
 * Done here rather than in the engine deliberately. Seeding at materialize
 * would put thirty points per range into the stored jsonb — read on every
 * dashboard render and billed by the byte — and would only reach a tile after
 * its next recompute. This costs nothing stored and works on rows written
 * before it existed.
 */
export function padSeries(
  series: Array<{ bucket: string; value: number }>,
  unit?: BucketUnit,
  opts?: {
    /** What an absent bucket means. `null` is a hole; `0` is a measured zero. */
    fill?: number | null;
    /**
     * The period on screen, so the chart can span it. Omit for "all time".
     * Named `period`, not `window`: this module is pinned against touching
     * anything DOM-shaped, and `window.from` reads as the global to a scanner
     * that cannot know better — which is the scanner behaving correctly.
     */
    period?: { from: number; to: number };
  },
): Array<{ bucket: string; value: number | null }> {
  if (!unit) return series;
  const fill = opts?.fill ?? null;
  const steps = series.map((s) => bucketIndex(s.bucket, unit));
  if (steps.some((n) => n == null)) return series;

  let lo = steps.length > 0 ? steps[0]! : null;
  let hi = steps.length > 0 ? steps[steps.length - 1]! : null;
  /**
   * THE PERIOD STRETCHES A DAY GRID, BUT NOT A SUB-DAY ONE.
   *
   * Stretching to the window's end is what makes "Last 7 days" draw seven marks
   * when two of them saw nothing, and it is safe for a day grid because such a
   * window's final bucket has always STARTED — 7d and 30d end on today's.
   *
   * An hour grid inside a whole-day window does not have that property: today
   * runs to 23:59 while its series ends at the last hour that began, so
   * stretching would fill the rest of the afternoon with `fill` — which is `0`
   * for a count metric, i.e. a line falling to the floor for hours that have
   * not happened. The materializer already refuses to MEASURE those; this is
   * the same refusal at the render layer, and without it that one would be
   * undone here.
   *
   * The series' own end is the authority, not the clock: this runs inside a
   * client component that server-renders, and a `Date.now()` on that path
   * disagrees with itself across an hour boundary.
   */
  if (opts?.period && unit !== "hour") {
    const wLo = bucketIndex(bucketKeyOf(opts.period.from, unit), unit);
    const wHi = bucketIndex(bucketKeyOf(opts.period.to, unit), unit);
    if (wLo != null && wHi != null && wHi - wLo <= 400) {
      lo = lo == null ? wLo : Math.min(lo, wLo);
      hi = hi == null ? wHi : Math.max(hi, wHi);
    }
  }
  if (lo == null || hi == null) return series;
  // Past a screen's worth the gap says what it needs to as one, and a two-point
  // series years apart must not mint thousands of slots.
  if (hi - lo > 400) return series;

  const byIndex = new Map(series.map((s, i) => [steps[i]!, s.value]));
  const out: Array<{ bucket: string; value: number | null }> = [];
  for (let i = lo; i <= hi; i++) {
    const v = byIndex.get(i);
    out.push({ bucket: bucketAt(i, unit), value: v === undefined ? fill : v });
  }
  return out;
}

/** A bucket key as a monotone integer index in its unit, or null if unparseable. */
function bucketIndex(key: string, unit: BucketUnit): number | null {
  switch (unit) {
    case "hour": {
      const t = Date.parse(`${key}:00:00Z`);
      return Number.isFinite(t) ? Math.round(t / 3_600_000) : null;
    }
    case "day": {
      const t = Date.parse(`${key}T00:00:00Z`);
      return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
    }
    case "week": {
      const m = key.match(/^(\d{4})-W(\d{2})$/);
      return m ? Number(m[1]) * 53 + Number(m[2]) : null;
    }
    case "month": {
      const m = key.match(/^(\d{4})-(\d{2})$/);
      return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
    }
    case "quarter": {
      const m = key.match(/^(\d{4})-Q([1-4])$/);
      return m ? Number(m[1]) * 4 + (Number(m[2]) - 1) : null;
    }
    case "year": {
      const m = key.match(/^\d{4}$/);
      return m ? Number(key) : null;
    }
  }
}

/** The inverse of `bucketIndex`, for minting the gap slots' own keys. */
function bucketAt(index: number, unit: BucketUnit): string {
  switch (unit) {
    case "hour":
      return new Date(index * 3_600_000).toISOString().slice(0, 13);
    case "day":
      return new Date(index * 86_400_000).toISOString().slice(0, 10);
    case "week":
      return `${Math.floor(index / 53)}-W${String(index % 53).padStart(2, "0")}`;
    case "month":
      return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    case "quarter":
      return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
    case "year":
      return String(index);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The x-axis spelling of a bucket key — "Aug 24", "W34", "Aug '26", "Q3 '26",
 * "2026". en-US pinned like every formatter in the pipeline; an unrecognised
 * key falls back to itself, which is at least true.
 */
export function bucketLabel(bucket: string, unit?: BucketUnit): string {
  /**
   * `2026-09-10T14` -> `14:00`. The shape is tested as well as the unit, because
   * a slot stored before the hour rung existed carries no `unit` at all and a
   * raw ISO fragment on an axis is worse than reading the key.
   */
  if (unit === "hour" || (!unit && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(bucket))) {
    const m = bucket.match(/^\d{4}-\d{2}-\d{2}T(\d{2})$/);
    if (m) return `${m[1]}:00`;
  }
  if (unit === "day" || (!unit && /^\d{4}-\d{2}-\d{2}$/.test(bucket))) {
    const m = bucket.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (m) return `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}`;
  }
  if (unit === "week" || /^\d{4}-W\d{2}$/.test(bucket)) {
    const m = bucket.match(/^\d{4}-W(\d{2})$/);
    if (m) return `W${Number(m[1])}`;
  }
  if (unit === "month" || /^\d{4}-\d{2}$/.test(bucket)) {
    const m = bucket.match(/^(\d{4})-(\d{2})$/);
    if (m) return `${MONTHS[Number(m[2]) - 1]} '${m[1].slice(2)}`;
  }
  if (unit === "quarter" || /^\d{4}-Q[1-4]$/.test(bucket)) {
    const m = bucket.match(/^(\d{4})-(Q[1-4])$/);
    if (m) return `${m[2]} '${m[1].slice(2)}`;
  }
  return bucket;
}

/**
 * One pie wedge as an SVG path, radius `r` about the origin, angles in degrees
 * clockwise from 12 o'clock. A full circle is drawn as two half-arcs, because
 * an arc whose start and end coincide renders as nothing at all.
 */
export function arcPath(r: number, startDeg: number, endDeg: number): string {
  const span = Math.min(360, endDeg - startDeg);
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${round10(r * Math.cos(rad))} ${round10(r * Math.sin(rad))}`;
  };
  if (span >= 360) {
    return `M ${pt(0)} A ${r} ${r} 0 1 1 ${pt(180)} A ${r} ${r} 0 1 1 ${pt(360)} Z`;
  }
  const large = span > 180 ? 1 : 0;
  return `M 0 0 L ${pt(startDeg)} A ${r} ${r} 0 ${large} 1 ${pt(endDeg)} Z`;
}

export type PieSlice = { label: string; value: number; share: number; a0: number; a1: number };

/**
 * Groups → drawable slices: the cap, the "Other" roll-up, the shares and the
 * angles, in ONE place so the arc, the legend and the tooltip agree by
 * construction.
 *
 * Non-positive values are EXCLUDED AND COUNTED, never silently absorbed — a
 * share of a whole cannot be negative, and a pie that quietly eats a refund
 * column is a chart lying by omission. The caller prints the count.
 */
export function pieSlices(
  groups: Array<{ label: string; value: number }>,
  cap = 6,
): { slices: PieSlice[]; other: { count: number; value: number } | null; excluded: number; total: number } {
  const positive = groups.filter((g) => g.value > 0);
  const excluded = groups.length - positive.length;
  const total = positive.reduce((a, g) => a + g.value, 0);
  if (total <= 0) return { slices: [], other: null, excluded, total: 0 };

  const kept = positive.slice(0, cap);
  const rest = positive.slice(cap);
  const other = rest.length > 0 ? { count: rest.length, value: rest.reduce((a, g) => a + g.value, 0) } : null;

  const parts = [...kept.map((g) => ({ label: g.label, value: g.value })), ...(other ? [{ label: "Other", value: other.value }] : [])];
  let angle = 0;
  const slices = parts.map((p) => {
    const share = p.value / total;
    const a0 = angle;
    angle = round10(angle + share * 360);
    return { ...p, share, a0, a1: angle };
  });
  // Whatever floating point did on the way round, the circle closes.
  if (slices.length > 0) slices[slices.length - 1].a1 = 360;
  return { slices, other, excluded, total };
}

/**
 * FUNNEL STAGE WIDTHS — a share of the LARGEST stage, with no cap and no floor.
 *
 * It measured against the FIRST stage, clamped at 100 and floored at 4, and all
 * three of those were ways of lying about a length.
 *
 * THE CAP. A stage bigger than stage 1 asked for more than 100% and got exactly
 * 100% — pixel-identical to a stage that really is 100%. The owner's own board
 * drew 12 -> 38 -> 0 as TWO IDENTICAL FULL-WIDTH SLABS and a stub, under a
 * sentence apologising for the clip. A clamp on a length channel is a broken
 * axis wearing a different hat, and the fix was never a better apology.
 *
 * THE FLOOR. A zero stage got 4% of the track — manufactured ink for an empty
 * set, which on the centred variant read as a bullet floating under two slabs.
 * It existed so a decimated stage stayed hoverable; the ROW is the hit target,
 * so it bought nothing and cost the truth.
 *
 * SHARE OF FIRST. Of the funnel implementations surveyed — ECharts, nivo,
 * Recharts, Plotly, chartjs-chart-funnel, Metabase — every one normalises to the
 * MAXIMUM. Only PostHog normalises to the first, and it can afford to because
 * its query guarantees the counts descend. Ours does not: `computeFunnel` issues
 * one independent `count(distinct subject)` per stage with no sequencing, and
 * `composeFunnel` assembles separately published metrics counted over one
 * window. Any of them may be the biggest, and that is not a data error — a
 * booking this week against a lead created last month is the arithmetic being
 * honest.
 *
 * SHARE OF MAX IS SELF-CLAMPING, which is why one edit retires all three: no
 * value can exceed the track, so there is nothing to clip and nothing to
 * apologise for, and a zero is simply zero.
 *
 * A GENUINE FUNNEL IS UNCHANGED TO THE PIXEL, and that is the argument for the
 * swap rather than a happy accident: when the counts descend the first stage IS
 * the max, so both rules return the same numbers — [420, 252, 96, 41] draws
 * 100 / 60 / 22.9 / 9.8 either way. The new rule differs only where the old one
 * was lying.
 *
 * All zeroes return all zeroes rather than a row of phantom stubs; the caller
 * draws its empty state instead of a table of nothing.
 */
export function stageWidths(counts: number[]): number[] {
  const max = counts.reduce((m, c) => (c > m ? c : m), 0);
  return counts.map((c) => (max > 0 ? Math.max(0, round10((c / max) * 100)) : 0));
}

/**
 * THE FUNNEL AS ONE CONNECTED BODY — a polygon per stage, sides sloping from
 * this stage's width to the next one's, so the TAPER between two stages is the
 * drop rather than a gap between two bars.
 *
 * The mark used to be detached horizontal bars with a label line over each, and
 * the owner's verdict on that was blunt: it reads as a table, not as a funnel.
 * A pipeline is supposed to look like a pipeline. This is the shape every
 * funnel implementation surveyed actually draws — ECharts, nivo, Recharts,
 * chartjs-chart-funnel — and the reason they all draw it is that the SLOPE
 * carries the loss for free, in the space between the stages, where a bar chart
 * has nothing at all.
 *
 * THE SHOULDER IS WHY A STAGE STILL HAS A WIDTH YOU CAN READ. Each stage owns a
 * band; the first `shoulder` of that band is a straight-sided rectangle at the
 * stage's own width, and only the remainder slopes toward the next stage. Drop
 * the shoulder and the whole thing becomes a cone in which no single stage has a
 * definite width, so the numbers stop having a mark to belong to — this is
 * nivo's `shapeBlending` and chartjs-chart-funnel's clamped `shrinkFraction`,
 * and 0.55 sits where both of them default.
 *
 * TWO ALIGNMENTS, ONE GEOMETRY. `center` gives the symmetric silhouette a
 * "Pipeline" wants; `left` anchors every stage at x=0, which is what a "Funnel"
 * wants and is also the only form in which two stages can be compared by length
 * against a shared origin. They differ by one line, which is what stops the two
 * marks drifting apart the way they had already drifted over a 2%-vs-4% floor.
 *
 * THE LAST STAGE HAS A FLAT BOTTOM, at its own width. Recharts defaults to a
 * triangle and ECharts tapers to `minSize`; both manufacture a final drop that
 * is not in the data, which is a lie told by a default.
 *
 * Coordinates are a 0..100 box per axis with `preserveAspectRatio="none"` — the
 * `cartesian.tsx` idiom rather than the pie's aspect lock, and the distinction
 * matters: a pie locks aspect because ANGLE is its encoding and a squeezed
 * circle lies. Here the encoding is horizontal width only, so a non-uniform
 * stretch preserves every ratio exactly.
 */
export type FunnelBand = {
  /**
   * The stage's own polygon, as an SVG `points` list in a 0..100 box. The first
   * TWO points are its top edge, which is the stage's OWN width — everything
   * below them belongs to the transition into the next stage.
   */
  points: string;
  /** Band top and bottom, so a caller can place a hit target or a label. */
  y0: number;
  y1: number;
  /** This stage's width as a share of the largest, 0..100. */
  width: number;
  /** The band's own axis: 50 centred, 0 left-anchored. A zero stage's mark rides it. */
  cx: number;
  /** The next stage is WIDER, so this band's floor is a step rather than a slope. */
  rise: boolean;
};

export function funnelShape(
  counts: number[],
  opts: { align?: "center" | "left"; shoulder?: number } = {},
): FunnelBand[] {
  const { align = "center", shoulder = 0.55 } = opts;
  const widths = stageWidths(counts);
  const n = widths.length;
  if (n === 0) return [];
  const band = 100 / n;

  /**
   * The x pair for a given width. Centred, a stage spreads either side of 50;
   * left-anchored it starts at 0. Everything else about the polygon is the same,
   * which is the point of computing it here rather than in two components.
   */
  const edges = (w: number): [number, number] =>
    align === "center" ? [round10(50 - w / 2), round10(50 + w / 2)] : [0, round10(w)];

  return widths.map((w, i) => {
    const y0 = round10(i * band);
    const y1 = round10((i + 1) * band);
    const yk = round10(y0 + band * shoulder);
    const next = i === n - 1 ? w : widths[i + 1];
    const rise = next > w;
    /**
     * TAPER DOWN, STEP UP — and the asymmetry is the whole point.
     *
     * A FALL is drawn in the space between the two stages: the sides slope
     * inward and the slope IS the loss, which is what makes this a pipeline
     * rather than a stack of bars.
     *
     * A RISE must NOT slope outward, and the first version of this did. Sloping
     * out gives stage i a bottom edge as wide as stage i+1, so a stage that is
     * genuinely 31% of the largest ends its band at 100% and reads as reaching
     * full width — which is precisely the "two identical slabs" misreading this
     * whole redesign exists to kill, rebuilt in the geometry after being removed
     * from the arithmetic. Measured on the owner's own data: On Calendar is
     * 30.8% wide and its polygon floor was 100%.
     *
     * So a rising stage keeps its own width all the way down and the stage below
     * simply STARTS wider. The step is visible, honest, and is what Looker
     * Studio's own stepped bars do.
     */
    const floor = rise ? w : next;
    const [l0, r0] = edges(w);
    const [l1, r1] = edges(floor);
    return {
      points: `${l0},${y0} ${r0},${y0} ${r0},${yk} ${r1},${y1} ${l1},${y1} ${l0},${yk}`,
      y0,
      y1,
      width: w,
      cx: align === "center" ? 50 : 0,
      rise,
    };
  });
}

/**
 * A RATIO ABOVE ONE SPELLED AS A MULTIPLE — `3.4` becomes "3.4x" — and `null`
 * for anything at or below one, which really is a share and belongs in the
 * caller's own percentage.
 *
 * Only a COMPOSED funnel reaches this. Its stages are independent metrics over
 * one window rather than a cohort walking down a sequence, so
 * `conversionFromPrev` is not a conversion at all: when stage 3 is bigger than
 * stage 2 the honest reading is "three and a bit times as many", and the slot
 * printed "340% from prev" — a number that is not a share, inside a phrase that
 * promises one. Percentages past 100 read as a typo even where they are right.
 *
 * PRECISION IS PICKED SO THE FIGURE CANNOT READ AS "LEVEL". One decimal covers
 * the range anybody actually sees, and whole numbers past ten because the tenth
 * of a 14x is noise. But a stage two per cent larger rounds to "1.0x", which
 * says the two stages are equal — the very confusion the capped bar already
 * risks — so a ratio that close to one keeps a second decimal instead.
 *
 * It lives here rather than in either renderer because BOTH print it, and the
 * rule this module exists to enforce is that each number has exactly one
 * answer: two copies of this drift the first time one of them is adjusted.
 */
export function multipleLabel(ratio: number): string | null {
  if (!Number.isFinite(ratio) || ratio <= 1) return null;
  if (ratio >= 10) return `${Math.round(ratio)}x`;
  const tenths = Math.round(ratio * 10) / 10;
  if (tenths !== 1) return `${tenths}x`;
  /**
   * ROUNDED AWAY FROM ONE, NEVER TO NEAREST — the whole reason this branch
   * exists, and it did not work as first written.
   *
   * A second decimal taken to NEAREST still lands on 1 for everything below
   * 1.005, so 1000 -> 1003 printed "1x": the figure spelling "no change" on a
   * stage that is genuinely larger, beside a bar carrying the capped cut edge
   * and under a footer naming that stage as wider. Three parts of one tile
   * contradicting each other, and the only one a reader tends to believe is
   * the number.
   *
   * Ceiling to the hundredth overstates by at most 0.01x and cannot spell
   * equality, which is the correct trade: this figure's whole job is to say
   * "bigger than the one above", and an exact-looking "1x" fails at that job
   * in the one direction that matters.
   */
  return `${Math.ceil(ratio * 100) / 100}x`;
}
