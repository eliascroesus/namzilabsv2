import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { computeAggregate, computeFunnel, queryEvents } from "@/lib/metrics/compute";
import { AggregateSchema, FunnelSchema } from "@/lib/metrics/types";
import { MATERIALIZED_RANGES, RANGE_OPTIONS, resolveRange } from "@/lib/metrics/range";
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
 * THE FORWARD RANGE IS RETIRED, and this describes what replaced it.
 *
 * "Upcoming" was a seventh pill: strictly after now, out to a year-9999
 * sentinel. It answered a real question — every other pill ends at now, so a
 * meeting that has not happened yet was visible only inside "All time", which
 * is returned unfiltered and counted it silently — but it answered it on the
 * wrong surface. A dashboard tile is a RESULT, and a headline number that mixes
 * what happened with what is merely scheduled is its own kind of wrong. The
 * forward view is the Calendar, which draws days still to come quieter than
 * days that happened.
 *
 * THE KEY MUST FALL BACK, NOT RESOLVE. Leaving `resolveRange` able to return
 * "upcoming" after it left `MATERIALIZED_RANGES` was worse than either
 * extreme: no stored tile carries the slot, so a bookmarked `?range=upcoming`
 * rendered every metric as "—" over "Not computed yet for this range — Refresh
 * to compute it", and Refresh could never produce it. That is a board naming a
 * button that cannot work.
 */
describe("resolveRange — the retired forward range", () => {
  it("treats 'upcoming' as an unknown key and falls back", () => {
    // Sabotage: restore the `key === "upcoming"` arm of the guard in
    // resolveRange and this returns "upcoming" with a year-9999 end — the
    // permanent "Not computed yet" state described above.
    expect(resolveRange("upcoming").key).toBe("7d");
    // ...and a real window, not a sentinel: the end is the clock.
    expect(resolveRange("upcoming").range.to.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("offers no forward pill, and materializes no forward slot", () => {
    // The two lists a pill and a stored slot come from. Neither may carry it:
    // one would put the pill back, the other would put the bytes back on every
    // tile read.
    expect(RANGE_OPTIONS.map((r) => r.key)).not.toContain("upcoming");
    expect(MATERIALIZED_RANGES).not.toContain("upcoming");
  });

  /**
   * The asymmetry that made the future invisible is still real and still the
   * reason the Calendar exists — a backward pill excludes future-dated records,
   * through the SQL path, against the real database. This half of the old
   * forward test outlives it.
   */
  it("still excludes future-dated events from a backward window", async () => {
    await ev({ eventType: "booked", subject: "next week", daysAgo: -7 });
    await ev({ eventType: "booked", subject: "in an hour", daysAgo: -1 / 24 });
    await ev({ eventType: "booked", subject: "yesterday", daysAgo: 1 });

    const week = await computeAggregate(db, ORG, agg({ eventType: "booked" }), resolveRange("7d").range);
    expect(week).toEqual({ kind: "scalar", value: 1 });

    // "All time" is the one that still contains them, unfiltered — which is
    // exactly the gap "Upcoming" was invented to explain and the Calendar now
    // shows properly.
    const all = await computeAggregate(db, ORG, agg({ eventType: "booked" }), resolveRange("all").range);
    expect(all).toEqual({ kind: "scalar", value: 1 });
  });
});
