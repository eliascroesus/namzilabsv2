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
 * rule for unmatched keys, the earliest-from tie-break, and the duration
 * being a plain NUMBER the existing aggregates can eat.
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

async function ev(o: { eventType: string; leadId?: string | null; atMin: number; direction?: string }) {
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
    },
  });
}

const N = (id: string, type: string, config: unknown, label?: string) => ({ id, type, data: { config, ...(label ? { label } : {}) } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const TB = (over: Record<string, unknown> = {}) => ({
  keyField: "properties.lead_id",
  fromType: "lead_created",
  toType: "call_logged",
  mode: "first",
  unit: "minutes",
  ...over,
});

/** app → time_between, returning the matched records. */
async function matches(tb: Record<string, unknown> = {}) {
  const g = parseGraph({
    nodes: [N("a", "app", { connectionId: CONN, source: "close" }), N("t", "time_between", TB(tb))],
    edges: [E("a", "t")],
  });
  const res = await runFlow({ db, orgId: ORG }, g);
  const exec = res.nodes.get("t")!;
  expect(exec.status).toBe("ok");
  const shape = (exec as NodeExecOk).shape;
  if (shape.kind !== "dataset") throw new Error("expected dataset");
  return shape.records;
}

describe("time_between semantics", () => {
  it("pairs each key's earliest FROM with the first TO at-or-after it, as a numeric duration", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 45 }); // later call — not the first
    await ev({ eventType: "lead_created", leadId: "L2", atMin: 5 });
    await ev({ eventType: "call_logged", leadId: "L2", atMin: 35 });

    const out = await matches();
    const byKey = new Map(out.map((r) => [r.subject, r.properties.duration]));
    expect(byKey.get("L1")).toBe(10);
    expect(byKey.get("L2")).toBe(30);
  });

  it("a call BEFORE the lead existed is never its response", async () => {
    // Sabotage: drop the at-or-after guard in execTimeBetween and the -30min
    // call wins as "first", producing a negative speed-to-lead.
    await ev({ eventType: "call_logged", leadId: "L1", atMin: -30 });
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 20 });

    const out = await matches();
    expect(out).toHaveLength(1);
    expect(out[0].properties.duration).toBe(20);
  });

  it("unmatched keys emit NOTHING — never a zero that drags the average", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "lead_created", leadId: "L_never_called", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L_orphan_call", atMin: 5 }); // no lead side

    const out = await matches();
    expect(out.map((r) => r.subject)).toEqual(["L1"]);
  });

  it("duplicate FROM events use the earliest; records without the key are dropped", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 15 }); // re-import duplicate, later
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 25 });
    await ev({ eventType: "call_logged", leadId: null, atMin: 1 }); // keyless

    const out = await matches();
    expect(out).toHaveLength(1);
    expect(out[0].properties.duration).toBe(25); // from the EARLIEST lead_created
  });

  it("converts units and honors mode: last", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 60 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 120 });

    const hoursFirst = await matches({ unit: "hours" });
    expect(hoursFirst[0].properties.duration).toBe(1);
    const hoursLast = await matches({ unit: "hours", mode: "last" });
    expect(hoursLast[0].properties.duration).toBe(2);
  });

  it("feeds the existing aggregates: a downstream median over properties.duration just works", async () => {
    await ev({ eventType: "lead_created", leadId: "L1", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L1", atMin: 10 });
    await ev({ eventType: "lead_created", leadId: "L2", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L2", atMin: 20 });
    await ev({ eventType: "lead_created", leadId: "L3", atMin: 0 });
    await ev({ eventType: "call_logged", leadId: "L3", atMin: 90 });

    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN, source: "close" }),
        N("t", "time_between", TB()),
        N("m", "formula", { op: "median", field: "properties.duration", distinctField: "subject" }),
      ],
      edges: [E("a", "t"), E("t", "m")],
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
  it("validate blocks publish until the matching field and both types are picked", () => {
    const g = parseGraph({
      nodes: [N("a", "app", { connectionId: CONN, source: "close" }), N("t", "time_between", TB({ toType: "" })), N("m", "formula", { op: "count" })],
      edges: [E("a", "t"), E("t", "m")],
    });
    const issues = validateGraph(g);
    expect(issues.some((i) => i.message === "Time between needs a matching field and both record types picked.")).toBe(true);
  });

  it("pushdown never folds a filter that sits AFTER a time_between", () => {
    // The filter's rules apply to EMITTED match records, not to events rows —
    // folding it into the app node's SQL would filter the wrong table shape.
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN, source: "close" }),
        N("t", "time_between", TB()),
        N("f", "filter", { combinator: "and", rules: [{ field: "properties.duration", op: "gt", value: "5", valueKind: "fixed" }] }),
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
    // The pre-seeded metric is what Review & publish shows.
    expect(g.metrics[0]?.name).toBe("Speed to lead (median minutes)");
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
});