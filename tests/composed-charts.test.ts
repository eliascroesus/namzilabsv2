import { describe, expect, it } from "vitest";
import { funnelFromCounts, widensAt } from "@/lib/metrics/funnel";
import { composeFunnel, composePie, isRefusal, type ComposeMember } from "@/lib/board/compose";
import { chartsFor, shapeOfClassic, shapeOfTile, NO_SHAPE, CHART_IDS, type MetricShape } from "@/lib/board/charts";
import { PARTS_SLOT, composes, parseTileConfig, CONFIG_FIELDS, honoured } from "@/lib/board/tile-config";
import { seedMetricFacts } from "@/lib/flow/types";

/**
 * COMPOSED FUNNELS AND PIES — the rules, as assertions.
 *
 * Every claim here is about a SENTENCE or a NUMBER that a pure function
 * returns, which is the whole reason the refusals live in `compose.ts` rather
 * than as branches inside the renderer's ternary ladder. A rule written as JSX
 * can only be tested by rendering and grepping the output, and this repo's
 * standing note is that grep-shaped checks degrade to "no match = pass" exactly
 * when a union widens — which is what adding three charts to a legality rule
 * does.
 *
 * Each test below was run against the unmodified code first and watched to
 * fail. Where a test would have passed vacuously, it says so and asserts the
 * thing that makes it capable of failing.
 */

const FUNNEL_SLOT = PARTS_SLOT.funnel;
const PIE_SLOT = PARTS_SLOT.pie;

/** A well-formed member. Tests override exactly the field under test. */
const member = (over: Partial<ComposeMember> = {}): ComposeMember => ({
  label: "Total Leads",
  value: 100,
  countable: true,
  additive: true,
  hasPeriods: true,
  timeField: "created_at",
  format: { format: "number" },
  ...over,
});

const refusalOf = (out: ReturnType<typeof composeFunnel> | ReturnType<typeof composePie>) =>
  isRefusal(out) ? out.refusal : null;

describe("the funnel arithmetic, shared with the classic engine", () => {
  it("points at no bottleneck when nobody actually fell out", () => {
    /**
     * THE BUG THIS FIXES, STATED AS THE CASE THAT USED TO FAIL. `worstDrop`
     * started at -1 and the test was `drop > worstDrop`, so a drop of ZERO beat
     * it — every FLAT funnel printed a red "Biggest drop-off" pill over stage 2,
     * and so did every funnel whose stages were all zero because the day was
     * young. A healthy funnel is the commonest way to hit it.
     */
    expect(funnelFromCounts([{ label: "a", count: 10 }, { label: "b", count: 10 }]).bottleneckIndex).toBeNull();
    expect(funnelFromCounts([{ label: "a", count: 0 }, { label: "b", count: 0 }]).bottleneckIndex).toBeNull();
    // A rising funnel has no drop either.
    expect(funnelFromCounts([{ label: "a", count: 5 }, { label: "b", count: 9 }]).bottleneckIndex).toBeNull();
  });

  it("still points at the largest real drop", () => {
    // The half that must NOT change — otherwise the fix above is just a delete.
    const r = funnelFromCounts([
      { label: "a", count: 100 },
      { label: "b", count: 90 },
      { label: "c", count: 20 },
      { label: "d", count: 18 },
    ]);
    expect(r.bottleneckIndex).toBe(2);
  });

  it("divides by zero nowhere", () => {
    const r = funnelFromCounts([{ label: "a", count: 0 }, { label: "b", count: 3 }]);
    for (const s of r.stages) {
      expect(Number.isFinite(s.conversionFromFirst), "conversionFromFirst went infinite").toBe(true);
      expect(Number.isFinite(s.conversionFromPrev), "conversionFromPrev went infinite").toBe(true);
    }
  });

  it("names every stage wider than the FIRST, not merely wider than its neighbour", () => {
    /**
     * 100 -> 400 -> 250. Comparing adjacent stages names stage 1 and stays
     * silent about stage 2, which is 250% of the top and clipped just as flat
     * by an `overflow-hidden` track. The reader would see two identical
     * full-width bars and one sentence explaining only one of them.
     */
    expect(widensAt([{ count: 100 }, { count: 400 }, { count: 250 }])).toEqual([1, 2]);
    expect(widensAt([{ count: 100 }, { count: 90 }, { count: 80 }])).toEqual([]);
    // A zero first stage has no "wider than" to be measured against.
    expect(widensAt([{ count: 0 }, { count: 5 }])).toEqual([]);
  });
});

describe("what a composed funnel refuses to draw", () => {
  it("asks for a refresh when a member predates the stamps, rather than calling it the wrong kind", () => {
    // undefined is "not restamped yet" and FALSE is "no" — they earn different
    // sentences, and only one of them has a button attached.
    const out = composeFunnel([member(), member({ label: "Booked", countable: undefined })], FUNNEL_SLOT);
    expect(refusalOf(out)).toMatch(/Refresh all/);
    expect(refusalOf(out)).toContain("Booked");
  });

  it("refuses a duration or a rate as a stage, naming it", () => {
    /**
     * The composition a reader of this board is most likely to try first, and
     * the one that used to be offered on 17 of 18 tiles. Both renderers
     * hardcode `{format:"number"}`, so a duration stage does not merely
     * mismatch — its unit is DISCARDED and 252 minutes prints as "252" beside
     * "420 leads" with a red drop-off pill over the pair.
     */
    const out = composeFunnel(
      [member(), member({ label: "Speed to Lead", countable: false, format: { format: "duration" } })],
      FUNNEL_SLOT,
    );
    expect(refusalOf(out)).toContain("Speed to Lead");
    expect(refusalOf(out)).toMatch(/length of time/);
  });

  it("refuses a member that has never been computed for a period", () => {
    // A row with no byRange answers every period with its all-time figure. That
    // is safe for one tile answering for itself and unsafe the moment it is
    // MIXED: stage 1 all-time under stage 2 last-7-days, both real numbers,
    // nothing on screen to say so.
    const out = composeFunnel([member(), member({ label: "Legacy", hasPeriods: false })], FUNNEL_SLOT);
    expect(refusalOf(out)).toContain("Legacy");
    expect(refusalOf(out)).toMatch(/never been computed for a period/);
  });

  it("refuses members measured in different things", () => {
    const out = composeFunnel(
      [member({ format: { format: "currency", currency: "USD" } }), member({ label: "Deals" })],
      FUNNEL_SLOT,
    );
    expect(refusalOf(out)).toMatch(/different units/);
  });

  it("refuses two members with the same name", () => {
    // Two flows may publish the same metric name, so this is reachable with no
    // duplication bug at all — and a funnel with two identically labelled
    // stages cannot be read whichever way it is drawn.
    const out = composeFunnel([member({ label: "Leads" }), member({ label: "Leads" })], FUNNEL_SLOT);
    expect(refusalOf(out)).toMatch(/same name/);
  });

  it("tells zero apart from missing", () => {
    // A count metric on a quiet day is 0, measured. Null is "cannot answer".
    // Rendering them identically is the failure this rung exists to prevent.
    expect(refusalOf(composeFunnel([member(), member({ label: "Booked", value: null })], FUNNEL_SLOT))).toContain(
      "no number in this period",
    );
    const zero = composeFunnel([member(), member({ label: "Booked", value: 0 })], FUNNEL_SLOT);
    expect(isRefusal(zero), "a zero stage is a fact, not a refusal").toBe(false);
  });

  it("refuses a zero first stage, because the drawing would contradict its own labels", () => {
    /**
     * With first = 0 every conversion guard yields 0, `stageWidths` returns its
     * 4% floor for every stage and FunnelView's own width falls to its 2%
     * minimum — so 0 -> 37 -> 12 draws three identical stubs each captioned
     * "0% from prev" while the numbers beside them say otherwise. Any count
     * metric is zero under the Today pill before the day's first record.
     */
    const out = composeFunnel([member({ value: 0 }), member({ label: "Booked", value: 37 })], FUNNEL_SLOT);
    expect(refusalOf(out)).toMatch(/first stage is zero/);
  });

  it("asks for more stages below the floor and fewer above the ceiling", () => {
    expect(refusalOf(composeFunnel([member()], FUNNEL_SLOT))).toMatch(/Add at least/);
    const many = [member(), ...Array.from({ length: 8 }, (_, i) => member({ label: `S${i}` }))];
    expect(refusalOf(composeFunnel(many, FUNNEL_SLOT))).toMatch(/at most/);
  });
});

describe("what a composed funnel discloses when it does draw", () => {
  const ok = composeFunnel(
    [member({ value: 420 }), member({ label: "Booked", value: 252 }), member({ label: "Held", value: 100 })],
    FUNNEL_SLOT,
  );

  it("draws, and its stages are the members in order", () => {
    expect(isRefusal(ok)).toBe(false);
    if (isRefusal(ok)) return;
    expect(ok.result.stages.map((s) => s.count)).toEqual([420, 252, 100]);
  });

  it("always says the stages are not a cohort", () => {
    /**
     * NOT SUPPRESSIBLE, because the thing it discloses cannot be detected and
     * so cannot be refused: each stage is an independent metric over the same
     * window, nobody is followed between them, and a subject can be counted in
     * two. (The CLASSIC funnel has always had this property — `computeFunnel`
     * issues one independent count(distinct subject) per stage.)
     */
    if (isRefusal(ok)) throw new Error("expected a drawing");
    expect(ok.notes.some((n) => /not followed as a cohort/.test(n))).toBe(true);
  });

  it("names a widening stage rather than letting its bar clip silently", () => {
    const wide = composeFunnel([member({ value: 100 }), member({ label: "Booked", value: 340 })], FUNNEL_SLOT);
    if (isRefusal(wide)) throw new Error("a widening funnel is legal — it is disclosed, not refused");
    expect(wide.notes.some((n) => n.includes("Booked") && /larger than the first stage/.test(n))).toBe(true);
  });

  it("says when the stages are dated by different fields", () => {
    // Part of the drop between two stages dated differently is a calendar
    // artifact rather than anything that happened. Knowable from the tiles,
    // not fixable, therefore disclosed.
    const mixed = composeFunnel(
      [member({ value: 420 }), member({ label: "Booked", value: 252, timeField: "booked_at" })],
      FUNNEL_SLOT,
    );
    if (isRefusal(mixed)) throw new Error("expected a drawing");
    expect(mixed.notes.some((n) => n.includes("created_at") && n.includes("booked_at"))).toBe(true);
  });
});

describe("what a composed pie refuses to draw", () => {
  const whole = (v: number) => member({ label: "Total Leads", value: v });

  it("refuses an average, which `facts.kind` alone could never catch", () => {
    /**
     * THE FINDING THAT KILLED THE ORIGINAL DESIGN. `facts.kind` is "count" for
     * sum, avg, median, min, max AND count_distinct alike — engine.ts says so
     * in its own comment — so without the `additive` stamp a pie whose whole is
     * "Avg Deal Size" ($8,400) and whose part is "Avg Deal Size, SMB" ($2,200)
     * passes every other rule here and draws a confident 74% "Other" slice of
     * an average.
     */
    const out = composePie(
      [whole(8400), member({ label: "SMB", value: 2200, additive: false }), member({ label: "Ent", value: 3000 })],
      PIE_SLOT,
    );
    expect(refusalOf(out)).toContain("SMB");
    expect(refusalOf(out)).toMatch(/add up/);
  });

  it("refuses a zero whole", () => {
    expect(refusalOf(composePie([whole(0), member({ label: "a", value: 0 }), member({ label: "b", value: 0 })], PIE_SLOT))).toMatch(
      /whole is zero/,
    );
  });

  it("refuses a negative part rather than quietly dropping it", () => {
    const out = composePie([whole(100), member({ label: "Refunds", value: -5 }), member({ label: "b", value: 10 })], PIE_SLOT);
    expect(refusalOf(out)).toContain("Refunds");
  });

  it("refuses parts that overrun the whole, instead of renormalising past it", () => {
    /**
     * `pieSlices` divides by the sum of whatever it is handed, so the circle
     * always closes at 100% however wrong the partition is. Refusing is the
     * only way the reader ever learns.
     */
    const out = composePie([whole(100), member({ label: "a", value: 80 }), member({ label: "b", value: 60 })], PIE_SLOT);
    expect(refusalOf(out)).toMatch(/more than the whole/);
  });

  it("forgives rounding but not a real overrun", () => {
    // Independently rounded figures legitimately total 100.4 against a whole of
    // 100; 140 is not rounding.
    const rounded = composePie([whole(100), member({ label: "a", value: 60.2 }), member({ label: "b", value: 40.2 })], PIE_SLOT);
    expect(isRefusal(rounded), "half a percent is rounding, not a contradiction").toBe(false);
  });

  it("needs at least two parts", () => {
    expect(refusalOf(composePie([whole(100), member({ label: "a", value: 10 })], PIE_SLOT))).toMatch(/at least 2 parts/);
  });

  it("refuses more parts than the cap, which a chart switch can smuggle in", () => {
    /**
     * Switching a composed FUNNEL (up to 7 parts) to a pie changes the chart
     * column and nothing else: `honoured()` keeps `parts` because the pie's
     * CONFIG_FIELDS row lists it, and a 7-part array would sail past a cap only
     * ever enforced while adding. Six named slices plus a residual is seven
     * arcs against `pieSlices`' cap of six — a second "Other".
     */
    const many = [whole(1000), ...Array.from({ length: 6 }, (_, i) => member({ label: `P${i}`, value: 10 }))];
    expect(refusalOf(composePie(many, PIE_SLOT))).toMatch(/at most 5 parts/);
  });
});

describe("what a composed pie draws", () => {
  it("appends the residual as the last slice, and it is exact", () => {
    const out = composePie(
      [member({ label: "Total Leads", value: 420 }), member({ label: "Ads", value: 180 }), member({ label: "Organic", value: 200 })],
      PIE_SLOT,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.groups).toEqual([
      { label: "Ads", value: 180 },
      { label: "Organic", value: 200 },
      { label: "Other", value: 40 },
    ]);
  });

  it("appends a SMALL residual rather than hiding it", () => {
    /**
     * Suppressing a sub-epsilon residual would leave `pieSlices` computing every
     * share against the sum of the PARTS while the tile's headline still states
     * the WHOLE — two different totals on one card. A visible 0.4% "Other" is
     * the honest version.
     */
    const out = composePie(
      [member({ label: "W", value: 1000 }), member({ label: "a", value: 600 }), member({ label: "b", value: 398 })],
      PIE_SLOT,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.groups.at(-1)).toEqual({ label: "Other", value: 2 });
  });

  it("adds no residual row when the parts tile the whole exactly", () => {
    const out = composePie(
      [member({ label: "W", value: 100 }), member({ label: "a", value: 60 }), member({ label: "b", value: 40 })],
      PIE_SLOT,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.groups.map((g) => g.label)).toEqual(["a", "b"]);
  });

  it("renames the residual when a real metric is already called Other", () => {
    /**
     * `sliceAccent` paints ANY slice labelled "Other" in the palette's reserved
     * grey, so a genuine metric of that name would be indistinguishable from
     * the remainder — and both would share a React key.
     */
    const out = composePie(
      [member({ label: "W", value: 100 }), member({ label: "Other", value: 30 }), member({ label: "b", value: 20 })],
      PIE_SLOT,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.groups.at(-1)!.label).toBe("Unaccounted");
  });

  it("always says Other is the remainder and the parts are assumed disjoint", () => {
    /**
     * UNPREVENTABLE, THEREFORE MANDATORY. "Total Leads" with parts "Ads Leads"
     * and "Booked Leads" is arithmetically indistinguishable from a real
     * partition — both sum to less than the whole — and only the author knows
     * which they built.
     */
    const out = composePie(
      [member({ label: "Total Leads", value: 420 }), member({ label: "Ads", value: 180 }), member({ label: "Organic", value: 200 })],
      PIE_SLOT,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.notes.some((n) => n.includes("Total Leads") && /assumed not to overlap/.test(n))).toBe(true);
  });

  it("says when a named part is zero, because the drawing drops it", () => {
    // `pieSlices` keeps only value > 0, so the author's named category vanishes
    // from the circle AND the legend with no trace at all.
    const out = composePie(
      [member({ label: "W", value: 100 }), member({ label: "Ads", value: 0 }), member({ label: "Organic", value: 40 })],
      PIE_SLOT,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.notes.some((n) => n.includes("Ads") && /zero in this period/.test(n))).toBe(true);
  });
});

describe("which charts a stored tile may now be drawn as", () => {
  const composable: MetricShape = { ...NO_SHAPE, scalar: true, series: true, composable: true };

  it("offers funnel, pipeline and pie on any stored scalar", () => {
    const offered = chartsFor(composable);
    for (const id of ["funnel", "pipeline", "pie"] as const) expect(offered).toContain(id);
  });

  it("offers none of them on a CLASSIC metric, which can never be composed", () => {
    /**
     * The reason `composable` is its own flag rather than a widening of
     * `scalar`. `tileOptions` holds flow metrics only — classic ones recompute
     * live — so a classic anchor would open an empty parts picker: a legal
     * chart, no way to configure it, and a sentence telling the reader to do
     * the impossible.
     *
     * THROUGH `shapeOfClassic`, NOT A HAND-BUILT SHAPE. Written the obvious way
     * — `chartsFor({...NO_SHAPE, composable: false})` — this passed with
     * `shapeOfClassic` mutated to stamp `composable: true`, because it never
     * called the function whose behaviour it claimed to pin. That is the
     * vacuous pass this repo keeps rediscovering, caught here by mutating the
     * source and watching the test not care.
     */
    const classic = shapeOfClassic({ kind: "series", series: [1, 2] }, null);
    expect(classic.composable, "a classic metric must never be composable").toBe(false);
    for (const id of ["funnel", "pipeline", "pie"] as const) expect(chartsFor(classic)).not.toContain(id);
    // A classic scalar, too — the branch above returns early for funnels only.
    expect(chartsFor(shapeOfClassic({ kind: "scalar" }, 10))).not.toContain("pie");
  });

  it("makes every STORED tile composable, through the function that stamps it", () => {
    // The mirror of the test above, and the reason a board's existing tiles can
    // anchor a funnel the moment this ships — no republish, no migration.
    const stored = shapeOfTile({ value: 42, byRange: { today: { value: 42 } } });
    expect(stored.composable).toBe(true);
    expect(chartsFor(stored)).toContain("funnel");
  });

  it("leaves a CLASSIC FUNNEL metric offering exactly what it always did", () => {
    // The short-circuit stays: a funnel metric is its own thing and offers
    // nothing else. Widening it would change live boards.
    expect(chartsFor({ ...NO_SHAPE, funnel: true })).toEqual(["funnel", "pipeline"]);
  });

  it("offers pie exactly once when it arrives through both doors", () => {
    const both: MetricShape = { ...NO_SHAPE, scalar: true, groups: true, composable: true };
    expect(chartsFor(both).filter((id) => id === "pie")).toHaveLength(1);
  });

  it("answers in the registry's own order, never in the order the rules fired", () => {
    for (const shape of [composable, { ...NO_SHAPE, scalar: true, groups: true, composable: true }]) {
      const offered = chartsFor(shape);
      const canonical = CHART_IDS.filter((id) => offered.includes(id));
      expect(offered).toEqual(canonical);
    }
  });
});

describe("the parts slot and the config key that feeds it", () => {
  it("gives every chart in the registry a row, so a new chart cannot default to zero by accident", () => {
    for (const id of CHART_IDS) expect(PARTS_SLOT[id], `${id} has no PARTS_SLOT row`).toBeDefined();
  });

  it("keeps the pie's ceiling equal to `pieSlices`' own cap, minus the residual", () => {
    /**
     * LOAD-BEARING ARITHMETIC, not a preference. `pieSlices` caps at 6 and
     * folds its overflow into a slice named "Other" — the same name
     * composition gives its residual. 5 named + 1 residual = 6 makes a second
     * "Other" impossible.
     */
    expect(PARTS_SLOT.pie.max + 1).toBe(6);
  });

  it("marks exactly the three composing charts", () => {
    expect(CHART_IDS.filter(composes).sort()).toEqual(["funnel", "pie", "pipeline"]);
  });

  it("offers `parts` on exactly the charts that compose", () => {
    // The panel reads CONFIG_FIELDS and the renderer reads PARTS_SLOT; a
    // disagreement is a control that does nothing or a value nothing can set.
    for (const id of CHART_IDS) {
      expect((CONFIG_FIELDS[id] as readonly string[]).includes("parts"), `${id}`).toBe(composes(id));
    }
  });

  it("stores only flow keys, and never the same metric twice", () => {
    expect(parseTileConfig({ parts: ["flow:f1:o1", "flow:f2:o2"] }).parts).toEqual(["flow:f1:o1", "flow:f2:o2"]);
    // A metric id would have put a database round trip behind every board write
    // — see the key's own note.
    expect(parseTileConfig({ parts: ["metric:abc"] }).parts).toBeUndefined();
    expect(parseTileConfig({ parts: ["flow:f1:o1", "flow:f1:o1"] }).parts).toBeUndefined();
    expect(parseTileConfig({ parts: [] }).parts).toBeUndefined();
    expect(parseTileConfig({ parts: Array.from({ length: 8 }, (_, i) => `flow:f:${i}`) }).parts).toBeUndefined();
  });

  it("costs a corrupt parts key only itself", () => {
    // The independent-key promise every other setting gets.
    expect(parseTileConfig({ parts: ["nope"], color: "teal" })).toEqual({ color: "teal" });
  });

  it("drops `parts` from a chart that cannot compose", () => {
    // Switching a composed funnel to a bar chart must not leave the bar reading
    // a key it has no idea about.
    expect(honoured("bar", { parts: ["flow:f1:o1"] }).parts).toBeUndefined();
    expect(honoured("pie", { parts: ["flow:f1:o1"] }).parts).toEqual(["flow:f1:o1"]);
  });
});

describe("the facts a composition is judged on", () => {
  it("separates what can be tallied from what can be added", () => {
    /**
     * `count_distinct` is the case that makes these two flags rather than one:
     * a perfectly good funnel stage, and NOT a pie part, because a subject
     * appearing in two slices is counted twice and the parts overrun the whole
     * by exactly the overlap.
     */
    expect(seedMetricFacts({ op: "count" })).toMatchObject({ countable: true, additive: true });
    expect(seedMetricFacts({ op: "sum" })).toMatchObject({ countable: true, additive: true });
    expect(seedMetricFacts({ op: "count_distinct" })).toMatchObject({ countable: true, additive: false });
    for (const op of ["avg", "median", "min", "max"]) {
      expect(seedMetricFacts({ op }), op).toMatchObject({ countable: false, additive: false });
    }
  });

  it("stamps a duration and a rate as neither", () => {
    expect(seedMetricFacts({ resultKind: "duration", field: "x" })).toMatchObject({ countable: false, additive: false });
    expect(seedMetricFacts({ op: "percentage" })).toMatchObject({ kind: "ratio", countable: false, additive: false });
  });

  it("reads the metric step's spelling as well as Calculate's", () => {
    // Calculate writes `op`; the metric step writes `aggregation`. A spec from
    // either must stamp the same facts, exactly as `breakdownMode ?? mode`
    // already does one line below.
    expect(seedMetricFacts({ aggregation: "count" })).toMatchObject({ countable: true, additive: true });
    expect(seedMetricFacts({ aggregation: "count_distinct" })).toMatchObject({ countable: true, additive: false });
  });

  it("leaves both flags ABSENT when it cannot tell, so the tile earns a refresh and not a verdict", () => {
    // The distinction the renderer turns into two different sentences.
    const unknown = seedMetricFacts({});
    expect(unknown.countable).toBeUndefined();
    expect(unknown.additive).toBeUndefined();
  });

  it("still answers everything it answered before", () => {
    // The half that must not change.
    expect(seedMetricFacts({ op: "percent_change" }).kind).toBe("ratio");
    expect(seedMetricFacts({ op: "count" }).kind).toBe("count");
    expect(seedMetricFacts({ mode: "categories", fallbackLabel: "Rest" })).toMatchObject({
      ordered: true,
      fallbackLabel: "Rest",
    });
  });
});
