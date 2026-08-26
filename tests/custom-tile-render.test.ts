import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomTile, type CustomTileSource } from "@/components/custom-tile";

/**
 * THE TILE THAT DRAWS WHAT IT WAS ASKED TO DRAW.
 *
 * `src/components/flow-tile.tsx:202-212` picks its mark from data presence
 * alone — series, then groups, then target — and never reads the `viz` the
 * publisher chose. That is why `ReviewPublishModal` labels three of its own
 * options "(draws bars)": the field has been decorative since the day it was
 * written, and the interface says so out loud rather than fixing it.
 *
 * On a custom view, picking the chart IS the interaction, so the first
 * assertion below is the one `FlowTile` could never pass: the same data, asked
 * for two different charts, must produce two different drawings.
 *
 * The second half is the consequence. A component that honours the request can
 * be asked for a drawing the data cannot support, which a presence-driven one
 * never could — so every one of those cases has to say so rather than quietly
 * rendering something else. Substituting a mark is the exact failure this file
 * exists to prevent, and it would be worse here than in FlowTile, because here
 * somebody explicitly asked.
 */

const flow = (tile: Record<string, unknown>): CustomTileSource => ({ kind: "flow", tile, status: "fresh" });

const render = (chart: string, source: CustomTileSource | null, rangeKey = "today", title = "Booked Leads") =>
  renderToStaticMarkup(createElement(CustomTile, { chart, title, rangeKey, source }));

/** A metric with a headline, a trend and a breakdown — every chart is legal. */
const RICH = {
  format: "number",
  precision: 0,
  value: 12,
  byRange: {
    today: {
      value: 12,
      series: [
        { bucket: "2026-08-24", value: 4 },
        { bucket: "2026-08-25", value: 8 },
      ],
      groups: [
        { label: "Afeef", value: 7 },
        { label: "Armaan", value: 5 },
      ],
    },
    yesterday: { value: 8 },
  },
};

describe("the chart is honoured, not inferred", () => {
  it("draws the same data two different ways when asked for two different charts", () => {
    // THE ASSERTION FlowTile CANNOT PASS. Presence-driven rendering returns the
    // identical markup for both of these, because the data decides and the
    // request is ignored.
    const asNumber = render("number", flow(RICH));
    const asBar = render("bar", flow(RICH));
    const asCategory = render("category", flow(RICH));

    expect(asNumber).not.toBe(asBar);
    expect(asBar).not.toBe(asCategory);
    // ...and each one draws its own mark. Sparkbars titles each bar with its
    // bucket; GroupBars prints the group's name.
    expect(asBar).toContain("2026-08-25");
    expect(asBar).not.toContain("Afeef");
    expect(asCategory).toContain("Afeef");
    expect(asCategory).not.toContain("2026-08-25");
    expect(asNumber).not.toContain("Afeef");
    expect(asNumber).not.toContain("2026-08-25");
  });

  it("prints the headline on every chart but the funnel", () => {
    for (const chart of ["number", "bar", "category"]) {
      expect(render(chart, flow(RICH)), `${chart} lost its number`).toContain("12");
    }
  });

  it("reads the ACTIVE range, not the tile's all-time figures", () => {
    const t = { ...RICH, value: 999, byRange: { ...RICH.byRange, "7d": { value: 40 } } };
    expect(render("number", flow(t), "7d")).toContain("40");
    // Sabotage: fall back to the stored top-level value and the board shows an
    // all-time number under a seven-day pill — the bug the range work fixed.
    expect(render("number", flow(t), "7d")).not.toContain("999");
  });
});

describe("a chart it cannot draw says so, and never substitutes", () => {
  it("says there is no trend rather than falling back to the number's mark", () => {
    const quiet = {
      format: "number",
      precision: 0,
      byRange: { today: { value: 0 }, "7d": { value: 5, series: [{ bucket: "b", value: 5 }] } },
    };
    const html = render("bar", flow(quiet), "today");
    expect(html).toContain("No trend in this period");
    // The metric CAN be a bar chart — a quiet day is not an illegal chart, and
    // must not be reported as one.
    expect(html).not.toContain("change the chart");
  });

  it("says the metric cannot be drawn this way when the chart is genuinely illegal", () => {
    // A scalar-only metric asked for a breakdown. It was repointed, or the flow
    // was republished into a different shape.
    const scalar = { format: "number", precision: 0, byRange: { today: { value: 3 } } };
    expect(render("category", flow(scalar))).toContain("change the chart");
  });

  it("refuses to draw progress with no target, rather than inventing one", () => {
    const noTarget = { format: "number", precision: 0, byRange: { today: { value: 3 } } };
    expect(render("progress", flow(noTarget))).toContain("change the chart");
  });

  it("draws progress when a target really is set", () => {
    const withTarget = { format: "number", precision: 0, target: 10, byRange: { today: { value: 4 } } };
    const html = render("progress", flow(withTarget));
    expect(html).toContain("Goal");
    expect(html).not.toContain("change the chart");
  });

  it("never draws a funnel from a flow metric", () => {
    // `FunnelView` eats a classic FunnelResult and no flow shape produces one,
    // so `shapeOfTile` never reports a funnel and the chart is simply illegal
    // here — answered by the same sentence every other illegal chart gets,
    // rather than by a dead branch of its own.
    expect(render("funnel", flow(RICH))).toContain("change the chart");
  });
});

describe("the three states that are not a number", () => {
  it("shows an em-dash, not a zero, when the period has no answer", () => {
    const t = { format: "number", precision: 0, byRange: { today: { unavailable: "Division by zero — check the second number." } } };
    const html = render("number", flow(t));
    expect(html).toContain("—");
    expect(html).toContain("Division by zero");
    // "No answer for this period" and "the answer is zero" are different facts,
    // and the tile that conflates them is the one nobody can trust.
    expect(html).not.toMatch(/>0</);
  });

  it("keeps its box and explains itself when the metric is gone", () => {
    const html = render("bar", null);
    expect(html).toContain("Metric unavailable");
    expect(html).toContain("Booked Leads");
    // A placement on the groups board is filtered away silently; this one was
    // deliberately placed and sized, so it stays and says why.
    expect(html).toContain("h-full");
  });

  it("reports a range that was never computed", () => {
    const t = { format: "number", precision: 0, byRange: { today: { value: 1 } } };
    expect(render("number", flow(t), "90d")).toContain("Not computed yet");
  });
});

describe("every tile fills the box the grid gave it", () => {
  it("is h-full, because the cell owns the height now", () => {
    // The one structural difference from FlowTile, which is content-height. A
    // tile that does not fill its cell leaves the grid looking broken at any
    // height the user drags it to.
    for (const source of [flow(RICH), null]) {
      expect(render("number", source)).toContain("h-full");
    }
  });
});
