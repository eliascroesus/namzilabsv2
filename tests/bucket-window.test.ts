import { describe, it, expect } from "vitest";
import { bucketUnitForWindow, buildTile } from "@/lib/flow/engine";
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
 * WHERE A CHART STARTS, AND WHAT A QUIET DAY MEANS.
 *
 * The engine emits only buckets that had records, so a series began at the
 * FIRST RECORD rather than at the start of the window: "Last 30 days" drew a
 * chart starting eleven days in, which reads as the metric having been switched
 * on then. A silent Tuesday in the middle was absent rather than zero, so the
 * line broke instead of touching the floor.
 *
 * `padSeries` renders an absent bucket as a hole, and its own note says exactly
 * why that is right in general and wrong here: "for a count, zero would happen
 * to be true; for an average it would be fabricated." So the fact decides. A
 * COUNT with no matching records counted zero — that is not a guess — and the
 * window is seeded. A ratio with no denominator, or a duration with no samples,
 * is genuinely unknown and keeps its gap.
 */
const rec = (iso: string, i: number) => ({
  id: `r${i}`,
  source: "s",
  eventType: "e",
  subject: `p${i}`,
  occurredAt: iso,
  value: null,
  currency: null,
  connectionId: "c",
  properties: {},
});

const build = (kind: string, records: ReturnType<typeof rec>[]) => {
  const { range } = resolveRange("30d");
  return buildTile(
    { name: "T", format: "number", timeField: "occurredAt", timeUnit: "day", facts: { kind } } as never,
    { kind: "dataset", records } as never,
    [],
    { start: range.from.getTime(), end: range.to.getTime() },
  );
};

describe("a count fills its whole window", () => {
  const { range } = resolveRange("30d");
  const end = range.to.getTime();
  const late = [1, 2, 3].map((i) => rec(new Date(end - i * DAY).toISOString(), i));

  it("starts where the PERIOD starts, not where the data does", () => {
    const series = build("count", late).series ?? [];
    // Thirty days, thirty buckets — not the three that had records.
    expect(series.length).toBe(30);
    expect(series[0].value).toBe(0);
  });

  it("keeps every real count it measured", () => {
    // Sabotage: seed with `buckets.set(key, 0)` instead of guarding on `has`,
    // and this reads 0 — every number on the board wiped by its own padding.
    const series = build("count", late).series ?? [];
    expect(series.reduce((a, b) => a + b.value, 0)).toBe(3);
    expect(series.filter((p) => p.value > 0)).toHaveLength(3);
  });

  it("leaves a ratio alone, because no denominator is not a zero", () => {
    const series = build("ratio", [rec(new Date(end - DAY).toISOString(), 1)]).series ?? [];
    expect(series.length).toBe(1);
  });

  it("leaves a duration alone for the same reason", () => {
    const series = build("duration", [rec(new Date(end - DAY).toISOString(), 1)]).series ?? [];
    expect(series.length).toBe(1);
  });

  it("seeds nothing at all when there is no window to seed against", () => {
    // The un-windowed run — `buildTile` without bounds — is the flow's whole
    // history, which has no edges to fill to.
    const tile = buildTile(
      { name: "T", format: "number", timeField: "occurredAt", timeUnit: "day", facts: { kind: "count" } } as never,
      { kind: "dataset", records: late } as never,
      [],
    );
    expect((tile.series ?? []).length).toBe(3);
  });
});
