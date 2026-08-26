import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHART_IDS } from "@/lib/board/charts";
import { fieldsFor } from "@/lib/board/tile-config";

// The panel's graph reaches the board's server actions through the metric
// list; node evaluates what the bundler would have severed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

const { TileConfigPanel } = await import("@/app/dashboard/tile-config-panel");

/**
 * THE PANEL OFFERS WHAT THE DRAWING READS, AND NOTHING ELSE.
 *
 * A control that changes nothing is worse than a missing one: it invites a
 * choice, accepts it, stores it, and then the tile looks exactly the same. The
 * defence is that the panel does not carry its own list — `fieldsFor(chart)`
 * decides, and `custom-tile.tsx` honours the same table, so the two cannot
 * drift into disagreeing about which settings are live.
 *
 * These render the real component with `renderToStaticMarkup` (the suite runs
 * in node, with no DOM), so what is asserted is the markup a viewer would get.
 */

const OPTIONS = [
  { key: "flow:f1:o1", title: "Booked Leads", charts: [...CHART_IDS] as string[] },
  { key: "flow:f2:o1", title: "Pickup Rate", charts: [...CHART_IDS] as string[] },
];

/** One tab renders at a time, so a control's absence must name which tab. */
const render = (over: Partial<Parameters<typeof TileConfigPanel>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TileConfigPanel, {
      chart: "bar",
      charts: [...CHART_IDS] as string[],
      config: {},
      metricName: "Booked Leads",
      tileKey: "flow:f1:o1",
      isFlow: true,
      boardRange: "7d",
      options: OPTIONS,
      busy: false,
      onClose: () => {},
      onChart: () => {},
      onMetric: () => {},
      onConfig: () => {},
      ...over,
    }),
  );

/** Both tabs at once, for assertions about what the panel offers AT ALL. */
const both = (over: Partial<Parameters<typeof TileConfigPanel>[0]> = {}) =>
  render({ ...over, initialTab: "data" }) + render({ ...over, initialTab: "style" });

describe("what the panel puts on screen", () => {
  it("shows a colour picker for a bar and none for a pie", () => {
    /**
     * The concrete case the table exists for. `PieChart` takes no accent — it
     * draws from `SLICE_ORDER` so one entity reads as one colour across every
     * tile — so a swatch grid here would be a control that does nothing.
     */
    expect(both({ chart: "bar" })).toContain("Colour");
    expect(both({ chart: "pie" })).not.toContain("Colour");
  });

  it("shows pie-only settings on the pie alone", () => {
    expect(both({ chart: "pie" })).toContain("Legend");
    expect(both({ chart: "bar" })).not.toContain("Legend");
  });

  it("never offers a control the chart's own field list omits", () => {
    // The labels the panel prints for the settings that are easy to get wrong.
    const LABEL: Record<string, string> = {
      color: "Colour",
      legend: "Legend",
      showLabels: "Label every bar",
      showSpark: "Show the trend",
      showDelta: "Compare to the period before",
      sort: "Order",
    };
    for (const id of CHART_IDS) {
      const html = both({ chart: id, charts: [...CHART_IDS] as string[] });
      const offers = new Set<string>(fieldsFor(id));
      for (const [key, label] of Object.entries(LABEL)) {
        expect(html.includes(label), `${id} ${offers.has(key) ? "should" : "must not"} offer "${label}"`).toBe(
          offers.has(key),
        );
      }
    }
  });

  it("lists only the charts this METRIC can be drawn as", () => {
    // The server computed `charts` with `chartsFor`; offering an illegal one
    // and refusing it on click would be a menu that lies.
    const html = render({ chart: "number", charts: ["number", "table"], initialTab: "style" });
    expect(html).toContain("Single number");
    expect(html).toContain("Table");
    expect(html).not.toContain("Pipeline");
  });
});

describe("the period control", () => {
  it("offers to follow the board, naming the board's own period", () => {
    expect(render({ boardRange: "30d", initialTab: "data" })).toContain("Follow the board (Last 30 days)");
  });

  it("is disabled for a classic metric, and says why", () => {
    /**
     * A classic metric is computed live for the one range the page resolved,
     * so a pin would read a window nobody computed. The renderer already
     * ignores it; the control says so rather than accepting a choice that
     * would be silently dropped.
     */
    const html = render({ isFlow: false, initialTab: "data" });
    expect(html).toContain("can&#x27;t be pinned");
    expect(html).toMatch(/<select[^>]*disabled/);
  });
});

describe("what the panel refuses to inherit", () => {
  // Comments EXPLAIN the couplings this file refuses; stripping them is what
  // stops the explanation from tripping the assertion. Same discipline as the
  // drag-rules suites and the chart kit's no-<text> rule.
  const code = readFileSync(join(process.cwd(), "src/app/dashboard/tile-config-panel.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const src = code;

  it("does not position itself against the flow canvas's chrome", () => {
    /**
     * `--spacing-chrome-band` is 106px of flow-builder toolbar island. It is a
     * fact about that canvas and about no other page, so a dashboard panel
     * offset by it would be aligned to furniture that is not there.
     */
    expect(src).not.toContain("chrome-band");
    expect(src).not.toContain("data-config-panel");
  });

  it("shares the chrome that SHOULD be shared", () => {
    // One design, not two that resemble each other.
    expect(src).toContain("PANEL_SHELL");
    expect(src).toContain("PanelTabs");
    expect(src).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  it("keeps its field list in the table rather than in itself", () => {
    // Sabotage: hard-code a chart id here and the drift starts. The panel asks
    // `fieldsFor`, and every control is gated on the answer.
    expect(src).toContain("fieldsFor(chart)");
    expect((src.match(/offers\.has\(/g) ?? []).length).toBeGreaterThan(6);
  });
});

describe("a block's panel", () => {
  /**
   * A block has no metric, so every control on Data — which one, over what
   * period, ordered how — asks a question it cannot have. The tab is HIDDEN
   * rather than rendered empty: a tab that opens onto nothing reads as a
   * feature that failed to load rather than one that does not apply.
   */
  const block = (chart: string, config = {}) =>
    render({ chart, charts: [], config, metricName: chart === "divider" ? "Divider" : "Heading" });

  it("has no Data tab at all", () => {
    expect(both({ chart: "bar" })).toContain(">data<");
    for (const kind of ["heading", "text", "divider"]) {
      expect(block(kind), `${kind} must not offer a Data tab`).not.toContain(">data<");
      expect(block(kind), `${kind} still has its Style tab`).toContain(">style<");
    }
  });

  it("shows the content field and nothing else", () => {
    const heading = block("heading", { text: "Acquisition" });
    expect(heading).toContain("Acquisition");
    // None of the chart furniture: no chart list, no colour, no decimals, no
    // goal. `fieldsFor` says so and the panel reads it rather than repeating it.
    for (const absent of ["Chart", "Colour", "Decimals", "Goal", "Legend", "Period"]) {
      expect(heading, `a heading must not offer "${absent}"`).not.toContain(`>${absent}<`);
    }
  });

  it("tells the truth about a divider, which has nothing to set", () => {
    const html = block("divider");
    expect(html).toContain("nothing to set");
    // An empty panel would read as broken; a sentence reads as an answer.
    expect(html).not.toContain("<textarea");
  });

  it("labels the field for what the block IS", () => {
    expect(block("heading")).toContain(">Heading<");
    expect(block("text")).toContain(">Note<");
  });
});
