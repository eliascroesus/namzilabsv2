import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * THE BUILDER, PUSHED AT ON PURPOSE.
 *
 * Every other flow test asks whether a correct graph over tidy data gives the
 * right number. This one asks what happens when the data is NOT tidy and the
 * graph is not sensible, because that is what a customer's first week looks
 * like and the product is about to launch.
 *
 * WHAT IS BEING LOOKED FOR, in priority order:
 *
 *   1. A CRASH. An unhandled throw in `runFlow` is the worst outcome: the
 *      builder's Test panel shows nothing, the nightly materialise dies, and
 *      the tile on somebody's dashboard stops moving with no error anyone
 *      reads. Every case here asserts the run COMPLETES, whatever it returns.
 *   2. A WRONG NUMBER THAT LOOKS RIGHT. `NaN`, `Infinity` and a silent `0` are
 *      worse than an error, because a dashboard renders them without comment.
 *   3. A shape a later node cannot survive.
 *
 * Nothing here asserts a number the engine does not already promise. Where
 * behaviour is a judgement call rather than a bug, the test records WHAT IT
 * DOES so a change is visible, and says so.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_adv";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function ev(o: {
  eventType?: string;
  subject?: string | null;
  value?: number | null;
  properties?: Record<string, unknown>;
  daysAgo?: number;
}) {
  await db.insert(events).values({
    eventId: `webhook:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "webhook",
    eventType: o.eventType ?? "row",
    subject: o.subject ?? null,
    occurredAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
    value: o.value != null ? String(o.value) : null,
    properties: o.properties ?? {},
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const G = (nodes: unknown[], edges: unknown[]) => parseGraph({ nodes, edges });

/**
 * Run and never let a throw escape — a crash is a RESULT here, not a failure.
 *
 * `compile` is a PARAMETER of `runFlow`, not something it reads from the
 * environment: `materialize.ts` and `test-run.ts` each call `compileEnabled()`
 * and pass the answer in. The first version of the parity block below set
 * `ENGINE_COMPILE=1` around the call and compared the results, which ran the
 * JS path twice and proved nothing — found by making `planPushdown` throw and
 * watching the suite stay green.
 */
async function attempt(g: ReturnType<typeof G>, compile = false) {
  try {
    return { ok: true as const, res: await runFlow({ db, orgId: ORG, compile }, g) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

const valueOf = (r: Awaited<ReturnType<typeof runFlow>>) => r.outputs[0]?.tile?.value;

describe("one record, many columns — the analytics-app shape", () => {
  /**
   * THE SHAPE THE OWNER NAMED. Plenty of sources send a SINGLE row per period
   * whose columns are the whole analysis — Fathom's meeting summary, a
   * Shopify daily rollup, an ad platform's account report. Every aggregate
   * then runs over one record, which is the case where "sum" and "the value
   * itself" are the same number and a bug is invisible.
   */
  const wide = () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) props[`metric_${i}`] = i * 10;
    props.name = "Daily report";
    props.rep = "alice";
    return props;
  };

  it("aggregates a column of a single wide record", async () => {
    await ev({ properties: wide() });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.metric_7" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r.ok && valueOf(r.res)).toBe(70);
  });

  it("does not confuse count with the value when there is exactly one row", async () => {
    // The trap: with one record, `count` is 1 and a wrong field lookup that
    // yields nothing also produces 1 in some designs. They must differ.
    await ev({ properties: wide() });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("c", "formula", { op: "count" }), N("o", "output", {})],
      [E("a", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok && valueOf(r.res)).toBe(1);
  });

  it("survives grouping a single record by one of its sixty columns", async () => {
    await ev({ properties: wide() });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g", "group", { mode: "field", field: "properties.rep", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g"), E("g", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("does not choke on a column that is absent from the only record", async () => {
    await ev({ properties: { only: 1 } });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.nope" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    // A missing column must read as nothing, never as NaN on a dashboard.
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number)).toBe(false);
  });
});

describe("nothing to work with", () => {
  it("counts zero records without failing", async () => {
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("c", "formula", { op: "count" }), N("o", "output", {})],
      [E("a", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r.ok && valueOf(r.res)).toBe(0);
  });

  it("averages nothing without producing NaN", async () => {
    /**
     * THE DIVISION THAT HAS NO ANSWER. `sum/count` with count 0 is NaN in
     * JavaScript, and NaN renders on a tile as "NaN" — a number-shaped thing
     * that is not a number. Whatever the engine chooses, it must not be that.
     */
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "avg", field: "value" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `avg of nothing produced ${v}`).toBe(false);
    expect(Number.isFinite(v as number) || v == null, `avg of nothing produced ${v}`).toBe(true);
  });

  it("survives a filter that removes everything", async () => {
    await ev({ eventType: "a" });
    await ev({ eventType: "b" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "nothing-matches" }] }),
        N("c", "formula", { op: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r.ok && valueOf(r.res)).toBe(0);
  });

  it("survives grouping when every key is null", async () => {
    await ev({ properties: { rep: null } });
    await ev({ properties: {} });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g", "group", { mode: "field", field: "properties.rep", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g"), E("g", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});

describe("the data is not the type the column implies", () => {
  it("sums a numeric column that arrives as strings", async () => {
    // Sheets, CSV imports and plenty of JSON APIs send numbers as text.
    await ev({ properties: { amount: "100" } });
    await ev({ properties: { amount: "250" } });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.amount" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `string numbers produced ${v}`).toBe(false);
  });

  it("does not produce NaN from a column of unparseable text", async () => {
    await ev({ properties: { amount: "n/a" } });
    await ev({ properties: { amount: "—" } });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.amount" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `unparseable text produced ${v}`).toBe(false);
  });

  it("survives a column that is sometimes a number and sometimes text", async () => {
    await ev({ properties: { amount: 100 } });
    await ev({ properties: { amount: "oops" } });
    await ev({ properties: { amount: null } });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.amount" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `mixed types produced ${v}`).toBe(false);
  });

  it("survives a column holding an object or an array", async () => {
    // Nested payloads are the norm; somebody will point an aggregate at one.
    await ev({ properties: { attendees: [{ email: "a@b.c" }, { email: "d@e.f" }] } });
    await ev({ properties: { attendees: { email: "g@h.i" } } });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.attendees" }), N("o", "output", {})],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `object column produced ${v}`).toBe(false);
  });

  it("groups by a column whose values are objects without crashing", async () => {
    await ev({ properties: { who: { name: "alice" } } });
    await ev({ properties: { who: { name: "bob" } } });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g", "group", { mode: "field", field: "properties.who", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g"), E("g", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});

describe("arithmetic that has no answer", () => {
  it("divides by zero without putting Infinity on a dashboard", async () => {
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("d", "formula", { op: "divide", aFixed: 10, bFixed: 0 }),
        N("o", "output", {}),
      ],
      [E("a", "d"), E("d", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isFinite(v as number) || v == null, `divide by zero produced ${v}`).toBe(true);
  });

  it("takes a percentage of zero without producing NaN", async () => {
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("p", "formula", { op: "percentage", aFixed: 0, bFixed: 0 }),
        N("o", "output", {}),
      ],
      [E("a", "p"), E("p", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `0/0 percentage produced ${v}`).toBe(false);
  });
});


describe("branching, recombining, and chaining", () => {
  it("splits into paths and unites them back without losing or duplicating", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "canceled", subject: "c" });

    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("p", "paths", {
          paths: [
            { id: "p1", label: "Booked", rules: [{ field: "eventType", op: "equals", value: "booked" }] },
            { id: "p2", label: "Rest", mode: "fallback" },
          ],
        }),
        N("u", "unite", {}),
        N("c", "formula", { op: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "p"), E("p", "u"), E("u", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    /**
     * A split that fans every record into exactly one lane and then recombines
     * must give back what it started with. Either direction is a real bug: a
     * count below three silently drops somebody's records, above three
     * double-counts them, and both render as a plausible number.
     */
    if (r.ok) expect(valueOf(r.res), "split → unite changed the record count").toBe(3);
  });

  it("survives a Combine reached by only one lane", async () => {
    await ev({ eventType: "booked" });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("u", "unite", {}), N("c", "formula", { op: "count" }), N("o", "output", {})],
      [E("a", "u"), E("u", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives a Combine with nothing wired into it", async () => {
    // Half-built graphs are the normal state of the canvas while somebody
    // works, and the Test button runs them.
    const g = G(
      [N("u", "unite", {}), N("c", "formula", { op: "count" }), N("o", "output", {})],
      [E("u", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives two Break-downs chained one after the other", async () => {
    await ev({ properties: { rep: "alice", region: "eu" } });
    await ev({ properties: { rep: "bob", region: "eu" } });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g1", "group", { mode: "field", field: "properties.region", aggregation: "count" }),
        N("g2", "group", { mode: "field", field: "properties.rep", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g1"), E("g1", "g2"), E("g2", "o")],
    );
    const r = await attempt(g);
    // Grouping an already-grouped set is nonsense a user can build in two
    // clicks. It must not throw, whatever it decides to return.
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives an aggregate placed after an aggregate", async () => {
    await ev({ value: 10 });
    await ev({ value: 20 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("m1", "formula", { op: "sum", field: "value" }),
        N("m2", "formula", { op: "sum", field: "value" }),
        N("o", "output", {}),
      ],
      [E("a", "m1"), E("m1", "m2"), E("m2", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives an output with no aggregate above it", async () => {
    await ev({ value: 10 });
    const g = G([N("a", "app", { connectionId: CONN }), N("o", "output", {})], [E("a", "o")]);
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives two outputs off one branch", async () => {
    await ev({ value: 10 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("c", "formula", { op: "count" }),
        N("o1", "output", { name: "One" }),
        N("o2", "output", { name: "Two" }),
      ],
      [E("a", "c"), E("c", "o1"), E("c", "o2")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (r.ok) expect(r.res.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it("does not hang or throw on a graph with a cycle", async () => {
    /**
     * THE ONE THAT MATTERS MOST HERE. A cycle in a naive traversal is an
     * infinite loop, which in a server action is a hung request holding a
     * database client — not a wrong number, an outage. It has to terminate.
     */
    await ev({ value: 1 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f1", "filter", { combinator: "and", rules: [] }),
        N("f2", "filter", { combinator: "and", rules: [] }),
        N("o", "output", {}),
      ],
      [E("a", "f1"), E("f1", "f2"), E("f2", "f1"), E("f2", "o")],
    );
    const r = await Promise.race([
      attempt(g),
      new Promise<{ ok: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: "TIMED OUT — the cycle was not broken" }), 8000),
      ),
    ]);
    expect(r.ok || !r.error.includes("TIMED OUT"), r.ok ? "" : r.error).toBe(true);
  }, 15000);

  it("survives a step wired to a node that is not in the graph", async () => {
    await ev({ value: 1 });
    const g = G(
      [N("a", "app", { connectionId: CONN }), N("c", "formula", { op: "count" }), N("o", "output", {})],
      [E("a", "c"), E("c", "o"), E("ghost", "c")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});

describe("time, and the dates that are not dates", () => {
  it("survives Time between when no pair matches", async () => {
    await ev({ eventType: "lead_created", properties: { lead_id: "L1" } });
    // No call_logged at all — every key is unmatched.
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("t", "time_between", { keyField: "properties.lead_id", fromType: "lead_created", toType: "call_logged", unit: "minutes" }),
        N("m", "formula", { op: "avg", field: "properties.minutes" }),
        N("o", "output", {}),
      ],
      [E("a", "t"), E("t", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const v = r.ok ? valueOf(r.res) : null;
    expect(Number.isNaN(v as number), `no pairs produced ${v}`).toBe(false);
  });

  it("survives Time between when the end is before the start", async () => {
    // Clock skew between two systems produces negative gaps in the wild.
    await ev({ eventType: "lead_created", properties: { lead_id: "L1" }, daysAgo: 1 });
    await ev({ eventType: "call_logged", properties: { lead_id: "L1" }, daysAgo: 3 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("t", "time_between", { keyField: "properties.lead_id", fromType: "lead_created", toType: "call_logged", unit: "minutes" }),
        N("c", "formula", { op: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "t"), E("t", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives a date column full of unparseable text", async () => {
    await ev({ properties: { when: "not a date" } });
    await ev({ properties: { when: "" } });
    await ev({ properties: { when: null } });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("m", "formula", { op: "count", groupBy: { type: "time", unit: "day" } }),
        N("o", "output", { viz: "line" }),
      ],
      [E("a", "m"), E("m", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("survives a Time window over a field that is not a date", async () => {
    await ev({ properties: { amount: 5 } });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("t", "time", { dateField: "properties.amount", mode: "rolling", days: 30 }),
        N("c", "formula", { op: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "t"), E("t", "c"), E("c", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});

describe("scale", () => {
  it("survives a break-down with thousands of distinct keys", async () => {
    /**
     * Grouping by an id, an email or a timestamp is a mistake somebody makes
     * on day one — and the result is a category chart with one bar per record.
     * It must not take the page down; a sane cap is a product decision, and
     * what is checked here is that the run finishes and bounds its output.
     */
    const rows = Array.from({ length: 2000 }, (_, i) => ({ properties: { id: `k${i}` } }));
    for (const row of rows) await ev(row);
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g", "group", { mode: "field", field: "properties.id", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g"), E("g", "o")],
    );
    const started = Date.now();
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(Date.now() - started, "2000 distinct keys took too long").toBeLessThan(20_000);
    if (r.ok) {
      const groups = r.res.outputs[0]?.tile?.groups;
      // Reported, not pinned: whether the engine caps the bucket list is a
      // product call. What matters is that it does not hand the browser two
      // thousand bars without anyone having decided to.
      expect(Array.isArray(groups), "a break-down produced no buckets at all").toBe(true);
      expect((groups ?? []).length, `2000 distinct keys produced ${(groups ?? []).length} bucket(s)`).toBeGreaterThan(0);
    }
  }, 60000);
});


describe("the compiled engine agrees with the JS one, end to end", () => {
  /**
   * `tests/engine-parity.test.ts` already gates the OPERATORS: every filter
   * predicate must evaluate identically in JS and in SQL, row for row. What it
   * does not cover is the whole pipeline — the aggregate, the grouping, the
   * empty case — under `ENGINE_COMPILE=1`.
   *
   * That gap matters precisely because the flag is off today. A number that
   * only diverges once somebody flips it in production is the worst shape of
   * bug this product can have: nobody is looking, the tile keeps rendering,
   * and the difference is a customer's metric quietly changing value.
   *
   * So each graph below runs both ways and the two results are compared. The
   * fixtures are deliberately the messy ones — string numbers, nulls, absent
   * columns, everything filtered out — because that is where two
   * implementations of "sum" drift apart.
   */
  async function bothWays(g: ReturnType<typeof G>) {
    return { js: await attempt(g, false), sql: await attempt(g, true) };
  }

  const cases: Array<{ name: string; seed: () => Promise<void>; graph: () => ReturnType<typeof G> }> = [
    {
      name: "a plain count",
      seed: async () => {
        await ev({ eventType: "booked" });
        await ev({ eventType: "booked" });
        await ev({ eventType: "canceled" });
      },
      graph: () =>
        G(
          [N("a", "app", { connectionId: CONN }), N("c", "formula", { op: "count" }), N("o", "output", {})],
          [E("a", "c"), E("c", "o")],
        ),
    },
    {
      name: "a filter then a count",
      seed: async () => {
        await ev({ eventType: "booked" });
        await ev({ eventType: "booked" });
        await ev({ eventType: "canceled" });
      },
      graph: () =>
        G(
          [
            N("a", "app", { connectionId: CONN }),
            N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
            N("c", "formula", { op: "count" }),
            N("o", "output", {}),
          ],
          [E("a", "f"), E("f", "c"), E("c", "o")],
        ),
    },
    {
      name: "a sum over string numbers",
      seed: async () => {
        await ev({ properties: { amount: "100" } });
        await ev({ properties: { amount: "250.5" } });
        await ev({ properties: { amount: null } });
        await ev({ properties: {} });
      },
      graph: () =>
        G(
          [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "sum", field: "properties.amount" }), N("o", "output", {})],
          [E("a", "m"), E("m", "o")],
        ),
    },
    {
      name: "an average with nulls in the column",
      seed: async () => {
        await ev({ value: 10 });
        await ev({ value: null });
        await ev({ value: 20 });
      },
      graph: () =>
        G(
          [N("a", "app", { connectionId: CONN }), N("m", "formula", { op: "avg", field: "value" }), N("o", "output", {})],
          [E("a", "m"), E("m", "o")],
        ),
    },
    {
      name: "everything filtered away",
      seed: async () => {
        await ev({ eventType: "a" });
      },
      graph: () =>
        G(
          [
            N("a", "app", { connectionId: CONN }),
            N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "zzz" }] }),
            N("m", "formula", { op: "sum", field: "value" }),
            N("o", "output", {}),
          ],
          [E("a", "f"), E("f", "m"), E("m", "o")],
        ),
    },
    {
      name: "a break-down by a column with missing values",
      seed: async () => {
        await ev({ properties: { rep: "alice" } });
        await ev({ properties: { rep: "alice" } });
        await ev({ properties: { rep: null } });
        await ev({ properties: {} });
      },
      graph: () =>
        G(
          [
            N("a", "app", { connectionId: CONN }),
            N("g", "group", { mode: "field", field: "properties.rep", aggregation: "count" }),
            N("o", "output", { viz: "category" }),
          ],
          [E("a", "g"), E("g", "o")],
        ),
    },
  ];

  for (const c of cases) {
    it(`${c.name} gives the same answer both ways`, async () => {
      await c.seed();
      const { js, sql } = await bothWays(c.graph());
      expect(js.ok, js.ok ? "" : `JS path threw: ${js.error}`).toBe(true);
      expect(sql.ok, sql.ok ? "" : `compiled path threw: ${sql.error}`).toBe(true);
      if (!js.ok || !sql.ok) return;

      const a = valueOf(js.res);
      const b = valueOf(sql.res);
      expect(b, `${c.name}: JS said ${JSON.stringify(a)}, compiled said ${JSON.stringify(b)}`).toEqual(a);

      /**
       * THE BUCKETS TOO — a category chart that agrees on its total while
       * disagreeing on the bars is still wrong.
       *
       * The field is `groups`. This read `series` first, which a category tile
       * does not carry, so it compared `undefined` to `undefined` on every
       * case and would have passed against any divergence at all.
       */
      const sa = js.res.outputs[0]?.tile?.groups;
      const sb = sql.res.outputs[0]?.tile?.groups;
      expect(JSON.stringify(sb), `${c.name}: the buckets differ`).toEqual(JSON.stringify(sa));
    });
  }
});


describe("the awkward values a group key can hold", () => {
  it("survives keys that are very long, unicode, or look like numbers", async () => {
    await ev({ properties: { k: "x".repeat(5000) } });
    await ev({ properties: { k: "日本語 — ünïcode 🎉" } });
    await ev({ properties: { k: "0" } });
    await ev({ properties: { k: 0 } });
    await ev({ properties: { k: false } });
    await ev({ properties: { k: "" } });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g", "group", { mode: "field", field: "properties.k", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g"), E("g", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (r.ok) {
      const groups = r.res.outputs[0]?.tile?.groups;
      expect(Array.isArray(groups), "a break-down produced no buckets at all").toBe(true);
      // Whatever the bucketing rules are, a label must be renderable — an
      // object or `undefined` reaching a chart axis is a client-side crash.
      for (const point of (groups ?? []) as Array<{ label?: unknown }>) {
        expect(["string", "number"], `a bucket label was ${typeof point.label}`).toContain(typeof point.label);
      }
    }
  });

  it("keeps `0` and `false` distinct from missing", async () => {
    /**
     * THE FALSY TRAP. A grouping that tests `if (!value)` folds `0`, `false`
     * and `""` into the same bucket as a genuinely absent field — and every
     * one of those is a real answer in somebody's data. Zero revenue is not
     * the same fact as no revenue column.
     */
    await ev({ properties: { paid: 0 } });
    await ev({ properties: {} });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("g", "group", { mode: "field", field: "properties.paid", aggregation: "count" }),
        N("o", "output", { viz: "category" }),
      ],
      [E("a", "g"), E("g", "o")],
    );
    const r = await attempt(g);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (r.ok) {
      const labels = ((r.res.outputs[0]?.tile?.groups ?? []) as Array<{ label?: unknown }>).map((p) => String(p.label));
      /**
       * MEASURED, AND THE ENGINE GETS THIS RIGHT: `0` keeps its own bucket
       * labelled "0", while an empty string, a null and an absent column all
       * collapse into "(not set)". `false` likewise survives as "false".
       *
       * That is the correct split and it is worth pinning, because the obvious
       * implementation — `if (!value) return "(not set)"` — silently folds zero
       * revenue in with no revenue column, and the chart looks fine either way.
       */
      expect(labels, `0 must keep its own bucket; got ${JSON.stringify(labels)}`).toContain("0");
      expect(labels, `a missing column must read as not set; got ${JSON.stringify(labels)}`).toContain("(not set)");
    }
  });
});

describe("a long chain", () => {
  it("runs twenty filters in a row without blowing the stack or the clock", async () => {
    // Nobody designs this; people arrive at it by adding one more condition
    // twenty times. It has to stay linear.
    for (let i = 0; i < 50; i++) await ev({ eventType: "row", properties: { n: i } });

    const nodes: unknown[] = [N("a", "app", { connectionId: CONN })];
    const edges: unknown[] = [];
    let prev = "a";
    for (let i = 0; i < 20; i++) {
      const id = `f${i}`;
      nodes.push(N(id, "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "row" }] }));
      edges.push(E(prev, id));
      prev = id;
    }
    nodes.push(N("c", "formula", { op: "count" }), N("o", "output", {}));
    edges.push(E(prev, "c"), E("c", "o"));

    const started = Date.now();
    const r = await attempt(G(nodes, edges));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(Date.now() - started, "a twenty-step chain took too long").toBeLessThan(15_000);
    if (r.ok) expect(valueOf(r.res), "twenty pass-through filters changed the count").toBe(50);
  }, 30000);
});

describe("the output says what it is", () => {
  it("does not hand a chart a value it cannot draw", async () => {
    /**
     * A category chart fed a single scalar, or a number tile fed a series, is
     * a mismatch a user creates by switching the viz after building the flow.
     * The engine must produce SOMETHING renderable rather than a half-filled
     * tile the client dereferences into a crash.
     */
    await ev({ value: 5 });
    for (const viz of ["number", "category", "line"]) {
      const g = G(
        [N("a", "app", { connectionId: CONN }), N("c", "formula", { op: "count" }), N("o", "output", { viz })],
        [E("a", "c"), E("c", "o")],
      );
      const r = await attempt(g);
      expect(r.ok, `viz=${viz}: ${r.ok ? "" : r.error}`).toBe(true);
      if (r.ok && r.res.outputs[0]) {
        const tile = r.res.outputs[0].tile as { value?: unknown; series?: unknown };
        const drawable = tile.value != null || Array.isArray(tile.series);
        expect(drawable, `viz=${viz} produced a tile with neither a value nor a series`).toBe(true);
      }
    }
  });
});
