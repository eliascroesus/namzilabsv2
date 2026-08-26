import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asChartId,
  chartsFor,
  CHARTS,
  CHART_IDS,
  defaultSize,
  shapeOfClassic,
  shapeOfTile,
  NO_SHAPE,
} from "@/lib/board/charts";
import { GRID_COLS } from "@/lib/board/grid";

/**
 * WHICH CHARTS MAY BE OFFERED FOR A METRIC — the rule that stops this feature
 * repeating the mistake it was built to correct.
 *
 * A published tile has carried a `viz` field since the beginning and it is
 * DECORATIVE: `flow-tile.tsx` chooses its mark from data presence and never
 * reads it. The interface has been apologising in prose ever since —
 * `ReviewPublishModal` labels three of its own options "(draws bars)". On a
 * custom view, picking the chart is the whole interaction, so a chart that is
 * offered has to be one the tile can actually draw.
 *
 * This is the one definition of that, and both the picker and the renderer read
 * it. Two definitions is how the gap between "offered" and "drawn" opens in the
 * first place.
 */

const tileWith = (over: Record<string, unknown>) => ({ format: "number", precision: 0, ...over });

describe("what a stored flow tile can be drawn as", () => {
  it("offers a trend only when there is a trend", () => {
    const series = shapeOfTile(tileWith({ value: 12, series: [{ bucket: "2026-08", value: 12 }] }));
    expect(chartsFor(series)).toEqual(["number", "bar"]);
    // Sabotage: return "bar" unconditionally and every scalar metric offers a
    // chart that renders an empty box under a real number.
    expect(chartsFor(shapeOfTile(tileWith({ value: 12 })))).toEqual(["number"]);
  });

  it("offers a breakdown only when there are groups", () => {
    const grouped = shapeOfTile(tileWith({ value: 9, groups: [{ label: "Afeef", value: 9 }] }));
    expect(chartsFor(grouped)).toEqual(["number", "category"]);
  });

  it("offers progress only when a target was set", () => {
    expect(chartsFor(shapeOfTile(tileWith({ value: 4, target: 10 })))).toContain("progress");
    expect(chartsFor(shapeOfTile(tileWith({ value: 4, target: null })))).not.toContain("progress");
    // A target with nothing to measure against it is not progress either.
    expect(chartsFor(shapeOfTile(tileWith({ target: 10 })))).not.toContain("progress");
  });

  it("offers both when a metric has both a trend and a breakdown", () => {
    const both = shapeOfTile(tileWith({ value: 5, series: [{ bucket: "x", value: 5 }], groups: [{ label: "a", value: 5 }] }));
    expect(chartsFor(both)).toEqual(["number", "bar", "category"]);
  });

  it("offers nothing at all for a tile that has never answered", () => {
    expect(chartsFor(shapeOfTile({}))).toEqual([]);
    expect(chartsFor(NO_SHAPE)).toEqual([]);
  });
});

describe("availability is a property of the METRIC, not of the period", () => {
  /**
   * THE SUBTLE ONE, AND THE REASON IT IS WRITTEN DOWN.
   *
   * `byRange` answers each period separately, so a metric can have a trend
   * under "Last 7 days" and none under "Today" purely because today is quiet.
   * If legality were computed from the ACTIVE range, pressing Today would make
   * a bar chart illegal and the tile would have to do something about it — on a
   * board where nothing has actually changed. Emptiness in the period you are
   * looking at is a RENDER state, not a legality one.
   */
  const quietToday = tileWith({
    value: 0,
    byRange: {
      today: { value: 0 },
      "7d": { value: 40, series: [{ bucket: "2026-08-20", value: 40 }] },
    },
  });

  it("still offers a bar chart when only a wider range has the trend", () => {
    // Sabotage: read only byRange[activeRange] and this returns ["number"] —
    // the chart someone chose becomes illegal on a quiet Tuesday.
    expect(chartsFor(shapeOfTile(quietToday))).toContain("bar");
  });

  it("sees a breakdown that exists in any one period", () => {
    const t = tileWith({ byRange: { today: { value: 1 }, "30d": { value: 9, groups: [{ label: "a", value: 9 }] } } });
    expect(chartsFor(shapeOfTile(t))).toContain("category");
  });
});

describe("classic metrics, which are computed live rather than stored", () => {
  it("draws a funnel as a funnel and as nothing else", () => {
    const funnel = shapeOfClassic({ stages: [{}, {}] }, null);
    // Deriving a funnel from a grouped metric would be a confident lie unless
    // the groups really are ordered stages, and nothing can know that.
    expect(chartsFor(funnel)).toEqual(["funnel"]);
    expect(chartsFor(funnel)).not.toContain("number");
  });

  it("never offers a breakdown, because the classic engine has no grouped shape", () => {
    const series = shapeOfClassic({ kind: "series", series: [1, 2] }, null);
    expect(chartsFor(series)).toEqual(["number", "bar"]);
    expect(chartsFor(shapeOfClassic({ kind: "scalar" }, null))).toEqual(["number"]);
  });

  it("offers progress when the metric carries a target", () => {
    expect(chartsFor(shapeOfClassic({ kind: "scalar" }, 100))).toEqual(["number", "progress"]);
  });

  it("offers nothing for a metric that failed to compute", () => {
    expect(chartsFor(shapeOfClassic(null, null))).toEqual([]);
  });
});

describe("the chart vocabulary", () => {
  it("is exactly the five that have a mark behind them", () => {
    /**
     * Pie, line, area and table have NO renderer in charts.tsx. Offering one
     * and drawing bars is the precise lie this feature exists to correct, so
     * they are absent until their marks are written. Adding an id here without
     * a branch in custom-tile.tsx puts the lie back.
     */
    expect(CHART_IDS).toEqual(["number", "bar", "category", "progress", "funnel"]);
  });

  it("is the same vocabulary the schema comment promises", () => {
    const schema = readFileSync(join(process.cwd(), "src/db/schema.ts"), "utf8");
    expect(schema).toContain("number | bar | category | progress | funnel");
  });

  it("has a branch in the renderer for every id it offers", () => {
    // The gate against a sixth chart being offered before it can be drawn.
    const render = readFileSync(join(process.cwd(), "src/components/custom-tile.tsx"), "utf8");
    for (const id of CHART_IDS) {
      expect(render, `custom-tile.tsx never mentions the "${id}" chart`).toContain(`"${id}"`);
    }
  });

  it("degrades an unknown stored value rather than rendering undefined", () => {
    expect(asChartId("pie")).toBe("number");
    expect(asChartId(undefined)).toBe("number");
    expect(asChartId("bar")).toBe("bar");
  });
});

describe("the footprints a chart lands at", () => {
  it("fits every chart inside the grid", () => {
    for (const id of CHART_IDS) {
      const d = defaultSize(id);
      expect(d.w, `${id} is wider than the grid`).toBeLessThanOrEqual(GRID_COLS);
      expect(d.w).toBeGreaterThanOrEqual(1);
      expect(d.h).toBeGreaterThanOrEqual(1);
    }
  });

  it("never sets a floor larger than the size it lands at", () => {
    // A tile that arrives smaller than it is allowed to be cannot be resized
    // back up without first being resized down, which is not a thing. Read off
    // the table directly: the resize gesture brings the accessor with it.
    for (const c of CHARTS) {
      expect(c.minW, `${c.id}`).toBeLessThanOrEqual(c.w);
      expect(c.minH, `${c.id}`).toBeLessThanOrEqual(c.h);
      expect(c.minW).toBeGreaterThanOrEqual(1);
      expect(c.minH).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives a chart more room than a number", () => {
    expect(defaultSize("bar").w).toBeGreaterThan(defaultSize("number").w);
    expect(defaultSize("bar").h).toBeGreaterThan(defaultSize("number").h);
  });

  it("describes every chart, because the picker renders the description", () => {
    for (const c of CHARTS) {
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.blurb.split(/\s+/).length, `${c.id} needs a real blurb`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("the module stays usable from the server", () => {
  it("carries no \"use client\", because the page computes availability", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/board/charts.ts"), "utf8");
    expect(src).not.toMatch(/^\s*"use client"/m);
  });
});
