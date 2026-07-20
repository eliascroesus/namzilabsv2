import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

const ORG = "org_f";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function ev(o: {
  orgId?: string;
  source?: string;
  eventType: string;
  subject?: string | null;
  value?: number;
  properties?: Record<string, unknown>;
  daysAgo?: number;
}) {
  await db.insert(events).values({
    eventId: `${o.source ?? "webhook"}:${randomUUID()}`,
    orgId: o.orgId ?? ORG,
    connectionId: CONN,
    source: o.source ?? "webhook",
    eventType: o.eventType,
    subject: o.subject ?? null,
    occurredAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
    value: o.value != null ? String(o.value) : null,
    properties: o.properties ?? {},
  });
}

// graph helpers
const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const G = (nodes: unknown[], edges: unknown[]) => parseGraph({ nodes, edges });

describe("flow engine — App → Filter → Aggregate → Output", () => {
  it("counts all app records, tracking records in/out per node", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "booked", subject: "c" });
    await ev({ eventType: "canceled", subject: "d" });

    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", { name: "Total events" }),
      ],
      [E("a", "agg"), E("agg", "out")],
    );
    const res = await runFlow({ db, orgId: ORG }, g);

    expect(res.outputs).toHaveLength(1);
    expect(res.outputs[0].tile.value).toBe(4);
    const app = res.nodes.get("a")!;
    const agg = res.nodes.get("agg")!;
    expect(app.recordsOut).toBe(4);
    expect(agg.recordsIn).toBe(4);
    expect(agg.recordsOut).toBe(1);
  });

  it("filters before aggregating (booked leads)", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "canceled", subject: "c" });

    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("out", "output", { name: "Booked" }),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "out")],
    );
    const res = await runFlow({ db, orgId: ORG }, g);
    expect(res.nodes.get("f")!.recordsIn).toBe(3);
    expect(res.nodes.get("f")!.recordsOut).toBe(2);
    expect(res.outputs[0].tile.value).toBe(2);
  });

  it("sums, averages and counts distinct", async () => {
    await ev({ eventType: "deal", subject: "a", value: 100 });
    await ev({ eventType: "deal", subject: "a", value: 300 });
    await ev({ eventType: "deal", subject: "b", value: 200 });

    const sum = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "sum", field: "value" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    expect(sum.outputs[0].tile.value).toBe(600);

    const avg = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "avg", field: "value" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    expect(avg.outputs[0].tile.value).toBe(200);

    const distinct = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count_distinct", distinctField: "subject" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]),
    );
    expect(distinct.outputs[0].tile.value).toBe(2);
  });

  it("produces a time series and a grouped result", async () => {
    await ev({ eventType: "booked", subject: "a", daysAgo: 1 });
    await ev({ eventType: "booked", subject: "b", daysAgo: 1 });
    await ev({ eventType: "booked", subject: "c", daysAgo: 3 });

    const series = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count", groupBy: { type: "time", unit: "day" } }), N("o", "output", { viz: "line" })], [E("a", "agg"), E("agg", "o")]),
    );
    expect(series.outputs[0].tile.series).toHaveLength(2);
    expect(series.outputs[0].tile.value).toBe(3);

    await ev({ eventType: "booked", subject: "x", source: "calendly", properties: { rep: "sam" } });
    await ev({ eventType: "booked", subject: "y", source: "calendly", properties: { rep: "sam" } });
    const grouped = await runFlow(
      { db, orgId: ORG },
      G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count", groupBy: { type: "field", field: "properties.rep" } }), N("o", "output", { viz: "category" })], [E("a", "agg"), E("agg", "o")]),
    );
    const groups = grouped.outputs[0].tile.groups!;
    expect(groups.find((g) => g.label === "sam")!.value).toBe(2);
  });

  it("supports rich filter operators", async () => {
    await ev({ eventType: "deal", subject: "a", value: 500 });
    await ev({ eventType: "deal", subject: "b", value: 50 });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "value", op: "gt", value: "100" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    expect((await runFlow({ db, orgId: ORG }, g)).outputs[0].tile.value).toBe(1);
  });

  it("supports starts_with / ends_with string operators", async () => {
    await ev({ eventType: "signup", subject: "alice@acme.com" });
    await ev({ eventType: "signup", subject: "bob@other.com" });
    await ev({ eventType: "signup", subject: "carol@acme.com" });
    const starts = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "subject", op: "starts_with", value: "a" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    expect((await runFlow({ db, orgId: ORG }, starts)).outputs[0].tile.value).toBe(1);

    const ends = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "subject", op: "ends_with", value: "@acme.com" }] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    expect((await runFlow({ db, orgId: ORG }, ends)).outputs[0].tile.value).toBe(2);
  });

  it("is tenant isolated", async () => {
    await ev({ eventType: "booked", subject: "mine" });
    await ev({ eventType: "booked", subject: "theirs", orgId: "org_other" });
    const g = G([N("a", "app", { connectionId: CONN }), N("agg", "aggregate", { aggregation: "count" }), N("o", "output", {})], [E("a", "agg"), E("agg", "o")]);
    expect((await runFlow({ db, orgId: ORG }, g)).outputs[0].tile.value).toBe(1);
  });

  it("runs only up to a target node when testing that node", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { rules: [] }),
        N("agg", "aggregate", { aggregation: "count" }),
        N("o", "output", {}),
      ],
      [E("a", "f"), E("f", "agg"), E("agg", "o")],
    );
    const res = await runFlow({ db, orgId: ORG }, g, { untilNodeId: "f" });
    expect(res.nodes.has("f")).toBe(true);
    expect(res.nodes.has("agg")).toBe(false); // downstream not executed
    expect(res.nodes.get("f")!.recordsOut).toBe(2);
  });

  it("Calculate (formula) compares data-step record counts (Output numbers)", async () => {
    await ev({ eventType: "booked", subject: "a" });
    await ev({ eventType: "booked", subject: "b" });
    await ev({ eventType: "booked", subject: "c" });
    await ev({ eventType: "canceled", subject: "d" });
    const g = G(
      [
        N("a", "app", { connectionId: CONN }),
        N("f", "filter", { combinator: "and", rules: [{ field: "eventType", op: "equals", value: "booked" }] }),
        N("calc", "formula", { op: "percentage" }),
      ],
      // Numerator (a) = the filter's passed count; denominator (b) = the app's loaded count.
      [E("a", "f"), { id: "f->calc", source: "f", target: "calc", targetHandle: "a" }, { id: "a->calc", source: "a", target: "calc", targetHandle: "b" }],
    );
    const res = await runFlow({ db, orgId: ORG }, g);
    const calc = res.nodes.get("calc")!;
    expect(calc.status).toBe("ok");
    expect((calc as { shape: { value: number } }).shape.value).toBe(75); // 3 passed ÷ 4 loaded × 100
  });
});
