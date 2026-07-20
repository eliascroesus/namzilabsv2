import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import {
  bridgeEdgeFor,
  isValidFlowConnection,
  buildFieldGroups,
  resolveSampleField,
  fieldProvenance,
  flowChecks,
  describeInputs,
  collidingFields,
  type FNode,
} from "@/components/flow/graph-utils";

// Minimal node/edge builders for the pure helpers.
const N = (id: string, type: string, data: Partial<FNode["data"]> = {}): FNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { config: {}, ...data } }) as FNode;
const E = (source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id: `${source}->${target}`, source, target, ...extra });
const titleOf = (n: FNode) => (typeof n.data.label === "string" && n.data.label) || String(n.type);

describe("isValidFlowConnection", () => {
  it("only allows scalar producers into a Formula", () => {
    expect(isValidFlowConnection("aggregate", "formula")).toBe(true);
    expect(isValidFlowConnection("formula", "formula")).toBe(true);
    expect(isValidFlowConnection("app", "formula")).toBe(false);
    expect(isValidFlowConnection("filter", "formula")).toBe(false);
    expect(isValidFlowConnection("group", "formula")).toBe(false);
  });
  it("only allows dataset producers into dataset consumers", () => {
    expect(isValidFlowConnection("app", "filter")).toBe(true);
    expect(isValidFlowConnection("filter", "aggregate")).toBe(true);
    expect(isValidFlowConnection("aggregate", "filter")).toBe(false); // scalar into a dataset consumer
  });
  it("lets anything meaningful into Output but nothing into App", () => {
    expect(isValidFlowConnection("aggregate", "output")).toBe(true);
    expect(isValidFlowConnection("filter", "output")).toBe(true);
    expect(isValidFlowConnection("filter", "app")).toBe(false);
  });
});

describe("bridgeEdgeFor (delete & reconnect)", () => {
  it("bridges a node with exactly one in and one out edge", () => {
    const edges = [E("a", "b"), E("b", "c")];
    const bridge = bridgeEdgeFor("b", edges);
    expect(bridge).not.toBeNull();
    expect(bridge!.source).toBe("a");
    expect(bridge!.target).toBe("c");
  });
  it("preserves the incoming sourceHandle and outgoing targetHandle", () => {
    const edges = [E("p", "b", { sourceHandle: "x" }), E("b", "f", { targetHandle: "a" })];
    const bridge = bridgeEdgeFor("b", edges)!;
    expect(bridge.sourceHandle).toBe("x");
    expect(bridge.targetHandle).toBe("a");
  });
  it("returns null for multiple inputs or outputs", () => {
    expect(bridgeEdgeFor("b", [E("a", "b"), E("a2", "b"), E("b", "c")])).toBeNull();
    expect(bridgeEdgeFor("b", [E("a", "b"), E("b", "c"), E("b", "c2")])).toBeNull();
    expect(bridgeEdgeFor("b", [E("b", "c")])).toBeNull(); // no input
  });
});

describe("resolveSampleField", () => {
  const rec = { source: "gsheets", eventType: "row_added", subject: "a@b.com", value: 10, properties: { plan: "pro", seats: 4 } };
  it("resolves standard columns and property paths", () => {
    expect(resolveSampleField(rec, "source")).toBe("gsheets");
    expect(resolveSampleField(rec, "value")).toBe(10);
    expect(resolveSampleField(rec, "plan")).toBe("pro");
    expect(resolveSampleField(rec, "properties.seats")).toBe(4);
    expect(resolveSampleField(rec, "missing")).toBeUndefined();
  });
  it("drills into nested objects and arrays", () => {
    const nested = { properties: { utm: { source: "google" }, items: [{ price: 9 }, { price: 42 }] } };
    expect(resolveSampleField(nested, "properties.utm.source")).toBe("google");
    expect(resolveSampleField(nested, "properties.items.1.price")).toBe(42);
  });
});

describe("buildFieldGroups (variable picker)", () => {
  const schema = [
    { path: "subject", label: "Subject", type: "text" },
    { path: "plan", label: "plan", type: "text" },
    { path: "properties.seats", label: "seats", type: "number" },
  ];
  const app = N("app1", "app", {
    lastTest: {
      status: "ok",
      recordsIn: 3,
      recordsOut: 3,
      sample: [
        { source: "gsheets", subject: "first", properties: { plan: "pro", seats: 4 } },
        { source: "gsheets", subject: "second", properties: { plan: "free", seats: 1 } },
      ],
      inputSample: [],
      outputSchema: schema,
    },
  });
  const filter = N("f1", "filter");
  const nodes = [app, filter];
  const edges = [E("app1", "f1")];
  const stepNoById = new Map([["app1", 1], ["f1", 2]]);

  it("shows source fields first and puts canonical fields in a trailing System group", () => {
    const groups = buildFieldGroups({ selectedId: "f1", nodes, edges, stepNoById, titleOf });
    // First group = the upstream source's custom fields (subject is standard, so excluded
    // here) plus the step's "Output number" (record count).
    expect(groups[0].from).toBe("app");
    expect(groups[0].fields.map((f) => f.path)).toEqual(["plan", "properties.seats", "__count_app1"]);
    expect(groups[0].fields.find((f) => f.path === "__count_app1")?.label).toBe("Output number");
    // Last group = collapsed System fields.
    const last = groups[groups.length - 1];
    expect(last.system).toBe(true);
    expect(last.from).toBe("System fields");
    expect(last.fields.map((f) => f.path)).toContain("source");
    expect(last.fields.map((f) => f.path)).toContain("occurredAt");
  });

  it("uses the chosen sample record for example values", () => {
    const first = buildFieldGroups({ selectedId: "f1", nodes, edges, stepNoById, titleOf, sampleIndexOf: () => 0 });
    const second = buildFieldGroups({ selectedId: "f1", nodes, edges, stepNoById, titleOf, sampleIndexOf: () => 1 });
    const planFirst = first[0].fields.find((f) => f.path === "plan");
    const planSecond = second[0].fields.find((f) => f.path === "plan");
    expect(planFirst?.example).toBe("pro");
    expect(planSecond?.example).toBe("free");
  });
});

describe("buildFieldGroups — nearest-app example resolution + provenance", () => {
  const sample = [{ source: "gsheets", subject: "first", properties: { utm: { source: "google" }, plan: "pro" } }];
  const app = N("appN", "app", {
    config: { source: "gsheets" },
    lastTest: { status: "ok", recordsIn: 1, recordsOut: 1, sample, inputSample: [], outputSchema: [{ path: "properties.utm", label: "utm", type: "object", container: true }, { path: "plan", label: "plan", type: "text" }] },
  });
  // A transform between the app and the selected node: its own sample is a subset, but
  // app-origin field examples should still come from the app's selected record.
  const filter = N("fN", "filter", {
    lastTest: { status: "ok", recordsIn: 1, recordsOut: 1, sample, inputSample: [], outputSchema: [{ path: "properties.utm", label: "utm", type: "object", container: true }, { path: "plan", label: "plan", type: "text" }] },
  });
  const agg = N("aggN", "aggregate");
  const nodes = [app, filter, agg];
  const edges = [E("appN", "fN"), E("fN", "aggN")];
  const stepNoById = new Map([["appN", 1], ["fN", 2], ["aggN", 3]]);

  it("tags the group with its nearest-app source and a sample record", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    expect(groups[0].appSource).toBe("gsheets");
    expect(groups[0].sampleRecord).toBeDefined();
    const plan = groups[0].fields.find((f) => f.path === "plan");
    expect(plan?.example).toBe("pro"); // resolved from the app's selected record
    expect(groups[0].fields.find((f) => f.path === "properties.utm")?.container).toBe(true);
  });

  it("fieldProvenance resolves a drilled-in nested path to its originating step + sample", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    const prov = fieldProvenance(groups, "properties.utm.source");
    expect(prov.sample).toBe("google");
    expect(prov.label).toBe("source");
    // Every upstream step is now a group (in flow order), so the field is attributed to
    // the step that first introduced it — the app (step 1) — not the pass-through Filter.
    expect(prov.stepNo).toBe(1);
  });

  it("a filter step exposes only its Output + Output number, not columns", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    const filterGroup = groups.find((g) => g.stepNo === 2);
    expect(filterGroup?.fields.map((f) => f.label)).toEqual(["Output", "Output number"]);
    expect(filterGroup?.fields.map((f) => f.path)).toEqual(["__passed_fN", "__count_fN"]);
    expect(filterGroup?.fields.find((f) => f.label === "Output number")?.example).toBe(1); // recordsOut
    expect(filterGroup?.fields.find((f) => f.label === "Output")?.type).toBe("boolean");
  });

  it("a data step exposes its columns plus an Output number", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    const appGroup = groups.find((g) => g.stepNo === 1);
    expect(appGroup?.fields.map((f) => f.label)).toContain("Output number");
    expect(appGroup?.fields.some((f) => f.path === "plan")).toBe(true);
  });
});

describe("flowChecks (Flow check rail)", () => {
  it("explains that a grouped aggregate can't feed a formula", () => {
    const app = N("a", "app", { config: { connectionId: "c", source: "gsheets" } });
    const agg = N("g", "aggregate", { config: { aggregation: "count", groupBy: { type: "time", unit: "week" } } });
    const formula = N("f", "formula", { config: { op: "percentage" } });
    const nodes = [app, agg, formula];
    const edges = [E("a", "g"), E("g", "f", { targetHandle: "a" })];
    const checks = flowChecks(nodes, edges, titleOf);
    expect(checks.some((c) => c.nodeId === "g" && /grouped by week/.test(c.impact))).toBe(true);
  });

  it("flags a disconnected step and clears on a valid graph", () => {
    const app = N("a", "app", { config: { connectionId: "c", source: "gsheets" } });
    const out = N("o", "output", { config: { name: "Signups" } });
    expect(flowChecks([app, out], [], titleOf).some((c) => c.nodeId === "o")).toBe(true);
    expect(flowChecks([app, out], [E("a", "o")], titleOf)).toHaveLength(0);
  });
});

describe("describeInputs / collidingFields (Combine + Formula panels)", () => {
  const mk = (id: string, src: string) =>
    N(id, "app", {
      config: { source: src, connectionName: `${src} acct`, eventType: "row_added" },
      lastTest: { status: "ok", recordsIn: 2, recordsOut: 2, sample: [], inputSample: [], outputSchema: [{ path: "email", label: "email", type: "text" }] },
    });
  const a = mk("a", "gsheets");
  const b = mk("b", "close");
  const combine = N("c", "combine");
  const nodes = [a, b, combine];
  const edges = [E("a", "c"), E("b", "c")];

  it("describes each connected source with app + record count", () => {
    const inputs = describeInputs({ selectedId: "c", nodes, edges, titleOf });
    expect(inputs).toHaveLength(2);
    expect(inputs[0].appSource).toBe("gsheets");
    expect(inputs[0].recordCount).toBe(2);
    expect(inputs[0].status).toBe("ok");
    expect(inputs[1].appSource).toBe("close");
  });

  it("flags fields shared across sources (overwrite warning)", () => {
    const inputs = describeInputs({ selectedId: "c", nodes, edges, titleOf });
    expect(collidingFields(inputs)).toContain("email");
  });
});
