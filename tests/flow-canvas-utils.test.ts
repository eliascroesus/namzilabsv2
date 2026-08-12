import type { FieldInfo } from "@/lib/flow/schema-infer";
import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import {
  bridgeEdgeFor,
  buildFieldGroups,
  computeVerticalLayout,
  computeStepNumbers,
  laneAncestorIds,
  nodeNeedsSetup,
  resolveSampleField,
  describeInputs,
  structuralEdges,
  terminalIds,
  type FNode,
} from "@/components/flow/graph-utils";

// Minimal node/edge builders for the pure helpers.
const N = (id: string, type: string, data: Partial<FNode["data"]> = {}): FNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { config: {}, ...data } }) as FNode;
const E = (source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id: `${source}->${target}`, source, target, ...extra });
const titleOf = (n: FNode) => (typeof n.data.label === "string" && n.data.label) || String(n.type);

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
  it("bridges a multi-input junction (Unite) from its first lane", () => {
    const bridge = bridgeEdgeFor("b", [E("a", "b"), E("a2", "b"), E("b", "c")])!;
    expect(bridge.source).toBe("a");
    expect(bridge.target).toBe("c");
  });
  it("deleting a matching Combine reconnects its KEPT lane, wherever it was wired", () => {
    // Sabotage: bridge blind from incoming[0] and deleting a matching Combine
    // whose keep lane was wired second hands every downstream step the check
    // list's records — silently, with a well-formed graph no validator flags.
    const edges = [E("sheetRows", "x"), E("closeLeads", "x"), E("x", "calc")];
    const bridge = bridgeEdgeFor("x", edges, "closeLeads")!;
    expect(bridge.source).toBe("closeLeads");
    expect(bridge.target).toBe("calc");
    // No preference (a stacking Combine) keeps the old first-lane rule.
    expect(bridgeEdgeFor("x", edges)!.source).toBe("sheetRows");
    // A preference that no longer matches any edge falls back rather than failing.
    expect(bridgeEdgeFor("x", edges, "gone")!.source).toBe("sheetRows");
  });
  it("returns null for multiple outputs or no input", () => {
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
  const schema: FieldInfo[] = [
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

  it("shows the step's own fields (no separate System group), canonical ones humanised", () => {
    const groups = buildFieldGroups({ selectedId: "f1", nodes, edges, stepNoById, titleOf });
    expect(groups[0].from).toBe("app");
    // Custom fields first, then canonical fields that carry data, then the step's
    // record count last — it is a dataset number, not one of the step's columns.
    expect(groups[0].fields.map((f) => f.path)).toEqual(["plan", "properties.seats", "subject", "__count_app1"]);
    expect(groups[0].fields.find((f) => f.path === "subject")?.label).toBe("Subject / person");
    // No trailing System group anymore.
    expect(groups.some((g) => g.system)).toBe(false);
  });

  it("uses the chosen sample record for example values", () => {
    const first = buildFieldGroups({ selectedId: "f1", nodes, edges, stepNoById, titleOf, sampleIndexOf: () => 0 });
    const second = buildFieldGroups({ selectedId: "f1", nodes, edges, stepNoById, titleOf, sampleIndexOf: () => 1 });
    const planFirst = first[0].fields.find((f) => f.path === "plan");
    const planSecond = second[0].fields.find((f) => f.path === "plan");
    expect(planFirst?.example).toBe("pro");
    expect(planSecond?.example).toBe("free");
  });

  it("never lists a Unite step as a data group — its lanes' steps appear instead", () => {
    const unite = N("u", "unite", {
      lastTest: { status: "ok", recordsIn: 3, recordsOut: 3, sample: [], inputSample: [], outputSchema: schema },
    });
    const after = N("f2", "filter");
    const groups = buildFieldGroups({
      selectedId: "f2",
      nodes: [app, unite, after],
      edges: [E("app1", "u"), E("u", "f2")],
      stepNoById: new Map([["app1", 1], ["u", 2], ["f2", 3]]),
      titleOf,
    });
    expect(groups.some((g) => g.from === "unite")).toBe(false);
    expect(groups.some((g) => g.from === "app")).toBe(true);
  });
});

describe("Combine's match mode in the editor's pure helpers", () => {
  const tested = {
    status: "ok" as const,
    recordsIn: 2,
    recordsOut: 1,
    sample: [],
    inputSample: [],
    outputSchema: [{ path: "plan", label: "plan", type: "text" }] as FieldInfo[],
  };

  it("a matching Combine needs setup until BOTH inputs are wired and all three answers are given", () => {
    // Sabotage: default any of these and a half-built join runs with a hidden
    // side — the exact silence the option was built to end.
    const full = { mode: "match", keepNodeId: "a", keyField: "k", lookupField: "l", matchMode: "appears" };
    expect(nodeNeedsSetup("unite", full, 2)).toBe(false);
    expect(nodeNeedsSetup("unite", full, 1)).toBe(true);
    expect(nodeNeedsSetup("unite", { ...full, keepNodeId: "" }, 2)).toBe(true);
    expect(nodeNeedsSetup("unite", { ...full, keyField: "" }, 2)).toBe(true);
    expect(nodeNeedsSetup("unite", { ...full, lookupField: "" }, 2)).toBe(true);
    // A stacking Combine (and every stored {} config) keeps its old rule.
    expect(nodeNeedsSetup("unite", {}, 1)).toBe(false);
    expect(nodeNeedsSetup("unite", {}, 0)).toBe(true);
  });

  it("laneAncestorIds scopes one input's side, never the other lane", () => {
    // app1 → f1 → x ← app2. The f1 lane's scope is {f1, app1}; app2 is the
    // other side. Offering the union re-opens the mistaken-join trap.
    const edges = [E("app1", "f1"), E("f1", "x"), E("app2", "x")];
    expect([...laneAncestorIds("f1", edges)].sort()).toEqual(["app1", "f1"]);
    expect([...laneAncestorIds("app2", edges)].sort()).toEqual(["app2"]);
  });

  it("below a matching Combine the check-list lane's fields are NOT offered — its records don't flow there", () => {
    // Sabotage: walk all lanes blind and the picker below the Combine offers
    // the reference side's columns, which resolve on no record — the exact
    // "pick a field the data doesn't carry" trap, one step later.
    const app = N("app1", "app", { lastTest: { ...tested, sample: [{ source: "close", properties: { plan: "pro" } }] } });
    const app2 = N("app2", "app", { lastTest: { ...tested, sample: [{ source: "gsheets", properties: {} }] } });
    const matchCfg = { mode: "match", keepNodeId: "app1", keyField: "plan", lookupField: "plan", matchMode: "appears" };
    const after = N("f9", "filter");
    const nodes = [app, app2, N("x", "unite", { config: matchCfg, lastTest: tested }), after];
    const edges = [E("app1", "x"), E("app2", "x"), E("x", "f9")];
    const stepNoById = new Map([["app1", 1], ["app2", 2], ["x", 3], ["f9", 4]]);

    const below = buildFieldGroups({ selectedId: "f9", nodes, edges, stepNoById, titleOf });
    expect(below.some((g) => g.nodeId === "app1")).toBe(true);
    expect(below.some((g) => g.nodeId === "app2")).toBe(false);

    // The matched population is PICKABLE downstream, by name: a matching
    // Combine is where "the leads that are also in the spreadsheet" comes
    // into existence, and a Time between or a Filter below it must be able
    // to say so. Sabotage: treat it as pass-through (Output only) and the
    // only offer is the Get data step, which reads as all 324 leads and had
    // users believing their metric ran on records the step already dropped.
    const xg = below.find((g) => g.nodeId === "x");
    expect(xg).toBeDefined();
    expect(xg!.fields.map((f) => f.path)).toContain("plan");
    // …AND it is still a decision step: survived-the-check and how-many.
    expect(xg!.fields.map((f) => f.path)).toEqual(expect.arrayContaining(["__passed_x", "__count_x"]));
    // Only the KEPT lane's records — its example values come from the Close
    // side, never the spreadsheet the records were merely checked against.
    expect((xg!.sampleRecord as { source?: string } | undefined)?.source).toBe("close");

    /**
     * …but ONLY when the kept side is one lane. Exposing columns is what
     * makes a step pickable as a Time between MOMENT, and a moment names the
     * lane a record came down. Keep a STACK and the Combine stamps every
     * record of two shapes: naming it on both sides of the clock measures
     * call → call and publishes a plausible near-zero, which is precisely
     * what the unset-lane guard exists to stop (it only fires when a side is
     * BLANK, so a named multi-lane step walks straight past it).
     * Sabotage: drop the one-lane condition and this falls back to columns.
     */
    const stackedKeep = [
      app,
      app2,
      N("cal", "app", { lastTest: { ...tested, sample: [{ source: "close", properties: { plan: "pro" } }] } }),
      N("stack", "unite", { config: {}, lastTest: tested }),
      N("x", "unite", { config: { ...matchCfg, keepNodeId: "stack" }, lastTest: tested }),
      after,
    ];
    const stackedEdges = [E("app1", "stack"), E("cal", "stack"), E("stack", "x"), E("app2", "x"), E("x", "f9")];
    const belowMulti = buildFieldGroups({
      selectedId: "f9",
      nodes: stackedKeep,
      edges: stackedEdges,
      stepNoById: new Map([["app1", 1], ["cal", 2], ["stack", 3], ["app2", 4], ["x", 5], ["f9", 6]]),
      titleOf,
    });
    const multi = belowMulti.find((g) => g.nodeId === "x")!;
    expect(multi.fields.map((f) => f.path).sort()).toEqual(["__count_x", "__passed_x"]);

    // The Combine's OWN panel still sees both lanes — that is where the two
    // match fields get picked.
    const atCombine = buildFieldGroups({ selectedId: "x", nodes, edges, stepNoById, titleOf });
    expect(atCombine.some((g) => g.nodeId === "app1")).toBe(true);
    expect(atCombine.some((g) => g.nodeId === "app2")).toBe(true);

    // And a STACKING Combine keeps offering both lanes below — its records
    // genuinely flow on together — while contributing no group of its own.
    const stacked = nodes.map((n) => (n.id === "x" ? N("x", "unite", {}) : n));
    const belowStack = buildFieldGroups({ selectedId: "f9", nodes: stacked, edges, stepNoById, titleOf });
    expect(belowStack.some((g) => g.nodeId === "app1")).toBe(true);
    expect(belowStack.some((g) => g.nodeId === "app2")).toBe(true);
    expect(belowStack.some((g) => g.nodeId === "x")).toBe(false);

    // A STALE keep reference (its lane got rewired without the config
    // following) fails OPEN. Sabotage: keep the strict skip and a stale id
    // hides BOTH lanes — every picker below the Combine goes empty, with the
    // kept lane's tested app sitting right there.
    const stale = nodes.map((n) => (n.id === "x" ? N("x", "unite", { config: { ...matchCfg, keepNodeId: "gone" }, lastTest: tested }) : n));
    const belowStale = buildFieldGroups({ selectedId: "f9", nodes: stale, edges, stepNoById, titleOf });
    expect(belowStale.some((g) => g.nodeId === "app1")).toBe(true);
    expect(belowStale.some((g) => g.nodeId === "app2")).toBe(true);
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
  const agg = N("aggN", "formula", { config: { op: "count" } });
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

  it("a filter step exposes its Output and its count, not columns", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    const filterGroup = groups.find((g) => g.stepNo === 2);
    expect(filterGroup?.fields.map((f) => f.label)).toEqual(["Output", "Output number"]);
    expect(filterGroup?.fields.map((f) => f.path)).toEqual(["__passed_fN", "__count_fN"]);
    expect(filterGroup?.fields.find((f) => f.label === "Output")?.type).toBe("boolean");
    expect(filterGroup?.fields.find((f) => f.label === "Output number")?.example).toBe(1); // recordsOut
  });

  it("a data step exposes its columns", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    const appGroup = groups.find((g) => g.stepNo === 1);
    expect(appGroup?.fields.some((f) => f.path === "plan")).toBe(true);
  });

  /**
   * "Output number" is how many records the step produced — the 390 on a Get data
   * card. It is a property of the dataset, so it reads identically on every row:
   * a per-record condition on it passes everything or nothing. It is offered to be
   * READ, and it goes LAST so it never competes with the step's real columns.
   */
  it("offers each step's record count last, after its real fields", () => {
    const groups = buildFieldGroups({ selectedId: "aggN", nodes, edges, stepNoById, titleOf });
    for (const g of groups) {
      const last = g.fields[g.fields.length - 1];
      expect(last.path).toBe(`__count_${g.stepNo === 1 ? "appN" : "fN"}`);
      expect(last.label).toBe("Output number");
    }
  });
});

/**
 * Fields a source declares as plumbing never reach the picker. Two kinds qualify:
 * constant on every row (`kind` is always "calendar#event"), or an exact
 * restatement of another field (a calendar's `subject` IS its `summary`). A
 * condition on a constant passes every record or none, so offering it can only
 * mislead. Hiding is display-only — stored references still resolve.
 */
describe("buildFieldGroups — connector-declared hidden fields", () => {
  const sample = [
    {
      source: "gcal",
      subject: "setting call",
      occurredAt: "2026-07-26T14:00:00.000Z",
      properties: { summary: "setting call", kind: "calendar#event", htmlLink: "https://…", guests_accepted: 2 },
    },
  ];
  const schema: FieldInfo[] = [
    { path: "properties.summary", label: "summary", type: "text" },
    { path: "properties.kind", label: "kind", type: "text" },
    { path: "properties.htmlLink", label: "htmlLink", type: "text" },
    { path: "properties.guests_accepted", label: "guests_accepted", type: "number" },
    { path: "subject", label: "subject", type: "text" },
    { path: "source", label: "source", type: "text" },
    { path: "occurredAt", label: "occurredAt", type: "date" },
  ];
  const app = N("gc", "app", {
    config: { source: "gcal" },
    lastTest: { status: "ok", recordsIn: 1, recordsOut: 390, sample, inputSample: [], outputSchema: schema },
  });
  const after = N("f", "filter");
  const groups = () =>
    buildFieldGroups({
      selectedId: "f",
      nodes: [app, after],
      edges: [E("gc", "f")],
      stepNoById: new Map([["gc", 1], ["f", 2]]),
      titleOf,
    });

  it("drops the plumbing a calendar record carries", () => {
    const paths = groups()[0].fields.map((f) => f.path);
    for (const gone of ["properties.kind", "properties.htmlLink", "subject", "source"]) {
      expect(paths).not.toContain(gone);
    }
  });

  it("keeps the fields that answer something — including Occurred at", () => {
    const paths = groups()[0].fields.map((f) => f.path);
    // On a calendar this IS the meeting's start time, and the default date field
    // of every Time-window step. It only looked like plumbing because its label
    // is humanised like one of ours.
    expect(paths).toContain("occurredAt");
    expect(paths).toContain("properties.summary");
    expect(paths).toContain("properties.guests_accepted");
  });

  it("still offers the step's record count", () => {
    const outNum = groups()[0].fields.find((f) => f.label === "Output number");
    expect(outNum?.example).toBe(390);
  });

  it("hides nothing for a source that declares no plumbing", () => {
    const sheets = N("gs", "app", {
      config: { source: "gsheets" },
      lastTest: { status: "ok", recordsIn: 1, recordsOut: 1, sample, inputSample: [], outputSchema: schema },
    });
    const g = buildFieldGroups({
      selectedId: "f",
      nodes: [sheets, after],
      edges: [E("gs", "f")],
      stepNoById: new Map([["gs", 1], ["f", 2]]),
      titleOf,
    });
    expect(g[0].fields.map((f) => f.path)).toContain("properties.kind");
  });
});

describe("structural layout — number references never move nodes", () => {
  const app = N("s", "app");
  const filter = N("f", "filter");
  const calc = N("c", "formula");
  const nodes = [app, filter, calc];
  // The line: sheets → filter → calc (plain chain edges).
  const chain = [E("s", "f"), E("f", "c")];
  // The calc's numbers: references to earlier steps (named handles).
  const withRefs = [...chain, E("s", "c", { id: "ra", targetHandle: "a" }), E("s", "c", { id: "rb", targetHandle: "b" })];
  const otherRefs = [...chain, E("f", "c", { id: "ra2", targetHandle: "a" }), E("s", "c", { id: "rb2", targetHandle: "b" })];

  it("keeps a compare step in its chain position no matter which numbers it references", () => {
    const base = computeVerticalLayout(nodes, chain);
    expect(computeVerticalLayout(nodes, withRefs)).toEqual(base);
    expect(computeVerticalLayout(nodes, otherRefs)).toEqual(base);
    // Step numbers are equally unaffected.
    expect(computeStepNumbers(nodes, withRefs)).toEqual(computeStepNumbers(nodes, chain));
  });

  it("structuralEdges drops reference edges once a chain edge exists, keeps legacy anchors", () => {
    expect(structuralEdges(nodes, withRefs).map((e) => e.id)).toEqual(chain.map((e) => e.id));
    // Legacy compare (no plain chain): its "a" edge is its anchor and is kept.
    const legacy = [E("s", "f"), E("f", "c", { id: "la", targetHandle: "a" }), E("s", "c", { id: "lb", targetHandle: "b" })];
    expect(structuralEdges(nodes, legacy).map((e) => e.id)).toEqual(["s->f", "la"]);
  });

  it("a step that only feeds a reference still counts as a line end", () => {
    // sheets → filter (chain); calc chained after filter; sheets also referenced by calc.
    const terms = terminalIds(nodes, withRefs);
    expect(terms.has("c")).toBe(true);
    expect(terms.has("s")).toBe(false);
  });
});

describe("multiple Get data roots — parallel lanes", () => {
  it("puts each data source on its own lane, side by side, with its chain below it", () => {
    const nodes = [N("s1", "app"), N("f1", "filter"), N("s2", "app"), N("f2", "filter")];
    const edges = [E("s1", "f1"), E("s2", "f2")];
    const pos = computeVerticalLayout(nodes, edges);
    // Both sources on the top row, spaced apart — neither reads as the other's next step.
    expect(pos.get("s1")!.y).toBe(pos.get("s2")!.y);
    expect(pos.get("s2")!.x - pos.get("s1")!.x).toBeGreaterThanOrEqual(288);
    // Each source's chain runs straight down its own lane.
    expect(pos.get("f1")!.x).toBe(pos.get("s1")!.x);
    expect(pos.get("f2")!.x).toBe(pos.get("s2")!.x);
    expect(pos.get("f1")!.y).toBeGreaterThan(pos.get("s1")!.y);
    // Both chains end in their own terminal (each lane gets its own "+ Add next step").
    const terms = terminalIds(nodes, edges);
    expect(terms.has("f1")).toBe(true);
    expect(terms.has("f2")).toBe(true);
  });
});

describe("Unite layout — a junction joining lanes", () => {
  it("centres a unite between the lanes it joins, below all of them", () => {
    const nodes = [N("s1", "app"), N("s2", "app"), N("u", "unite"), N("agg", "formula", { config: { op: "count" } })];
    const edges = [E("s1", "u"), E("s2", "u"), E("u", "agg")];
    const pos = computeVerticalLayout(nodes, edges);
    const mid = (pos.get("s1")!.x + pos.get("s2")!.x) / 2;
    expect(pos.get("u")!.x).toBe(mid);
    expect(pos.get("u")!.y).toBeGreaterThan(pos.get("s1")!.y);
    // The chain continues below the junction, in its lane.
    expect(pos.get("agg")!.x).toBe(pos.get("u")!.x);
    expect(pos.get("agg")!.y).toBeGreaterThan(pos.get("u")!.y);
  });
});

describe("Unite merging sibling branches of one split", () => {
  it("centres a unite that joins two branch lanes, below both of them", () => {
    const hub = N("p", "paths", { config: { paths: [{ id: "p1", label: "A" }, { id: "p2", label: "B" }] } });
    const nodes = [N("a", "app"), hub, N("f1", "filter"), N("f2", "filter"), N("u", "unite")];
    const edges = [
      E("a", "p"),
      E("p", "f1", { sourceHandle: "p1" }),
      E("p", "f2", { sourceHandle: "p2" }),
      E("f1", "u"),
      E("f2", "u"),
    ];
    const pos = computeVerticalLayout(nodes, edges);
    // Branch lanes fan out symmetrically; the merge sits centred between + below them.
    expect(pos.get("f1")!.x).toBeLessThan(0);
    expect(pos.get("f2")!.x).toBeGreaterThan(0);
    expect(pos.get("u")!.x).toBe(0);
    expect(pos.get("u")!.y).toBeGreaterThan(pos.get("f1")!.y);
    expect(pos.get("u")!.y).toBeGreaterThan(pos.get("f2")!.y);
  });
});

describe("describeInputs (Unite + Calculate panels)", () => {
  it("describes each connected input in connection order, with the producer's number", () => {
    const a = N("a", "app", {
      config: { source: "gsheets" },
      lastTest: { status: "ok", recordsIn: 2, recordsOut: 2, sample: [], inputSample: [], outputSchema: [] },
    });
    const calc = N("k", "formula", {
      config: { op: "count" },
      lastTest: { status: "ok", recordsIn: 2, recordsOut: 1, sample: [], inputSample: [], outputSchema: [], value: 2 },
    });
    const unite = N("c", "unite");
    const inputs = describeInputs({
      selectedId: "c",
      nodes: [a, calc, unite],
      edges: [E("a", "c"), E("k", "c", { targetHandle: "a" })],
      titleOf,
    });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ nodeId: "a", targetHandle: null, title: "app" });
    expect(inputs[1]).toMatchObject({ nodeId: "k", targetHandle: "a", value: 2 });
  });
});

/**
 * A Filter with nothing to filter on passes every record. It used to wear the
 * green "Ready" badge — the most common half-built state in the product,
 * showing the word that means finished.
 */
describe("an empty Filter is not Ready", () => {
  it("needs setup with no conditions and no date window", async () => {
    const { nodeNeedsSetup } = await import("@/components/flow/graph-utils");
    // Sabotage: fall through to `inputCount === 0` as it used to and a step
    // passing 100% of records reads green, with "390 passed" beneath it.
    expect(nodeNeedsSetup("filter", { combinator: "and", rules: [] }, 1)).toBe(true);
    expect(nodeNeedsSetup("filter", { combinator: "and", rules: [{ field: "x", op: "equals", value: "y" }] }, 1)).toBe(false);
    // A date window is a real filter, even with no rules.
    expect(nodeNeedsSetup("filter", { combinator: "and", rules: [], dateRange: { enabled: true } }, 1)).toBe(false);
    // Still needs an input first.
    expect(nodeNeedsSetup("filter", { combinator: "and", rules: [{ field: "x", op: "equals", value: "y" }] }, 0)).toBe(true);
  });
});

/**
 * A branch head set to "Always run" or "Everything else" correctly has no
 * rules — the panel hides the condition editor entirely for those modes. The
 * empty-Filter rule badged them "Needs setup" forever, which disables Continue
 * and takes the Test button with it.
 */
describe("a non-custom branch head is already configured", () => {
  it("always and fallback need no conditions; custom still does", async () => {
    const { nodeNeedsSetup } = await import("@/components/flow/graph-utils");
    const empty = { combinator: "and", rules: [] };
    // Sabotage: ignore branchMode and these are stuck on "Needs setup" with no
    // control on screen that could ever clear it.
    expect(nodeNeedsSetup("filter", empty, 1, undefined, "always")).toBe(false);
    expect(nodeNeedsSetup("filter", empty, 1, undefined, "fallback")).toBe(false);
    expect(nodeNeedsSetup("filter", empty, 1, undefined, "custom")).toBe(true);
    expect(nodeNeedsSetup("filter", empty, 1, undefined, null)).toBe(true);
    // Still needs an input, whatever the mode.
    expect(nodeNeedsSetup("filter", empty, 0, undefined, "always")).toBe(true);
  });
});
