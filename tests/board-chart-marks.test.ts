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
     * AND MOVED A FOURTH TIME FOR THE LIGHT THEME, mechanically. `TargetBar`'s
     * unmet meter was `bg-neutral-500` on a `bg-neutral-500/30` track — raw ramp
     * steps, cut for the console, which on white would have been a near-black
     * bar in a grey channel. They are `--rule` and `--muted-foreground` now:
     * roles, so the meter follows the surface it is drawn on.
     *
     * Still no honesty rule moved. Zero-anchoring, `formatMetricValue` and the
     * direction-blind delta are all untouched.
     *
     * AND MOVED A FIFTH TIME FOR THE BLUE RETHEME (4 Sep 2026) — a rename,
     * not a behaviour change, but the file said "a series is a MARK and stays
     * `--marker`" two paragraphs up and that stopped being true. The Figma's
     * ramp splits jobs the single `--marker` used to hold alone: `--marker`
     * becomes the dark stroke (`brand-400`) or light stroke (`brand-800`) for
     * links, the focus ring and the active-tab rule, while the chart series —
     * Sparkbars' wash, its bars, and the breakdown's first slot — takes
     * `--color-brand-500` (`#007BFF`) directly, because after the split the
     * two tokens are no longer the same colour in either theme. `TargetBar`
     * is untouched again: it already drew in `--success`/neutral, never
     * `--marker`, so the goal-bar paragraphs above still hold.
     *
     * AND MOVED A SIXTH TIME IN THE HEADER FIX ROUND'S FIRST REVIEW PASS —
     * a radius and a documentation fix, no behaviour and no further colour
     * change. The delta chip was still `rounded-full`, missed when the fifth
     * move repainted the marks; it went to `rounded-control` on the reading
     * that the spec's "8px corners" covered it.
     *
     * A SEVENTH TIME ON 6 SEP 2026, WHICH PUT THAT RADIUS BACK. The owner's
     * metric-card export draws the delta at a full radius, and the shape rule
     * it was squared against is the CONTROL ladder — things that get pressed.
     * A status caption is not one, so the chip is a pill again, deliberately
     * and with the reason written at the call site. Colour did not move: it
     * is still the neutral wash, never red or green, because down is good for
     * Speed to Lead and bad for Booked Leads and nothing on a tile records
     * which. The rest of the diff is prose: the
     * file-level vocabulary and the `Sparkbars` comments still said "5% wash"
     * and "25% yellow line" after the fifth move repainted them blue at 12%,
     * and the "LATEST BUCKET IN INK" comment still described a black-emphasis
     * behaviour the markup has never implemented (the spec's own Deferred
     * list records that drift; this pass only stopped the comment claiming
     * otherwise). None of it changes what a single bar or wash renders.
     *
     * AN EIGHTH TIME ON 6 SEP 2026, FOR THE `node-id=14:4` OVERVIEW PASS —
     * one class removed and the rest prose. `font-medium` came off the chip's
     * OUTER span: it set the whole pill a weight above the body text it
     * qualifies, including the "vs yesterday" half, where the two-tone is
     * supposed to be built by RAISING the magnitude and never by lifting the
     * label with it. The magnitude keeps its own `font-semibold`, so the only
     * visible change is that the trailing half sits at the regular weight the
     * export draws it at. Padding, gap and radius were already the export's
     * 8/4/full and did not move.
     *
     * COLOUR STILL DID NOT MOVE, AND THIS TIME THE EXPORT ARGUES OTHERWISE.
     * `node-id=14:4` paints the chip red under "−50%" and green under "+50%",
     * and it does it on a SPEED TO LEAD tile — where −50% means the team
     * halved its response time and is the best news on the board. That is the
     * exact failure the direction-blind rule exists to prevent, drawn out in
     * the reference itself, so the geometry was adopted and the colour was
     * not. Confirmed with the owner before the change. The wash stays neutral
     * until a tile can record which direction is good.
     *
     * A NINTH TIME, SAME DAY, FOR THE CHIP'S INK. One class: the magnitude's
     * `text-foreground` came off and the pill's own `text-foreground` went to
     * `text-muted-foreground`, so BOTH halves now sit at the muted step. The
     * owner put our card beside the export's and the difference was loudness,
     * not colour — there both halves are `#7e7e7e` and the chip is plainly a
     * caption, where ours was a small WHITE sentence competing with a 28px
     * white numeral eight pixels away. Two full-ink objects on a 108px card is
     * one too many. The two-tone survives on WEIGHT alone (`font-semibold` on
     * the magnitude), which is the same device the flat state always used.
     * Still no honesty rule moved: zero-anchoring, `formatMetricValue` and the
     * direction-blind wash are untouched.
     */
    const hash = createHash("sha256").update(readFileSync(join(process.cwd(), "src/components/charts.tsx"))).digest("hex");
    expect(hash).toBe("83bbf1d2962a544099966f56cc208fd4806ffa222f12c558b0000398289716c7");
  });
});

/**
 * THE 6 SEP 2026 AXIS PASS — the owner's note on the live app was "fix the
 * metric cards … with fewer like Y axis lines and text".
 *
 * Four divisions drew five gridlines and five numbers behind a mark that is
 * usually three or four points long: a grid competing with the line it exists
 * to measure. The Figma draws three labels, a dashed floor and a thicker
 * series line.
 *
 * Source pins, plus one real call into `niceTicks` — which is where the
 * "three labels" claim is actually decided, and so the only part of it worth
 * asserting against behaviour rather than against text.
 */
describe("the axis reads three lines, and the floor is dashed", () => {
  const cartesian = readFileSync(join(process.cwd(), "src/components/board-charts/cartesian.tsx"), "utf8");

  it("asks niceTicks for two divisions, so both marks draw three labels", async () => {
    // Sabotage: drop AXIS_DIVISIONS from either call and the count returns to 5.
    expect(cartesian).toContain("const AXIS_DIVISIONS = 2;");
    // Non-greedy across the nested `Math.min(...)` / `Math.max(...)` parens.
    const calls = cartesian.match(/niceTicks\([\s\S]*?, AXIS_DIVISIONS\)/g) ?? [];
    expect(calls, "both the line and the bar mark pass it").toHaveLength(2);

    const { niceTicks } = await import("@/lib/board/scale");
    // The Figma's own example: a percent series topping out at 100.
    expect(niceTicks(0, 100, 2).ticks).toEqual([0, 50, 100]);
    // A real headline (28.2%) still gets round numbers that bracket it.
    const pickup = niceTicks(0, 28.2, 2);
    expect(pickup.ticks).toHaveLength(3);
    expect(pickup.lo).toBe(0);
    expect(pickup.hi).toBeGreaterThanOrEqual(28.2);
    // The utility's own default is untouched: four divisions, five ticks.
    expect(niceTicks(0, 97).ticks).toHaveLength(5);
  });

  it("dashes the floor, and keeps zero heavy when zero is not the floor", () => {
    const grid = cartesian.slice(cartesian.indexOf("function Gridlines"), cartesian.indexOf("A LINE, OR AN AREA UNDER IT"));
    expect(grid, "the floor is what gets the dashes").toContain("const isFloor = t === lo;");
    expect(grid).toContain('strokeDasharray={isFloor ? "4 4" : undefined}');
    expect(grid, "the floor takes the muted rule").toContain('isFloor ? "var(--color-muted-foreground)"');
    expect(grid, "a crossing series still reads magnitude against zero").toContain('t === 0 ? "var(--color-neutral-500)"');
  });

  it("draws the series line at the Figma's weight, not a hairline", () => {
    // Sabotage: put 1.5 back and this fails.
    expect(cartesian).toContain('strokeWidth="3"');
    expect(cartesian, "the hairline weight is gone from the series path").not.toContain('strokeWidth="1.5"');
  });
});

/**
 * THE nTH BUCKET OF THE PREVIOUS WINDOW UNDER THE nTH OF THIS ONE.
 *
 * That is what `compare` promises in its own prop doc — "plotted by INDEX
 * rather than by bucket, which is the whole trick" — and until hourly buckets
 * arrived nothing tested it, because nothing could violate it: every
 * day-grained window and its shifted twin have the SAME number of buckets, so
 * spacing each across its own count gave the same answer.
 *
 * Today at an hour grid is the first case where they differ. Its series stops
 * at the last hour that has begun (17 of them at 16:00) while yesterday's is a
 * complete 24, and spacing each across its own count stretches both to the full
 * width — putting 16:00 today against 23:00 yesterday and comparing this
 * afternoon with last night. The comparison is the ONE mark on the chart whose
 * entire meaning is which point it sits under.
 */
describe("the comparison line's x positions", () => {
  const day = Date.UTC(2026, 8, 10);
  const hourly = (n: number, from: number, v: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({
      bucket: new Date(from + i * 3_600_000).toISOString().slice(0, 13),
      value: v(i),
    }));

  const markup = renderToStaticMarkup(
    createElement(LineChart, {
      series: hourly(17, day, (i) => i + 1),
      compare: hourly(24, day - 86_400_000, () => 5),
      unit: "hour" as const,
      pad: { fill: 0, period: { from: day, to: day + 86_399_999 } },
      format: { format: "number" },
      accent: "#B6FF56",
    }),
  );

  /** The prior path is the one stroked in the comparison colour. */
  const priorD = markup.match(/<path d="([^"]+)"[^>]*stroke="var\(--color-series-compare\)"/)?.[1];

  it("is drawn at all", () => {
    expect(priorD, "no comparison path in the markup").toBeTruthy();
  });

  it("ends under the current window's last point, not past it or short of it", () => {
    const xs = [...priorD!.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));
    // 17 positions across the current grid: i/16*100, so the last is exactly
    // 100. Spacing 24 points across their own count instead put this at 69.6.
    expect(Math.max(...xs)).toBe(100);
    expect(new Set(xs).size).toBe(17);
  });

  it("puts hour 8 of yesterday under hour 8 of today", () => {
    const xs = [...priorD!.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));
    expect([...new Set(xs)].sort((a, b) => a - b)[8]).toBeCloseTo((8 / 16) * 100, 6);
  });
});
