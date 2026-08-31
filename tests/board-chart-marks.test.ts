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

  it("DRAWS an isolated bucket instead of emitting an unstrokable moveto", () => {
    /**
     * THE BUG THIS FILE ASSERTED FOR WEEKS. `padSeries` turns a quiet bucket
     * into a null and each run opens with `M`, so a run of ONE emitted a lone
     * moveto — which no SVG renderer strokes. Alternate-day data therefore drew
     * a completely blank plot, and the subpath count above passed green over it,
     * because two invisible runs are still two `M`s.
     *
     * A zero-length segment picks up `stroke-linecap="round"` and renders as
     * the dot it always should have been. Sabotage: drop the `L` and every run
     * of one vanishes again.
     */
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        series: series(["2026-08-01", 3], ["2026-08-03", 5], ["2026-08-05", 4]),
        format: FMT,
        accent: "#000",
        unit: "day",
      }),
    );
    const path = html.match(/ d="([^"]*)"/g)?.find((d) => d.includes("M")) ?? "";
    // Every run must carry a drawing command, not just a cursor move.
    for (const run of path.split("M ").slice(1)) {
      expect(run.trim(), `a run with no L draws nothing: "${run.trim()}"`).toContain("L");
    }
  });

  it("breaks the AREA at the gaps too, rather than filling across them", () => {
    /**
     * The fill was one polygon over the non-null points, so it ran straight
     * across every quiet bucket while the stroke honestly broke — a confident
     * shape covering days with no data. One polygon per run, so both marks tell
     * the same story.
     */
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        series: series(["2026-08-01", 3], ["2026-08-04", 6]),
        format: FMT,
        accent: "#000",
        unit: "day",
        area: true,
      }),
    );
    const fill = html.match(/ d="([^"]*)"/g)?.find((d) => d.includes("Z")) ?? "";
    // Two runs, two closed polygons.
    expect((fill.match(/Z/g) ?? []).length).toBe(2);
  });

  it("keeps a negative goal on the axis instead of drawing it off-canvas", () => {
    // The target was folded into the max but not the min, so a negative goal
    // rendered 250% below a `0 0 100 100` viewBox: invisible, with nothing to
    // say the goal existed.
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        series: series(["a", 10], ["b", 20]),
        format: FMT,
        accent: "#000",
        target: -50,
      }),
    );
    const dashed = html.match(/<line[^>]*stroke-dasharray[^>]*>/)?.[0] ?? "";
    const y = Number(dashed.match(/y1="([-\d.]+)"/)?.[1] ?? NaN);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(100);
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
     *
     * MOVED FOR THE BRAND SHEET'S COLOUR PASS. The marks were the last neutral
     * surface in the product — a grey delta pill, grey gutters and one flat
     * violet — and they are what people actually look at. They now spend the
     * sheet's ratio on data: violet fills the series, ink emphasises (the
     * bucket a series ends on, a delta that moved), and the accent four
     * decorate a breakdown's rows, where every row is named in its own label
     * so no hue encodes identity. Yellow stays out: it is the hero, once per
     * screen, and a dashboard is a wall of these.
     *
     * NONE OF THE HONESTY RULES MOVED WITH IT, which is the thing this freeze
     * is really guarding — bars are still zero-anchored, every value still
     * goes through `formatMetricValue`, and the delta still paints up and down
     * identically so it cannot invent a direction.
     *
     * MOVED AGAIN FOR THE CHARCOAL/YELLOW REBRAND, and the note above is why
     * the change was mechanical rather than a redesign. The marks were spelled
     * `bg-primary` — the role, correctly — and `--primary` stopped being violet
     * and became #eecf00. Six class names moved from `primary` to `marker` so
     * the series stay the colour that paragraph already chose for them.
     *
     * Leaving them would have been the silent failure that gate exists to
     * catch: `bg-primary` still compiles, so nothing would have failed, and a
     * dashboard's worth of series bars would have rendered at roughly 1.1:1 on
     * a white card.
     *
     * AND MOVED ONCE MORE FOR THE DARK CONSOLE — one component, and this time
     * it is a BEHAVIOUR change rather than a rename, which is exactly what this
     * hash exists to force somebody to write down.
     *
     * `TargetBar` drew an unmet meter in `--marker` and a met one in
     * `--success`. That was a real distinction while the marker was violet and
     * success was green; they are the SAME GREEN now — `--success` is
     * `brand-500` — so the component rendered both states identically and
     * stopped reporting the only thing it exists to report.
     *
     * The unmet meter is greyscale and colour ARRIVES when the goal lands. The
     * state is carried by a colour appearing rather than by one colour becoming
     * another, which is also the honest reading of the kit's own rule that green
     * means good: a bar at 40% is not good, it is 40%.
     *
     * The series marks themselves are untouched — a series is a MARK and stays
     * `--marker`, and the argument above about a bar carrying no ink of its own
     * is satisfied either way now, since both steps of the green ramp clear 8:1
     * on a card.
     *
     * Still no honesty rule moved. Zero-anchoring, `formatMetricValue` and the
     * direction-blind delta are all untouched.
     */
    const hash = createHash("sha256").update(readFileSync(join(process.cwd(), "src/components/charts.tsx"))).digest("hex");
    expect(hash).toBe("2b041883c78dbe465437f969d328b30b239cf1bd03026d80d39e4c52c0afea59");
  });
});
