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
export type BucketUnit = "day" | "week" | "month" | "quarter" | "year";

/**
 * Nice axis ticks covering `[min(0, lo), max(0, hi)]`.
 *
 * Steps snap to the {1, 2, 2.5, 5} × 10^n ladder, so an axis reads 0 / 25 / 50
 * rather than 0 / 23.7 / 47.4. Degenerate inputs get a real axis rather than a
 * crash: an all-zero series spans [0, 1].
 */
export function niceTicks(lo: number, hi: number, count = 4): { ticks: number[]; lo: number; hi: number } {
  let min = Math.min(0, lo, hi);
  let max = Math.max(0, lo, hi);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  if (min === 0 && max === 0) max = 1;

  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;

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
export function padSeries(
  series: Array<{ bucket: string; value: number }>,
  unit?: BucketUnit,
): Array<{ bucket: string; value: number | null }> {
  if (!unit || series.length < 2) return series;
  const steps = series.map((s) => bucketIndex(s.bucket, unit));
  if (steps.some((n) => n == null)) return series;

  const out: Array<{ bucket: string; value: number | null }> = [];
  for (let i = 0; i < series.length; i++) {
    out.push(series[i]);
    if (i === series.length - 1) break;
    const from = steps[i]!;
    const to = steps[i + 1]!;
    // Cap the fill: a two-point series years apart must not mint thousands of
    // holes — past a screen's worth, the gap says what it needs to as one.
    const missing = Math.min(Math.max(0, to - from - 1), 60);
    for (let g = 1; g <= missing; g++) out.push({ bucket: bucketAt(from + g, unit), value: null });
  }
  return out;
}

/** A bucket key as a monotone integer index in its unit, or null if unparseable. */
function bucketIndex(key: string, unit: BucketUnit): number | null {
  switch (unit) {
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
 * Funnel stage widths as a share of the FIRST stage, floored at 4% so a
 * decimated stage stays visible enough to hover. The first stage is 100% by
 * definition; an empty first stage makes every width the floor.
 */
export function stageWidths(counts: number[]): number[] {
  const first = counts[0] ?? 0;
  return counts.map((c) => (first > 0 ? Math.max(4, round10((c / first) * 100)) : 4));
}
