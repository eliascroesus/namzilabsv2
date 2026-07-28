import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { deliveryLog, testRuns } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * H.6 — storage lifecycle. Operational tables that grow with ACTIVITY rather
 * than with the customer's data must have a retention policy, or they become
 * the biggest table in the database and the slowest thing to vacuum.
 *
 * Policy (deletes are bounded per run so one sweep can't lock a hot table):
 * - `delivery_log`: an observability trail of every processing attempt. 30d.
 * - `test_runs`: ephemeral editor working state — one row per Test click.
 *   Settled runs 30d; unsettled (queued/running) rows are also swept after
 *   that window, since a run that never settled in 30 days never will.
 *
 * NOT swept here: raw_events (replay source of truth — its archive policy is
 * a separate, deliberate decision) and events (customer data, soft-deleted
 * only). When partitioning lands, these become partition drops instead.
 */

const DAY_MS = 86_400_000;
/** Rows removed per table per run — bounded so the sweep stays short. */
const DELETE_BATCH = 5_000;

export type RetentionResult = { deliveryLog: number; testRuns: number };

/**
 * Wall-clock ceiling for one run, replacing the old one-batch-and-stop.
 *
 * A single 5,000-row batch per table per night is not a retention policy on a
 * table that accumulates faster than that: it falls behind by the difference,
 * every night, forever, and says nothing while doing it. Draining under a time
 * budget is bounded in the dimension that actually matters (how long the nightly
 * job may hold resources) rather than in rows, and stays safe to interrupt
 * because each batch commits on its own.
 */
const DEFAULT_BUDGET_MS = 15_000;

export async function pruneOperationalTables(
  db: DB,
  opts: { deliveryLogDays?: number; testRunDays?: number; now?: Date; budgetMs?: number } = {},
): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const deliveryCutoff = new Date(now.getTime() - (opts.deliveryLogDays ?? 30) * DAY_MS);
  const testCutoff = new Date(now.getTime() - (opts.testRunDays ?? 30) * DAY_MS);
  // Real elapsed time, not the injected `now` — `now` fixes the cutoffs for the
  // whole run and must not move while it drains.
  const end = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);

  const drain = async (
    select: (limit: number) => Promise<Array<{ id: string }>>,
    remove: (ids: string[]) => Promise<void>,
  ): Promise<number> => {
    let removed = 0;
    while (Date.now() < end) {
      const batch = await select(DELETE_BATCH);
      if (batch.length === 0) break;
      await remove(batch.map((r) => r.id));
      removed += batch.length;
      if (batch.length < DELETE_BATCH) break;
    }
    return removed;
  };

  const deliveryLogRemoved = await drain(
    (limit) => db.select({ id: deliveryLog.id }).from(deliveryLog).where(lt(deliveryLog.createdAt, deliveryCutoff)).limit(limit),
    async (ids) => void (await db.delete(deliveryLog).where(inArray(deliveryLog.id, ids))),
  );
  const testRunsRemoved = await drain(
    (limit) => db.select({ id: testRuns.id }).from(testRuns).where(lt(testRuns.createdAt, testCutoff)).limit(limit),
    async (ids) => void (await db.delete(testRuns).where(inArray(testRuns.id, ids))),
  );

  return { deliveryLog: deliveryLogRemoved, testRuns: testRunsRemoved };
}

/**
 * Settled Test runs are worthless the moment the editor has read them; this
 * tighter sweep keeps the table small between retention runs. Kept separate so
 * the retention policy above stays the single source of the 30-day guarantee.
 */
export async function pruneSettledTestRuns(db: DB, olderThanHours = 24, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanHours * 3_600_000);
  const rows = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(and(eq(testRuns.status, "ok"), lt(testRuns.updatedAt, cutoff)))
    .limit(DELETE_BATCH);
  if (rows.length === 0) return 0;
  await db.delete(testRuns).where(inArray(testRuns.id, rows.map((r) => r.id)));
  return rows.length;
}

/** Rows currently past retention (for observability / capacity planning). */
export async function retentionBacklog(db: DB, days = 30, now = new Date()): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const [dl] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deliveryLog)
    .where(lt(deliveryLog.createdAt, cutoff));
  const [tr] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(testRuns)
    .where(lt(testRuns.createdAt, cutoff));
  return { deliveryLog: Number(dl?.c ?? 0), testRuns: Number(tr?.c ?? 0) };
}
