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

describe("engine — Formatter date ops + mapped fallback", () => {
  it("date_only strips the time portion", async () => {
    await ev({});
    const g = parseGraph({
      nodes: [N("a", "app", { connectionId: CONN }), N("fm", "formatter", { field: "occurredAt", op: "date_only", outputField: "properties.day" })],
      edges: [E("a", "fm")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "fm" });
    const rec = res.nodes.get("fm")!.sample[0] as { properties: Record<string, unknown> };
    expect(String(rec.properties.day)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("fallback (default) can pull from another field", async () => {
    await ev({ properties: { name: "", fallback: "Anon" } });
    const g = parseGraph({
      nodes: [
        N("a", "app", { connectionId: CONN }),
        N("fm", "formatter", { field: "properties.name", op: "default", defaultValueKind: "field", defaultValueField: "properties.fallback", outputField: "properties.name" }),
      ],
      edges: [E("a", "fm")],
    });
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "fm" });
    const rec = res.nodes.get("fm")!.sample[0] as { properties: Record<string, unknown> };
    expect(rec.properties.name).toBe("Anon");
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
