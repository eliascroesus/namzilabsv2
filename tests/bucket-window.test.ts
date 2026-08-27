import { describe, it, expect } from "vitest";
import { bucketUnitForWindow, bucketWindowsFor } from "@/lib/flow/engine";
import { MATERIALIZED_RANGES, resolveRange } from "@/lib/metrics/range";

/**
 * HOW BIG A BUCKET EACH WINDOW GETS — and why the metric does not get a vote.
 *
 * `timeUnit` reads like a declaration about the data ("this metric is monthly")
 * and is nothing of the kind: `MetricSpecSchema` DEFAULTS it to "month", so
 * every metric whose author never touched the control carries "month" without
 * having chosen it. It is a display preference for the all-time view.
 *
 * The first version of this function treated it as a floor — "never bucket
 * finer than the metric asked for" — which sounded careful and made the whole
 * feature a no-op: seven days floored to month is ONE bucket, which is exactly
 * the single-dot chart the change existed to fix. Worse, the advice on that
 * tile was "pick a longer range", and ninety days floored to month is one
 * bucket too.
 *
 * The window decides. It is the only thing that knows how many points will fit
 * on screen, and it is what the pill above the board is promising.
 */

const DAY = 86_400_000;

describe("the window decides, not the metric", () => {
  it("buckets a week by day, and a month of days", () => {
    // THE REGRESSION, as a value. Under the floor these both answered "month",
    // which is one bucket — the single dot the whole change exists to abolish.
    expect(bucketUnitForWindow(7 * DAY)).toBe("day");
    expect(bucketUnitForWindow(30 * DAY)).toBe("day");
  });

  it("cannot be told a declared unit at all", async () => {
    /**
     * The guarantee is now structural: the parameter is GONE, so no future
     * caller can reintroduce the floor by passing `spec.timeUnit` here. What is
     * left to pin is the call site — `all` is the one window whose length is
     * unknown, and the only one that may keep the metric's own unit.
     */
    expect(bucketUnitForWindow.length).toBe(1);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/flow/engine.ts", "utf8");
    expect(src).toContain("range.all ? spec.timeUnit : bucketUnitForWindow(range.end - range.start)");
  });

  it("widens the bucket as the window widens, so a tile stays legible", () => {
    expect(bucketUnitForWindow(1 * DAY)).toBe("day");
    expect(bucketUnitForWindow(90 * DAY)).toBe("week");
    expect(bucketUnitForWindow(365 * DAY)).toBe("month");
    expect(bucketUnitForWindow(5 * 365 * DAY)).toBe("year");
  });
});

describe("every range the dashboard offers", () => {
  it("gives a trend more than one point wherever a trend is possible", () => {
    /**
     * The property that actually matters, asserted over the REAL windows
     * `resolveRange` produces rather than over round numbers. Today and
     * Yesterday are one day long, so one bucket is the honest answer for them —
     * the tile says so in words. Every other range must be able to draw.
     */
    const SINGLE = new Set(["today", "yesterday"]);
    for (const key of MATERIALIZED_RANGES) {
      if (key === "all") continue; // unbounded; keeps the metric's own unit
      const { range } = resolveRange(key);
      const span = range.to.getTime() - range.from.getTime();
      const unit = bucketUnitForWindow(span);
      const perBucket = unit === "day" ? DAY : unit === "week" ? 7 * DAY : 30 * DAY;
      const points = Math.round(span / perBucket);
      if (SINGLE.has(key)) expect(points, `${key}`).toBeLessThanOrEqual(1);
      else expect(points, `${key} draws only ${points} point(s) as ${unit}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps every window inside a legible number of points", () => {
    // Few enough to read in a tile, and few enough that the stored jsonb — read
    // on every dashboard render and billed by the byte — stays small.
    for (const key of MATERIALIZED_RANGES) {
      if (key === "all") continue;
      const { range } = resolveRange(key);
      const span = range.to.getTime() - range.from.getTime();
      const unit = bucketUnitForWindow(span);
      const perBucket = unit === "day" ? DAY : unit === "week" ? 7 * DAY : 30 * DAY;
      expect(Math.round(span / perBucket), `${key}`).toBeLessThanOrEqual(45);
    }
  });
});

/**
 * A TREND FOR A METRIC THAT MEASURES ONE NUMBER.
 *
 * "If I can see it on the calendar view then I should be able to see it in the
 * charts." That was exactly right, and the gap was filing rather than data: a
 * percentage, a currency total and a duration end as `shape.kind === "scalar"`,
 * so `buildTile` never wrote them a `series` and `chartsFor` offers line, area
 * and bar only to a metric that has one — while the per-day numbers already
 * existed, computed out of the same `tileByRange` call the calendar reads.
 *
 * The rule that makes it honest: every point is the metric RE-RUN over its own
 * window. A week's rate is that week's numerator over that week's denominator,
 * never seven daily rates averaged — and the tile carries no fact that could
 * say when folding is safe, since `facts.kind` is "count" for `sum`, `avg`,
 * `median`, `min` and `count_distinct` alike.
 */
describe("the windows a range's trend is made of", () => {
  const of = (key: Parameters<typeof resolveRange>[0]) => {
    const { range } = resolveRange(key);
    return bucketWindowsFor(range.from.getTime(), range.to.getTime());
  };

  it("covers each bounded range at the size the window implies", () => {
    expect(of("7d")).toHaveLength(7);
    expect(of("30d")).toHaveLength(30);
    // Thirteen or fourteen ISO weeks, depending where today falls in one.
    expect(of("90d").length).toBeGreaterThanOrEqual(13);
    expect(of("90d").length).toBeLessThanOrEqual(14);
  });

  it("spells a day exactly as the calendar does, which is what makes it free", () => {
    /**
     * The economics of the whole design in one assertion. A day bucket key and
     * a calendar day key are the same string, so Today, Yesterday, 7d and 30d
     * reuse windows the calendar already pays for and cost NOTHING new; only
     * the weeks of 90d are extra. Sabotage: spell a day any other way and the
     * materializer mints seventy windows per tile instead of thirteen.
     */
    for (const w of of("7d")) expect(w.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const { range } = resolveRange("7d");
    expect(of("7d")[6].key).toBe(range.to.toISOString().slice(0, 10));
  });

  it("refuses an unbounded span rather than minting fifty years of it", () => {
    // All time starts at the EPOCH, which is fifty-odd YEAR buckets — under any
    // count cap, and fifty-odd full traversals of the run for a chart nothing
    // asked for. The lock is on the span for exactly that reason.
    const all = resolveRange("all");
    expect(bucketWindowsFor(all.range.from.getTime(), all.range.to.getTime())).toEqual([]);
    expect(bucketWindowsFor(0, Date.UTC(2026, 7, 27))).toEqual([]);
  });

  it("never overlaps and never leaves a hole", () => {
    // Each window is closed at `next - 1`, so consecutive buckets touch exactly.
    const w = of("30d");
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end + 1);
    const { range } = resolveRange("30d");
    expect(w[0].start).toBe(range.from.getTime());
    expect(w[w.length - 1].end).toBe(range.to.getTime());
  });
});
