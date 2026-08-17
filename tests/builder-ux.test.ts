import { describe, it, expect } from "vitest";
import { validateGraph } from "@/lib/flow/validate";
import { parseGraph, aggregationInputs, AGGREGATIONS, NODE_LABELS, NODE_TYPES } from "@/lib/flow/types";
import { defaultConfig, NODE_META } from "@/components/flow/node-meta";
import { nodeNeedsSetup } from "@/components/flow/graph-utils";
import { FLOW_TEMPLATES } from "@/lib/flow/templates";

/**
 * The builder's plain-English contract. Every pin here is a user-facing
 * promise: messages never speak raw node types, the first Calculate a user
 * adds counts records instead of demanding a Numerator, a do-nothing Filter
 * is detectable, and every shipped template validates clean.
 */

describe("validation speaks plain English", () => {
  it("an empty flow says what to ADD, not what internal nodes it wants", () => {
    // Sabotage: restore "Add an App and an Output node" — neither name
    // exists in the picker; Output isn't even a visible step anymore.
    expect(validateGraph(parseGraph({ nodes: [], edges: [] }))).toEqual([
      { message: "This flow is empty. Add a Get data step to start." },
    ]);
  });

  it("input errors name the step like the picker does, never cap(node.type)", () => {
    const g = parseGraph({ nodes: [{ id: "u", type: "unite", data: { config: {} } }], edges: [] });
    const issues = validateGraph(g);
    // "Combine data", not "Unite" — the label the user actually saw.
    expect(issues.some((i) => i.message === "Combine data needs a step before it.")).toBe(true);
  });

  it("every node type has a plain-English label for messages to use", () => {
    for (const t of NODE_TYPES) {
      expect(NODE_LABELS[t]?.length ?? 0).toBeGreaterThan(0);
      // Labels are prose, not identifiers: no underscores, starts uppercase.
      expect(NODE_LABELS[t]).not.toContain("_");
    }
  });

  it("picker labels and message labels agree for every visible step", () => {
    for (const t of NODE_TYPES) {
      if (NODE_META[t]?.hidden) continue;
      expect(NODE_LABELS[t]).toBe(NODE_META[t].label);
    }
  });
});

describe("aggregation inputs — one predicate, four panels", () => {
  it("every op that reads a number out of a record offers a field picker", () => {
    // Sabotage: drop `median` from NUMERIC_FIELD_OPS and the speed-to-lead
    // panel hides the very field it is configured with, so the flagship
    // metric silently aggregates a null column to 0.
    for (const op of ["sum", "avg", "median", "min", "max"]) {
      expect({ op, ...aggregationInputs(op) }).toEqual({ op, numberField: true, distinctField: false });
    }
  });

  it("count_distinct asks what 'distinct' means, and count asks nothing", () => {
    expect(aggregationInputs("count_distinct")).toEqual({ numberField: false, distinctField: true });
    expect(aggregationInputs("count")).toEqual({ numberField: false, distinctField: false });
  });

  it("every declared aggregation is classified — a new one can't slip through unasked", () => {
    for (const op of AGGREGATIONS) {
      const i = aggregationInputs(op);
      const known = op === "count" ? !i.numberField && !i.distinctField : i.numberField !== i.distinctField;
      expect({ op, known }).toEqual({ op, known: true });
    }
  });
});

describe("Calculate defaults to counting", () => {
  it("a fresh Calculate counts records — the first metric everyone builds", () => {
    // Sabotage: restore { op: "percentage" } and a new Calculate lands on
    // "Needs setup — Pick or type a First and Second number".
    expect(defaultConfig("formula").op).toBe("count");
  });
});

describe("every shipped template validates clean", () => {
  it("with a connection prefilled, no template ships with a validation issue", () => {
    for (const t of FLOW_TEMPLATES) {
      const g = t.build("00000000-0000-0000-0000-000000000000");
      expect({ template: t.id, issues: validateGraph(g) }).toEqual({ template: t.id, issues: [] });
      // At least one enabled metric, every pre-seeded one human-named — a
      // template may deliberately pre-seed DISABLED specs for structural
      // terminals (no-show rate's count nodes) so they don't auto-publish.
      expect(g.metrics.some((m) => m.enabled)).toBe(true);
      expect(g.metrics.every((m) => m.name.length > 3)).toBe(true);
    }
  });
});

describe("an account is required, not just a source", () => {
  const APP_NO_CONN = { connectionId: null, source: "close", eventType: "lead_created", sourceConfig: {} };

  it("nodeNeedsSetup flags a source-only Get data step", () => {
    // Sabotage: restore the `!connectionId && !source` check and a template
    // built without a prefilled account looks Ready while silently reading
    // EVERY connection of that source in the org — blended workspaces.
    expect(nodeNeedsSetup("app", APP_NO_CONN, 0)).toBe(true);
    expect(nodeNeedsSetup("app", { ...APP_NO_CONN, connectionId: "c1" }, 0)).toBe(false);
  });

  it("publish blocks a source-only Get data step, in plain English", () => {
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: APP_NO_CONN } },
        { id: "m", type: "formula", data: { config: { op: "count" } } },
      ],
      edges: [{ id: "a->m", source: "a", target: "m" }],
      metrics: [{ nodeId: "m", enabled: true, name: "Count" }],
    });
    expect(validateGraph(g).some((i) => i.message === "Get data needs an account — open the step and choose one.")).toBe(true);
  });
});

/**
 * A speed-to-lead that read "285.195783" is the reason the Calculate step now
 * asks what it is measuring before it asks anything else. A number is a
 * number; a length of time is said the way people say it.
 */
describe("a length of time is shown as one", () => {
  it("the reading changes; the length of time never does", async () => {
    const { formatDuration } = await import("@/lib/format");
    // 285.195783 minutes is ONE duration. Sabotage: fold the display choice
    // back into the value unit and these disagree — "4h 45m" under minutes,
    // "4m 45s" under seconds — which is the bug this pins.
    const v = 285.195783;
    expect(formatDuration(v, "minutes", "auto")).toBe("4h 45m");
    expect(formatDuration(v, "minutes", "hours")).toBe("4h 45m 12s");
    expect(formatDuration(v, "minutes", "minutes")).toBe("285m 12s");
    expect(formatDuration(v, "minutes", "seconds")).toBe("17,112s");
    expect(formatDuration(v, "minutes", "days")).toBe("0d 4h 45m 12s");
  });

  it("a short gap reads the way it was asked for, zeros included", async () => {
    const { formatDuration } = await import("@/lib/format");
    // 4 minutes 30 seconds, the founder's own example.
    expect(formatDuration(270, "seconds", "hours")).toBe("0h 4m 30s");
    expect(formatDuration(270, "seconds", "minutes")).toBe("4m 30s");
    expect(formatDuration(270, "seconds", "seconds")).toBe("270s");
    expect(formatDuration(4.5, "minutes", "hours")).toBe("0h 4m 30s"); // same duration, other unit
  });

  it("the value unit comes from the field, so it cannot be answered wrong", async () => {
    const { durationValueUnit, fieldNamesItsUnit } = await import("@/lib/flow/types");
    expect(durationValueUnit("properties.time_between.minutes", "seconds")).toBe("minutes");
    expect(durationValueUnit("properties.time_between.hours", "seconds")).toBe("hours");
    expect(fieldNamesItsUnit("properties.time_between.seconds")).toBe(true);
    // A field that does NOT say keeps the stored answer, and the panel asks.
    expect(durationValueUnit("properties.data.duration", "seconds")).toBe("seconds");
    expect(fieldNamesItsUnit("properties.data.duration")).toBe(false);
  });

  it("an unrecognised unit says so instead of quietly meaning minutes", async () => {
    const { formatDuration } = await import("@/lib/format");
    expect(formatDuration(285, "fortnights")).toBe("—");
  });

  it("the builder's own result line follows the step's choice", async () => {
    const { resultLabel } = await import("@/components/flow/node-meta");
    const test = { recordsIn: 10, recordsOut: 1, value: 285.195783 };
    const cfg = { resultKind: "duration", field: "properties.time_between.minutes" };
    // Sabotage: print String(value) as it used to and this reads 285.195783.
    expect(resultLabel("formula", test, cfg)).toBe("4h 45m");
    expect(resultLabel("formula", test, { ...cfg, durationDisplay: "seconds" })).toBe("17,112s");
    // A plain number still reads as a number — just not as a raw float.
    expect(resultLabel("formula", test, { resultKind: "number" })).toBe("285.2");
    expect(resultLabel("formula", { recordsIn: 9, recordsOut: 1, value: 12000 })).toBe("12,000");
  });

  it("the published tile reads the same as the builder", async () => {
    const { formatMetricValue } = await import("@/lib/format");
    const { resultLabel } = await import("@/components/flow/node-meta");
    const cfg = { resultKind: "duration", field: "properties.time_between.minutes", durationDisplay: "hours" };
    // Sabotage: drop durationDisplay from TileSpec/MetricSpec and the tile
    // renders "4h 45m" while the builder renders "4h 45m 12s" — two answers
    // for one number, on two screens.
    expect(formatMetricValue(285.195783, { format: "duration", unit: "minutes", durationDisplay: "hours" })).toBe(
      resultLabel("formula", { recordsIn: 1, recordsOut: 1, value: 285.195783 }, cfg),
    );
  });

  /**
   * A SPLIT STEP'S HEADLINE IS ITS METRIC, NOT ITS NUMBER OF BUCKETS. The Test
   * DTO derived its own number and covered scalar and grouped but not SERIES,
   * so a Calculate split over time reported "12" for twelve months in the
   * editor while the dashboard rendered the real total. Grouped had the same
   * hole whenever the shape carried no precomputed total.
   *
   * REVERT test-run.ts TO ITS OWN EXPRESSION AND THIS FAILS: one function now
   * answers for both screens.
   */
  it("a trend or breakdown reads the same in the builder as on the tile", async () => {
    const { headlineValue, buildTile } = await import("@/lib/flow/engine");
    const spec = { name: "m", viz: "line" as const, format: "number" as const, precision: 0, target: null };

    // Twelve monthly buckets summing to 120, with no precomputed total.
    const series = {
      kind: "series" as const,
      series: Array.from({ length: 12 }, (_, i) => ({ bucket: `2026-${String(i + 1).padStart(2, "0")}`, value: 10 })),
    };
    expect(headlineValue(series)).toBe(120);
    expect(buildTile(spec, series, []).value).toBe(120);

    // A carried total wins over the sum — a median is not the sum of medians.
    const withTotal = { ...series, total: 35 };
    expect(headlineValue(withTotal)).toBe(35);
    expect(buildTile(spec, withTotal, []).value).toBe(35);

    // Grouped, same rule, including the missing-total fallback.
    const grouped = { kind: "grouped" as const, groups: [{ label: "a", value: 3 }, { label: "b", value: 4 }] };
    expect(headlineValue(grouped)).toBe(7);
    expect(buildTile(spec, grouped, []).value).toBe(7);

    // A dataset has no single number of its own — the caller states the count.
    expect(headlineValue({ kind: "dataset", records: [] })).toBeUndefined();
  });

  /**
   * A legacy Output node says "duration" through `format` + `unit`, never
   * `resultKind` — so the builder printed its raw float beside a tile that
   * rendered the same number as "4h 45m".
   */
  it("a legacy Output node's duration reads the same on both screens", async () => {
    const { resultLabel } = await import("@/components/flow/node-meta");
    const { formatMetricValue } = await import("@/lib/format");
    const cfg = { format: "duration", unit: "minutes", durationDisplay: "hours" };
    const label = resultLabel("output", { recordsIn: 1, recordsOut: 1, value: 285.195783 }, cfg);
    expect(label).toBe("4h 45m 12s");
    expect(label).toBe(formatMetricValue(285.195783, { format: "duration", unit: "minutes", durationDisplay: "hours" }));
  });

  /**
   * Every formatter in the pipeline pins en-US. The number branch alone read
   * the runtime's locale, so one tile said "1,234" on a laptop and "1.234" on
   * a server with a European ICU default — same data, different number.
   */
  it("a plain number is formatted the same wherever it renders", async () => {
    const { formatMetricValue } = await import("@/lib/format");
    expect(formatMetricValue(1234.5, { format: "number", precision: 1 })).toBe("1,234.5");
    expect(formatMetricValue(1234.5, { format: "number", precision: 1, unit: "leads" })).toBe("1,234.5 leads");

    // The OUTPUT cannot prove this on an en-US machine — both the pinned and
    // the ambient call render "1,234.5" here, and the bug only appears on a
    // server whose ICU default is elsewhere. So assert what was actually
    // wrong: that a locale is REQUESTED rather than left to the runtime.
    const original = Number.prototype.toLocaleString;
    const asked: unknown[] = [];
    // eslint-disable-next-line no-extend-native
    Number.prototype.toLocaleString = function (this: number, locale?: unknown, opts?: unknown) {
      asked.push(locale);
      return (original as (l?: unknown, o?: unknown) => string).call(this, locale, opts);
    } as typeof Number.prototype.toLocaleString;
    try {
      formatMetricValue(1234.5, { format: "number", precision: 1 });
    } finally {
      // eslint-disable-next-line no-extend-native
      Number.prototype.toLocaleString = original;
    }
    expect(asked).toEqual(["en-US"]);
  });

  it("a hand-built duration flow publishes a duration tile, not a bare 285", async () => {
    const { seedMetricFormat } = await import("@/lib/flow/types");
    // Sabotage: hardcode format "number" as the seeding used to and the
    // published tile reads "285" for a step the builder shows as "4h 45m".
    expect(seedMetricFormat({ resultKind: "duration", field: "properties.time_between.minutes", durationDisplay: "hours" })).toEqual({
      format: "duration",
      unit: "minutes",
      durationDisplay: "hours",
    });
    // A field that does not name its unit falls back to what the step was told.
    expect(seedMetricFormat({ resultKind: "duration", field: "properties.data.duration", durationUnit: "seconds" })).toEqual({
      format: "duration",
      unit: "seconds",
      durationDisplay: "auto",
    });
    expect(seedMetricFormat({ op: "count" })).toEqual({ format: "number" });
  });

  it("choosing a length of time drops the trend split, which cannot be one", async () => {
    // A duration Calculate is a single number by construction; leaving a stale
    // groupBy behind would classify it a series and block publish with advice
    // about a control the panel no longer shows.
    const { outputShapeOf } = await import("@/lib/flow/shapes");
    expect(outputShapeOf("formula", { op: "median", resultKind: "duration", groupBy: null })).toBe("scalar");
  });
});


/**
 * Time between offers moments, not the whole record. A Close step carries
 * ~480 fields and four of them are timestamps; listing all 480 is the same
 * "where is my data" problem from the other end.
 */
describe("the clock picker offers only things a clock can read", () => {
  it("keeps dates and numbers, drops text, drops the step's own record count", async () => {
    const { momentGroups } = await import("@/components/flow/field-groups");
    const groups = [
      {
        stepId: "leads",
        stepNo: 1,
        title: "Get data",
        fields: [
          { path: "occurredAt", label: "occurredAt", type: "date" },
          { path: "properties.data.date_created", label: "data.date_created", type: "date" },
          { path: "value", label: "value", type: "number" },
          { path: "properties.lead_id", label: "lead_id", type: "text" },
          // Sabotage: keep __count_ and the picker offers "Output number" as a
          // moment — the gap between two tallies, which is not a duration.
          { path: "__count_leads", label: "Output number", type: "number" },
        ],
      },
      { stepId: "sys", title: "Nothing timely", fields: [{ path: "subject", label: "subject", type: "text" }] },
    ];
    const out = momentGroups(groups);
    expect(out.map((g) => g.stepId)).toEqual(["leads"]); // the all-text group vanishes entirely
    expect(out[0].fields.map((f) => f.path)).toEqual(["occurredAt", "properties.data.date_created", "value"]);
  });
});

/**
 * The editor's job when something is wrong is to say what and where. It used
 * to lose the work, print the parser's internals, and refuse to publish
 * without naming a step.
 */
describe("the editor tells the truth about its own failures", () => {
  it("a cleared number box can never write NaN into the graph", async () => {
    const { MetricSpecSchema } = await import("@/lib/flow/types");
    // Sabotage: go back to Number(e.target.value) in the Decimals box and
    // clearing it writes NaN, which fails this parse — so the autosave of that
    // edit and of every edit after it dies behind a grey "Save failed".
    expect(MetricSpecSchema.safeParse({ nodeId: "m", name: "x", precision: NaN }).success).toBe(false);
    const sanitised = (m: { precision: number; target: number | null }) => ({
      ...m,
      precision: Number.isFinite(m.precision) ? m.precision : 0,
      target: m.target != null && Number.isFinite(m.target) ? m.target : null,
    });
    expect(sanitised({ precision: NaN, target: NaN })).toEqual({ precision: 0, target: null });
  });

  it("publish refuses with one issue per step, each carrying its node", async () => {
    const { PublishBlocked } = await import("@/lib/flow/store");
    const e = new PublishBlocked([
      { nodeId: "n1", message: "Get data needs an account — open the step and choose one." },
      { nodeId: "n2", message: "Split into paths needs at least one branch." },
    ]);
    // Sabotage: throw a plain Error with the messages joined and the canvas can
    // highlight nothing — which is why it read "Can't publish: Cannot publish:
    // A; B; C", prefixed by both layers and pointing at no step at all.
    expect(e.issues.map((i) => i.nodeId)).toEqual(["n1", "n2"]);
    expect(e.message).toMatch(/^Cannot publish: /);
  });

  it("a Filter whose config will not parse blocks publish instead of failing later", async () => {
    const { validateGraph } = await import("@/lib/flow/validate");
    const { parseGraph } = await import("@/lib/flow/types");
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: "c", source: "close" } } },
        { id: "f", type: "filter", data: { config: { combinator: "and", rules: [{ field: "", op: "equals", value: "x" }] } } },
        { id: "m", type: "formula", data: { config: { op: "count" } } },
      ],
      edges: [
        { id: "e1", source: "a", target: "f" },
        { id: "e2", source: "f", target: "m" },
      ],
      metrics: [{ nodeId: "m", enabled: true, name: "x" }],
    });
    // Sabotage: restore `if (cfg.success && …)` as the only guard and this
    // publishes clean, then fails at materialize with a red tile and no step
    // named anywhere.
    expect(validateGraph(g).some((i) => i.nodeId === "f")).toBe(true);
  });
});
