import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BLOCK_IDS,
  CHARTS,
  CHART_IDS,
  blockKindOf,
  blockTileKey,
  chartsFor,
  defaultSize,
  minSize,
  type MetricShape,
} from "@/lib/board/charts";
import { fieldsFor, parseTileConfig } from "@/lib/board/tile-config";
import { canvasRowFate } from "@/lib/board/types";

vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

const { CustomTile } = await import("@/components/custom-tile");

/**
 * FURNITURE ON A BOARD OF NUMBERS.
 *
 * A heading, a note and a rule are tiles in every way that matters to the grid
 * — a box, a position, a size, a drag — and in no way that matters to a metric.
 * That double nature is where the mistakes are, and each one below is a place
 * the two halves could be confused for one another:
 *
 *   · `chartsFor` must never return one. "Heading" is not a way of drawing
 *     Booked Leads, and offering it as one is the category error the whole
 *     registry exists to prevent.
 *   · The renderer must answer the block BEFORE it answers a missing metric,
 *     because a block's source is null for a completely different reason.
 *   · The page's row classifier must do the same, or every block on every
 *     board reads as a deleted metric.
 */

const EVERY_SHAPE: MetricShape[] = [];
for (let i = 0; i < 32; i++) {
  EVERY_SHAPE.push({
    scalar: !!(i & 1),
    series: !!(i & 2),
    groups: !!(i & 4),
    target: !!(i & 8),
    funnel: !!(i & 16),
  });
}

describe("a block is not a way of drawing a metric", () => {
  it("is never offered by chartsFor, for any shape a metric can have", () => {
    // All 32 combinations, not a sample: a block leaking into one branch is
    // exactly the kind of thing a handful of examples misses.
    for (const shape of EVERY_SHAPE) {
      const offered = chartsFor(shape);
      for (const block of BLOCK_IDS) {
        expect(offered, `chartsFor offered "${block}" for ${JSON.stringify(shape)}`).not.toContain(block);
      }
    }
  });

  it("is still a real chart id, because the tile IS drawn as one", () => {
    // The registry holds it — it has a label, a blurb and a default size — it
    // simply never appears as an answer to "what can this metric be?".
    for (const block of BLOCK_IDS) expect(CHART_IDS).toContain(block);
  });

  it("carries the sizes a full-width heading and a one-row rule need", () => {
    expect(defaultSize("heading")).toEqual({ w: 12, h: 2 });
    expect(defaultSize("text")).toEqual({ w: 6, h: 3 });
    expect(defaultSize("divider")).toEqual({ w: 12, h: 1 });
    // Minimums stay under the defaults, or a new block cannot be shrunk at all.
    for (const block of BLOCK_IDS) {
      const c = CHARTS.find((k) => k.id === block)!;
      expect(c.minW, `${block} minW`).toBeLessThanOrEqual(c.w);
      expect(c.minH, `${block} minH`).toBeLessThanOrEqual(c.h);
    }
  });
});

describe("the block: sentinel", () => {
  it("names exactly the three kinds and nothing else", () => {
    for (const block of BLOCK_IDS) expect(blockKindOf(blockTileKey(block))).toBe(block);
    expect(blockKindOf("block:sunburst")).toBeNull();
    expect(blockKindOf("block:")).toBeNull();
    expect(blockKindOf("blockheading")).toBeNull();
    expect(blockKindOf("flow:f1:o1")).toBeNull();
    expect(blockKindOf("metric:m1")).toBeNull();
  });

  it("is what stops a block being read as a deleted metric", () => {
    /**
     * A block joins to no metric and is in no unfiltered key set, which is
     * indistinguishable from a deletion by every other test the classifier
     * performs. Without the block branch this returns "dead" and the board
     * draws "It isn't published any more" over every heading on it.
     */
    expect(canvasRowFate(blockTileKey("heading"), false, new Set())).toBe("render");
    expect(canvasRowFate(blockTileKey("divider"), false, new Set())).toBe("render");
    // And an unknown block kind is still dead, because nothing can draw it.
    expect(canvasRowFate("block:sunburst", false, new Set())).toBe("dead");
  });
});

describe("what a block offers to configure", () => {
  it("gives heading and text their content, and the divider nothing", () => {
    expect(fieldsFor("heading")).toContain("text");
    expect(fieldsFor("text")).toContain("text");
    expect(fieldsFor("divider")).not.toContain("text");
  });

  it("gives all three a title, for the menu's benefit", () => {
    for (const block of BLOCK_IDS) expect(fieldsFor(block)).toContain("title");
  });

  it("gives none of them a period — there is no data to window", () => {
    for (const block of BLOCK_IDS) expect(fieldsFor(block)).not.toContain("rangeKey");
  });

  it("costs a corrupt text key only itself", () => {
    // The same independent-key promise every other setting gets.
    expect(parseTileConfig({ text: 42, color: "teal" })).toEqual({ color: "teal" });
    expect(parseTileConfig({ text: "  Acquisition  " })).toEqual({ text: "Acquisition" });
    expect(parseTileConfig({ text: "" })).toEqual({});
    expect(parseTileConfig({ text: "x".repeat(2001) })).toEqual({});
  });
});

const render = (chart: string, config: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(CustomTile, { chart, title: "T", rangeKey: "today", source: null, config } as never),
  );

describe("how a block renders", () => {
  it("draws its words rather than a dead metric, though its source is null", () => {
    /**
     * THE ORDERING BUG, as an assertion. A block points at nothing on purpose,
     * so `source` is null exactly as a deleted metric's is — branch on the
     * source first and every block on every board becomes a DeadTile.
     */
    const html = render("heading", { text: "Acquisition" });
    expect(html).toContain("Acquisition");
    expect(html).not.toContain("Metric unavailable");
    expect(html).not.toContain("isn’t published any more");
  });

  it("wears no card, because a heading is text on the canvas", () => {
    const heading = render("heading", { text: "Acquisition" });
    const chartTile = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Booked",
        rangeKey: "today",
        source: { kind: "flow", status: "fresh", tile: { format: "number", byRange: { today: { value: 1 } } } },
      } as never),
    );
    // `Card` brings all three; a block brings none of them.
    for (const chrome of ["rounded-surface", "shadow-card", "bg-card"]) {
      expect(chartTile, `a chart tile has ${chrome}`).toContain(chrome);
      expect(heading, `a block must not have ${chrome}`).not.toContain(chrome);
    }
  });

  it("draws the divider as a rule and not as a box", () => {
    const html = render("divider");
    expect(html).toContain("h-px");
    expect(html).not.toContain("rounded-surface");
    // Nothing to read out: it is decoration, and a screen reader announcing
    // "divider, blank" on every section break is noise.
    expect(html).toContain('role="presentation"');
  });

  it("shows a placeholder when empty, so the box is never invisible", () => {
    // An empty block still occupies its grid slot; rendering nothing leaves a
    // hole that can only be found by dragging into it.
    expect(render("heading")).toContain("Heading");
    expect(render("text")).toContain("Write a note");
  });

  it("keeps the line breaks somebody typed", () => {
    expect(render("text", { text: "One\nTwo" })).toContain("whitespace-pre-line");
  });

  it("ignores a period pinned to it, having no data to window", () => {
    // `honoured` drops the key before the block sees it — the field table says
    // a block has no `rangeKey`, and this is the renderer half of that.
    const html = render("heading", { text: "Acquisition", rangeKey: "7d" });
    expect(html).not.toContain("Last 7 days");
  });
});

/**
 * THE SMALLEST BOX A CHART IS STILL ITSELF IN.
 *
 * `minW`/`minH` sat in the CHARTS table with nothing reading them: the drag
 * hardcoded one global 2×3 floor and the menu's size presets applied none at
 * all. A line chart squeezed to three rows has zero height left for its axis
 * frame, and `overflow-hidden` ate the whole plot — the tile kept its border
 * and its number and silently lost its chart.
 */
describe("how small a chart may be made", () => {
  it("gives every chart a floor no bigger than its default", () => {
    for (const id of CHART_IDS) {
      const min = minSize(id);
      const def = defaultSize(id);
      expect(min.w, `${id} cannot be shrunk to its minimum`).toBeLessThanOrEqual(def.w);
      expect(min.h, `${id} cannot be shrunk to its minimum`).toBeLessThanOrEqual(def.h);
    }
  });

  it("never lets a metric card shrink below a standard one", () => {
    // 3x4 is what a tile on the groups board is, and nothing calling itself a
    // metric card should be smaller than one.
    for (const id of ["number", "progress"] as const) {
      expect(minSize(id)).toEqual({ w: 3, h: 4 });
    }
  });

  it("gives the cartesian family the extra row its axis frame needs", () => {
    // Measured, not guessed: at ROW_UNIT_PX 40 and p-4, four rows leaves 38px
    // for an axis frame that needs 49 with five ticks — the x-labels clip.
    for (const id of ["line", "area", "bar", "category", "table"] as const) {
      expect(minSize(id).h, `${id} needs five rows`).toBeGreaterThanOrEqual(5);
    }
  });

  it("is actually READ by both paths that resize a tile", async () => {
    /**
     * The pin that matters. A table of minimums nothing consults is decoration;
     * these two call sites are the only ways a tile changes size.
     */
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/dashboard/canvas-drag.ts", "utf8"), "the drag ignores the per-chart floor").toContain(
      "minOf?.(b.id)",
    );
    const board = readFileSync("src/app/dashboard/custom-board.tsx", "utf8");
    expect(board, "the board never tells the drag what the floor is").toContain("minOf");
    expect(board, "the menu's size presets apply no floor").toContain("Math.max(min.w, w)");
  });
});
