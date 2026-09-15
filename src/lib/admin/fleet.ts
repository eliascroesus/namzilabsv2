import { desc, gt, sql } from "drizzle-orm";
import {
  auditLog,
  connections,
  dashboardTiles,
  deadLetter,
  flows,
  mcpGrants,
  metrics,
  referrals,
  userProfiles,
  workspaceOwners,
} from "@/db/schema";
import { getDb } from "@/db/client";
import { requireStaff } from "@/lib/admin/access";

/**
 * THE FLEET OVERVIEW — every number on the admin dashboard's front page.
 *
 * ═══ THE DESIGN CONSTRAINT IS COST, NOT LATENCY ═══
 *
 * Stated plainly by the owner: be as cheap as possible, and ten seconds of
 * load time does not matter. Neon bills egress and compute, the free egress
 * allowance is account-wide, and an internal dashboard that quietly scans the
 * events table on every page view is a bill nobody asked for. So:
 *
 * 1. EXACT COUNTS ONLY FOR TABLES BOUNDED BY HUMAN ACTION. Connections, flows,
 *    metrics, tiles, owners, grants, referrals — one row per deliberate act, so
 *    a thousand customers is thousands of rows, not millions. `count(*)` over
 *    those is cheap and the number is worth being exact.
 *
 * 2. FOR TABLES THAT GROW WITH TRAFFIC, COUNT WHEN IT IS CHEAP AND ESTIMATE
 *    WHEN IT IS NOT — decided per table, from the table's size on disk.
 *
 *    The first version simply estimated all of them from `pg_class.reltuples`,
 *    and measuring it against the real database showed why that was wrong.
 *    `reltuples` is superb on a big table (events: 26,148 estimated against
 *    26,151 actual) and unreliable on a small one (delivery_log: 51 estimated
 *    against 104 actual — a 2× error), because it only moves when autovacuum
 *    analyses. A 2× error on a small number is worse than useless; the same
 *    relative error on a number in the millions changes no decision at all.
 *    Two of the six had never been analysed and reported -1.
 *
 *    So the catalog read fetches `pg_total_relation_size` alongside
 *    `reltuples`, and a table under `EXACT_BELOW_BYTES` is counted exactly —
 *    scanning 32 MB is nothing, and it is the range where the estimate is
 *    least trustworthy. Above that the estimate stands and the UI marks it
 *    `approx`. A never-analysed table is decided the same way, on its size,
 *    rather than being shown as a confident zero or a useless "unknown".
 *
 *    The size lookup is the cheap part: file sizes come from the catalog, so
 *    the decision costs the same whether a table holds a thousand rows or a
 *    billion.
 *
 * 3. SEQUENTIAL, NOT `Promise.all`. Counter-intuitive and deliberate:
 *    `MIN_POOL_MAX` in `src/db/client.ts` is derived arithmetic — 5 (the widest
 *    read fan-out in the app) + 1 (a transaction holding its client) + 1
 *    (headroom) — and `tests/pool-tuning.test.ts` asserts that exact sum. A
 *    wider fan-out here would not be slow, it would invalidate the floor and
 *    risk the DEADLOCK that comment describes. Latency does not matter on this
 *    page, so the queries simply queue.
 *
 * 4. NO CACHE, AND THAT IS A DECISION. A handful of staff loading this a few
 *    times a day is a trivial query volume once (2) removes the scans; a cache
 *    would add staleness and a refresh affordance to save nothing measurable.
 *    If it ever does matter, the next step is a snapshot row recomputed hourly,
 *    not a Next.js cache — the numbers would then be shared across instances
 *    instead of per-container.
 *
 * ═══ WHAT IS DELIBERATELY NOT HERE ═══
 *
 * No event payloads, no metric values, no board contents, no credentials.
 * The dashboard shows the SHAPE of usage — how many, how healthy, how busy —
 * and never what anybody's data says. See `lookup.ts` for the same line drawn
 * around the per-workspace view.
 */

/** Tables that grow with traffic, so their row count is decided by size. */
const ESTIMATED = ["events", "raw_events", "delivery_log", "usage_ledger", "mcp_calls", "test_runs"] as const;

/**
 * Below this on disk, count exactly instead of trusting `reltuples`.
 *
 * 32 MB is roughly a hundred thousand of this schema's rows, scans in
 * milliseconds, and sits comfortably inside the band where the planner's
 * estimate is least reliable — `delivery_log` measured 51 against an actual
 * 104. Above it the estimate is both accurate and the only affordable answer.
 */
const EXACT_BELOW_BYTES = 32 * 1024 * 1024;

export type FleetOverview = {
  at: Date;
  workspaces: number;
  people: number;
  profiles: number;
  connections: { total: number; bySource: Array<{ source: string; n: number }>; byStatus: Array<{ status: string; n: number }> };
  built: { flows: number; metrics: number; tiles: number };
  ai: { grants: number };
  referrals: number;
  unresolvedDeadLetter: number;
  /**
   * Row counts for the traffic tables. `exact` says which were counted and
   * which are the planner's estimate, so the UI can mark the difference
   * instead of presenting both as facts.
   */
  approx: Array<{ table: string; rows: number | null; exact: boolean }>;
  topByConnections: Array<{ orgId: string; n: number }>;
  recentGovernance: Array<{ action: string; orgId: string | null; at: Date }>;
};

const n = (rows: Array<{ n: unknown }>): number => Number(rows[0]?.n ?? 0);

/**
 * The pool driver returns `{ rows }` and the http driver returns the array
 * itself. Same shim as `rowsOf` in `src/lib/schema-audit.ts` and the inline one
 * in `src/lib/sync/locks.ts` — the only three places raw SQL is executed.
 */
function rowsOf<T>(res: unknown): T[] {
  return (res as { rows?: T[] }).rows ?? (res as T[]);
}

/**
 * Every figure on the front page.
 *
 * Gated here as well as in the page, because rule 4 in `access.ts` is that the
 * gate lives with the QUERY and not only with the rendering — a layout is not
 * a security boundary.
 */
export async function fleetOverview(): Promise<FleetOverview> {
  await requireStaff();
  const db = getDb();

  // ── Bounded by human action: exact ────────────────────────────────────────
  const workspaces = n(await db.select({ n: sql<number>`count(*)::int` }).from(workspaceOwners));
  // Distinct owners is the honest answer to "how many people" from OUR data.
  // WorkOS is the authority on accounts and knows about members who own
  // nothing; this number is a floor, and the UI says so.
  const people = n(
    await db.select({ n: sql<number>`count(distinct ${workspaceOwners.userId})::int` }).from(workspaceOwners),
  );
  const profiles = n(await db.select({ n: sql<number>`count(*)::int` }).from(userProfiles));
  const connectionsTotal = n(await db.select({ n: sql<number>`count(*)::int` }).from(connections));

  const bySource = await db
    .select({ source: connections.source, n: sql<number>`count(*)::int` })
    .from(connections)
    .groupBy(connections.source)
    .orderBy(desc(sql`count(*)`));

  const byStatus = await db
    .select({ status: connections.status, n: sql<number>`count(*)::int` })
    .from(connections)
    .groupBy(connections.status)
    .orderBy(desc(sql`count(*)`));

  const flowCount = n(await db.select({ n: sql<number>`count(*)::int` }).from(flows));
  const metricCount = n(await db.select({ n: sql<number>`count(*)::int` }).from(metrics));
  const tileCount = n(await db.select({ n: sql<number>`count(*)::int` }).from(dashboardTiles));
  const grants = n(await db.select({ n: sql<number>`count(*)::int` }).from(mcpGrants));
  const referralCount = n(await db.select({ n: sql<number>`count(*)::int` }).from(referrals));
  const unresolvedDeadLetter = n(
    await db.select({ n: sql<number>`count(*)::int` }).from(deadLetter).where(sql`${deadLetter.resolvedAt} is null`),
  );

  /**
   * "MOST APPS ADDED ON ONE WORKSPACE" — asked for by name. Cheap because
   * `connections` is bounded by human action; ten rows, ordered, nothing
   * scanned that grows with traffic.
   */
  const topByConnections = await db
    .select({ orgId: connections.orgId, n: sql<number>`count(*)::int` })
    .from(connections)
    .groupBy(connections.orgId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  /**
   * The last governance acts across the whole fleet — the audit log read the
   * way an operator wants it rather than one tenant at a time. Indexed by
   * `(org_id, at desc)`; ten rows.
   */
  const recentGovernance = await db
    .select({ action: auditLog.action, orgId: auditLog.orgId, at: auditLog.at })
    .from(auditLog)
    .orderBy(desc(auditLog.at))
    .limit(10);

  /**
   * ── The traffic tables: one catalog read, then a decision per table ──────
   *
   * Both figures come from the catalog, so this costs the same at any scale.
   * `reltuples` is the planner's row estimate (-1 until the table is first
   * analysed); `pg_total_relation_size` is what it occupies on disk, which is
   * what decides whether counting it is affordable.
   */
  const catalog = await db.execute(sql`
    select c.relname,
           c.reltuples::bigint as rows,
           pg_total_relation_size(c.oid)::bigint as bytes
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (${sql.join(ESTIMATED.map((t) => sql`${t}`), sql`, `)})
  `);
  const byTable = new Map(
    rowsOf<{ relname: string; rows: string; bytes: string }>(catalog).map((r) => [
      r.relname,
      { rows: Number(r.rows), bytes: Number(r.bytes) },
    ]),
  );

  const approx: FleetOverview["approx"] = [];
  for (const table of ESTIMATED) {
    const row = byTable.get(table);
    if (!row) {
      // In `ESTIMATED` but not in the catalog: the table does not exist here.
      approx.push({ table, rows: null, exact: false });
      continue;
    }
    if (row.bytes < EXACT_BELOW_BYTES) {
      /**
       * Small enough to count, so count it — this is the band where the
       * estimate is least trustworthy and the scan is cheapest. `sql.raw` is
       * safe because the name comes from `ESTIMATED`, a literal tuple in this
       * file, and never from a request.
       */
      const counted = await db.execute(sql`select count(*)::int as n from ${sql.raw(`"${table}"`)}`);
      approx.push({ table, rows: Number(rowsOf<{ n: number }>(counted)[0]?.n ?? 0), exact: true });
      continue;
    }
    // Big enough that a scan would be the expensive thing this page exists to
    // avoid. A -1 here means big AND never analysed, which is genuinely
    // unknown rather than zero.
    approx.push({ table, rows: row.rows < 0 ? null : row.rows, exact: false });
  }

  return {
    at: new Date(),
    workspaces,
    people,
    profiles,
    connections: { total: connectionsTotal, bySource, byStatus },
    built: { flows: flowCount, metrics: metricCount, tiles: tileCount },
    ai: { grants },
    referrals: referralCount,
    unresolvedDeadLetter,
    approx,
    topByConnections,
    recentGovernance,
  };
}

/**
 * Connections that are visibly broken right now, fleet-wide.
 *
 * The one thing on this dashboard that is not a statistic but a WORKLIST: an
 * errored connection is a customer whose numbers are silently wrong, and they
 * usually do not know. Capped, and it names the workspace rather than the
 * error's contents — a provider error string can quote a customer's data.
 */
export async function brokenConnections(): Promise<Array<{ orgId: string; source: string; status: string; syncStatus: string; lastEventAt: Date | null }>> {
  await requireStaff();
  return getDb()
    .select({
      orgId: connections.orgId,
      source: connections.source,
      status: connections.status,
      syncStatus: connections.syncStatus,
      lastEventAt: connections.lastEventAt,
    })
    .from(connections)
    .where(sql`${connections.status} = 'error' or ${connections.syncStatus} = 'error'`)
    .orderBy(desc(connections.lastEventAt))
    .limit(50);
}

/**
 * How many workspaces were claimed in the last 30 days — the only growth
 * figure here, and one row.
 */
export async function recentWorkspaces(): Promise<number> {
  await requireStaff();
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceOwners)
    .where(gt(workspaceOwners.claimedAt, new Date(Date.now() - 30 * 86_400_000)));
  return n(rows);
}
