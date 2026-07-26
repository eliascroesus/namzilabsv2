import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { connections, events } from "@/db/schema";
import type { DB } from "@/db/types";
import { isStreamScoped } from "@/connectors/catalog";

/**
 * ONE-TIME legacy-row reconciliation (the P5 gate).
 *
 * The pre-unification writer left two kinds of rows that today's machinery
 * cannot retire:
 *
 *   (a) poll-managed rows on STREAM-SCOPED connections with `stream_hash IS
 *       NULL` — written before events carried stream identity. The full-resync
 *       delete is scoped to the hashes it re-polled, and mirror sweeps delete
 *       within a stream, so nothing ever revisits these. They are ghosts: rows
 *       whose source resource may be long gone, still counted by any read that
 *       isn't stream-filtered (whole-connection Get-data steps, classic
 *       metrics).
 *   (b) stream rows stamped at generation 0 — already handled, structurally,
 *       by the scoped delete (it keys on stream_hash, not generation), so they
 *       are NOT this script's business.
 *
 * This script retires exactly (a).
 *
 * What it must NEVER touch:
 * - rows on CONNECTION-SCOPED connections (Close, Instantly, Sendblue, custom
 *   webhook). There, `stream_hash IS NULL` is the CORRECT steady state for
 *   every row — poll-managed and webhook alike. Deleting those would erase
 *   live customer data.
 * - generation-0 rows anywhere: the append-only webhook class, never swept.
 * - rows already soft-deleted (which is what makes re-running safe).
 *
 * Idempotent by construction: it only ever matches rows with `deleted_at IS
 * NULL`, so a second run — or a resumed interrupted run — finds nothing left.
 */

/** Rows retired per batch, so one statement can't lock the table for long. */
const BATCH = 2_000;

export type LegacyReconciliationReport = {
  /** Connections whose source is stream-scoped (the only ones in scope). */
  streamScopedConnections: number;
  /** Legacy ghost rows found (gen >= 1, null stream_hash, still live). */
  candidates: number;
  /** Rows actually tombstoned (0 in dry-run). */
  tombstoned: number;
  dryRun: boolean;
};

/** The connections this reconciliation applies to. */
async function streamScopedConnectionIds(db: DB): Promise<string[]> {
  const rows = await db.select({ id: connections.id, source: connections.source }).from(connections);
  return rows.filter((r) => isStreamScoped(r.source)).map((r) => r.id);
}

/** The WHERE that defines a legacy ghost row, in one place. */
function ghostRowCondition(connectionIds: string[]) {
  return and(
    inArray(events.connectionId, connectionIds),
    gte(events.syncGeneration, 1), // poll-managed, never the webhook class
    isNull(events.streamHash), // pre-unification: no stream identity
    isNull(events.deletedAt), // already-retired rows are left alone (idempotency)
  );
}

/**
 * Report what the reconciliation WOULD do (no writes). Run this first.
 */
export async function inspectLegacyRows(db: DB): Promise<LegacyReconciliationReport> {
  const ids = await streamScopedConnectionIds(db);
  if (ids.length === 0) return { streamScopedConnections: 0, candidates: 0, tombstoned: 0, dryRun: true };
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(events)
    .where(ghostRowCondition(ids));
  return { streamScopedConnections: ids.length, candidates: Number(row?.c ?? 0), tombstoned: 0, dryRun: true };
}

/**
 * Retire the legacy ghost rows. Safe to re-run (idempotent) and safe to
 * interrupt (batched, each batch commits on its own).
 */
export async function reconcileLegacyRows(db: DB, opts: { dryRun?: boolean } = {}): Promise<LegacyReconciliationReport> {
  const dryRun = opts.dryRun ?? false;
  const report = await inspectLegacyRows(db);
  if (dryRun || report.candidates === 0) return { ...report, dryRun };

  const ids = await streamScopedConnectionIds(db);
  let tombstoned = 0;
  for (;;) {
    const batch = await db
      .select({ id: events.id })
      .from(events)
      .where(ghostRowCondition(ids))
      .limit(BATCH);
    if (batch.length === 0) break;
    const done = await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(
        inArray(
          events.id,
          batch.map((r) => r.id),
        ),
      )
      .returning({ id: events.id });
    tombstoned += done.length;
    if (batch.length < BATCH) break;
  }
  return { ...report, tombstoned, dryRun: false };
}

/** Per-connection breakdown, for the operator to eyeball before applying. */
export async function legacyRowsByConnection(
  db: DB,
): Promise<Array<{ connectionId: string; source: string; name: string; rows: number }>> {
  const conns = await db
    .select({ id: connections.id, source: connections.source, name: connections.name })
    .from(connections);
  const scoped = conns.filter((c) => isStreamScoped(c.source));
  const out: Array<{ connectionId: string; source: string; name: string; rows: number }> = [];
  for (const c of scoped) {
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.connectionId, c.id),
          gte(events.syncGeneration, 1),
          isNull(events.streamHash),
          isNull(events.deletedAt),
        ),
      );
    const rows = Number(row?.c ?? 0);
    if (rows > 0) out.push({ connectionId: c.id, source: c.source, name: c.name, rows });
  }
  return out.sort((a, b) => b.rows - a.rows);
}
