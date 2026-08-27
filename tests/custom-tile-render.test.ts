import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The tile is a client component whose import graph passes through
// flow-tile.tsx and its "use server" refresh action — mocked, because node
// evaluates what the bundler would have severed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));

const { CustomTile } = await import("@/components/custom-tile");
type CustomTileSource = Parameters<typeof CustomTile>[0]["source"] & {};

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

/**
 * PROSE ASSERTED AS PROSE, not as source text.
 *
 * Every sentence on a tile is spliced together from expressions, and JSX drops
 * the whitespace around an expression when the line wraps — which shipped
 * "3 records carryno date in this metric's time reference". A source-text
 * assertion cannot see that: the file contains the space. Only the rendered
 * string does, so the rendered string is what these read.
 */
describe("the sentences the tile writes", () => {
  const undated = (n: number) =>
    render("number", flow({ format: "number", precision: 0, byRange: { today: { value: 12, undated: n } } }))
      .replace(/<[^>]*>/g, "")
      .replace(/&#x27;|&rsquo;|\u2019/g, "'");

  it("keeps its words apart when it counts undated records", () => {
    expect(undated(3)).toContain("3 records carry no date");
    // Sabotage: splice the plural back in as `carr{n === 1 ? "ies" : "y"}` and
    // this reads "carryno date" again.
    expect(undated(3)).not.toMatch(/carry\S/);
  });

  it("agrees with itself about one record", () => {
    expect(undated(1)).toContain("1 record carries no date");
    expect(undated(1)).not.toContain("records");
  });

  it("says nothing at all when every record is dated", () => {
    expect(undated(0)).not.toContain("no date");
  });
});

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
    // ...and each one draws its own mark: the bars label their buckets, the
    // breakdown prints the group's name.
    //
    // "Aug 25", not "2026-08-25" — the kit prints bucket keys through
    // `bucketLabel`, because a raw ISO key on an axis is a storage detail
    // leaking onto the card. Both spellings are asserted, so a regression that
    // put the key back would fail here rather than merely look wrong.
    expect(asBar).toContain("Aug 25");
    expect(asBar).not.toContain("2026-08-25");
    expect(asBar).not.toContain("Afeef");
    expect(asCategory).toContain("Afeef");
    expect(asCategory).not.toContain("Aug 25");
    expect(asNumber).not.toContain("Afeef");
    expect(asNumber).not.toContain("Aug 25");
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

describe("the marks stay importable from a client component", () => {
  /**
   * `custom-tile.tsx` is a client component now, so everything it renders
   * enters the client bundle. Three properties make that safe, and each one is
   * a single careless edit away from gone:
   *
   *   no hooks — the marks are pure functions of their props;
   *   no `server-only` — nothing in their import graph refuses the client;
   *   `import type` on `@/lib/metrics/compute` — that module imports drizzle
   *   and the db schema, and ONE dropped `type` keyword ships the entire
   *   database layer to every browser.
   */
  it("charts.tsx and funnel-view.tsx carry no hooks and no server-only import", async () => {
    const { readFileSync } = await import("node:fs");
    for (const p of ["src/components/charts.tsx", "src/components/funnel-view.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src, `${p} grew a hook`).not.toMatch(/\buse(State|Effect|Ref|Callback|Memo)\b/);
      expect(src, `${p} refuses the client`).not.toMatch(/server-only/);
    }
  });

  it("every compute reference stays import type, or drizzle enters the client bundle", async () => {
    const { readFileSync } = await import("node:fs");
    for (const p of ["src/components/funnel-view.tsx", "src/components/custom-tile.tsx"]) {
      const src = readFileSync(p, "utf8");
      const refs = src.match(/import .* from "@\/lib\/metrics\/compute"/g) ?? [];
      for (const ref of refs) {
        expect(ref, `${p}: ${ref}`).toMatch(/^import type /);
      }
    }
  });
});

describe("the five states, now that the boundary carries them", () => {
  /**
   * A FlowTile has always rendered these; the canvas rendered NONE of them —
   * three were dropped where the source was built, one was spent rewording a
   * sentence, one was missing from the type. A customer mid-import, or reading
   * a number from a flow they had already rewritten, saw a clean unmarked tile.
   */
  const base = { format: "number", precision: 0, byRange: { today: { value: 4 } } };

  it("a stale tile wears the pill, not a calm dot", () => {
    const html = render("number", { kind: "flow", tile: base, status: "stale" });
    expect(html).toContain("Refreshing soon");
  });

  it("a failed run says so loudly, WITH the door out", () => {
    const html = render("number", {
      kind: "flow",
      tile: base,
      status: "error",
      error: "The Close connection was refused.",
      flowId: "f1",
    });
    // Before: status "error" only reworded the missing-range sentence — a flow
    // whose last run FAILED rendered as a calm chart over its stale number.
    expect(html).toContain("Error");
    expect(html).toContain("The Close connection was refused.");
    expect(html).toContain("/dashboard/flows/f1");
    expect(html).toContain("Fix in the editor");
  });

  it("an unpublished flow warns that the number is the published version's", () => {
    const html = render("number", { kind: "flow", tile: base, status: "fresh", unpublished: true, flowId: "f1" });
    expect(html).toContain("Edited since publishing");
    expect(html).toContain("Review &amp; publish");
  });

  it("an import in progress shows its coverage", () => {
    const html = render("number", {
      kind: "flow",
      tile: base,
      status: "fresh",
      importing: { coveredMs: 12 * 86_400_000, targetMs: 90 * 86_400_000 },
    });
    expect(html).toContain("Still importing");
    expect(html).toContain("12 of 90 days");
  });

  it("undated records are reported beside the number they are missing from", () => {
    const html = render("number", {
      kind: "flow",
      tile: { ...base, byRange: { today: { value: 4, undated: 2 } } },
      status: "fresh",
    });
    expect(html).toContain("2 records carry no date");
  });

  it("the timestamp explains itself on hover", () => {
    const html = render("number", { kind: "flow", tile: base, status: "fresh", computedAt: "2026-08-26T12:00:00Z" });
    expect(html).toMatch(/title="[^"]*2026/);
  });
});

describe("the delta tells the truth or says nothing", () => {
  it("never fabricates +100% when yesterday is missing", () => {
    /**
     * The `?? 0` bug: a today tile whose yesterday entry was absent compared
     * against zero and printed a confident +100%. `deriveDelta`'s rules —
     * shared from the groups board, not re-derived — refuse a comparison with
     * no honest prior.
     */
    const html = render("number", {
      kind: "flow",
      tile: { format: "number", precision: 0, byRange: { today: { value: 4 } } },
      status: "fresh",
    });
    expect(html).not.toContain("+100%");
    expect(html).not.toContain("yesterday");
  });

  it("compares against a real yesterday when one exists", () => {
    const html = render("number", {
      kind: "flow",
      tile: { format: "number", precision: 0, byRange: { today: { value: 4 }, yesterday: { value: 2 } } },
      status: "fresh",
    });
    expect(html).toContain("yesterday");
  });

  it("refuses an unavailable yesterday exactly like a missing one", () => {
    const html = render("number", {
      kind: "flow",
      tile: {
        format: "number",
        precision: 0,
        byRange: { today: { value: 4 }, yesterday: { unavailable: "Division by zero." } },
      },
      status: "fresh",
    });
    expect(html).not.toContain("yesterday");
  });
});

/**
 * A TILE THAT ANSWERS FOR ITS OWN PERIOD.
 *
 * Every materialized range already rides in the tile's `byRange`, so pinning
 * one is a different key read from data the client is already holding — no
 * round trip, no second query. The risk it carries is the whole reason these
 * exist: a tile silently answering a different question from the one the pill
 * above it says is being asked. So the override has to announce itself, and it
 * has to be refused where it cannot be honoured.
 */
describe("the tile's own period", () => {
  const TWO_PERIODS = {
    format: "number",
    precision: 0,
    byRange: { today: { value: 12 }, "7d": { value: 99 } },
  };

  it("reads the pinned slot rather than the board's", () => {
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Booked",
        rangeKey: "today",
        source: flow(TWO_PERIODS),
        config: { rangeKey: "7d" as const },
      }),
    );
    expect(html).toContain("99");
    expect(html).not.toContain(">12<");
  });

  it("says so beside the title, because a silent override is the failure", () => {
    const pinned = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Booked",
        rangeKey: "today",
        source: flow(TWO_PERIODS),
        config: { rangeKey: "7d" as const },
      }),
    );
    expect(pinned).toContain("Last 7 days");
  });

  it("says nothing when it agrees with the board — there is nothing to say", () => {
    const following = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Booked",
        rangeKey: "7d",
        source: flow(TWO_PERIODS),
        config: { rangeKey: "7d" as const },
      }),
    );
    expect(following).not.toContain("Last 7 days");
    expect(following).toContain("99");
  });

  it("IGNORES the pin on a classic metric, which has only one computed period", () => {
    /**
     * A classic metric is computed live for the one range the page resolved.
     * Honouring a stored override would read a window nobody computed — and
     * worse, would print a label claiming a period the number is not for.
     */
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Pickup",
        rangeKey: "today",
        source: { kind: "classic" as const, result: { kind: "scalar" as const, value: 7 }, target: null },
        config: { rangeKey: "7d" as const },
      }),
    );
    expect(html).toContain("7");
    expect(html).not.toContain("Last 7 days");
  });
});

describe("only the settings this chart uses reach the mark", () => {
  it("ignores a setting left behind by a previous chart", () => {
    /**
     * Set a colour on a bar chart, switch the tile to a pie: the stored key
     * survives (switch back and it returns) but the pie draws from
     * `SLICE_ORDER` and must not read it. `honoured()` drops it before the mark
     * is called, so the panel and the renderer cannot disagree about which
     * settings are live.
     */
    const groups = {
      format: "number",
      precision: 0,
      byRange: { today: { groups: [{ label: "Pro", value: 6 }, { label: "Free", value: 4 }] } },
    };
    const withColor = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "pie",
        title: "Plan",
        rangeKey: "today",
        source: flow(groups),
        config: { color: "olive" as const },
      }),
    );
    const without = renderToStaticMarkup(
      createElement(CustomTile, { chart: "pie", title: "Plan", rangeKey: "today", source: flow(groups) }),
    );
    // Byte-identical: the colour changed nothing, which is why the panel does
    // not offer it. Sabotage: add "color" to CONFIG_FIELDS.pie and this still
    // passes — but the panel then shows a swatch that does nothing, which is
    // what tests/tile-config.test.ts asserts against.
    expect(withColor).toBe(without);
  });
});

describe("a pin the tile cannot honour", () => {
  it("says the period was not computed instead of showing un-windowed figures", () => {
    /**
     * A tile stored before `byRange` existed has only top-level figures. Asked
     * for a pinned period it used to fall through to those and print an
     * ALL-TIME number under a "Today" marker — a confidently wrong answer of
     * exactly the species the marker was added to prevent.
     */
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Booked",
        rangeKey: "7d",
        source: flow({ format: "number", precision: 0, value: 500 }),
        config: { rangeKey: "today" as const },
      }),
    );
    expect(html).not.toContain("500");
    expect(html).toContain("Not computed yet for this period");
  });

  it("still falls back for a tile that is NOT pinned — the old path is intact", () => {
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "number",
        title: "Booked",
        rangeKey: "7d",
        source: flow({ format: "number", precision: 0, value: 500 }),
      }),
    );
    expect(html).toContain("500");
  });
});

describe("a trend with nothing to trend", () => {
  const oneBucket = { series: [{ bucket: "2026-08", value: 26 }], value: 26 };

  it("names the chart, so two tiles of one metric are told apart", () => {
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "area",
        title: "On Calendar",
        rangeKey: "7d",
        source: flow({ format: "number", precision: 0, byRange: { "7d": { ...oneBucket, unit: "day" } } }),
      }),
    );
    expect(html).toContain("an area needs at least two");
  });

  it("says a stale row is stale rather than blaming the range", () => {
    /**
     * A slot with a series but NO unit was bucketed by the old engine, which
     * used the metric's declared `timeUnit` — "month" by default — so a week
     * came back as one point and so would ninety days. Telling somebody to
     * pick a longer range is advice that cannot work; the row needs recomputing
     * and every tile does that at least daily.
     */
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "line",
        title: "On Calendar",
        rangeKey: "7d",
        source: flow({ format: "number", precision: 0, timeUnit: "month", byRange: { "7d": oneBucket } }),
      }),
    );
    expect(html).toContain("Refresh all");
    expect(html).not.toContain("pick a longer range");
  });

  it("draws the trend once the window carries enough points", () => {
    const html = renderToStaticMarkup(
      createElement(CustomTile, {
        chart: "line",
        title: "On Calendar",
        rangeKey: "7d",
        source: flow({
          format: "number",
          precision: 0,
          byRange: {
            "7d": {
              unit: "day",
              value: 26,
              series: [
                { bucket: "2026-08-24", value: 9 },
                { bucket: "2026-08-25", value: 8 },
                { bucket: "2026-08-26", value: 9 },
              ],
            },
          },
        }),
      }),
    );
    expect(html).not.toContain("needs at least two");
    // Labelled in the slice's OWN unit — days, not the metric's declared month.
    expect(html).toContain("Aug 24");
  });
});
