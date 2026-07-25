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

export async function pruneOperationalTables(
  db: DB,
  opts: { deliveryLogDays?: number; testRunDays?: number; now?: Date } = {},
): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const deliveryCutoff = new Date(now.getTime() - (opts.deliveryLogDays ?? 30) * DAY_MS);
  const testCutoff = new Date(now.getTime() - (opts.testRunDays ?? 30) * DAY_MS);

  const oldDelivery = await db
    .select({ id: deliveryLog.id })
    .from(deliveryLog)
    .where(lt(deliveryLog.createdAt, deliveryCutoff))
    .limit(DELETE_BATCH);
  if (oldDelivery.length > 0) {
    await db.delete(deliveryLog).where(inArray(deliveryLog.id, oldDelivery.map((r) => r.id)));
  }

  const oldRuns = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(lt(testRuns.createdAt, testCutoff))
    .limit(DELETE_BATCH);
  if (oldRuns.length > 0) {
    await db.delete(testRuns).where(inArray(testRuns.id, oldRuns.map((r) => r.id)));
  }

  return { deliveryLog: oldDelivery.length, testRuns: oldRuns.length };
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
