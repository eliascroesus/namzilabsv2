import { and, eq, gte, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { connections, deadLetter, events, sourceStreams, usageLedger } from "@/db/schema";
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

/**
 * Consecutive restarts that mean a paged scan is not advancing.
 *
 * Mirrored from `RESTART_ALARM` in `src/connectors/calendly.ts`, which is where
 * the counter is written. Two in a row cannot be two coincidental expiries.
 */
const RESTART_ALARM = 2;

/** How long a dead-letter row may sit unresolved before it is reported. */
const DLQ_UNRESOLVED_MS = 24 * HOUR_MS;

/** Rows returned per check, so one broken deploy cannot produce an unbounded report. */
const REPORT_LIMIT = 50;

/** Window over which throttling is totalled — long enough that one bad hour doesn't report. */
const THROTTLE_WINDOW_MS = 24 * HOUR_MS;

/**
 * Denied calls in that window that mean "this budget is mis-sized", not "we
 * touched the ceiling once".
 *
 * The base sweep is every ten minutes, so a day is ~144 sweeps per stream. A
 * connection that has been denied fifty times is being refused on a large
 * fraction of its sweeps rather than clipping the limit during one burst —
 * which is the difference between backpressure working and a connection that
 * is quietly falling behind because its budget is too small.
 */
const THROTTLED_DAY = 50;

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
  /** Connections whose own budget is denying their calls on a sustained basis. */
  throttledConnections: Array<{ connectionId: string; provider: string; throttled: number; calls: number }>;
  /** Paged scans whose stored continuation keeps being refused, so they never advance. */
  restartingScans: Array<{ streamId: string; connectionId: string; source: string; restarts: number }>;
  /** True when any check found something. Lets a caller alert without re-deriving it. */
  anyFindings: boolean;
};

/**
 * A connection being refused by its own rate budget.
 *
 * This is the same shape as every other check here — something that should be
 * moving has stopped — but it is the one case where the system is doing the
 * stopping. `usage_ledger.throttled` has been incremented on every denial since
 * F.1 and read by nothing, so a connection could be having a large fraction of
 * its calls refused every night with no error anywhere: the breaker sees no
 * failure (there was no call), the stream still reports a successful poll (it
 * did poll, with less data), and `lastError` stays clean.
 *
 * Reported rather than alerted, like `emptyMirrors`: sustained throttling is
 * sometimes correct — a genuinely busy account against a small provider limit —
 * and the fix is a budget change, which is a human decision. `calls` rides
 * along because the ratio is what makes it readable; 60 denials against 6,000
 * calls is backpressure working, and against 100 is a connection crawling.
 */
async function throttledConnections(db: DB, now: Date) {
  const since = new Date(now.getTime() - THROTTLE_WINDOW_MS);
  return db
    .select({
      connectionId: usageLedger.connectionId,
      provider: usageLedger.provider,
      throttled: sql<number>`sum(${usageLedger.throttled})::int`,
      calls: sql<number>`sum(${usageLedger.calls})::int`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.windowStart, since))
    .groupBy(usageLedger.connectionId, usageLedger.provider)
    .having(sql`sum(${usageLedger.throttled}) >= ${THROTTLED_DAY}`)
    .limit(REPORT_LIMIT);
}

/**
 * A paged scan that keeps restarting, and the reason this check exists at all.
 *
 * `calendly.ts` has counted consecutive rejected continuations in its cursor
 * since the day the question was raised. It was RIGHT, it fired on every sweep
 * from the third onward, and it had been doing so on every affected connection
 * since the connector shipped — because the connector rebuilt each page request
 * from `next_page_token` and that rebuild is always refused. Nobody saw it. The
 * counter wrote to `console.warn`, `incomplete` fed the cadence ladder, and no
 * check anywhere asked whether a scan was advancing.
 *
 * That is the second time in a fortnight a counter built for one silent failure
 * turned out to be incrementing unread — `usage_ledger.throttled` was the
 * first. So the counter gets a reader.
 *
 * Cheap because the count is already persisted: it rides in the cursor JSON on
 * the stream row, so this is a `LIKE` over `source_streams` and no new column.
 * After the fix the expected value everywhere is zero, which is what makes a
 * nonzero one worth printing.
 */
async function restartingScans(db: DB) {
  const rows = await db
    .select({
      streamId: sourceStreams.id,
      connectionId: sourceStreams.connectionId,
      source: connections.source,
      cursor: sourceStreams.cursor,
    })
    .from(sourceStreams)
    .innerJoin(connections, eq(connections.id, sourceStreams.connectionId))
    .where(and(eq(connections.status, "active"), isNull(connections.disabledAt), like(sourceStreams.cursor, '%"restarts"%')))
    .limit(REPORT_LIMIT * 4);

  return rows
    .flatMap((r) => {
      // Parsed rather than pattern-matched out of the JSON: the threshold is a
      // number comparison, and a cursor this cannot read is not a finding.
      try {
        const n = (JSON.parse(r.cursor ?? "") as { restarts?: unknown }).restarts;
        if (typeof n !== "number" || n < RESTART_ALARM) return [];
        return [{ streamId: r.streamId, connectionId: r.connectionId, source: r.source, restarts: n }];
      } catch {
        return [];
      }
    })
    .slice(0, REPORT_LIMIT);
}

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
  // EXACTLY FOUR CONCURRENT READS HERE. `MIN_POOL_MAX` in `src/db/client.ts` is
  // derived from this call site — "4 concurrent reads + 1 transaction + 1
  // spare" — and a pool below that floor DEADLOCKS rather than degrades, so a
  // fifth entry in this array silently invalidates the derivation and the
  // symptom is a hung nightly job, not a slow one. New checks go sequentially
  // below, which is why `throttledConnections` is not in here.
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

  // Sequential from here, and deliberately so — see the note on the Promise.all
  // above. These two are cheap aggregates; the cost of running them one after
  // another is a round trip, and the cost of getting the pool floor wrong is a
  // nightly job that hangs instead of reporting.
  const [dlq] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deadLetter)
    .where(and(isNull(deadLetter.resolvedAt), lt(deadLetter.createdAt, new Date(now.getTime() - DLQ_UNRESOLVED_MS))));

  const throttled = await throttledConnections(db, now);
  const stalledScans = await restartingScans(db);

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
    throttledConnections: throttled,
    restartingScans: stalledScans,
  };
  return {
    ...report,
    anyFindings:
      report.unsweptStreams.length > 0 ||
      report.failingConnections.length > 0 ||
      report.stalledBackfills.length > 0 ||
      report.unresolvedDeadLetters > 0 ||
      report.emptyMirrors.length > 0 ||
      report.throttledConnections.length > 0 ||
      report.restartingScans.length > 0,
  };
}
