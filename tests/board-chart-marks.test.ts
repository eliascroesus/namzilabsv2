import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GROUP_ACCENT } from "@/components/flow/node-accent";

// ChartFrame imports the freshness vocabulary from flow-tile.tsx — one
// spelling across both boards — and that module reaches the flow refresh
// action, a "use server" file node evaluates for real.
vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

const { BarsVertical, LineChart } = await import("@/components/board-charts/cartesian");
const { BarsHorizontal } = await import("@/components/board-charts/bars-horizontal");
const { PieChart, pieFooter } = await import("@/components/board-charts/pie");
const { ChartFrame } = await import("@/components/board-charts/frame");

/**
 * WHAT THE MARKS ACTUALLY EMIT.
 *
 * The chart kit's honesty rules are all invisible on a screenshot: an axis
 * that excludes zero looks like a chart, a fabricated bucket looks like data,
 * and a mark drawn under a period that could not be answered looks completely
 * normal. Each one is asserted here as bytes.
 *
 * `renderToStaticMarkup` on hook-free components — which is also a constraint
 * the kit must satisfy, since these render on both sides of the boundary.
 */

const FMT = { format: "number", precision: 0 } as const;
const DUR = { format: "duration", unit: "seconds", durationDisplay: "auto" } as const;
const series = (...v: Array<[string, number]>) => v.map(([bucket, value]) => ({ bucket, value }));

describe("the cartesian marks", () => {
  it("keeps strokes 1px however the box is stretched", () => {
    /**
     * The whole geometry decision in one attribute. The viewBox is stretched
     * with `preserveAspectRatio="none"`, so without this a tile dragged wide
     * would draw a line thick horizontally and thin vertically.
     */
    const html = renderToStaticMarkup(
      createElement(LineChart, { series: series(["2026-08-01", 3], ["2026-08-02", 6]), format: FMT, accent: "#000" }),
    );
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toContain("vector-effect=");
    expect(html).not.toContain("<text");
  });

  it("breaks the line into subpaths across a gap rather than diving to zero", () => {
    // Two runs → two `M` commands. One run with a dive would be the lie.
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        series: series(["2026-08-01", 3], ["2026-08-04", 6]),
        format: FMT,
        accent: "#000",
        unit: "day",
      }),
    );
    const path = html.match(/ d="([^"]*)"/g)?.find((d) => d.includes("M")) ?? "";
    expect((path.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("prints axis labels through the metric's own formatter", () => {
    // A duration axis reads "2h 10m", not 7800 — an axis that disagrees with
    // the headline above it is two claims about one number.
    const html = renderToStaticMarkup(
      createElement(LineChart, { series: series(["a", 0], ["b", 7800]), format: DUR, accent: "#000" }),
    );
    expect(html).toMatch(/\dh/);
    expect(html).not.toContain(">7800<");
  });

  it("anchors bars at zero even when the data sits far above it", () => {
    const html = renderToStaticMarkup(
      createElement(BarsVertical, { series: series(["a", 95], ["b", 100]), format: FMT, accent: "#000" }),
    );
    // The zero tick is on the axis, so a 5% difference draws as 5%.
    expect(html).toContain(">0<");
  });

  it("draws nothing at all for a missing bucket", () => {
    const withGap = renderToStaticMarkup(
      createElement(BarsVertical, {
        series: series(["2026-08-01", 3], ["2026-08-03", 6]),
        format: FMT,
        accent: "#000",
        unit: "day",
      }),
    );
    // Three slots, two bars — plus hit rects, which are transparent.
    const solid = (withGap.match(/<rect(?![^>]*transparent)/g) ?? []).length;
    expect(solid).toBe(2);
  });

  it("gives every bucket a hit band carrying its own pre-formatted tooltip", () => {
    // Composed where the data is, so the formatter never crosses the boundary.
    const html = renderToStaticMarkup(
      createElement(BarsVertical, { series: series(["2026-08-01", 3]), format: FMT, accent: "#000", unit: "day" }),
    );
    expect(html).toContain('data-tip="Aug 1 · 3"');
  });
});

describe("the pie", () => {
  const groups = [
    { label: "Pro", value: 6 },
    { label: "Free", value: 4 },
  ];

  it("locks its aspect, because a squeezed circle encodes angle dishonestly", () => {
    const html = renderToStaticMarkup(createElement(PieChart, { groups, format: FMT }));
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("separates slices with a card-coloured gap, not colour alone", () => {
    const html = renderToStaticMarkup(createElement(PieChart, { groups, format: FMT }));
    expect(html).toContain('stroke="var(--color-card)"');
  });

  it("names every slice in the legend, so colour is never the only encoding", () => {
    const html = renderToStaticMarkup(createElement(PieChart, { groups, format: FMT }));
    expect(html).toContain("Pro");
    expect(html).toContain("Free");
    expect(html).toContain("60%");
  });

  it("says out loud when it could not draw everything it was given", () => {
    expect(pieFooter([{ label: "in", value: 5 }, { label: "refund", value: -2 }])).toContain("at or below zero");
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `g${i}`, value: 9 - i }));
    expect(pieFooter(many, 6)).toContain("rolled into Other");
  });

  it("takes its colours from the palette by key, never a literal", () => {
    const html = renderToStaticMarkup(createElement(PieChart, { groups, format: FMT }));
    expect(html).toContain(GROUP_ACCENT.blue);
  });
});

describe("the breakdown", () => {
  const groups = Array.from({ length: 12 }, (_, i) => ({ label: `g${i}`, value: 12 - i }));

  it("shows every row in full mode and lets the tile's height decide", () => {
    const html = renderToStaticMarkup(createElement(BarsHorizontal, { groups, format: FMT, accent: "#000" }));
    expect((html.match(/data-tip=/g) ?? []).length).toBe(12);
    expect(html).toContain("overflow-y-auto");
  });

  it("sorts on request without touching the stored order by default", () => {
    const stored = renderToStaticMarkup(createElement(BarsHorizontal, { groups, format: FMT, accent: "#000" }));
    const sorted = renderToStaticMarkup(
      createElement(BarsHorizontal, { groups, format: FMT, accent: "#000", sort: "value_asc" }),
    );
    expect(stored.indexOf("g0")).toBeLessThan(stored.indexOf("g11"));
    expect(sorted.indexOf("g11")).toBeLessThan(sorted.indexOf("g0"));
  });
});

describe("ChartFrame — the mark never runs when the state is not clean", () => {
  /** Throws if it is ever rendered. Proof, not inference. */
  const Exploding = () => {
    throw new Error("the mark was rendered under a blocked state");
  };

  it("does not invoke the mark when the period cannot be answered", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ChartFrame, { title: "T", unavailable: "Division by zero.", children: createElement(Exploding) }),
      ),
    ).not.toThrow();
  });

  it("does not invoke the mark when the period is empty", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ChartFrame, { title: "T", emptyReason: "No trend in this period.", children: createElement(Exploding) }),
      ),
    ).not.toThrow();
  });

  it("DOES invoke it when the state is clean — the guarantee cuts both ways", () => {
    expect(() =>
      renderToStaticMarkup(createElement(ChartFrame, { title: "T", children: createElement(Exploding) })),
    ).toThrow(/the mark was rendered/);
  });

  it("renders unpublished and importing ALONGSIDE the number, not instead of it", () => {
    const html = renderToStaticMarkup(
      createElement(ChartFrame, {
        title: "T",
        headline: "42",
        unpublished: true,
        flowId: "f1",
        importing: { coveredMs: 86_400_000, targetMs: 8 * 86_400_000 },
        children: createElement("p", null, "the mark"),
      }),
    );
    expect(html).toContain("42");
    expect(html).toContain("the mark");
    expect(html).toContain("Edited since publishing");
    expect(html).toContain("Still importing");
  });

  it("prefers the error to the mark when a run failed", () => {
    const html = renderToStaticMarkup(
      createElement(ChartFrame, {
        title: "T",
        headline: null,
        status: "error",
        error: "Close refused the connection.",
        flowId: "f1",
        unavailable: "The last run of this flow failed.",
        children: createElement("p", null, "the mark"),
      }),
    );
    expect(html).toContain("Close refused the connection.");
    expect(html).toContain("Fix in the editor");
    expect(html).not.toContain("the mark");
    expect(html).toContain("—");
  });
});

describe("the kit's shape", () => {
  const dir = "src/components/board-charts";

  it("is server-safe everywhere except the one mark that needs state", () => {
    for (const f of readdirSync(join(process.cwd(), dir))) {
      const src = readFileSync(join(process.cwd(), dir, f), "utf8");
      const isClient = /^"use client"/m.test(src);
      if (f === "table.tsx") {
        // Pagination is state; its props are plain strings so the boundary
        // costs nothing.
        expect(isClient, "table.tsx paginates, so it is the client mark").toBe(true);
        continue;
      }
      expect(isClient, `${f} must render on either side of the boundary`).toBe(false);
      expect(src, `${f} grew a hook`).not.toMatch(/\buse(State|Effect|Ref|Reducer)\b/);
    }
  });

  it("puts no text inside an SVG, because text cannot reflow", () => {
    // Comments EXPLAIN the rule and must not be able to break it — the same
    // `code()` discipline the drag-rules suites use.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const f of readdirSync(join(process.cwd(), dir))) {
      expect(code(readFileSync(join(process.cwd(), dir, f), "utf8")), `${f} has <text> in its SVG`).not.toContain(
        "<text",
      );
    }
  });

  it("leaves charts.tsx byte-identical — it is the legacy board's vocabulary", () => {
    /**
     * `charts.tsx` is shared with the groups board and the /design gallery.
     * The kit was built BESIDE it, not into it, so the four marks the legacy
     * dashboard renders cannot move under it. A change here is a deliberate
     * act: update this hash and say why in the message.
     */
    const hash = createHash("sha256").update(readFileSync(join(process.cwd(), "src/components/charts.tsx"))).digest("hex");
    expect(hash).toBe("add06e49e5e1b3f9bd2b86e68d126191d45561c0962f82509cc8dec9e72721f5");
  });
});
