import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;
const ORG = "org_m3";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function ev(o: { source?: string; eventType: string; subject?: string | null; value?: number; daysAgo?: number }) {
  await db.insert(events).values({
    eventId: `${o.source ?? "webhook"}:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: o.source ?? "webhook",
    eventType: o.eventType,
    subject: o.subject ?? null,
    occurredAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
    value: o.value != null ? String(o.value) : null,
    properties: {},
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const EH = (s: string, t: string, handle: string) => ({ id: `${s}:${handle}->${t}`, source: s, target: t, sourceHandle: handle });
/** Edge into a named target handle (Formula A/B). */
const ET = (s: string, t: string, handle: string) => ({ id: `${s}->${t}:${handle}`, source: s, target: t, targetHandle: handle });
const G = (nodes: unknown[], edges: unknown[]) => parseGraph({ nodes, edges });
const run = (g: ReturnType<typeof G>) => runFlow({ db, orgId: ORG }, g);

describe("Time node", () => {
  it("keeps only records inside the window", async () => {
    await ev({ eventType: "booked", daysAgo: 1 });
    await ev({ eventType: "booked", daysAgo: 5 });
    await ev({ eventType: "booked", daysAgo: 40 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("t", "time", { dateField: "occurredAt", mode: "rolling", days: 30 }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "t"), E("t", "agg"), E("agg", "o")],
    );
    const r = await run(g);
    expect(r.nodes.get("t")!.recordsOut).toBe(2);
    expect(r.outputs[0].tile.value).toBe(2);
  });
});

describe("Formula node", () => {
  it("computes a percentage from two aggregates", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("aggBooked", "aggregate", { aggregation: "count" }),
        N("aggTotal", "aggregate", { aggregation: "count" }),
        N("pct", "formula", { op: "percentage" }),
        N("o", "output", { name: "Booking rate", format: "percent", precision: 1 }),
      ],
      [E("a", "f"), E("f", "aggBooked"), E("a", "aggTotal"), ET("aggBooked", "pct", "a"), ET("aggTotal", "pct", "b"), E("pct", "o")],
    );
    const r = await run(g);
    expect(r.outputs[0].tile.value).toBe(75); // 3 / 4 * 100
  });

  it("resolves operands strictly by named handle (A/B), not edge order", async () => {
    await ev({ eventType: "booked", value: 10 });
    await ev({ eventType: "booked", value: 40 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("sum", "aggregate", { aggregation: "sum", field: "value" }), // 50
        N("cnt", "aggregate", { aggregation: "count" }), // 2
        N("div", "formula", { op: "divide" }),
        N("o", "output", {}),
      ],
      // Wire cnt→B and sum→A even though cnt is listed/added first: A/B must win.
      [E("a", "sum"), E("a", "cnt"), ET("cnt", "div", "b"), ET("sum", "div", "a"), E("div", "o")],
    );
    expect((await run(g)).outputs[0].tile.value).toBe(25); // 50 (A) / 2 (B)
  });

  it("errors when a Formula input handle is missing", async () => {
    await ev({ eventType: "booked" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("cnt", "aggregate", { aggregation: "count" }),
        N("div", "formula", { op: "divide" }),
        N("o", "output", {}),
      ],
      [E("a", "cnt"), ET("cnt", "div", "a"), E("div", "o")], // only A connected
    );
    const r = await run(g);
    expect(r.nodes.get("div")!.status).toBe("error");
    expect((r.nodes.get("div") as { error: string }).error).toMatch(/input B/);
  });

  it("errors clearly on divide by zero", async () => {
    await ev({ eventType: "x" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("num", "aggregate", { aggregation: "count" }),
        N("den", "aggregate", { aggregation: "sum", field: "value" }), // sum of null values = 0
        N("div", "formula", { op: "divide" }),
        N("o", "output", {}),
      ],
      [E("a", "num"), E("a", "den"), ET("num", "div", "a"), ET("den", "div", "b"), E("div", "o")],
    );
    const r = await run(g);
    expect(r.nodes.get("div")!.status).toBe("error");
    expect((r.nodes.get("div") as { error: string }).error).toMatch(/Division by zero/);
  });
});

describe("Combine node", () => {
  async function seedTwoSources() {
    await ev({ source: "a", eventType: "lead", subject: "x" });
    await ev({ source: "a", eventType: "lead", subject: "y" });
    await ev({ source: "b", eventType: "lead", subject: "y" });
    await ev({ source: "b", eventType: "lead", subject: "z" });
  }
  const base = (mode: string, extra: Record<string, unknown> = {}) =>
    G(
      [
        N("a", "app", { connectionId: CONN, source: "a" }),
        N("b", "app", { connectionId: CONN, source: "b" }),
        N("c", "combine", { mode, identityField: "subject", ...extra }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "c"), E("b", "c"), E("c", "agg"), E("agg", "o")],
    );

  it("stacks all records", async () => {
    await seedTwoSources();
    expect((await run(base("stack"))).outputs[0].tile.value).toBe(4);
  });
  it("dedupes by identity", async () => {
    await seedTwoSources();
    expect((await run(base("dedupe"))).outputs[0].tile.value).toBe(3); // x,y,z
  });
  it("keeps only matched base records", async () => {
    await seedTwoSources();
    expect((await run(base("match", { keep: "matched" }))).outputs[0].tile.value).toBe(1); // y
  });
  it("keeps only unmatched base records", async () => {
    await seedTwoSources();
    expect((await run(base("match", { keep: "unmatched" }))).outputs[0].tile.value).toBe(1); // x
  });
});

describe("Group node", () => {
  it("groups by a field with counts", async () => {
    await ev({ source: "a", eventType: "e", subject: "1" });
    await ev({ source: "a", eventType: "e", subject: "2" });
    await ev({ source: "b", eventType: "e", subject: "3" });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("grp", "group", { mode: "field", field: "source", aggregation: "count" }), N("o", "output", { viz: "category" })],
      [E("a", "grp"), E("grp", "o")],
    );
    const groups = (await run(g)).outputs[0].tile.groups!;
    expect(groups.find((x) => x.label === "a")!.value).toBe(2);
    expect(groups.find((x) => x.label === "b")!.value).toBe(1);
  });

  it("groups by custom categories with a fallback", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    await ev({ eventType: "weird" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("grp", "group", {
          mode: "categories",
          fallbackLabel: "Other",
          categories: [
            { label: "Booked", filters: { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] } },
            { label: "Canceled", filters: { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "canceled" }] } },
          ],
        }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "grp"), E("grp", "o")],
    );
    const groups = (await run(g)).outputs[0].tile.groups!;
    expect(groups.find((x) => x.label === "Booked")!.value).toBe(1);
    expect(groups.find((x) => x.label === "Other")!.value).toBe(1);
  });
});

describe("Formatter node", () => {
  it("rounds a numeric field before aggregation", async () => {
    await ev({ eventType: "deal", value: 1.4 });
    await ev({ eventType: "deal", value: 1.6 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("fmt", "formatter", { field: "value", op: "round", decimals: 0 }),
        N("agg", "aggregate", { aggregation: "sum", field: "value" }),
        N("o", "output", {}),
      ],
      [E("a", "fmt"), E("fmt", "agg"), E("agg", "o")],
    );
    expect((await run(g)).outputs[0].tile.value).toBe(3); // 1 + 2
  });
});

describe("Paths node", () => {
  it("routes records to the correct path handle", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("p", "paths", {
          fallbackId: "fb",
          fallbackLabel: "Other",
          paths: [{ id: "pBooked", label: "Booked", filters: { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] } }],
        }),
        N("aggB", "aggregate", { aggregation: "count" }),
        N("aggF", "aggregate", { aggregation: "count" }),
        N("oB", "output", { name: "Booked" }),
        N("oF", "output", { name: "Other" }),
      ],
      [E("a", "p"), EH("p", "aggB", "pBooked"), EH("p", "aggF", "fb"), E("aggB", "oB"), E("aggF", "oF")],
    );
    const r = await run(g);
    const booked = r.outputs.find((o) => o.tile.name === "Booked")!;
    const other = r.outputs.find((o) => o.tile.name === "Other")!;
    expect(booked.tile.value).toBe(2);
    expect(other.tile.value).toBe(1);
  });
});
