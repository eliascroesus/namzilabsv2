import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bucketUnitForWindow, bucketWindowsFor } from "@/lib/flow/engine";
import { resolveRange } from "@/lib/metrics/range";
import { bucketKeyOf, bucketLabel, padSeries } from "@/lib/board/scale";

/**
 * THE HOUR RUNG — why a one-day window drew nothing until now.
 *
 * `withTrends` refuses a series of fewer than two points, and its own comment
 * said why that caught Today and Yesterday: "Today and Yesterday are one day
 * long by definition". At a day bucket a one-day window HAS one bucket, so
 * every short range rendered "Only one point in this period" on a board whose
 * events carry `occurredAt` to the millisecond. The data was always there; the
 * grid was too coarse to show it.
 *
 * THE LADDER IS THE STANDARD ONE, not a number picked here. The established
 * approach — Grafana's `$__interval` is the widely-deployed version — is
 * `interval = range / maxDataPoints`, snapped to a "nice" unit: 24h lands on
 * 5m at ~300 points, 7d on 30m. These charts are not 300-point panels; they
 * draw a couple of dozen marks and `bucketWindowsFor` caps at 64. At ~24 points
 * a 24h window lands on exactly one hour, which is the rung added here.
 *
 * TWO DAYS IS THE BOUNDARY, and it falls out of the same arithmetic rather than
 * being chosen: 48 hourly buckets is the most that stays inside the cap with
 * room to spare, and a third day would be 72 and drop the series entirely.
 *
 * UTC, LIKE EVERYTHING ELSE HERE. There is no workspace timezone in this
 * product and the day boundaries are already UTC, so an hour bucket is
 * consistent with the window that contains it. It is also more visible per
 * hour than per day — a 09:00 CET spike reads at 07:00 — which is an argument
 * for a workspace timezone, not against hourly buckets.
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;

describe("the unit a window picks", () => {
  it("takes hours for a day and for two", () => {
    expect(bucketUnitForWindow(DAY)).toBe("hour");
    expect(bucketUnitForWindow(2 * DAY)).toBe("hour");
  });

  it("goes back to days the moment a window is longer than two", () => {
    // 48 hourly buckets is the most that fits comfortably under the 64 cap;
    // 72 would return nothing at all, which is worse than a coarser grid.
    expect(bucketUnitForWindow(2 * DAY + HOUR)).toBe("day");
    expect(bucketUnitForWindow(7 * DAY)).toBe("day");
  });

  it("leaves every rung above it alone", () => {
    expect(bucketUnitForWindow(45 * DAY)).toBe("day");
    expect(bucketUnitForWindow(90 * DAY)).toBe("week");
    expect(bucketUnitForWindow(365 * DAY)).toBe("month");
    expect(bucketUnitForWindow(1300 * DAY)).toBe("year");
  });
});

describe("an hourly window", () => {
  const start = Date.UTC(2026, 8, 10, 0, 0, 0);
  const end = start + DAY - 1;

  it("draws a bucket an hour, which is what makes the chart possible", () => {
    const w = bucketWindowsFor(start, end);
    expect(w).toHaveLength(24);
    // The guard that suppressed these charts wants two or more.
    expect(w.length).toBeGreaterThanOrEqual(2);
  });

  it("keys an hour as the day plus the hour, sorting lexically like every other key", () => {
    const w = bucketWindowsFor(start, end);
    expect(w[0].key).toBe("2026-09-10T00");
    expect(w[14].key).toBe("2026-09-10T14");
    expect([...w.map((b) => b.key)].sort()).toEqual(w.map((b) => b.key));
  });

  it("floors to the hour and steps exactly one hour", () => {
    const w = bucketWindowsFor(start + 37 * 60_000, end);
    expect(w[0].start).toBe(start + 37 * 60_000); // clamped to the window's own start
    expect(w[1].start - w[0].end).toBe(1);
    expect(w[2].start - w[1].start).toBe(HOUR);
  });

  it("spans two days without tripping the 64-bucket cap", () => {
    const w = bucketWindowsFor(start, start + 2 * DAY - 1);
    expect(w).toHaveLength(48);
    expect(w[47].key).toBe("2026-09-11T23");
  });
});

describe("the axis label for an hour", () => {
  it("reads as a clock time, not a raw key", () => {
    expect(bucketLabel("2026-09-10T14", "hour")).toBe("14:00");
    expect(bucketLabel("2026-09-10T00", "hour")).toBe("00:00");
  });

  it("is inferred from the key's own shape when no unit is passed", () => {
    // Stored slots carry `unit`, but a row written before this rung existed
    // does not — and a raw "2026-09-10T14" on an axis is worse than a guess.
    expect(bucketLabel("2026-09-10T14")).toBe("14:00");
  });

  it("leaves every other shape reading as it did", () => {
    expect(bucketLabel("2026-09-10", "day")).toBe("Sep 10");
    expect(bucketLabel("2026-W02", "week")).toBe("W2");
    expect(bucketLabel("2026-09", "month")).toBe("Sep '26");
  });
});

describe("an hour that has not happened yet", () => {
  /**
   * THE ONE THING A SUB-DAY GRID EXPOSES THAT A DAY GRID NEVER DID.
   *
   * "Today" is a WHOLE UTC day — `WINDOW_DAYS` says so and `resolveRange` mints
   * midnight to 23:59:59.999 — so at 16:00 its hourly grid has 24 buckets of
   * which SEVEN are still in the future. Measured, each is a truthful count of
   * zero records; drawn, they are a line falling to the floor for the rest of
   * the afternoon. Every reader of that chart sees a crash that did not happen.
   *
   * The day grid never had the problem, and that is why it went unnoticed: 7d
   * and 30d end on TODAY'S bucket, which has already started. Only a grid finer
   * than the window's own end can contain a bucket that has not begun.
   *
   * The rule is "has it started", not "has it finished" — the current hour is
   * partial and low, exactly as today's partial bucket already is on 7d, and
   * the product has always drawn that.
   */
  it("is not measured, so it cannot be drawn", () => {
    const materialize = readFileSync("src/lib/flow/materialize.ts", "utf8");
    // Skipped at the point the trend windows are collected, which both keeps it
    // out of the series and saves measuring a window nobody can see.
    expect(materialize).toMatch(/if \(b\.start > asOfMs\) continue;/);
  });

  it("leaves the hours that have started, including the partial one", () => {
    const { range } = resolveRange("today");
    const start = range.from.getTime();
    // 16:24 on the day the window covers.
    const now = start + 16 * HOUR + 24 * 60_000;
    const drawn = bucketWindowsFor(start, range.to.getTime()).filter((b) => b.start <= now);
    expect(drawn).toHaveLength(17); // 00:00 through 16:00
    expect(drawn.at(-1)!.start).toBe(start + 16 * HOUR);
  });

  it("does not touch a day-grained window, whose last bucket has always started", () => {
    const { range } = resolveRange("7d");
    const all = bucketWindowsFor(range.from.getTime(), range.to.getTime());
    expect(all.filter((b) => b.start <= Date.now())).toHaveLength(all.length);
  });
});

describe("padding an hourly series", () => {
  /**
   * `padSeries` fills gaps AND stretches the series to span the pill's promise,
   * so "Last 7 days" draws seven marks even if two of them saw nothing. For a
   * count metric it fills with `0` — a measured zero, which for a day grid is
   * exactly right because a window's last DAY bucket has always started.
   *
   * An hour grid breaks that assumption, and the break is invisible: today's
   * period ends at 23:59 while its series ends at the last hour that started,
   * so stretching to the period would fill the rest of the afternoon with real
   * zeroes — reinstating, at the render layer, the flatline the materializer
   * just refused to measure. The series' own end is the authority for a sub-day
   * grid, because the materializer stamped it knowing what had begun.
   *
   * No clock is read here on purpose: this runs inside a client component that
   * server-renders, and a `Date.now()` in that path disagrees with itself
   * across an hour boundary.
   */
  const day = Date.UTC(2026, 8, 10);
  const hours = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ bucket: bucketKeyOf(day + i * HOUR, "hour"), value: i + 1 }));

  it("keys an hour, rather than silently handing back the day", () => {
    // Without an `hour` arm this returned "2026-09-10", which `bucketIndex`
    // could not parse — so the period branch below was skipped by accident
    // rather than by decision, and the whole behaviour rested on a NaN.
    expect(bucketKeyOf(day + 14 * HOUR, "hour")).toBe("2026-09-10T14");
  });

  it("stops where the measurements stop, not where the day ends", () => {
    const padded = padSeries(hours(17), "hour", { fill: 0, period: { from: day, to: day + DAY - 1 } });
    expect(padded).toHaveLength(17);
    expect(padded.at(-1)!.bucket).toBe("2026-09-10T16");
  });

  it("still fills the holes inside the measured stretch", () => {
    const sparse = [hours(17)[0], hours(17)[16]];
    const padded = padSeries(sparse, "hour", { fill: 0, period: { from: day, to: day + DAY - 1 } });
    expect(padded).toHaveLength(17);
    expect(padded[8]).toEqual({ bucket: "2026-09-10T08", value: 0 });
  });

  it("leaves a day-grained series spanning its whole period, as it always has", () => {
    const from = Date.UTC(2026, 8, 4);
    const padded = padSeries([{ bucket: "2026-09-04", value: 3 }], "day", {
      fill: 0,
      period: { from, to: from + 7 * DAY - 1 },
    });
    expect(padded).toHaveLength(7);
  });
});
