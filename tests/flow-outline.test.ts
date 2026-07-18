import { describe, it, expect } from "vitest";
import { STEP_LABEL, stageOf, sentenceFor, nextOptions, buildOutcome, buildReview, OUTCOMES } from "@/components/flow/outline";
import type { FNode } from "@/components/flow/graph-utils";

const data = (config: Record<string, unknown>) => ({ config }) as FNode["data"];
const node = (id: string, type: string, cfg: Record<string, unknown>, extra: Partial<FNode["data"]> = {}): FNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { config: cfg, ...extra } }) as FNode;

describe("plain-language names + stages", () => {
  it("renames node types to business language", () => {
    expect(STEP_LABEL.app).toBe("Data source");
    expect(STEP_LABEL.aggregate).toBe("Summarize");
    expect(STEP_LABEL.formula).toBe("Calculate metric");
    expect(STEP_LABEL.output).toBe("Dashboard metric");
  });
  it("assigns each type to one of the four stages", () => {
    expect(stageOf("app")).toBe("Data");
    expect(stageOf("filter")).toBe("Conditions");
    expect(stageOf("aggregate")).toBe("Calculation");
    expect(stageOf("output")).toBe("Dashboard");
  });
});

describe("sentenceFor", () => {
  it("reads as a sentence", () => {
    expect(sentenceFor("app", data({ connectionName: "Calendly", eventType: "booked" }))).toBe("Load Calendly booked");
    expect(sentenceFor("aggregate", data({ aggregation: "count" }))).toBe("Count matching records");
    expect(sentenceFor("output", data({ name: "Today's booked calls", viz: "number" }))).toBe('Show "Today\'s booked calls" as a number');
    expect(sentenceFor("time", data({ mode: "preset", preset: "today" }))).toBe("Keep records from today");
  });
});

describe("nextOptions (valid next actions)", () => {
  it("after Data source: date range, filter, transform, combine, summarize (no dashboard yet)", () => {
    const { common, advanced } = nextOptions("app");
    expect(common).toEqual(expect.arrayContaining(["time", "filter", "formatter", "combine", "aggregate"]));
    expect(common).not.toContain("output");
    expect(common).not.toContain("paths");
    expect(advanced).toEqual(expect.arrayContaining(["paths", "group"]));
  });
  it("after Summarize: calculate or dashboard metric", () => {
    expect(nextOptions("aggregate").common).toEqual(expect.arrayContaining(["formula", "output"]));
  });
  it("after Calculate: calculate again or dashboard metric", () => {
    expect(nextOptions("formula").common).toEqual(expect.arrayContaining(["formula", "output"]));
  });
});

describe("buildOutcome", () => {
  it("offers six outcomes", () => {
    expect(OUTCOMES.map((o) => o.key)).toEqual(["count", "sum", "rate", "breakdown", "trend", "custom"]);
  });
  it("count = app → summarize → dashboard", () => {
    const g = buildOutcome("count");
    expect(g.nodes.map((n) => n.type)).toEqual(["app", "aggregate", "output"]);
    expect(g.edges).toHaveLength(2);
  });
  it("conversion rate branches and converges through a Formula with A/B handles", () => {
    const g = buildOutcome("rate");
    expect(g.nodes.filter((n) => n.type === "aggregate")).toHaveLength(2);
    const formula = g.nodes.find((n) => n.type === "formula")!;
    const intoFormula = g.edges.filter((e) => e.target === formula.id);
    expect(intoFormula.map((e) => e.targetHandle).sort()).toEqual(["a", "b"]);
  });
  it("custom starts from a single data source", () => {
    expect(buildOutcome("custom").nodes.map((n) => n.type)).toEqual(["app"]);
  });
});

describe("buildReview", () => {
  it("summarizes metrics, sources, calculations and unready steps", () => {
    const nodes: FNode[] = [
      node("a", "app", { connectionName: "Calendly", eventType: "booked" }, { lastTest: { status: "ok", recordsIn: 3, recordsOut: 3, sample: [], inputSample: [], outputSchema: [] } }),
      node("agg", "aggregate", { aggregation: "count" }), // untested
      node("o", "output", { name: "Booked calls", format: "number" }, { lastTest: { status: "ok", recordsIn: 1, recordsOut: 1, sample: [], inputSample: [], outputSchema: [], tile: { value: 3 } } }),
    ];
    const stepNo = new Map([["a", 1], ["agg", 2], ["o", 3]]);
    const r = buildReview(nodes, stepNo, (n) => String(n.type));
    expect(r.metrics).toEqual([{ name: "Booked calls", value: "3", format: "number" }]);
    expect(r.sources).toEqual(["Calendly · booked"]);
    expect(r.calculations).toContain("Count matching records");
    expect(r.untested.map((u) => u.step)).toContain(2);
  });
});
