import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, flowResults, flows, flowVersions } from "@/db/schema";
import { materializeFlow } from "@/lib/flow/materialize";
import { dayKey } from "@/lib/metrics/calendar";
import type { DB } from "@/db/types";

/**
 * C4: A TIME-SPLIT CALCULATE'S STORED TILE AGREES WITH ITSELF.
 *
 * A Calculate's own `groupBy: { type: "time" }` used to bucket by
 * `occurredAt` no matter which "Time reference" the metric published with,
 * while `tileByRange` already re-executed every range through the SAME
 * endpoint node — so the top-level series (from the initial run), `All time`
 * (which re-runs the endpoint over every record, untouched) and `Last 7 days`
 * (which re-runs it over the windowed ones) could each bucket the very same
 * record under a different day, depending only on which of the two seams
 * (`execNode`'s initial run, `tileByRange`'s re-execution) happened to read
 * the chosen field. Fixing only one seam still disagrees with the other —
 * this test pins that both read `properties.starts_at`, not `occurredAt`.
 */

let db: DB;
let close: () => Promise<void>;
const ORG = "org_time_split_ref";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

/** A time-split Calculate published with a chosen "Time reference". */
async function seedTimeSplit(bookings: Array<{ arrivedDaysAgo: number; bookedDaysAgo: number }>) {
  const connId = randomUUID();
  await db
    .insert(connections)
    .values({ id: connId, orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "none" });

  const graph = {
    nodes: [
      { id: "m", type: "app", data: { config: { connectionId: connId, source: "webhook", eventType: "meeting_booked" } } },
      { id: "c", type: "calculate", data: { config: { mode: "number", aggregation: "count", groupBy: { type: "time", unit: "day" } } } },
    ],
    edges: [{ id: "m->c", source: "m", target: "c" }],
    metrics: [{ nodeId: "c", enabled: true, name: "Meetings booked", viz: "line", format: "number", precision: 0, target: null, timeField: "properties.starts_at" }],
  };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name: "time split", draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph });

  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows: (typeof events.$inferInsert)[] = [];
  bookings.forEach((b, i) => {
    rows.push({
      eventId: `m${i}`,
      orgId: ORG,
      connectionId: connId,
      source: "webhook",
      eventType: "meeting_booked",
      subject: `m${i}`,
      // Arrival (occurredAt): the row's own age. Deliberately far from the
      // booked day below, so a bucket keyed by arrival could never pass for
      // one keyed by the booking.
      occurredAt: new Date(midnight - b.arrivedDaysAgo * 86_400_000 + 3_600_000),
      properties: { starts_at: new Date(midnight - b.bookedDaysAgo * 86_400_000 + 5 * 3_600_000).toISOString() },
    });
  });
  if (rows.length) await db.insert(events).values(rows);
  await materializeFlow(db, ORG, flow.id);
  const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
  return {
    now,
    tile: row.tile as {
      series?: Array<{ bucket: string; value: number }>;
      value?: number;
      byRange?: Record<string, { value?: number; series?: Array<{ bucket: string; value: number }> }>;
    },
  };
}

describe("a time-split Calculate's stored tile agrees with itself", () => {
  it("buckets series, All time and Last 7 days by the same chosen date, with the same headline", async () => {
    const { now, tile } = await seedTimeSplit([
      // Two meetings arrived long ago and are booked for today.
      { arrivedDaysAgo: 20, bookedDaysAgo: 0 },
      { arrivedDaysAgo: 20, bookedDaysAgo: 0 },
      // One arrived long ago and is booked for yesterday.
      { arrivedDaysAgo: 15, bookedDaysAgo: 1 },
    ]);

    const today = dayKey(now);
    const yesterday = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000));
    // Bucket-key order is lexicographic (see `aggregate()`), and an ISO day
    // string sorts chronologically, so yesterday always precedes today here.
    const expectedSeries = [
      { bucket: yesterday, value: 1 },
      { bucket: today, value: 2 },
    ];

    // The top-level series comes from the initial run (`execNode`'s seam);
    // sabotage: revert only that seam and this reads arrival-dated buckets
    // twenty and fifteen days back instead.
    expect(tile.series).toEqual(expectedSeries);
    // `all` re-executes the endpoint over every record, untouched
    // (`tileByRange`'s seam); sabotage: revert only that seam and this
    // disagrees with `tile.series` above.
    expect(tile.byRange?.all?.series).toEqual(expectedSeries);
    // `7d` re-executes it over the windowed records — the same seam, a
    // narrower input.
    expect(tile.byRange?.["7d"]?.series).toEqual(expectedSeries);

    // The headline is every booked meeting, in every slot — never the sum of
    // buckets dated by the wrong field, and never just the dated ones.
    expect(tile.value).toBe(3);
    expect(tile.byRange?.all?.value).toBe(3);
    expect(tile.byRange?.["7d"]?.value).toBe(3);
  });
});
