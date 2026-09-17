import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { workspaceOwners, connections, flows } from "@/db/schema";
import type { DB } from "@/db/types";
import { growthSeries, totalsFrom } from "@/lib/admin/growth";

/**
 * THE GROWTH CHART, AGAINST REAL POSTGRES.
 *
 * Every assertion here is about a number a founder would act on, which is the
 * reason it is worth the cost of a real database rather than a stub: the whole
 * failure mode of an admin panel is a figure that looks plausible and is wrong,
 * and a mocked query cannot tell you whether the SQL says what you meant.
 */

let db: DB;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(async () => close());

/** Midnight UTC, n days back — the same clock `growth.ts` counts on. */
function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const owner = (orgId: string, source: "created" | "backfill_earliest", claimedAt: Date) =>
  db.insert(workspaceOwners).values({ orgId, userId: `user_${orgId}`, source, claimedAt });

describe("a backfilled owner row is not a signup", () => {
  /**
   * THE BUG THIS MODULE EXISTS FOR.
   *
   * `workspace_owners` holds two kinds of row. `created` is written the moment
   * a workspace is made, so `claimed_at` is its birthday. `backfill_earliest`
   * is written by `permissions.ts` the first time an OLD workspace's ranks are
   * read — and it does not set `claimed_at`, so the column defaults to `now()`.
   *
   * A workspace made in March and opened for the first time today therefore
   * lands in the table dated today. Counted naively it is a brand-new customer,
   * and the overview's "N in the last 30 days" said exactly that for however
   * many dormant workspaces happened to be visited. It always looked plausible,
   * which is why nobody could see it.
   */
  it("excludes a workspace that was merely looked at today", async () => {
    await owner("org_real", "created", daysAgo(0));
    // The dormant one: born long ago, claimed by the backfill just now.
    await owner("org_dormant", "backfill_earliest", daysAgo(0));

    const series = await growthSeries(db, 30);
    expect(totalsFrom(series).workspacesToday, "only the genuinely new one counts").toBe(1);
  });

  it("counts none at all when every row is a backfill", async () => {
    // A quiet day that a naive count would report as three signups.
    for (const id of ["a", "b", "c"]) await owner(`org_${id}`, "backfill_earliest", daysAgo(0));
    const series = await growthSeries(db, 30);
    expect(totalsFrom(series).workspacesToday).toBe(0);
    expect(totalsFrom(series).workspaces30d).toBe(0);
  });
});

describe("the windows mean what they say", () => {
  it("separates today from the last seven and thirty days", async () => {
    await owner("org_today", "created", daysAgo(0));
    await owner("org_3d", "created", daysAgo(3));
    await owner("org_20d", "created", daysAgo(20));
    // Outside every window: must appear in none of the three figures.
    await owner("org_old", "created", daysAgo(200));

    const t = totalsFrom(await growthSeries(db, 30));
    expect(t.workspacesToday).toBe(1);
    expect(t.workspaces7d).toBe(2);
    expect(t.workspaces30d).toBe(3);
  });

  it("does not let a row from before the window leak into the first bar", async () => {
    /**
     * The classic off-by-one in a windowed chart: everything older than the
     * range gets swept into the oldest bucket, so the chart opens with a spike
     * that is really "all of history". The `where` clause is what prevents it,
     * and this is the test that would fail if it were dropped.
     */
    await owner("org_ancient", "created", daysAgo(400));
    const series = await growthSeries(db, 30);
    expect(series.workspaces.reduce((a, b) => a + b.value, 0)).toBe(0);
  });
});

describe("the series is dense", () => {
  it("returns one bucket per day, zeros included, oldest first", async () => {
    await owner("org_one", "created", daysAgo(5));

    const series = await growthSeries(db, 30);
    expect(series.workspaces).toHaveLength(30);
    /**
     * WHY THE ZEROS MATTER. Postgres returns only days that have rows. Handed
     * straight to a bar chart those become ADJACENT bars, so a quiet fortnight
     * followed by one signup draws as two equal days side by side — the shape
     * of steady growth, rendered from its opposite.
     */
    expect(series.workspaces.filter((p) => p.value === 0)).toHaveLength(29);
    const days = series.workspaces.map((p) => p.bucket);
    expect([...days].sort(), "oldest first, so the chart reads left to right").toEqual(days);
    expect(days[days.length - 1]).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("the other two series", () => {
  it("counts connections and flows by the day they were made", async () => {
    await db.insert(connections).values([
      { orgId: "org_1", source: "calendly", name: "A", status: "active", createdAt: daysAgo(0) },
      { orgId: "org_1", source: "stripe", name: "B", status: "active", createdAt: daysAgo(0) },
      { orgId: "org_1", source: "gcal", name: "C", status: "active", createdAt: daysAgo(40) },
    ]);
    await db.insert(flows).values({ orgId: "org_1", name: "F", createdAt: daysAgo(0) });

    const t = totalsFrom(await growthSeries(db, 30));
    expect(t.connectionsToday, "the 40-day-old one is outside the window").toBe(2);
    expect(t.flowsToday).toBe(1);
  });
});

describe("the tiles and the chart cannot disagree", () => {
  it("derives every headline from the same series it draws", async () => {
    /**
     * Two counts of the same thing, taken at two moments, eventually differ —
     * and an admin panel whose tile says 4 above a chart showing 3 is a panel
     * nobody believes again. `totalsFrom` is arithmetic over the series rather
     * than a second query, so the two are the same number by construction.
     */
    for (let i = 0; i < 4; i++) await owner(`org_${i}`, "created", daysAgo(0));
    const series = await growthSeries(db, 30);
    const drawn = series.workspaces[series.workspaces.length - 1].value;
    expect(totalsFrom(series).workspacesToday).toBe(drawn);
    expect(drawn).toBe(4);
  });
});
