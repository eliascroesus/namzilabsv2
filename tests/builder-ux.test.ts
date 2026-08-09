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
  it("formats a duration from whatever unit the numbers are in", async () => {
    const { formatDuration, formatMetricValue } = await import("@/lib/format");
    expect(formatDuration(285.195783, "minutes")).toBe("4h 45m");
    expect(formatDuration(0.5, "minutes")).toBe("30s");
    expect(formatDuration(90, "seconds")).toBe("1m 30s");
    expect(formatDuration(50, "hours")).toBe("2d 2h");
    // The published tile goes through the same path.
    expect(formatMetricValue(285.195783, { format: "duration", unit: "minutes" })).toBe("4h 45m");
  });

  it("the builder's own result line follows the step's choice", async () => {
    const { resultLabel } = await import("@/components/flow/node-meta");
    const test = { recordsIn: 10, recordsOut: 1, value: 285.195783 };
    // Sabotage: print String(value) as it used to and this reads 285.195783.
    expect(resultLabel("formula", test, { resultKind: "duration", durationUnit: "minutes" })).toBe("4h 45m");
    // A plain number still reads as a number — just not as a raw float.
    expect(resultLabel("formula", test, { resultKind: "number" })).toBe("285.2");
    expect(resultLabel("formula", { recordsIn: 9, recordsOut: 1, value: 12000 })).toBe("12,000");
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
