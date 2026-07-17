import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { computeAggregate, computeFunnel, queryEvents } from "@/lib/metrics/compute";
import { AggregateSchema, FunnelSchema } from "@/lib/metrics/types";
import { resolveRange } from "@/lib/metrics/range";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

const ORG = "org_m";
const CONN = randomUUID();
const WEEK = resolveRange("7d").range;

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

const agg = (cfg: Record<string, unknown>) => AggregateSchema.parse({ kind: "aggregate", ...cfg });

describe("aggregate metrics", () => {
  it("counts 'booked leads this week' and excludes older events", async () => {
    await ev({ eventType: "booked", subject: "a@x.com", daysAgo: 1 });
    await ev({ eventType: "booked", subject: "b@x.com", daysAgo: 2 });
    await ev({ eventType: "booked", subject: "c@x.com", daysAgo: 3 });
    await ev({ eventType: "booked", subject: "old@x.com", daysAgo: 10 }); // outside 7d
    await ev({ eventType: "reply", subject: "d@x.com", daysAgo: 1 }); // wrong type

    const res = await computeAggregate(db, ORG, agg({ eventType: "booked" }), WEEK);
    expect(res).toEqual({ kind: "scalar", value: 3 });
  });

  it("sums a numeric value field", async () => {
    await ev({ eventType: "deal", value: 100 });
    await ev({ eventType: "deal", value: 250 });
    const res = await computeAggregate(db, ORG, agg({ eventType: "deal", aggregation: "sum" }), WEEK);
    expect(res).toEqual({ kind: "scalar", value: 350 });
  });

  it("counts distinct subjects", async () => {
    await ev({ eventType: "sms_sent", subject: "a@x.com" });
    await ev({ eventType: "sms_sent", subject: "a@x.com" });
    await ev({ eventType: "sms_sent", subject: "b@x.com" });
    const res = await computeAggregate(db, ORG, agg({ eventType: "sms_sent", aggregation: "count_distinct" }), WEEK);
    expect(res).toEqual({ kind: "scalar", value: 2 });
  });

  it("applies a properties filter rule", async () => {
    await ev({ eventType: "booked", properties: { plan: "pro" } });
    await ev({ eventType: "booked", properties: { plan: "free" } });
    const def = agg({
      eventType: "booked",
      filters: { combinator: "and", rules: [{ field: "properties.plan", op: "equals", value: "pro" }] },
    });
    const res = await computeAggregate(db, ORG, def, WEEK);
    expect(res).toEqual({ kind: "scalar", value: 1 });
  });

  it("respects the dashboard-wide source filter", async () => {
    await ev({ eventType: "booked", source: "calendly", subject: "a" });
    await ev({ eventType: "booked", source: "calendly", subject: "b" });
    await ev({ eventType: "booked", source: "close", subject: "c" });
    const res = await computeAggregate(db, ORG, agg({ eventType: "booked" }), WEEK, "calendly");
    expect(res).toEqual({ kind: "scalar", value: 2 });
  });

  it("produces a time-bucketed trend series", async () => {
    await ev({ eventType: "booked", daysAgo: 1 });
    await ev({ eventType: "booked", daysAgo: 1 });
    await ev({ eventType: "booked", daysAgo: 3 });
    const res = await computeAggregate(db, ORG, agg({ eventType: "booked", timeBucket: "day" }), WEEK);
    expect(res.kind).toBe("series");
    if (res.kind === "series") {
      expect(res.series.length).toBe(2);
      expect(res.series.reduce((s, p) => s + p.value, 0)).toBe(3);
    }
  });

  it("is tenant-isolated (ignores other orgs' events)", async () => {
    await ev({ eventType: "booked", subject: "mine" });
    await ev({ eventType: "booked", subject: "theirs", orgId: "org_other" });
    const res = await computeAggregate(db, ORG, agg({ eventType: "booked" }), WEEK);
    expect(res).toEqual({ kind: "scalar", value: 1 });
  });
});

describe("funnel metrics", () => {
  it("computes stage counts, conversions and the bottleneck", async () => {
    for (const s of ["a", "b", "c", "d"]) await ev({ eventType: "sms_sent", subject: s });
    for (const s of ["a", "b", "c"]) await ev({ eventType: "booked", subject: s });
    for (const s of ["a", "b"]) await ev({ eventType: "showed", subject: s });

    const def = FunnelSchema.parse({
      kind: "funnel",
      stages: [
        { label: "SMS sent", eventType: "sms_sent" },
        { label: "Booked", eventType: "booked" },
        { label: "Showed", eventType: "showed" },
      ],
    });
    const res = await computeFunnel(db, ORG, def, WEEK);
    expect(res.stages.map((s) => s.count)).toEqual([4, 3, 2]);
    expect(res.stages[1].conversionFromFirst).toBeCloseTo(0.75);
    expect(res.stages[2].conversionFromPrev).toBeCloseTo(2 / 3);
    expect(res.bottleneckIndex).not.toBeNull();
  });
});

describe("drill-down", () => {
  it("lists the events behind a metric, newest first", async () => {
    await ev({ eventType: "booked", subject: "old", daysAgo: 3 });
    await ev({ eventType: "booked", subject: "new", daysAgo: 1 });
    const rows = await queryEvents(db, ORG, { eventType: "booked", range: WEEK, limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0].subject).toBe("new");
  });
});
