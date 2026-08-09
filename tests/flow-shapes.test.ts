import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, type NodeExecOk } from "@/lib/flow/engine";
import { outputShapeOf, producesDataset, producesNumber, isBinaryCalc } from "@/lib/flow/shapes";
import { parseGraph, NODE_TYPES } from "@/lib/flow/types";
import { validateGraph } from "@/lib/flow/validate";
import type { DB } from "@/db/types";

/**
 * ONE ANSWER to "what does this step produce".
 *
 * There were three, and they disagreed: the engine knows four shapes, the
 * validator knew three, and the canvas kept a private list that had never
 * heard of Time between. That is how a Calculate split over time got
 * offered as a single number and then threw a runtime error at the user as
 * its error message.
 *
 * The pin that matters is the last describe: every classification is
 * checked against what the engine ACTUALLY returns, so the two can never
 * drift again.
 */

let db: DB;
let close: () => Promise<void>;
const ORG = "org_shapes";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
  for (let i = 0; i < 3; i++) {
    await db.insert(events).values({
      eventId: `s:${i}`,
      orgId: ORG,
      connectionId: CONN,
      source: "close",
      eventType: "call_logged",
      subject: `p${i}`,
      occurredAt: new Date(Date.now() - i * 86_400_000),
      value: String(i + 1),
      properties: {},
    });
  }
});
afterEach(async () => {
  await close();
});

describe("outputShapeOf", () => {
  it("classifies every declared node type — a new one can't slip through unclassified", () => {
    for (const t of NODE_TYPES) {
      expect({ t, shape: typeof outputShapeOf(t, {}) }).toEqual({ t, shape: "string" });
    }
  });

  it("a Calculate is a different shape depending on how it is configured", () => {
    expect(outputShapeOf("formula", { op: "count" })).toBe("scalar");
    expect(outputShapeOf("formula", { op: "count", groupBy: { type: "time", unit: "day" } })).toBe("series");
    expect(outputShapeOf("formula", { op: "count", groupBy: { type: "field", field: "source" } })).toBe("grouped");
    expect(outputShapeOf("formula", { op: "percentage" })).toBe("scalar");
  });

  it("record steps are datasets, including Time between", () => {
    for (const t of ["app", "filter", "time", "time_between", "paths", "unite"]) {
      expect({ t, dataset: producesDataset(t) }).toEqual({ t, dataset: true });
      expect(outputShapeOf(t, {})).toBe("dataset");
    }
  });

  it("only a single number can fill a Compare slot — a trend cannot", () => {
    // Sabotage: return true for any formula (the old isNumberProducer) and a
    // time-split Calculate is offered, then throws at run time.
    expect(producesNumber("formula", { op: "count" })).toBe(true);
    expect(producesNumber("formula", { op: "count", groupBy: { type: "time", unit: "day" } })).toBe(false);
    expect(producesNumber("app", {})).toBe(true); // its record count
    expect(producesNumber("group", {})).toBe(false);
  });

  it("names the compare configuration once", () => {
    expect(isBinaryCalc("formula", { op: "percentage" })).toBe(true);
    expect(isBinaryCalc("formula", { op: "count" })).toBe(false);
    expect(isBinaryCalc("calculate", { mode: "compare" })).toBe(true);
    expect(isBinaryCalc("calculate", { mode: "number" })).toBe(false);
    expect(isBinaryCalc("filter", {})).toBe(false);
  });
});

describe("the classifier matches the engine", () => {
  const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
  const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });

  const cases: Array<{ name: string; type: string; cfg: Record<string, unknown> }> = [
    { name: "app", type: "app", cfg: { connectionId: CONN, source: "close" } },
    { name: "filter", type: "filter", cfg: { combinator: "and", rules: [] } },
    { name: "calculate → one number", type: "formula", cfg: { op: "count" } },
    { name: "calculate → trend", type: "formula", cfg: { op: "count", groupBy: { type: "time", unit: "day" } } },
    { name: "calculate → per group", type: "formula", cfg: { op: "count", groupBy: { type: "field", field: "source" } } },
    { name: "group", type: "group", cfg: { mode: "field", field: "source", aggregation: "count" } },
  ];

  for (const c of cases) {
    it(`${c.name}: predicted shape is the shape the engine returns`, async () => {
      const nodes = c.type === "app" ? [N("x", c.type, c.cfg)] : [N("a", "app", { connectionId: CONN, source: "close" }), N("x", c.type, c.cfg)];
      const edges = c.type === "app" ? [] : [E("a", "x")];
      const res = await runFlow({ db, orgId: ORG }, parseGraph({ nodes, edges }));
      const exec = res.nodes.get("x")!;
      expect(exec.status).toBe("ok");
      expect({ case: c.name, shape: (exec as NodeExecOk).shape.kind }).toEqual({ case: c.name, shape: outputShapeOf(c.type, c.cfg) });
    });
  }
});

describe("publish blocks a many-numbers input instead of crashing on it", () => {
  it("a trend wired into a Compare is an issue, with advice", () => {
    // It used to validate clean and throw "This input isn't a single number"
    // from the engine — a crash used as an error message.
    const g = parseGraph({
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: CONN, source: "close" } } },
        { id: "trend", type: "formula", data: { config: { op: "count", groupBy: { type: "time", unit: "day" } } } },
        { id: "cmp", type: "formula", data: { config: { op: "percentage", bFixed: 10 } } },
      ],
      edges: [
        { id: "a->trend", source: "a", target: "trend" },
        { id: "trend->cmp", source: "trend", target: "cmp", targetHandle: "a" },
      ],
      metrics: [{ nodeId: "cmp", enabled: true, name: "Rate" }],
    });
    expect(validateGraph(g).some((i) => /produces a trend over time/.test(i.message))).toBe(true);
  });
});


/**
 * A step that computes a number has no per-record variables — and the field
 * picker used to claim otherwise: a Calculate that produced 38 advertised an
 * "Output number" field whose sample read 1 and which resolved to nothing at
 * all, because no record ever carries it. Its number lives in the Compare
 * slots, where it is real.
 */
describe("the field picker only offers variables that exist", () => {
  it("a value-producing step contributes no pickable fields", async () => {
    const { buildFieldGroups } = await import("@/components/flow/graph-utils");
    const tested = (id: string, type: string, config: Record<string, unknown>, schema: unknown[] = []) => ({
      id,
      type,
      position: { x: 0, y: 0 },
      data: {
        config,
        lastTest: { status: "ok", recordsIn: 3, recordsOut: 1, value: 38, sample: [{}], outputSchema: schema },
      },
    });
    const nodes = [
      tested("a", "app", { connectionId: CONN, source: "close" }, [{ path: "properties.lead_id", label: "lead_id", type: "text" }]),
      tested("calc", "formula", { op: "count" }),
      tested("f", "filter", { combinator: "and", rules: [] }),
    ] as never[];
    const edges = [
      { id: "e1", source: "a", target: "calc" },
      { id: "e2", source: "calc", target: "f" },
    ] as never[];

    const groups = buildFieldGroups({
      selectedId: "f",
      nodes,
      edges,
      stepNoById: new Map([["a", 1], ["calc", 2], ["f", 3]]),
      titleOf: (n) => String(n.type),
    });
    // Sabotage: put the phantom __count_<id> back and a group titled after
    // the Calculate shows up offering a field worth 1 that resolves to
    // nothing.
    expect(groups.some((g) => g.fields.some((x) => x.path === "__count_calc"))).toBe(false);
    // The dataset step above it still contributes its real columns.
    expect(groups.some((g) => g.fields.some((x) => x.path === "properties.lead_id"))).toBe(true);
  });
});
