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

/**
 * The dashboard's day-grained ranges. UTC boundaries, computed the same way
 * the flow engine computes its own `today`/`yesterday` presets — the product
 * dates every record in UTC, and a dashboard that defined the day locally
 * would disagree with the identical preset inside a flow.
 */
describe("resolveRange — Today and Yesterday", () => {
  const startOfTodayUtc = () => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  };

  it("Today starts at UTC midnight and runs to now, not to end of day", () => {
    const { key, range } = resolveRange("today");
    expect(key).toBe("today");
    expect(range.from.getTime()).toBe(startOfTodayUtc());
    // Sabotage: end the window at end-of-day and a still-running period is
    // reported as a finished one — the partial-period lie the flow presets
    // carry a warning about.
    expect(range.to.getTime()).toBeLessThanOrEqual(Date.now());
    expect(range.to.getTime()).toBeGreaterThan(startOfTodayUtc() - 1);
  });

  it("Yesterday is the whole previous UTC day, ending the instant before today", () => {
    const { range } = resolveRange("yesterday");
    expect(range.from.getTime()).toBe(startOfTodayUtc() - 86_400_000);
    // Sabotage: end it at startOfToday and midnight lands in both windows,
    // double-counting one instant across two ranges.
    expect(range.to.getTime()).toBe(startOfTodayUtc() - 1);
    expect(range.to.getTime() - range.from.getTime()).toBe(86_400_000 - 1);
  });

  it("the two never overlap, and an unknown key still falls back to 7 days", () => {
    const today = resolveRange("today").range;
    const yesterday = resolveRange("yesterday").range;
    expect(yesterday.to.getTime()).toBeLessThan(today.from.getTime());
    expect(resolveRange("nonsense").key).toBe("7d");
    expect(resolveRange(undefined).key).toBe("7d");
  });
});

/**
 * THE FORWARD RANGE. Every other pill ends at now, so a meeting that has not
 * happened yet was visible in exactly one place — "All time", which is returned
 * unfiltered and so counted it without saying so.
 */
describe("resolveRange — Upcoming", () => {
  it("starts strictly after now, so a record dated exactly now is not counted twice", () => {
    const before = Date.now();
    const { key, range } = resolveRange("upcoming");
    expect(key).toBe("upcoming");
    expect(range.from.getTime()).toBeGreaterThan(before);
  });

  it("ends at a bound that survives being written as a date", () => {
    const { range } = resolveRange("upcoming");
    // Sabotage: `new Date(8_640_000_000_000_000)` is also a Date and is also
    // "far future", but it serialises as "+275760-09-13T00:00:00.000Z" — the
    // ISO extended-year spelling, which Postgres will not parse. Four plain
    // digits is the whole requirement, and the SQL test below proves it.
    expect(range.to.toISOString()).toBe("9999-12-31T23:59:59.999Z");
  });

  /**
   * The bound is not decorative: `compute.ts` binds it straight into
   * `occurred_at <= $n`. This runs it through the real database.
   */
  it("selects future-dated events through the SQL path, and only those", async () => {
    await ev({ eventType: "booked", subject: "next week", daysAgo: -7 });
    await ev({ eventType: "booked", subject: "in an hour", daysAgo: -1 / 24 });
    await ev({ eventType: "booked", subject: "yesterday", daysAgo: 1 });

    const res = await computeAggregate(db, ORG, agg({ eventType: "booked" }), resolveRange("upcoming").range);
    expect(res).toEqual({ kind: "scalar", value: 2 });

    // And the backward pills still exclude them, which is the asymmetry that
    // made the future invisible in the first place.
    const week = await computeAggregate(db, ORG, agg({ eventType: "booked" }), resolveRange("7d").range);
    expect(week).toEqual({ kind: "scalar", value: 1 });
  });
});
