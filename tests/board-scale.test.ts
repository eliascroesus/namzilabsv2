import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arcPath, bucketLabel, niceTicks, padSeries, pieSlices, stageWidths } from "@/lib/board/scale";

/**
 * THE CHART KIT'S ARITHMETIC, ASSERTED RATHER THAN EYEBALLED.
 *
 * Every one of these is a property nobody can see on a screenshot. An axis that
 * excludes zero looks like a chart; a pie whose slices sum to 359° looks like a
 * pie; a series that fabricates zeros for quiet days looks like data. They are
 * all lies, and this file is where they are caught.
 */

describe("niceTicks — zero is always on the axis", () => {
  it("includes zero even when the data does not go near it", () => {
    /**
     * THE ONE THAT MATTERS. A bar chart whose axis starts at 95 turns a 4%
     * dip into a visual collapse. Every reference product anchors bars at
     * zero, and doing it in the tick function means no mark can forget.
     */
    const { ticks, lo } = niceTicks(95, 100);
    expect(lo).toBe(0);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
  });

  it("spans below zero when the data does", () => {
    const { lo, hi, ticks } = niceTicks(-40, 10);
    expect(lo).toBeLessThanOrEqual(-40);
    expect(hi).toBeGreaterThanOrEqual(10);
    expect(ticks).toContain(0);
  });

  it("snaps to a readable ladder rather than dividing the span", () => {
    // 0/25/50/75/100, not 0/23.7/47.4 — the whole point of "nice".
    expect(niceTicks(0, 97).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 8).ticks).toEqual([0, 2, 4, 6, 8]);
  });

  it("gives an all-zero series a real axis rather than a division by zero", () => {
    const { ticks, lo, hi } = niceTicks(0, 0);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("survives infinities and NaN without emitting them", () => {
    for (const [lo, hi] of [
      [NaN, NaN],
      [Infinity, -Infinity],
      [0, NaN],
    ]) {
      const out = niceTicks(lo, hi);
      expect(out.ticks.every((t) => Number.isFinite(t))).toBe(true);
      expect(out.ticks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("emits no floating-point debris", () => {
    // A step of 0.1 accumulated forty times produces 0.30000000000000004 and
    // an axis that reads it out loud.
    for (const t of niceTicks(0, 1).ticks) expect(String(t)).not.toMatch(/\d{6,}/);
  });
});

describe("padSeries — a quiet bucket is a gap, never a zero", () => {
  it("inserts nulls for the days the engine omitted", () => {
    const out = padSeries(
      [
        { bucket: "2026-08-01", value: 3 },
        { bucket: "2026-08-04", value: 5 },
      ],
      "day",
    );
    expect(out.map((p) => p.value)).toEqual([3, null, null, 5]);
    expect(out.map((p) => p.bucket)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]);
  });

  it("never fabricates a zero, because a zero is a claim", () => {
    // For a count the zero happens to be true; for an average it is invented.
    // A gap is the one rendering that is honest for both.
    const out = padSeries([{ bucket: "2026-01", value: 10 }, { bucket: "2026-04", value: 20 }], "month");
    expect(out.filter((p) => p.value === 0)).toHaveLength(0);
    expect(out.filter((p) => p.value === null)).toHaveLength(2);
  });

  it("passes an unknown or categorical series through untouched", () => {
    const cat = [
      { bucket: "Enterprise", value: 4 },
      { bucket: "SMB", value: 9 },
    ];
    expect(padSeries(cat)).toEqual(cat);
    expect(padSeries(cat, "day")).toEqual(cat);
  });

  it("caps the fill, so two points years apart do not mint thousands of holes", () => {
    const out = padSeries([{ bucket: "2000-01-01", value: 1 }, { bucket: "2026-01-01", value: 2 }], "day");
    expect(out.length).toBeLessThanOrEqual(64);
  });

  it("handles every unit's key shape", () => {
    expect(padSeries([{ bucket: "2026-W01", value: 1 }, { bucket: "2026-W03", value: 2 }], "week")).toHaveLength(3);
    expect(padSeries([{ bucket: "2026-Q1", value: 1 }, { bucket: "2026-Q3", value: 2 }], "quarter")).toHaveLength(3);
    expect(padSeries([{ bucket: "2024", value: 1 }, { bucket: "2026", value: 2 }], "year")).toHaveLength(3);
  });
});

describe("bucketLabel", () => {
  it("spells each unit the way an axis should read", () => {
    expect(bucketLabel("2026-08-24", "day")).toBe("Aug 24");
    expect(bucketLabel("2026-W34", "week")).toBe("W34");
    expect(bucketLabel("2026-08", "month")).toBe("Aug '26");
    expect(bucketLabel("2026-Q3", "quarter")).toBe("Q3 '26");
    expect(bucketLabel("2026", "year")).toBe("2026");
  });

  it("falls back to the key itself, which is at least true", () => {
    expect(bucketLabel("Enterprise")).toBe("Enterprise");
  });
});

describe("pieSlices — the shares are computed once", () => {
  const g = (label: string, value: number) => ({ label, value });

  it("closes the circle exactly, whatever floating point did", () => {
    const { slices } = pieSlices([g("a", 1), g("b", 1), g("c", 1)]);
    expect(slices[slices.length - 1].a1).toBe(360);
    expect(slices[0].a0).toBe(0);
    // ...and the shares sum to one whole.
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });

  it("rolls everything past the cap into one Other, counted", () => {
    const groups = Array.from({ length: 10 }, (_, i) => g(`g${i}`, 10 - i));
    const { slices, other } = pieSlices(groups, 4);
    expect(slices).toHaveLength(5);
    expect(slices[4].label).toBe("Other");
    expect(other).toEqual({ count: 6, value: 6 + 5 + 4 + 3 + 2 + 1 });
  });

  it("EXCLUDES non-positive values and reports how many", () => {
    /**
     * A share of a whole cannot be negative. Absorbing a refund column into a
     * pie is a chart lying by omission — so they are dropped and counted, and
     * the mark prints the count.
     */
    const { slices, excluded, total } = pieSlices([g("in", 10), g("out", -4), g("nil", 0)]);
    expect(excluded).toBe(2);
    expect(slices).toHaveLength(1);
    expect(total).toBe(10);
  });

  it("draws nothing when there is nothing above zero to divide", () => {
    const { slices, total } = pieSlices([g("a", 0), g("b", -1)]);
    expect(slices).toEqual([]);
    expect(total).toBe(0);
  });

  it("gives a single group the whole circle", () => {
    const { slices } = pieSlices([g("only", 7)]);
    expect(slices).toHaveLength(1);
    expect(slices[0].a0).toBe(0);
    expect(slices[0].a1).toBe(360);
    expect(slices[0].share).toBe(1);
  });
});

describe("arcPath", () => {
  it("draws a full circle as two arcs, because a coincident arc renders nothing", () => {
    const d = arcPath(50, 0, 360);
    expect((d.match(/A /g) ?? []).length).toBe(2);
  });

  it("flags the large-arc sweep past a half turn", () => {
    expect(arcPath(50, 0, 90)).toMatch(/A 50 50 0 0 1/);
    expect(arcPath(50, 0, 270)).toMatch(/A 50 50 0 1 1/);
  });

  it("starts at twelve o'clock", () => {
    // The first point of a wedge starting at 0° is straight up: (0, -r).
    expect(arcPath(50, 0, 90)).toContain("L 0 -50");
  });
});

describe("stageWidths", () => {
  it("measures every stage against the first", () => {
    expect(stageWidths([100, 50, 25])).toEqual([100, 50, 25]);
  });

  it("floors a decimated stage so it stays hoverable", () => {
    const [, , last] = stageWidths([1000, 500, 1]);
    expect(last).toBe(4);
  });

  it("does not divide by an empty first stage", () => {
    expect(stageWidths([0, 0]).every((w) => Number.isFinite(w))).toBe(true);
  });
});

describe("the module stays usable from either side of the boundary", () => {
  it("carries no directive and touches nothing but numbers", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/board/scale.ts"), "utf8");
    expect(src).not.toMatch(/^\s*"use client"/m);
    expect(src).not.toMatch(/document\.|window\.|Math\.random/);
  });
});
