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

  it("stacks three or more sources", async () => {
    await ev({ source: "a", eventType: "lead", subject: "x" });
    await ev({ source: "b", eventType: "lead", subject: "y" });
    await ev({ source: "d", eventType: "lead", subject: "z" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN, source: "a" }),
        N("b", "app", { connectionId: CONN, source: "b" }),
        N("d", "app", { connectionId: CONN, source: "d" }),
        N("c", "combine", { mode: "stack" }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "c"), E("b", "c"), E("d", "c"), E("c", "agg"), E("agg", "o")],
    );
    expect((await run(g)).outputs[0].tile.value).toBe(3);
  });

  it("new edge shape: a chain input plus 'src' reference inputs combine the same way", async () => {
    await seedTwoSources();
    const g = G(
      [
        N("a", "app", { connectionId: CONN, source: "a" }),
        N("b", "app", { connectionId: CONN, source: "b" }),
        N("c", "combine", { mode: "stack" }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      // The chain edge holds the step's place in the line; picked sources ride "src".
      [E("a", "c"), ET("b", "c", "src"), E("c", "agg"), E("agg", "o")],
    );
    expect((await run(g)).outputs[0].tile.value).toBe(4);
  });

  it("deduping fills property gaps instead of overwriting real values with blanks", async () => {
    const mk = (source: string, props: Record<string, unknown>) =>
      db.insert(events).values({
        eventId: `${source}:${randomUUID()}`,
        orgId: ORG,
        connectionId: CONN,
        source,
        eventType: "lead",
        subject: "y",
        occurredAt: new Date(Date.now() - 86_400_000),
        value: null,
        properties: props,
      });
    await mk("a", { plan: "pro" });
    await mk("b", { plan: "" });
    const g = (wins: "first" | "last") =>
      G(
        [
          N("a", "app", { connectionId: CONN, source: "a" }),
          N("b", "app", { connectionId: CONN, source: "b" }),
          N("c", "combine", { mode: "dedupe", identityField: "subject", sourceWins: wins }),
        ],
        [E("a", "c"), E("b", "c")],
      );
    // Whichever source wins, the blank plan never erases the real one — collisions
    // resolve on the backend, so the builder needs no scary overwrite warning.
    for (const wins of ["first", "last"] as const) {
      const r = await run(g(wins));
      const c = r.nodes.get("c") as { sample: Array<{ properties: Record<string, unknown> }> };
      expect(c.sample[0].properties.plan).toBe("pro");
    }
  });

  it("Unite joins lanes; a single-input Combine then merges/matches within the stream", async () => {
    // Two sheets: x only in a, y in both, z only in b.
    await seedTwoSources();
    const g = (mode: string, keep = "all") =>
      G(
        [
          N("a", "app", { connectionId: CONN, source: "a" }),
          N("b", "app", { connectionId: CONN, source: "b" }),
          N("u", "unite", {}),
          N("c", "combine", { mode, identityField: "subject", keep }),
        ],
        [E("a", "u"), E("b", "u"), E("u", "c")],
      );
    // Unite = every record from every lane.
    const united = await run(g("stack"));
    expect(united.nodes.get("u")!.recordsOut).toBe(4);
    // Merge duplicates → one record per subject (x, y, z).
    expect((await run(g("dedupe"))).nodes.get("c")!.recordsOut).toBe(3);
    // Only records found more than once → y.
    const dupes = await run(g("match", "matched"));
    expect(dupes.nodes.get("c")!.recordsOut).toBe(1);
    expect((dupes.nodes.get("c") as { sample: Array<{ subject: string }> }).sample[0].subject).toBe("y");
    // Only records found once → x and z.
    expect((await run(g("match", "unmatched"))).nodes.get("c")!.recordsOut).toBe(2);
  });

  it("Match mode: the chosen base source controls which records survive", async () => {
    await ev({ source: "a", eventType: "lead", subject: "x" });
    await ev({ source: "a", eventType: "lead", subject: "y" });
    await ev({ source: "b", eventType: "lead", subject: "y" });
    await ev({ source: "b", eventType: "lead", subject: "z" });
    const mk = (baseSourceId: string) =>
      G(
        [
          N("a", "app", { connectionId: CONN, source: "a" }),
          N("b", "app", { connectionId: CONN, source: "b" }),
          N("c", "combine", { mode: "match", identityField: "subject", keep: "unmatched", baseSourceId }),
          N("o", "output", {}),
        ],
        [E("a", "c"), E("b", "c"), E("c", "o")],
      );
    const baseA = await run(mk("a"));
    expect((baseA.nodes.get("c") as { sample: Array<{ subject: string }> }).sample[0].subject).toBe("x");
    const baseB = await run(mk("b"));
    expect((baseB.nodes.get("c") as { sample: Array<{ subject: string }> }).sample[0].subject).toBe("z");
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

  it("fixes a text timestamp into a real date, and buckets into hours", async () => {
    // A Sheets-style row whose Timestamp column is plain text.
    await db.insert(events).values({
      eventId: `gsheets:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "gsheets",
      eventType: "row_added",
      subject: null,
      occurredAt: new Date(),
      value: null,
      properties: { ts: "7/21/2026 14:23:45" },
    });
    const g = (op: string, outputField?: string) =>
      G(
        [N("a", "app", { connectionId: CONN }), N("fmt", "formatter", { field: "ts", op, outputField })],
        [E("a", "fmt")],
      );
    const fixed = await run(g("to_date"));
    const fixedSample = (fixed.nodes.get("fmt") as { sample: Array<{ properties: Record<string, unknown> }> }).sample[0];
    expect(String(fixedSample.properties.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // proper ISO date-time

    const hourly = await run(g("hour", "ts_hour"));
    const hourlySample = (hourly.nodes.get("fmt") as { sample: Array<{ properties: Record<string, unknown> }> }).sample[0];
    expect(String(hourlySample.properties.ts_hour)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:00$/); // "2026-07-21 14:00"
    expect(hourlySample.properties.ts).toBe("7/21/2026 14:23:45"); // original kept (saved to a new field)
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
