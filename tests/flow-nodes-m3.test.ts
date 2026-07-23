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

async function ev(o: { source?: string; eventType: string; subject?: string | null; value?: number; daysAgo?: number; properties?: Record<string, unknown> }) {
  await db.insert(events).values({
    eventId: `${o.source ?? "webhook"}:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: o.source ?? "webhook",
    eventType: o.eventType,
    subject: o.subject ?? null,
    occurredAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
    value: o.value != null ? String(o.value) : null,
    properties: o.properties ?? {},
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

  it("a typed-in literal fills a number slot with no wired step", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    await ev({ eventType: "booked" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("cnt", "aggregate", { aggregation: "count" }), // 3
        N("pct", "formula", { op: "percentage", bFixed: 10 }),
        N("o", "output", {}),
      ],
      [E("a", "cnt"), ET("cnt", "pct", "a"), E("pct", "o")],
    );
    expect((await run(g)).outputs[0].tile.value).toBe(30); // 3 / 10 × 100
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

describe("Get data — Remove duplicates (replaces the Combine node)", () => {
  it("dedupes by the chosen field, keeping the newest record, before anything else runs", async () => {
    await ev({ eventType: "lead", subject: "x", daysAgo: 5, properties: { v: "old" } });
    await ev({ eventType: "lead", subject: "x", daysAgo: 1, properties: { v: "new" } });
    await ev({ eventType: "lead", subject: "y", daysAgo: 2 });
    const g = G(
      [N("a", "app", { connectionId: CONN, dedupe: true, dedupeField: "subject" }), N("agg", "formula", { op: "count" }), N("o", "output", {})],
      [E("a", "agg"), E("agg", "o")],
    );
    const r = await run(g);
    expect(r.nodes.get("a")!.recordsOut).toBe(2); // duplicates never enter the flow
    expect(r.outputs[0].tile.value).toBe(2);
    const kept = (r.nodes.get("a") as { sample: Array<{ subject: string | null; properties: Record<string, unknown> }> }).sample.find((s) => s.subject === "x")!;
    expect(kept.properties.v).toBe("new"); // the newest copy wins
  });

  it("dedupes by a property field (e.g. an email column)", async () => {
    await ev({ eventType: "lead", properties: { email: "a@b.com" } });
    await ev({ eventType: "lead", properties: { email: "a@b.com" } });
    await ev({ eventType: "lead", properties: { email: "c@d.com" } });
    const g = G([N("a", "app", { connectionId: CONN, dedupe: true, dedupeField: "properties.email" })], []);
    expect((await run(g)).nodes.get("a")!.recordsOut).toBe(2);
  });

  it("records with an empty identity always pass (they can't be duplicates)", async () => {
    await ev({ eventType: "lead", subject: null });
    await ev({ eventType: "lead", subject: null });
    await ev({ eventType: "lead", subject: "x" });
    await ev({ eventType: "lead", subject: "x" });
    const g = G([N("a", "app", { connectionId: CONN, dedupe: true, dedupeField: "subject" })], []);
    expect((await run(g)).nodes.get("a")!.recordsOut).toBe(3); // both empties + one x
  });

  it("dedupe off (the default) loads everything unchanged", async () => {
    await ev({ eventType: "lead", subject: "x" });
    await ev({ eventType: "lead", subject: "x" });
    const g = G([N("a", "app", { connectionId: CONN })], []);
    expect((await run(g)).nodes.get("a")!.recordsOut).toBe(2);
  });

  it("legacy Combine nodes migrate to pass-through Filters (and drop their src edges)", async () => {
    await ev({ source: "a", eventType: "lead", subject: "x" });
    await ev({ source: "a", eventType: "lead", subject: "x" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN, source: "a" }),
        N("b", "app", { connectionId: CONN, source: "b" }),
        N("c", "combine", { mode: "dedupe", identityField: "subject" }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "c"), ET("b", "c", "src"), E("c", "agg"), E("agg", "o")],
    );
    expect(g.nodes.find((n) => n.id === "c")?.type).toBe("filter");
    expect(g.edges.some((e) => e.targetHandle === "src")).toBe(false);
    const r = await run(g);
    expect(r.nodes.get("c")!.status).toBe("ok");
    expect(r.outputs[0].tile.value).toBe(2); // pass-through: no silent dedupe anymore
  });

  it("Unite still joins lanes into one stream", async () => {
    await ev({ source: "a", eventType: "lead", subject: "x" });
    await ev({ source: "a", eventType: "lead", subject: "y" });
    await ev({ source: "b", eventType: "lead", subject: "y" });
    await ev({ source: "b", eventType: "lead", subject: "z" });
    const g = G(
      [N("a", "app", { connectionId: CONN, source: "a" }), N("b", "app", { connectionId: CONN, source: "b" }), N("u", "unite", {})],
      [E("a", "u"), E("b", "u")],
    );
    expect((await run(g)).nodes.get("u")!.recordsOut).toBe(4);
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

describe("Automatic date normalization (replaces the Clean up values node)", () => {
  it("a Sheets-style text timestamp reads as a canonical ISO date with no cleanup step", async () => {
    await db.insert(events).values({
      eventId: `gsheets:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "gsheets",
      eventType: "row_added",
      subject: null,
      occurredAt: new Date(),
      value: null,
      properties: { ts: "7/21/2026 14:23:45", Amount: "1250", Email: "a@b.com" },
    });
    const g = G([N("a", "app", { connectionId: CONN })], []);
    const sample = ((await run(g)).nodes.get("a") as { sample: Array<{ properties: Record<string, unknown> }> }).sample[0];
    expect(sample.properties.ts).toBe("2026-07-21T14:23:45.000Z"); // canonical, deterministic
    expect(sample.properties.Amount).toBe("1250"); // non-dates byte-identical
    expect(sample.properties.Email).toBe("a@b.com");
  });

  it("normalized date fields flow through filters and stay usable for date comparisons", async () => {
    await ev({ eventType: "row_added", properties: { booked_on: "7/21/2026" } });
    await ev({ eventType: "row_added", properties: { booked_on: "7/21/2020" } });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "properties.booked_on", op: "after", value: "2025-01-01" }] }),
      ],
      [E("a", "f")],
    );
    expect((await run(g)).nodes.get("f")!.recordsOut).toBe(1);
  });

  it("legacy Formatter nodes migrate to pass-through Filters", async () => {
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
    expect(g.nodes.find((n) => n.id === "fmt")?.type).toBe("filter");
    expect((await run(g)).outputs[0].tile.value).toBe(3); // 1.4 + 1.6, unrounded pass-through
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

  it("a fallback branch receives only records matching no custom branch", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    await ev({ eventType: "noshow" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("p", "paths", { paths: [{ id: "p1", label: "Booked" }, { id: "p2", label: "Canceled" }, { id: "p3", label: "Everything else", mode: "fallback" }] }),
        N("f1", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("f2", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "canceled" }] }),
        N("f3", "filter", { combinator: "and", rules: [] }),
      ],
      [E("a", "p"), EH("p", "f1", "p1"), EH("p", "f2", "p2"), EH("p", "f3", "p3")],
    );
    const r = await run(g);
    // Custom branches receive everything and narrow it in their own conditions step.
    expect(r.nodes.get("f1")!.recordsIn).toBe(3);
    expect(r.nodes.get("f1")!.recordsOut).toBe(1);
    expect(r.nodes.get("f2")!.recordsOut).toBe(1);
    // The fallback branch gets only the record neither custom branch matched (noshow).
    expect(r.nodes.get("f3")!.recordsIn).toBe(1);
    expect(r.nodes.get("f3")!.recordsOut).toBe(1);
  });

  it("an always-run branch receives every record", async () => {
    await ev({ eventType: "booked" });
    await ev({ eventType: "canceled" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("p", "paths", { paths: [{ id: "p1", label: "Booked" }, { id: "p2", label: "All records", mode: "always" }] }),
        N("f1", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("f2", "filter", { combinator: "and", rules: [] }),
      ],
      [E("a", "p"), EH("p", "f1", "p1"), EH("p", "f2", "p2")],
    );
    const r = await run(g);
    expect(r.nodes.get("f1")!.recordsOut).toBe(1);
    expect(r.nodes.get("f2")!.recordsIn).toBe(2);
    expect(r.nodes.get("f2")!.recordsOut).toBe(2);
  });
});
