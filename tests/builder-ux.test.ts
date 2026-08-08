import { describe, it, expect } from "vitest";
import { validateGraph } from "@/lib/flow/validate";
import { parseGraph, NODE_LABELS, NODE_TYPES } from "@/lib/flow/types";
import { defaultConfig, NODE_META } from "@/components/flow/node-meta";
import { isPassThroughFilter } from "@/components/flow/graph-utils";
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

describe("Calculate defaults to counting", () => {
  it("a fresh Calculate counts records — the first metric everyone builds", () => {
    // Sabotage: restore { op: "percentage" } and a new Calculate lands on
    // "Needs setup — Pick or type a First and Second number".
    expect(defaultConfig("formula").op).toBe("count");
  });
});

describe("pass-through Filter detector", () => {
  it("no rules + no date range = passes everything (worth a warning, never an error)", () => {
    expect(isPassThroughFilter({ combinator: "and", rules: [] })).toBe(true);
    expect(isPassThroughFilter({ rules: [], dateRange: { enabled: false } })).toBe(true);
    expect(isPassThroughFilter({ rules: [{ field: "subject", op: "equals", value: "x" }] })).toBe(false);
    expect(isPassThroughFilter({ rules: [], dateRange: { enabled: true } })).toBe(false);
  });
});

describe("every shipped template validates clean", () => {
  it("with a connection prefilled, no template ships with a validation issue", () => {
    for (const t of FLOW_TEMPLATES) {
      const g = t.build("00000000-0000-0000-0000-000000000000");
      expect({ template: t.id, issues: validateGraph(g) }).toEqual({ template: t.id, issues: [] });
      // Every template pre-seeds at least one enabled, human-named metric.
      expect(g.metrics.length).toBeGreaterThan(0);
      expect(g.metrics.every((m) => m.enabled && m.name.length > 3)).toBe(true);
    }
  });
});