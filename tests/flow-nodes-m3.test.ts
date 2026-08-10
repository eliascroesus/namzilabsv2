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
    // A REAL zero, not an absent field. This used to lean on "sum of null
    // values = 0", which is the confident-zero bug: an aggregation over a
    // field no record carries now errors on its own, so it can no longer be
    // borrowed to manufacture a denominator.
    await ev({ eventType: "x", value: 0 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("num", "aggregate", { aggregation: "count" }),
        N("den", "aggregate", { aggregation: "sum", field: "value" }),
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

/**
 * WHICH DUPLICATE SURVIVES IS ASKED, NOT INHERITED FROM THE LOAD ORDER.
 *
 * "Keep one per lead" used to mean "keep whichever the database handed over
 * first", which happened to be the newest — a sort order living in a
 * different function, never shown and never askable. A founder wanting the
 * FIRST call to each lead ticked the box, got the last one, and their
 * speed-to-lead read 24 hours instead of 5 minutes.
 */
describe("keep one per group states its own order", () => {
  const threeCalls = async () => {
    await ev({ eventType: "call", subject: "+1914", daysAgo: 5, properties: { v: "first" } });
    await ev({ eventType: "call", subject: "+1914", daysAgo: 2, properties: { v: "middle" } });
    await ev({ eventType: "call", subject: "+1914", daysAgo: 1, properties: { v: "last" } });
  };
  const keptValue = async (over: Record<string, unknown>) => {
    const g = G([N("a", "app", { connectionId: CONN, dedupe: true, dedupeField: "subject", ...over })], []);
    const r = await run(g);
    const sample = (r.nodes.get("a") as { sample: Array<{ properties: Record<string, unknown> }> }).sample;
    return sample[0].properties.v;
  };

  it("earliest keeps the FIRST record — the thing dedupe could never say", async () => {
    await threeCalls();
    // Sabotage: go back to keep-first-seen on a newest-first stream and this
    // returns "last". That single line is the 1,446-minute speed-to-lead.
    expect(await keptValue({ dedupeKeep: "earliest", dedupeOrderField: "occurredAt" })).toBe("first");
  });

  it("latest is the default, so no existing flow's number moves", async () => {
    await threeCalls();
    expect(await keptValue({})).toBe("last");
    expect(await keptValue({ dedupeKeep: "latest", dedupeOrderField: "occurredAt" })).toBe("last");
  });

  it("orders by any field, not just when the record happened", async () => {
    await ev({ eventType: "call", subject: "+1914", daysAgo: 1, properties: { dur: 30, v: "short" } });
    await ev({ eventType: "call", subject: "+1914", daysAgo: 5, properties: { dur: 900, v: "long" } });
    // Sabotage: read occurredAt regardless of the chosen field and the longest
    // call is unreachable — you can only ever order by when it happened.
    expect(await keptValue({ dedupeKeep: "latest", dedupeOrderField: "properties.dur" })).toBe("long");
    expect(await keptValue({ dedupeKeep: "earliest", dedupeOrderField: "properties.dur" })).toBe("short");
  });

  it("the survivor is emitted where its group first appeared — the stream is not reordered", async () => {
    // Sabotage: emit at the winner's own position and the dataset comes back
    // in a different order than it loaded, which quietly changes the preview,
    // the "latest 3 records" contract, and anything downstream reading order.
    await ev({ eventType: "call", subject: "b", daysAgo: 1 });
    await ev({ eventType: "call", subject: "a", daysAgo: 2 });
    await ev({ eventType: "call", subject: "a", daysAgo: 9 });
    const g = G([N("x", "app", { connectionId: CONN, dedupe: true, dedupeField: "subject", dedupeKeep: "earliest" })], []);
    const shape = (await run(g)).nodes.get("x") as { sample: Array<{ subject: string | null }> };
    expect(shape.sample.map((s) => s.subject)).toEqual(["b", "a"]); // newest-first, as loaded
  });

  it("a record with no orderable value never beats one that has it", async () => {
    await ev({ eventType: "call", subject: "+1914", daysAgo: 3, properties: { dur: 60, v: "has" } });
    await ev({ eventType: "call", subject: "+1914", daysAgo: 1, properties: { v: "none" } });
    // Sabotage: treat a missing value as 0 and "none" wins every "earliest"
    // comparison, so the answer is decided by absent data.
    expect(await keptValue({ dedupeKeep: "earliest", dedupeOrderField: "properties.dur" })).toBe("has");
    expect(await keptValue({ dedupeKeep: "latest", dedupeOrderField: "properties.dur" })).toBe("has");
  });

  it("the receipt says which direction it actually used", async () => {
    await threeCalls();
    const g = G([N("a", "app", { connectionId: CONN, dedupe: true, dedupeField: "subject", dedupeKeep: "earliest" })], []);
    const rep = (await run(g)).nodes.get("a") as { dedupe?: { keep: string; removed: number; orderField: string } };
    expect(rep.dedupe).toMatchObject({ keep: "earliest", orderField: "occurredAt", removed: 2 });
  });
});

/**
 * The proof that nobody's published number moves: the new comparator, on its
 * defaults, reproduces the old keep-first-seen-on-a-newest-first-stream
 * algorithm exactly — including how it broke ties.
 */
describe("the rewrite is behaviour-identical on its defaults", () => {
  it("matches the old algorithm over 500 records with heavy duplication and ties", async () => {
    const { keepOnePerGroup } = await import("@/lib/flow/engine");
    const T0 = Date.parse("2026-01-01T00:00:00Z");
    // Deterministic pseudo-random: 40 groups over 500 records, and timestamps
    // drawn from only 25 distinct values so ties are everywhere.
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const records = Array.from({ length: 500 }, (_, i) => ({
      id: `r${i}`,
      source: "close",
      connectionId: "c",
      eventType: "call",
      subject: `g${rnd(40)}`,
      occurredAt: new Date(T0 + rnd(25) * 3_600_000),
      value: null,
      currency: null,
      properties: {},
    }));
    // Newest-first, exactly as execApp loads them.
    records.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1));

    const old = (() => {
      const seen = new Set<string>();
      const out: typeof records = [];
      for (const r of records) {
        const k = String(r.subject ?? "").trim();
        if (k === "") { out.push(r); continue; }
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
      return out.map((r) => r.id);
    })();

    const next = keepOnePerGroup(records as never[], { groupField: "subject", keep: "latest", orderField: "occurredAt" }).records.map((r) => r.id);
    // Sabotage: use `>=` instead of `>` in the comparator and ties flip to the
    // last-encountered record, diverging from every published number.
    expect(next).toEqual(old);
  });
});

/**
 * "Average deal value: $0" in a big bold box with a green badge, because the
 * default field is `value` and Close never populates it. A confident zero is
 * the worst possible answer: it is indistinguishable from a real measurement,
 * so nobody questions it.
 */
describe("an aggregation over a field nothing carries is an error, not a zero", () => {
  const agg = async (op: string, field: string) => {
    const g = G([N("a", "app", { connectionId: CONN }), N("m", "formula", { op, field, distinctField: field })], [E("a", "m")]);
    return (await run(g)).nodes.get("m")!;
  };

  it("names the field and the record count instead of returning 0", async () => {
    await ev({ eventType: "deal", properties: { amount: 100 } });
    await ev({ eventType: "deal", properties: { amount: 250 } });
    // Sabotage: return 0 for an empty numeric set and this reads $0 over two
    // real records, green, published, and never questioned.
    const exec = await agg("avg", "value");
    expect(exec.status).toBe("error");
    expect((exec as { error: string }).error).toMatch(/none of the 2 records here have a value/);
  });

  it("still works the moment the right field is picked", async () => {
    await ev({ eventType: "deal", properties: { amount: 100 } });
    await ev({ eventType: "deal", properties: { amount: 250 } });
    const exec = await agg("avg", "properties.amount");
    expect(exec.status).toBe("ok");
    expect((exec as { shape: { value: number } }).shape.value).toBe(175);
  });

  it("a legitimately empty window is still 0, not an error", async () => {
    // Sabotage: throw on zero records too and every quiet Monday turns red.
    const exec = await agg("avg", "value");
    expect(exec.status).toBe("ok");
    expect((exec as { shape: { value: number } }).shape.value).toBe(0);
  });

  it("count unique values of a field nothing carries errors too", async () => {
    await ev({ eventType: "deal", properties: { amount: 100 } });
    // Sabotage: return set.size and "unique leads called" reads 0 whenever the
    // chosen field is null on every record — the same lie, one aggregation over.
    const exec = await agg("count_distinct", "properties.missing");
    expect(exec.status).toBe("error");
    expect((exec as { error: string }).error).toMatch(/count unique values of/);
  });
});
