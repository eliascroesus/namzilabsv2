import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { events } from "@/db/schema";
import { runFlow } from "@/lib/flow/engine";
import { TIME_UNITS, STORED_TIME_UNITS, FormulaConfigSchema, parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * AN HOUR IS A PERIOD A TREND MAY BE BUILT ON.
 *
 * Every piece of machinery under it already spoke hours — `bucketKey` cuts the
 * ISO string at 13 characters and says in its own comment why that sorts
 * chronologically, `bucketFloorMs` and `bucketNextMs` both branch on it, and
 * the chart marks have drawn an hour grid since `bucketUnitForWindow` started
 * choosing one for windows of two days or fewer. Only `TIME_UNITS` withheld it,
 * so the Summarize step offered Day, Week, Month, Quarter and Year over an
 * engine that could already answer Hour.
 *
 * WHY THIS FILE EXISTS RATHER THAN A LINE IN AN EXISTING ONE. Nothing in the
 * suite enumerated `TIME_UNITS`, so widening it is the exact change this
 * repo's own tests are worst at catching: a check that walks a union and
 * asserts on what it finds keeps passing when the union grows, having quietly
 * tested one fewer case than it did yesterday. These assert the new rung by
 * name.
 */
describe("hour, withdrawn from the picker", () => {
  it("is not a period a flow author can choose", () => {
    /**
     * WITHDRAWN THE MORNING AFTER IT SHIPPED. Offering it was reasoned from the
     * machinery — `bucketKey`, `bucketFloorMs` and `bucketNextMs` all branch on
     * hours, and the marks have drawn an hour grid for short windows for ages —
     * and that reasoning missed CARDINALITY. A bucket per distinct hour is
     * bounded only by the record count, so a long history puts thousands of
     * points in a tile's jsonb: the same blow-up `MAX_GROUPS` exists to stop,
     * one axis over. Day is the floor.
     */
    expect(TIME_UNITS).not.toContain("hour");
    expect([...TIME_UNITS]).toEqual(["day", "week", "month", "quarter", "year"]);
  });

  it("is still a period a SAVED flow may contain", () => {
    /**
     * THE COMPATIBILITY HALF, and the reason `STORED_TIME_UNITS` exists at all.
     * A graph built during that one day carries `unit: "hour"`; a zod enum that
     * no longer lists it does not degrade politely, it throws — and the flow
     * cannot be OPENED, let alone corrected. That is a worse failure than the
     * one the withdrawal prevents.
     */
    expect(STORED_TIME_UNITS).toContain("hour");
    // The stored list is the offered list plus that rung and nothing else, so
    // the two cannot quietly drift apart.
    expect([...STORED_TIME_UNITS].sort()).toEqual([...TIME_UNITS, "hour"].sort());
  });

  it("survives the schema a saved step is parsed through", () => {
    /**
     * The picker writing a value the parser then rejects is how a step saves
     * and comes back empty. `GroupBySchema` reads `z.enum(TIME_UNITS)`, so
     * this passes for free once the constant grows — which is precisely why it
     * is worth pinning: nothing else would notice if the enum were spelled out
     * by hand somewhere and left behind.
     */
    const cfg = FormulaConfigSchema.parse({ op: "count", groupBy: { type: "time", unit: "hour" } });
    expect(cfg.groupBy).toMatchObject({ type: "time", unit: "hour" });
  });

  it("rejects a period nobody implemented, so the enum is still a gate", () => {
    /**
     * The negative half, and it is load-bearing: without it the test above
     * proves only that SOMETHING parsed. An earlier draft of this file imported
     * a schema that does not exist, so `.parse` threw a TypeError and
     * `toThrow()` swallowed it — a green assertion over a typo, which is this
     * repo's standing failure mode written small.
     */
    expect(() => FormulaConfigSchema.parse({ op: "count", groupBy: { type: "time", unit: "fortnight" } })).toThrow(
      /fortnight|invalid|expected/i,
    );
  });
});

/**
 * AND THE ENGINE ANSWERS IT — which is the assertion that matters, because the
 * three above would all pass over an engine that silently bucketed by day.
 */
describe("an hourly trend, run", () => {
  const ORG = "org_hour";
  const CONN = randomUUID();
  let db: DB;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  /**
   * SEEDED FROM THE TOP OF AN HOUR, NOT FROM "NOW" — and the first version of
   * this file got that wrong in a way only the clock could reveal.
   *
   * It placed two events 0.2 and 0.3 hours ago and asserted they shared a
   * bucket. They usually do; at 00:15 UTC they are 00:03 and 23:57, which are
   * two hours and two buckets, and the test failed on a change to nobody's
   * code. `hoursAgo` counts whole hours back from the TOP of the current hour
   * and `minute` places the event inside it, so "these two are in one hour" is
   * a property of the fixture rather than a coincidence of when it ran.
   */
  const topOfHour = () => {
    const d = new Date();
    d.setUTCMinutes(0, 0, 0);
    return d.getTime();
  };
  const at = async (hoursAgo: number, subject: string, minute = 10) => {
    await db.insert(events).values({
      eventId: `webhook:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "webhook",
      eventType: "booked",
      subject,
      occurredAt: new Date(topOfHour() - hoursAgo * 3_600_000 + minute * 60_000),
      value: null,
      properties: {},
    });
  };

  it("splits one day into its hours, keyed so they sort chronologically", async () => {
    // Two in the same hour, one three hours earlier: two buckets, not three,
    // and not one — which is what a silent fall back to `day` would give. The
    // minutes are explicit so the pair cannot drift into separate hours.
    await at(3, "a", 10);
    await at(1, "b", 10);
    await at(1, "c", 40);

    const res = await runFlow(
      { db, orgId: ORG },
      parseGraph({
        nodes: [
          { id: "a", type: "app", data: { config: { connectionId: CONN } } },
          { id: "agg", type: "aggregate", data: { config: { aggregation: "count", groupBy: { type: "time", unit: "hour" } } } },
          { id: "o", type: "output", data: { config: { viz: "line" } } },
        ],
        edges: [
          { id: "a->agg", source: "a", target: "agg" },
          { id: "agg->o", source: "agg", target: "o" },
        ],
      }),
    );

    const series = res.outputs[0].tile.series!;
    expect(series).toHaveLength(2);
    // `2026-09-14T13` — the ISO string cut at the hour, which is what makes the
    // keys sort chronologically as plain strings. See `bucketKey`.
    for (const point of series) expect(point.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect([...series].sort((x, y) => (x.bucket < y.bucket ? -1 : 1))).toEqual(series);
    expect(series.reduce((n, s) => n + s.value, 0)).toBe(3);
    // The pair that shared an hour landed in one bucket.
    expect(series.map((s) => s.value).sort()).toEqual([1, 2]);
    expect(res.outputs[0].tile.value).toBe(3);
  });

  it("is a finer grid than a day, over the very same records", async () => {
    /**
     * THE TWO RECORDS ARE PLACED INSIDE ONE UTC DAY ON PURPOSE. Three hours
     * before "now" straddles midnight for three hours out of every
     * twenty-four, and on those runs `day` also answers two buckets and a
     * strict `toBeGreaterThan` fails on a change to nobody's code — the kind of
     * test that gets re-run until it is green and then trusted. Anchoring both
     * events to the middle of the current UTC day removes the clock from the
     * assertion entirely.
     */
    const now = new Date();
    // Midday YESTERDAY, so both records are firmly in the past whatever the
    // hour of the run; 12:00 and 15:00 share a UTC day on every date there is.
    // Counted from the top of the hour, like every other seed here.
    const middayAgoH = Math.round(
      (topOfHour() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12)) / 3_600_000,
    );
    await at(middayAgoH, "a");
    await at(middayAgoH - 3, "b");
    const graph = (unit: string) =>
      parseGraph({
        nodes: [
          { id: "a", type: "app", data: { config: { connectionId: CONN } } },
          { id: "agg", type: "aggregate", data: { config: { aggregation: "count", groupBy: { type: "time", unit } } } },
          { id: "o", type: "output", data: { config: { viz: "line" } } },
        ],
        edges: [
          { id: "a->agg", source: "a", target: "agg" },
          { id: "agg->o", source: "agg", target: "o" },
        ],
      });
    const byHour = await runFlow({ db, orgId: ORG }, graph("hour"));
    const byDay = await runFlow({ db, orgId: ORG }, graph("day"));
    expect(byHour.outputs[0].tile.series!.length).toBeGreaterThan(byDay.outputs[0].tile.series!.length);
  });
});
