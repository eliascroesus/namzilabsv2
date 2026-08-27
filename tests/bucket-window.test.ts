import { describe, it, expect } from "vitest";
import { bucketUnitForWindow } from "@/lib/flow/engine";
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
