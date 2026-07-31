import { and, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { connections, deadLetter, events, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { isMirrorSource } from "@/connectors/catalog";
import { stalledJobs } from "@/lib/backfill/jobs";

/**
 * 10(b) — the daily invariant scan. READS ONLY, and no provider calls at all.
 *
 * The failure this exists for is the one where everything looks fine. Migration
 * 0012 was skipped and `withConnectionSyncLock` threw on every sync entry point
 * for weeks while the test suite stayed green, because nothing anywhere asked
 * "is work still happening?" — it only ever asked "did this piece of work
 * succeed?", and no work was reaching the question.
 *
 * So every check here is of the shape "something that should be moving has
 * stopped", answered from stored state. None of them can be answered by the
 * thing they are watching: a stream that is never polled writes no error, a
 * backfill that is wedged still reports `running`, and a connection whose
 * failures are being retried forever looks busy.
 *
 * THE ONE FROM THE PLAN THAT IS NOT HERE, stated rather than quietly dropped:
 * "connections whose cursor has not advanced while records keep arriving".
 * Cursor history is not stored — `sync_state.cursor` holds only the current
 * value and is rewritten every poll — so there is no way to see that it stood
 * still, and inferring it from stored `occurred_at` would flag every account
 * that simply had a quiet month. Detecting it properly needs a column. The same
 * class IS caught deterministically at CI by 10(a),
 * `tests/stranding-contract.test.ts`, which drives each connector through a
 * burst larger than its page budget and asserts nothing becomes unreachable —
 * which is where the bug it was written for would have been caught.
 */

const HOUR_MS = 3_600_000;

/**
 * How long a stream may go unpolled before it is reported.
 *
 * The base sweep is ten minutes and the slowest cadence rung is measured in
 * hours, so a day is far past any legitimate backoff and far short of letting a
 * stream that has fallen out of the sweep sit unnoticed for a week.
 */
const UNSWEPT_MS = 24 * HOUR_MS;

/**
 * Consecutive failures that mean "this is not a blip".
 *
 * The breaker already maintains this counter, so the scan borrows it rather than
 * inventing a second notion of unhealthy. Five is past every transient a
 * provider throws and short of a day of retries.
 */
const FAILING_STREAK = 5;

/** How long a dead-letter row may sit unresolved before it is reported. */
const DLQ_UNRESOLVED_MS = 24 * HOUR_MS;

/** Rows returned per check, so one broken deploy cannot produce an unbounded report. */
const REPORT_LIMIT = 50;

export type InvariantReport = {
  /** Streams an active, unpaused connection has stopped polling. */
  unsweptStreams: Array<{ streamId: string; connectionId: string; source: string; lastPolledAt: Date | null }>;
  /** Connections failing on a streak the breaker is already counting. */
  failingConnections: Array<{ connectionId: string; source: string; failures: number; lastError: string | null }>;
  /** Backfills that report `running` and have not moved their checkpoint. */
  stalledBackfills: Array<{ jobId: string; streamId: string; rowsImported: number; lastProgressAt: Date | null }>;
  /** Payloads accepted at the door and never processed into `events`. */
  unresolvedDeadLetters: number;
  /** Mirror streams that have been read successfully and hold nothing. */
  emptyMirrors: Array<{ streamId: string; connectionId: string; source: string; lastPolledAt: Date | null }>;
  /** True when any check found something. Lets a caller alert without re-deriving it. */
  anyFindings: boolean;
};

/**
 * A stream that should be being polled and is not.
 *
 * Deliberately scoped to streams whose CONNECTION is healthy — active, not
 * disabled, not paused — because a paused connection not being polled is the
 * system working, and reporting it would bury the case where a stream has
 * silently fallen out of a sweep that is otherwise running fine.
 *
 * `lastPolledAt IS NULL` counts too, once the stream is old enough to have been
 * picked up: a stream created by a flow save that the sweep never visited is the
 * same failure, arriving before there is any timestamp to be stale.
 */
async function unsweptStreams(db: DB, now: Date) {
  const cutoff = new Date(now.getTime() - UNSWEPT_MS);
  return db
    .select({
      streamId: sourceStreams.id,
      connectionId: sourceStreams.connectionId,
      source: connections.source,
      lastPolledAt: sourceStreams.lastPolledAt,
    })
    .from(sourceStreams)
    .innerJoin(connections, eq(connections.id, sourceStreams.connectionId))
    .where(
      and(
        ne(sourceStreams.status, "disabled"),
        eq(connections.status, "active"),
        isNull(connections.disabledAt),
        or(isNull(connections.pausedUntil), lt(connections.pausedUntil, now)),
        or(
          lt(sourceStreams.lastPolledAt, cutoff),
          and(isNull(sourceStreams.lastPolledAt), lt(sourceStreams.createdAt, cutoff)),
        ),
      ),
    )
    .limit(REPORT_LIMIT);
}

/**
 * A mirror that has read its resource and holds nothing.
 *
 * The mirror guarantee is "stored live rows ≡ the source after every sweep", so
 * zero stored rows is a claim that the spreadsheet is empty. Sometimes true —
 * which is why this reports rather than alerts — but it is also exactly what a
 * retire that ran against the wrong scope looks like, and what a read returning
 * an empty payload looks like. Neither writes an error anywhere.
 *
 * Only for sources whose class actually makes that claim. An incremental source
 * holding no rows for a stream just means nothing has happened in its window.
 */
async function emptyMirrors(db: DB, now: Date) {
  const cutoff = new Date(now.getTime() - HOUR_MS);
  const rows = await db
    .select({
      streamId: sourceStreams.id,
      connectionId: sourceStreams.connectionId,
      source: connections.source,
      lastPolledAt: sourceStreams.lastPolledAt,
      live: sql<number>`(
        select count(*)::int from ${events}
        where ${events.connectionId} = ${sourceStreams.connectionId}
          and ${events.streamHash} = ${sourceStreams.configHash}
          and ${events.deletedAt} is null
      )`,
    })
    .from(sourceStreams)
    .innerJoin(connections, eq(connections.id, sourceStreams.connectionId))
    .where(
      and(
        eq(sourceStreams.status, "active"),
        eq(connections.status, "active"),
        isNull(connections.disabledAt),
        // Polled successfully at least once, and long enough ago that a stream
        // mid-first-sync is not reported as broken.
        lt(sourceStreams.lastPolledAt, cutoff),
      ),
    )
    .limit(REPORT_LIMIT * 4);
  return rows.filter((r) => isMirrorSource(r.source) && r.live === 0).slice(0, REPORT_LIMIT).map(({ live: _live, ...rest }) => rest);
}

export async function scanInvariants(db: DB, now = new Date()): Promise<InvariantReport> {
  const [unswept, failing, stalled, empty] = await Promise.all([
    unsweptStreams(db, now),
    db
      .select({
        connectionId: connections.id,
        source: connections.source,
        failures: connections.consecutiveFailures,
        lastError: connections.lastError,
      })
      .from(connections)
      .where(and(gte(connections.consecutiveFailures, FAILING_STREAK), isNull(connections.disabledAt)))
      .limit(REPORT_LIMIT),
    // The lane's own definition of stalled, reused rather than restated: a
    // second notion of "not progressing" would drift from the first.
    stalledJobs(db, 6 * HOUR_MS, now),
    emptyMirrors(db, now),
  ]);

  const [dlq] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deadLetter)
    .where(and(isNull(deadLetter.resolvedAt), lt(deadLetter.createdAt, new Date(now.getTime() - DLQ_UNRESOLVED_MS))));

  const report: Omit<InvariantReport, "anyFindings"> = {
    unsweptStreams: unswept,
    failingConnections: failing,
    stalledBackfills: stalled.map((j) => ({
      jobId: j.id,
      streamId: j.streamId,
      rowsImported: j.rowsImported,
      lastProgressAt: j.lastProgressAt,
    })),
    unresolvedDeadLetters: dlq?.c ?? 0,
    emptyMirrors: empty,
  };
  return {
    ...report,
    anyFindings:
      report.unsweptStreams.length > 0 ||
      report.failingConnections.length > 0 ||
      report.stalledBackfills.length > 0 ||
      report.unresolvedDeadLetters > 0 ||
      report.emptyMirrors.length > 0,
  };
}
