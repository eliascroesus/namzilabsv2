import { sql } from "drizzle-orm";
import { connections, flows, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * GROWTH, AND WHAT IT IS HONESTLY ALLOWED TO MEAN HERE.
 *
 * The owner asked for "how many new accounts joined today". This database does
 * not know about accounts — WorkOS does, and asking it would be a paginated API
 * walk per day of the chart. What this database knows exactly, and cheaply, is
 * when a WORKSPACE was created and when somebody first connected an app or
 * built a flow. Those are the three moments that actually matter for a product
 * like this one anyway: somebody showed up, somebody plugged something in,
 * somebody built the thing they came for.
 *
 * So every number here is labelled as what it is. A chart called "signups" that
 * is quietly counting something else is worse than no chart, because it is the
 * one a founder makes decisions on.
 *
 * ═══ THE BUG THIS MODULE WAS WRITTEN AROUND ═══
 *
 * `workspace_owners` has two kinds of row, and only one of them is a signup.
 *
 *   `created`           written by `createOrganizationAction` at the moment the
 *                       workspace is made, so `claimed_at` IS the creation time.
 *   `backfill_earliest` written by `permissions.ts` the first time an OLD
 *                       workspace's ranks are looked at, and it does NOT set
 *                       `claimed_at` — so the column defaults to `now()`.
 *
 * A workspace created in March, opened for the first time today, therefore
 * lands in the database today with a claim date of today. Counted naively it
 * appears as a brand-new customer. `recentWorkspaces()` was doing exactly that,
 * so the overview's "N in the last 30 days" has been over-reporting by however
 * many dormant workspaces happened to be visited in that window — invisible,
 * because the number always looked plausible.
 *
 * Every query below filters `source = 'created'`. It under-counts in one rare
 * case, and that is the right direction to be wrong in: the owner-row insert is
 * best-effort inside a try/catch, so a workspace whose insert failed is claimed
 * later by the backfill and is never counted. A growth chart that misses a
 * handful is recoverable; one that invents customers is not.
 *
 * ═══ EVERYTHING IS UTC ═══
 *
 * "Today" needs a timezone and the server has no business guessing the
 * reader's. UTC is stated on the page rather than assumed, because a founder
 * checking at 9pm in Stockholm is looking at a day that closed two hours ago
 * and should know it.
 *
 * ═══ COST ═══
 *
 * Three tables, all bounded by deliberate human action — the same argument
 * `fleetOverview` makes for counting them exactly. A `date_trunc` group-by over
 * a few thousand rows is nothing; none of this touches a table that grows with
 * traffic.
 */

export type DayPoint = { bucket: string; value: number };

export type GrowthSeries = {
  /** Workspaces created, by UTC day, oldest first. */
  workspaces: DayPoint[];
  /** Apps connected, by UTC day. */
  connections: DayPoint[];
  /** Flows built, by UTC day. */
  flows: DayPoint[];
  /** The window these cover, so the page can say so. */
  days: number;
};

export type GrowthTotals = {
  workspacesToday: number;
  workspaces7d: number;
  workspaces30d: number;
  connectionsToday: number;
  flowsToday: number;
};

/** Midnight UTC, `n` days ago. The floor of every window here. */
function utcDaysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/**
 * A DENSE SERIES, because a sparse one lies in a bar chart.
 *
 * Postgres returns only the days that have rows. Handed straight to a chart
 * those become adjacent bars, so a quiet fortnight followed by one signup
 * renders as two equal-width days side by side — the shape of steady growth
 * drawn from its opposite. Every day in the window gets a bucket, zeros
 * included.
 */
function densify(rows: Array<{ day: string | Date; n: number }>, days: number): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const key = (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10);
    byDay.set(key, Number(r.n));
  }
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = utcDaysAgo(i).toISOString().slice(0, 10);
    out.push({ bucket: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}

/**
 * Takes its `db` rather than reaching for one, so the whole thing is
 * exercisable against real Postgres in `tests/admin-growth.test.ts` — the same
 * split `permissions.ts` makes, and for the same reason: a number nobody can
 * test is a number nobody can trust.
 *
 * NO `requireStaff()` HERE. Authorization belongs at the page and at the
 * exported wrappers below; a pure query module that gates itself cannot be
 * tested without a session, which is how the gate ends up untested instead.
 */
export async function growthSeries(db: DB, days = 30): Promise<GrowthSeries> {
  const since = utcDaysAgo(days - 1);

  const [ws, conn, flw] = await Promise.all([
    db
      .select({ day: sql<string>`date_trunc('day', ${workspaceOwners.claimedAt} at time zone 'utc')::date::text`, n: sql<number>`count(*)::int` })
      .from(workspaceOwners)
      // The whole point of this module — see the header.
      .where(sql`${workspaceOwners.source} = 'created' and ${workspaceOwners.claimedAt} >= ${since}`)
      .groupBy(sql`1`),
    db
      .select({ day: sql<string>`date_trunc('day', ${connections.createdAt} at time zone 'utc')::date::text`, n: sql<number>`count(*)::int` })
      .from(connections)
      .where(sql`${connections.createdAt} >= ${since}`)
      .groupBy(sql`1`),
    db
      .select({ day: sql<string>`date_trunc('day', ${flows.createdAt} at time zone 'utc')::date::text`, n: sql<number>`count(*)::int` })
      .from(flows)
      .where(sql`${flows.createdAt} >= ${since}`)
      .groupBy(sql`1`),
  ]);

  return {
    workspaces: densify(ws, days),
    connections: densify(conn, days),
    flows: densify(flw, days),
    days,
  };
}

/**
 * The headline figures. Derived from the same series rather than re-queried, so
 * the tiles and the chart can never disagree — which they would, eventually,
 * being two counts of the same thing taken at two moments.
 */
export function totalsFrom(series: GrowthSeries): GrowthTotals {
  const tail = (p: DayPoint[], n: number) => p.slice(-n).reduce((a, b) => a + b.value, 0);
  return {
    workspacesToday: tail(series.workspaces, 1),
    workspaces7d: tail(series.workspaces, 7),
    workspaces30d: tail(series.workspaces, 30),
    connectionsToday: tail(series.connections, 1),
    flowsToday: tail(series.flows, 1),
  };
}
