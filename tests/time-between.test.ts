import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, type NodeExecOk } from "@/lib/flow/engine";
import { planPushdown } from "@/lib/flow/compile/pushdown";
import { validateGraph } from "@/lib/flow/validate";
import { parseGraph, type Scalar } from "@/lib/flow/types";
import { FLOW_TEMPLATES, flowTemplate } from "@/lib/flow/templates";
import type { DB } from "@/db/types";

/**
 * The pairing primitive (Time between) and the metric it exists for (speed
 * to lead). Nothing else in the engine reads two records at once, so every
 * behavior here is load-bearing: the at-or-after guard, the emit-nothing
 * rule for unmatched keys, the earliest-start tie-break, and the gap being
 * plain NUMBERS the existing aggregates can eat.
 *
 * The step is configured by PICKING VARIABLES: a field path plus the step
 * whose records carry it. That second half is what these tests exercise
 * hardest — after a Combine, leads and calls both carry `occurredAt`, so the
 * lane is the only thing telling them apart.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_tb";
const CONN = randomUUID();
const T0 = Date.parse("2026-07-01T12:00:00Z");
const MIN = 60_000;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
});
afterEach(async () => {
  await close();
});

async function ev(o: { eventType: string; leadId?: string | null; atMin: number; direction?: string; extra?: Record<string, unknown> }) {
  await db.insert(events).values({
    eventId: `tbtest:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "close",
    eventType: o.eventType,
    subject: null,
    occurredAt: new Date(T0 + o.atMin * MIN),
    properties: {
      ...(o.leadId !== null ? { lead_id: o.leadId ?? "lead_A" } : {}),
      data: o.direction ? { direction: o.direction } : {},
      ...(o.extra ?? {}),
    },
  });
}

const N = (id: string, type: string, config: unknown, label?: string) => ({ id, type, data: { config, ...(label ? { label } : {}) } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const TB = (over: Record<string, unknown> = {}) => ({
  keyField: "properties.lead_id",
  startField: "occurredAt",
  startStep: "leads",
  endField: "occurredAt",
  endStep: "calls",
  ...over,
});
/** The gap, in minutes, off an emitted record. */
const mins = (r: { properties: Record<string, unknown> }) => (r.properties.time_between as Record<string, unknown>).minutes;

/**
 * The real shape: two Get data lanes into a Combine, then the step. Both
 * lanes carry `occurredAt` and nothing else distinguishes them.
 */
async function matches(tb: Record<string, unknown> = {}, extraNodes: unknown[] = [], extraEdges: unknown[] = []) {
  const g = parseGraph({
    nodes: [
      N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
      N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
      N("u", "unite", {}),
      N("t", "time_between", TB(tb)),
      ...extraNodes,
    ],
    edges: [E("leads", "u"), E("calls", "u"), E("u", "t"), ...extraEdges],
  });
  const res = await runFlow({ db, orgId: ORG }, g);
  const exec = res.nodes.get("t")!;
  expect(exec.status).toBe("ok");
  const shape = (exec as NodeExecOk).shape;
  if (shape.kind !== "dataset") throw new Error("expected dataset");
  return shape.records;
}

describe("time_between semantics", () => {
  it("pairs each key's earliest start with the first stop at-or-after it, as a numeric duration", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 45 }); // later call — not the first
    await ev({ eventType: "lead_created", leadId: "L2", atMin: 5 });
    await ev({ eventType: "call_logged", leadId: "L2", atMin: 35 });

    const out = await matches();
    const byKey = new Map(out.map((r) => [(r.properties.time_between as Record<string, unknown>).key, mins(r)]));
    expect(byKey.get("L1")).toBe(10);
    expect(byKey.get("L2")).toBe(30);
  });

  it("the two lanes are told apart by the STEP, not the field — both sides read occurredAt", async () => {
    // Sabotage: ignore cfg.startStep/endStep and every record is in both
    // lanes, so the earliest event of any kind starts the clock. Here that
    // flips the answer from 40 (lead → call) to 5 (call → lead).
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 0 });
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 5 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 45 });

    const out = await matches();
    expect(out).toHaveLength(1);
    expect(mins(out[0])).toBe(40); // 5 → 45: the first call AFTER the lead
  });

  it("a call BEFORE the lead existed is never its response", async () => {
    // Sabotage: drop the at-or-after guard and the -30min call wins as
    // "first", producing a negative speed-to-lead.
    await ev({ eventType: "call_logged", leadId: "L1", atMin: -30 });
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 20 });

    const out = await matches();
    expect(out).toHaveLength(1);
    expect(mins(out[0])).toBe(20);
  });

  it("unmatched keys emit NOTHING — never a zero that drags the average", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "lead_created", leadId: "L_never_called", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L_orphan_call", atMin: 5 }); // no lead side

    const out = await matches();
    expect(out.map((r) => (r.properties.time_between as Record<string, unknown>).key)).toEqual(["L1"]);
  });

  it("duplicate start events use the earliest; records without the key are dropped", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 15 }); // re-import duplicate, later
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 25 });
    await ev({ eventType: "call_logged", leadId: null, atMin: 1 }); // keyless

    const out = await matches();
    expect(out).toHaveLength(1);
    expect(mins(out[0])).toBe(25); // from the EARLIEST lead_created
  });

  it("publishes the gap in four units, so the reader picks the one that reads well", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 120 });

    const tb = (await matches())[0].properties.time_between as Record<string, number>;
    expect({ seconds: tb.seconds, minutes: tb.minutes, hours: tb.hours, days: tb.days }).toEqual({
      seconds: 7_200,
      minutes: 120,
      hours: 2,
      days: 2 / 24,
    });
  });

  it("feeds the existing aggregates: a downstream median over the gap just works", async () => {
    for (const [lead, at] of [["L1", 10], ["L2", 20], ["L3", 90]] as Array<[string, number]>) {
      await ev({ eventType: "lead_created", leadId: lead, atMin: 0 });
      await ev({ eventType: "call_logged", leadId: lead, atMin: at });
    }

    const out = await matches({}, [N("m", "formula", { op: "median", field: "properties.time_between.minutes", distinctField: "subject" })], [E("t", "m")]);
    expect(out).toHaveLength(3);

    const g = parseGraph({
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", TB()),
        N("m", "formula", { op: "median", field: "properties.time_between.minutes", distinctField: "subject" }),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t"), E("t", "m")],
    });
    const res = await runFlow({ db, orgId: ORG }, g);
    const exec = res.nodes.get("m")! as NodeExecOk;
    expect(exec.status).toBe("ok");
    expect((exec.shape as Scalar).value).toBe(20); // median of 10, 20, 90 — NOT the 40 an average would claim
  });
});

describe("median aggregate", () => {
  const scalarOf = async (op: string, values: number[]) => {
    for (const [i, v] of values.entries()) {
      await db.insert(events).values({
        eventId: `med:${i}:${randomUUID()}`,
        orgId: ORG,
        connectionId: CONN,
        source: "close",
        eventType: "deal",
        occurredAt: new Date(T0),
        value: String(v),
        properties: {},
      });
    }
    const g = parseGraph({
      nodes: [N("a", "app", { connectionId: CONN }), N("m", "formula", { op, field: "value", distinctField: "subject" })],
      edges: [E("a", "m")],
    });
    const res = await runFlow({ db, orgId: ORG }, g);
    return ((res.nodes.get("m")! as NodeExecOk).shape as Scalar).value;
  };

  it("odd count takes the middle; even count averages the two middles; empty is 0", async () => {
    expect(await scalarOf("median", [90, 10, 20])).toBe(20);
  });
  it("even count averages the two middles", async () => {
    expect(await scalarOf("median", [2, 4, 100, 1])).toBe(3);
  });
  it("no numeric values yields 0, same contract as avg", async () => {
    expect(await scalarOf("median", [])).toBe(0);
  });
});

describe("guards around the node", () => {
  it("validate blocks publish until the matching field and both moments are set", () => {
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN, source: "close" }),
        N("t", "time_between", TB({ endField: "" })),
        N("m", "formula", { op: "count" }),
      ],
      edges: [E("a", "t"), E("t", "m")],
    });
    const issues = validateGraph(g);
    expect(issues.some((i) => i.message === "Time between needs a matching field, a start time and a stop time.")).toBe(true);
  });

  it("pushdown never folds a filter that sits AFTER a time_between", () => {
    // The filter's rules apply to EMITTED match records, not to events rows —
    // folding it into the app node's SQL would filter the wrong table shape.
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN, source: "close" }),
        N("t", "time_between", TB()),
        N("f", "filter", { combinator: "and", rules: [{ field: "properties.time_between.minutes", op: "gt", value: "5", valueKind: "fixed" }] }),
      ],
      edges: [E("a", "t"), E("t", "f")],
    });
    const plan = planPushdown(g, "a");
    expect(plan.foldedNodeIds).toEqual([]);
  });
});

describe("Speed to lead (Close) template", () => {
  it("parses clean and validates with no issues when a connection is prefilled", () => {
    const template = flowTemplate("speed-to-lead-close")!;
    expect(template).toBeTruthy();
    const g = template.build(CONN);
    expect(validateGraph(g)).toEqual([]);
    // The tile renders a LENGTH OF TIME, not a bare 285.195783.
    expect({ name: g.metrics[0]?.name, format: g.metrics[0]?.format, unit: g.metrics[0]?.unit }).toEqual({
      name: "Speed to lead",
      format: "duration",
      unit: "minutes",
    });
  });

  it("every registered template parses and carries a source", () => {
    for (const t of FLOW_TEMPLATES) {
      expect(t.source.length).toBeGreaterThan(0);
      expect(() => t.build(null)).not.toThrow();
    }
  });

  it("computes the real number end-to-end: outbound-only, first call, median across leads", async () => {
    // L1: inbound at +2 (must NOT count), outbound at +10 → 10
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 2, direction: "inbound" });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10, direction: "outbound" });
    // L2: outbound at +30 → 30
    await ev({ eventType: "lead_created", leadId: "L2", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L2", atMin: 30, direction: "outbound" });
    // L3: never called — excluded, not a zero
    await ev({ eventType: "lead_created", leadId: "L3", atMin: 0 });

    const g = flowTemplate("speed-to-lead-close")!.build(CONN);
    const res = await runFlow({ db, orgId: ORG }, g);
    const median = res.nodes.get("median")! as NodeExecOk;
    expect(median.status).toBe("ok");
    // median of [10, 30] = 20. Sabotage: drop the template's outbound filter
    // and L1's inbound call at +2 wins, making this 16 (median of 2, 30).
    expect((median.shape as Scalar).value).toBe(20);

    const gap = res.nodes.get("gap")! as NodeExecOk;
    expect(gap.recordsOut).toBe(2); // L3 emitted nothing
  });

  it("a lane's stamp survives the steps in between — the calls lane runs through a Filter", async () => {
    // The template's stop moment names the Get data step, but those records
    // reach the Combine through an outbound Filter. Sabotage: stamp only the
    // immediate producer and this metric silently pairs nothing.
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10, direction: "outbound" });

    const g = flowTemplate("speed-to-lead-close")!.build(CONN);
    const res = await runFlow({ db, orgId: ORG }, g);
    expect((res.nodes.get("gap")! as NodeExecOk).recordsOut).toBe(1);
  });
});

/**
 * The node obeys the same law as every other dataset step: it preserves what
 * flows through it, and adds without destroying.
 */
describe("Time between is built like the other nodes", () => {
  it("the output IS the start record, annotated — downstream fields survive", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });

    const out = await matches();
    expect(out).toHaveLength(1);
    // Sabotage: rebuild the fabricated {key, from_at, to_at, duration} record
    // and every one of these fails — which is what made a later Filter on
    // lead_id match nothing.
    expect(out[0].source).toBe("close");
    expect(out[0].connectionId).toBe(CONN);
    expect(out[0].eventType).toBe("lead_created");
    expect(out[0].properties.lead_id).toBe("L1");
  });

  it("subject is the pairing key, because that is what a count-distinct is counting", async () => {
    // Close lead rows carry subject: null. Sabotage: let the start record's
    // own subject through and "how many leads got called" — a count_distinct
    // whose default distinctField is literally "subject" — reads 0.
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "lead_created", leadId: "L2", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L2", atMin: 20 });

    const out = await matches({}, [N("m", "formula", { op: "count_distinct" })], [E("t", "m")]);
    expect(out.map((r) => r.subject).sort()).toEqual(["L1", "L2"]);
  });

  it("adds without destroying: a source field named `duration` or `key` survives", async () => {
    // Sheets columns and webhook payloads sit at the top of `properties`, so a
    // column called `duration` is ordinary — and a call's OWN duration is
    // exactly the data this step gets pointed at. Sabotage: write the gap as
    // bare `duration`/`key` and both source values are silently overwritten.
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0, extra: { duration: 999, key: "row-1" } });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });

    const out = await matches();
    expect({ duration: out[0].properties.duration, key: out[0].properties.key }).toEqual({ duration: 999, key: "row-1" });
    expect(mins(out[0])).toBe(10);
  });

  it("two moments on ONE record need no lane at all", async () => {
    // The other half of the same idea: created → answered inside a single
    // call row. No step chosen on either side, two different fields.
    await ev({
      eventType: "call_logged",
      leadId: "L1",
      atMin: 0,
      extra: { created_at: new Date(T0).toISOString(), answered_at: new Date(T0 + 3 * MIN).toISOString() },
    });

    const out = await matches({
      startField: "properties.created_at",
      startStep: "",
      endField: "properties.answered_at",
      endStep: "",
    });
    expect(out).toHaveLength(1);
    expect(mins(out[0])).toBe(3);
  });

  it("the start record is never its own end when both sides read the same field", async () => {
    // Same lane, same field = "gap to the next occurrence". Sabotage: drop the
    // identity check and every record pairs with itself for a flat 0.
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 45 });

    const out = await matches({ endStep: "leads" });
    expect(out).toHaveLength(1);
    expect(mins(out[0])).toBe(45);
  });
});

describe("saved flows survive the change", () => {
  it("a legacy fromType/toType flow recovers its lanes from the graph and keeps its number", async () => {
    await ev({ eventType: "call_logged", leadId: "L1", atMin: -30 }); // before the lead: must not win
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 30 });

    // Raw legacy JSON, exactly as it sits in a published flow_version.
    const g = parseGraph({
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", { keyField: "properties.lead_id", fromType: "lead_created", toType: "call_logged", mode: "first", unit: "minutes" }),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t")],
    });
    const res = await runFlow({ db, orgId: ORG }, g);
    const shape = (res.nodes.get("t")! as NodeExecOk).shape;
    if (shape.kind !== "dataset") throw new Error("expected dataset");
    // Sabotage: map the record types to no lane and the -30 call starts the
    // clock, flipping 30 into 60.
    expect(mins(shape.records[0])).toBe(30);
  });

  it("a saved Calculate below it follows the gap to its new name", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 30 });

    const g = parseGraph({
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", { keyField: "properties.lead_id", fromType: "lead_created", toType: "call_logged", unit: "minutes" }),
        N("m", "formula", { op: "avg", field: "properties.duration" }),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t"), E("t", "m")],
    });
    // Sabotage: skip repointDurationRefs and the published tile reads 0 — it
    // averages a field the step no longer writes, with no error anywhere.
    expect(((await runFlow({ db, orgId: ORG }, g)).nodes.get("m")! as NodeExecOk).shape).toMatchObject({ value: 30 });
  });

  it("a `properties.duration` ABOVE the step is left alone — it is a real Close column", async () => {
    // The repoint is restricted to steps downstream of a migrated Time
    // between for exactly this reason. Sabotage: rename it everywhere and a
    // genuine call-duration average silently becomes the speed-to-lead gap.
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 0, extra: { duration: 42 } });
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });

    const g = parseGraph({
      nodes: [
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("dur", "formula", { op: "avg", field: "properties.duration" }),
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("u", "unite", {}),
        N("t", "time_between", { keyField: "properties.lead_id", fromType: "lead_created", toType: "call_logged" }),
      ],
      edges: [E("calls", "dur"), E("leads", "u"), E("calls", "u"), E("u", "t")],
    });
    expect(((await runFlow({ db, orgId: ORG }, g)).nodes.get("dur")! as NodeExecOk).shape).toMatchObject({ value: 42 });
  });
});

/**
 * An unset lane means "any record carrying this field". That is right for the
 * one-record case and catastrophic after a Combine, where leads and calls both
 * carry `occurredAt` — the clock starts on whichever came first, so the step
 * measures call to call and reports a speed-to-lead near zero. It used to
 * publish clean, because only the three field paths were ever checked.
 */
describe("an ambiguous lane is an error, not a number", () => {
  it("refuses to guess when records came from more than one step", async () => {
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 0 });
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 5 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 45 });

    const g = parseGraph({
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", { keyField: "properties.lead_id", startField: "occurredAt", startStep: "", endField: "occurredAt", endStep: "" }),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t")],
    });
    const exec = (await runFlow({ db, orgId: ORG }, g)).nodes.get("t")!;
    // Sabotage: drop the lane guard and this returns 5 minutes (call -> lead),
    // green, published, and wrong by a factor of eight.
    expect(exec.status).toBe("error");
    expect((exec as { error: string }).error).toMatch(/more than one earlier step/);
  });

  it("still allows the one-record case, where an unset lane is the whole point", async () => {
    // Sabotage: require the steps unconditionally and created -> answered
    // inside a single call row stops working.
    await ev({
      eventType: "call_logged",
      leadId: "L1",
      atMin: 0,
      extra: { created_at: new Date(T0).toISOString(), answered_at: new Date(T0 + 3 * MIN).toISOString() },
    });
    const out = await matches({ startField: "properties.created_at", startStep: "", endField: "properties.answered_at", endStep: "" });
    expect(mins(out[0])).toBe(3);
  });

  it("blocks publish for the same reason, before anything runs", () => {
    const g = parseGraph({
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", { keyField: "properties.lead_id", startField: "occurredAt", endField: "occurredAt" }),
        N("m", "formula", { op: "count" }),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t"), E("t", "m")],
      metrics: [{ nodeId: "m", enabled: true, name: "x" }],
    });
    // Sabotage: check only the three field paths, as validate used to, and a
    // flow measuring call-to-call publishes with no issue at all.
    expect(validateGraph(g).some((i) => /more than one Get data step/.test(i.message))).toBe(true);
  });

  it("one Get data step feeding it is never ambiguous", () => {
    const g = parseGraph({
      nodes: [
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("t", "time_between", { keyField: "id", startField: "properties.created_at", endField: "properties.answered_at" }),
        N("m", "formula", { op: "count" }),
      ],
      edges: [E("calls", "t"), E("t", "m")],
      metrics: [{ nodeId: "m", enabled: true, name: "x" }],
    });
    expect(validateGraph(g).some((i) => /more than one Get data step/.test(i.message))).toBe(false);
  });
});

/**
 * The denominator a median hides: keys that never got a stop moment emit
 * nothing, so "median speed to lead" is quietly a median over the leads that
 * were eventually called.
 */
describe("pairing publishes its denominator", () => {
  it("counts the keys that started but never matched", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "lead_created", leadId: "L_never", atMin: 0 });
    await ev({ eventType: "lead_created", leadId: "L_before", atMin: 20 });
    await ev({ eventType: "call_logged", leadId: "L_before", atMin: 5 }); // call predates the lead

    const g = parseGraph({
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", TB()),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t")],
    });
    const exec = (await runFlow({ db, orgId: ORG }, g)).nodes.get("t")! as NodeExecOk & { pairing?: Record<string, number> };
    // Sabotage: drop the report and "how fast do we call leads" silently
    // becomes "how fast do we call the leads we called".
    expect(exec.pairing).toEqual({ keys: 3, started: 3, matched: 1, noStop: 1, stopBeforeStart: 1 });
  });
});
