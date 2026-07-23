import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import { validateGraph } from "@/lib/flow/validate";
import { getField, walkPath, type FlowRecord } from "@/lib/flow/records";
import { inferSchema } from "@/lib/flow/schema-infer";
import type { DB } from "@/db/types";

// ---------- Pure: nested field resolution ----------

const rec = (props: Record<string, unknown>): FlowRecord => ({
  id: "r1",
  source: "webhook",
  eventType: "e",
  subject: "s",
  occurredAt: new Date().toISOString(),
  value: 100,
  currency: null,
  connectionId: "c1",
  properties: props,
});

describe("getField — nested objects & arrays", () => {
  it("resolves nested object paths and array indices", () => {
    const r = rec({ utm: { source: "google" }, items: [{ price: 9 }, { price: 42 }] });
    expect(getField(r, "properties.utm.source")).toBe("google");
    expect(getField(r, "properties.items.1.price")).toBe(42);
  });
  it("keeps flat keys (incl. keys containing dots) working", () => {
    const r = rec({ "a.b": "literal", plan: "pro" });
    expect(getField(r, "properties.a.b")).toBe("literal"); // exact literal key wins
    expect(getField(r, "plan")).toBe("pro"); // bare property key
    expect(getField(r, "subject")).toBe("s"); // standard field
  });
  it("returns undefined for missing / non-traversable paths", () => {
    const r = rec({ n: 1 });
    expect(getField(r, "properties.n.deep")).toBeUndefined();
    expect(walkPath({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(walkPath({ a: 1 }, "a.b")).toBeUndefined();
  });
});

describe("inferSchema — container + list types", () => {
  it("flags objects and arrays as expandable containers", () => {
    const schema = inferSchema([rec({ tags: ["a", "b"], meta: { k: 1 } })]);
    const tags = schema.find((f) => f.path === "properties.tags")!;
    const meta = schema.find((f) => f.path === "properties.meta")!;
    expect(tags.type).toBe("list");
    expect(tags.container).toBe(true);
    expect(meta.type).toBe("object");
    expect(meta.container).toBe(true);
  });
});

// ---------- Engine: dynamic (field-mapped) filter values ----------

let db: DB;
let close: () => Promise<void>;
const ORG = "org_map";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function ev(o: { eventType?: string; value?: number; properties?: Record<string, unknown>; daysAgo?: number }) {
  await db.insert(events).values({
    eventId: `webhook:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "webhook",
    eventType: o.eventType ?? "e",
    subject: null,
    occurredAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
    value: o.value != null ? String(o.value) : null,
    properties: o.properties ?? {},
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });

describe("engine — Filter with a mapped (field) comparison value", () => {
  it("keeps records where one field equals another field (field-to-field)", async () => {
    await ev({ properties: { plan: "pro", tier: "pro" } });
    await ev({ properties: { plan: "pro", tier: "free" } });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "properties.plan", op: "equals", value: "", valueKind: "field", valueField: "properties.tier" }] }),
      ],
      edges: [E("a", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    const f = res.nodes.get("f")!;
    expect(f.status).toBe("ok");
    expect(f.recordsOut).toBe(1);
  });

  it("compares numbers as numbers when mapped (value > properties.threshold)", async () => {
    await ev({ value: 100, properties: { threshold: 50 } });
    await ev({ value: 10, properties: { threshold: 50 } });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "value", op: "gt", value: "", valueKind: "field", valueField: "properties.threshold" }] }),
      ],
      edges: [E("a", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    expect(res.nodes.get("f")!.recordsOut).toBe(1);
  });

  it("still honours fixed literal values exactly (backward compatible)", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
      ],
      edges: [E("a", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    expect(res.nodes.get("f")!.recordsOut).toBe(1);
  });

  it("filters on a nested property path", async () => {
    await ev({ properties: { utm: { source: "google" } } });
    await ev({ properties: { utm: { source: "bing" } } });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "properties.utm.source", op: "equals", value: "google" }] }),
      ],
      edges: [E("a", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    expect(res.nodes.get("f")!.recordsOut).toBe(1);
  });
});

describe("engine — Filter date range quick section", () => {
  it("keeps only records within a rolling window", async () => {
    await ev({ daysAgo: 2 });
    await ev({ daysAgo: 400 });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [], dateRange: { enabled: true, dateField: "occurredAt", mode: "rolling", days: 30 } }),
      ],
      edges: [E("a", "f")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    expect(res.nodes.get("f")!.recordsOut).toBe(1);
    expect(res.nodes.get("f")!.recordsIn).toBe(2);
  });
});

describe("engine — legacy Formatter nodes become pass-throughs (dates are automatic now)", () => {
  it("a stored formatter node migrates to a rule-less Filter and passes records through", async () => {
    await ev({ properties: { name: "x" } });
    await ev({ properties: { name: "y" } });
    const g = parseGraph({
      nodes: [N("a", "app", { connectionId: CONN }), N("fm", "formatter", { field: "occurredAt", op: "date_only", outputField: "properties.day" })],
      edges: [E("a", "fm")],
    });
    expect(g.nodes.find((n) => n.id === "fm")?.type).toBe("filter");
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "fm" });
    expect(res.nodes.get("fm")!.status).toBe("ok");
    expect(res.nodes.get("fm")!.recordsOut).toBe(2); // pass-through, nothing dropped
  });

  it("date-looking property values are canonical on read — no cleanup step needed", async () => {
    await ev({ properties: { Timestamp: "7/21/2026 14:23:45", note: "call on 7/21" } });
    const g = parseGraph({ nodes: [N("a", "app", { connectionId: CONN })], edges: [] });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "a" });
    const rec = res.nodes.get("a")!.sample[0] as { properties: Record<string, unknown> };
    expect(rec.properties.Timestamp).toBe("2026-07-21T14:23:45.000Z");
    expect(rec.properties.note).toBe("call on 7/21"); // non-dates never touched
  });
});

describe("engine — Calculate node (merged number / breakdown / compare)", () => {
  it("number mode counts records", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = parseGraph({ nodes: [N("a", "app", { connectionId: CONN }), N("c", "calculate", { mode: "number", aggregation: "count" })], edges: [E("a", "c")] });
    const c = (await runFlow({ db, orgId: ORG }, g, { untilNodeId: "c" })).nodes.get("c")!;
    expect(c.status).toBe("ok");
    if (c.status === "ok" && c.shape.kind === "scalar") expect(c.shape.value).toBe(3);
    else throw new Error("expected scalar");
  });

  it("breakdown mode groups by a field", async () => {
    await ev({ eventType: "booked", properties: { plan: "pro" } });
    await ev({ eventType: "booked", properties: { plan: "free" } });
    await ev({ eventType: "booked", properties: { plan: "pro" } });
    const g = parseGraph({
      nodes: [N("a", "app", { connectionId: CONN }), N("c", "calculate", { mode: "breakdown", breakdownMode: "field", breakdownField: "properties.plan", aggregation: "count" })],
      edges: [E("a", "c")],
    });
    const c = (await runFlow({ db, orgId: ORG }, g, { untilNodeId: "c" })).nodes.get("c")!;
    if (c.status === "ok" && c.shape.kind === "grouped") expect(c.shape.groups.find((x) => x.label === "pro")?.value).toBe(2);
    else throw new Error("expected grouped");
  });

  it("compare mode divides two numbers as a percentage (show-up rate)", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("cA", "calculate", { mode: "number", aggregation: "count" }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("cB", "calculate", { mode: "number", aggregation: "count" }),
        N("cmp", "calculate", { mode: "compare", op: "percentage" }),
      ],
      edges: [
        E("a", "cA"),
        E("a", "f"),
        E("f", "cB"),
        { id: "cB->cmp", source: "cB", target: "cmp", targetHandle: "a" },
        { id: "cA->cmp", source: "cA", target: "cmp", targetHandle: "b" },
      ],
    });
    const cmp = (await runFlow({ db, orgId: ORG }, g, { untilNodeId: "cmp" })).nodes.get("cmp")!;
    expect(cmp.status).toBe("ok");
    if (cmp.status === "ok" && cmp.shape.kind === "scalar") expect(cmp.shape.value).toBe(75);
    else throw new Error("expected scalar");
  });
});

describe("engine — Paths hub fans out to each branch (new model)", () => {
  it("gives every branch the full input; the branch's own Filter narrows it", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("p", "paths", { paths: [{ id: "pa", label: "Path A" }, { id: "pb", label: "Path B" }] }),
        N("fa", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
      ],
      edges: [E("a", "p"), { id: "p->fa", source: "p", target: "fa", sourceHandle: "pa" }],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "fa" });
    expect(res.nodes.get("p")!.recordsOut).toBe(3); // hub passes everything through
    expect(res.nodes.get("fa")!.recordsOut).toBe(2); // Path A's Filter keeps booked
  });
});

describe("validateGraph — mapped rule without a chosen field", () => {
  it("flags a condition set to compare against a field with no field chosen", () => {
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "value", op: "equals", value: "", valueKind: "field", valueField: "" }] }),
        N("out", "output", { name: "M" }),
      ],
      edges: [E("a", "f"), E("f", "out")],
    });
    const issues = validateGraph(g);
    expect(issues.some((i) => i.nodeId === "f" && /compares against a field/.test(i.message))).toBe(true);
  });
});
