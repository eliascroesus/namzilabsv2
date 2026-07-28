import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import {
  connectionArchive,
  connections,
  deadLetter,
  events,
  rawEvents,
  sourceStreams,
  streamFields,
  syncState,
  usageLedger,
} from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * Phase 2B — the only path in this product that destroys customer data.
 *
 * Everything else is a soft delete: `deleted_at` takes rows out of circulation
 * and `upsertEvents` can clear it again. This hard-deletes, so every guard here
 * is load-bearing rather than defensive habit.
 *
 * THE CLOCK IS `disabled_at`, NEVER `status`. A connection disabled a minute
 * ago and one disabled two months ago look identical without it, and `status`
 * alone would let a mis-click destroy a live customer's history immediately.
 * Every stage below re-checks the age itself; none trusts a caller's list.
 *
 * Three independent passes, deliberately not one:
 *
 *  - **Day 30, disabled** — the bulk. Archive what the connection held, then
 *    hard-delete its events and raw payloads. The connection row, its streams
 *    and its config survive, so reconnecting still works; it just re-imports
 *    from the provider instead of restoring in place.
 *  - **Day 60, disabled** — the remainder: the connection row, its streams, and
 *    the five tables that leak because none has a foreign key to `connections`.
 *  - **Tombstones on LIVE connections** — rows soft-deleted more than 30 days
 *    ago on a connection that is still active. Nothing archives here: the
 *    connection is alive and its current data is intact.
 */

const DAY_MS = 86_400_000;

/**
 * How long a disconnected connection keeps its data, and then its identity.
 *
 * Sixty is deliberately double thirty rather than a second arbitrary number: it
 * gives someone who reconnects between the two a working integration with a
 * gap, which is a recoverable state, instead of an integration that silently
 * became a new one.
 */
export const PURGE_EVENTS_AFTER_DAYS = 30;
export const PURGE_CONNECTION_AFTER_DAYS = 60;

/**
 * How long a tombstone survives on a LIVE connection.
 *
 * It has to exceed the longest window any retire path can re-cover, because
 * `upsertEvents` clears `deleted_at` when a record reappears — purge sooner and
 * a legitimate resurrection turns into a duplicate insert instead of a restore.
 * Calendly's window is the widest at 30 days back / 90 forward (a meeting 100
 * days out is tombstoned and re-enters the window within 10), and Close's
 * overlap is five minutes. Thirty days clears every one of them.
 */
export const PURGE_TOMBSTONES_AFTER_DAYS = 30;

/** Rows removed per statement, so one delete can never lock a hot table. */
const BATCH = 5_000;

/**
 * Wall-clock ceiling for one run.
 *
 * The old `pruneOperationalTables` did exactly one batch per table per night
 * with no loop, so a table accumulating faster than 5,000 rows a day could
 * never be caught up — it fell behind permanently and silently. Draining under
 * a time budget fixes that in the only way that also stays safe to interrupt:
 * every batch commits on its own, so stopping early is a resumable state, not a
 * partial one.
 */
const DEFAULT_BUDGET_MS = 20_000;

export type PurgeReport = {
  dryRun: boolean;
  /** Connections archived and stripped of data at day 30. */
  eventsPurged: Array<{ connectionId: string; source: string; events: number; rawEvents: number }>;
  /** Connections removed outright at day 60. */
  connectionsRemoved: Array<{ connectionId: string; source: string; rows: Record<string, number> }>;
  /** Expired tombstones removed from live connections. */
  tombstonesPurged: number;
  /**
   * What this run did NOT get to. Non-zero means the budget ran out, which is
   * normal on a big first run and a problem only if it never reaches zero.
   */
  backlog: { events: number; rawEvents: number; tombstones: number };
  /** True when the run stopped on its time budget rather than on empty. */
  hitBudget: boolean;
};

type Deadline = { readonly expired: boolean };

function deadline(budgetMs: number): Deadline {
  // Anchored to REAL time, not to the caller's `now`. Those are different
  // clocks and conflating them is silent: `now` is the logical instant the
  // cutoffs are computed from (a test pins it, a backfill may set it in the
  // past), while the budget measures how long this run may actually hold
  // resources. Deriving the deadline from `now` makes a run with a past `now`
  // expire before its first batch — a purge that reports success having done
  // nothing.
  const end = Date.now() + budgetMs;
  return {
    get expired() {
      return Date.now() >= end;
    },
  };
}

/** An aggregate's timestamp, whichever shape the driver handed back. */
function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Delete in bounded batches until empty or out of time. Returns rows removed. */
async function drain(
  db: DB,
  select: (limit: number) => Promise<Array<{ id: string }>>,
  remove: (ids: string[]) => Promise<void>,
  clock: Deadline,
): Promise<number> {
  let removed = 0;
  while (!clock.expired) {
    const batch = await select(BATCH);
    if (batch.length === 0) break;
    await remove(batch.map((r) => r.id));
    removed += batch.length;
    if (batch.length < BATCH) break;
  }
  return removed;
}

/** Connections disabled longer than `days`. The age check lives here, once. */
async function disabledLongerThan(db: DB, days: number, now: Date) {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return db
    .select({
      id: connections.id,
      orgId: connections.orgId,
      source: connections.source,
      name: connections.name,
      config: connections.config,
      disabledAt: connections.disabledAt,
    })
    .from(connections)
    .where(
      and(
        // Both, always. `status` says the user disconnected it; `disabled_at`
        // says how long ago. Either alone is a way to delete live data.
        eq(connections.status, "disabled"),
        isNotNull(connections.disabledAt),
        lt(connections.disabledAt, cutoff),
      ),
    );
}

/**
 * Write down what a connection held, before its rows are destroyed.
 *
 * Runs BEFORE the delete and is idempotent on the unique index, so an
 * interrupted run resumes without writing a second archive — and, more
 * importantly, can never delete data it has not yet described.
 */
async function archiveConnection(
  db: DB,
  conn: { id: string; orgId: string; source: string; name: string; config: Record<string, unknown>; disabledAt: Date | null },
): Promise<{ events: number; rawEvents: number }> {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // Typed as unknown and coerced below, deliberately. `sql<Date>` is an
      // assertion, not a conversion: an aggregate comes back as a STRING from
      // both drivers, and handing that to a timestamp column throws at insert
      // time — inside the archive step, which runs immediately before a
      // hard delete. Wrong here means data destroyed with nothing describing it.
      oldest: sql<unknown>`min(${events.occurredAt})`,
      newest: sql<unknown>`max(${events.occurredAt})`,
    })
    .from(events)
    .where(eq(events.connectionId, conn.id));
  const [raw] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(rawEvents)
    .where(eq(rawEvents.connectionId, conn.id));
  const streams = await db
    .select({ hash: sourceStreams.configHash })
    .from(sourceStreams)
    .where(eq(sourceStreams.connectionId, conn.id));

  const eventCount = Number(counts?.total ?? 0);
  const rawEventCount = Number(raw?.total ?? 0);
  await db
    .insert(connectionArchive)
    .values({
      orgId: conn.orgId,
      connectionId: conn.id,
      source: conn.source,
      name: conn.name,
      config: conn.config ?? {},
      streamHashes: streams.map((s) => s.hash),
      eventCount,
      rawEventCount,
      oldestOccurredAt: asDate(counts?.oldest),
      newestOccurredAt: asDate(counts?.newest),
      disabledAt: conn.disabledAt,
    })
    .onConflictDoNothing({ target: connectionArchive.connectionId });
  return { events: eventCount, rawEvents: rawEventCount };
}

/**
 * The whole retention pass. `apply` defaults to false: this counts what it
 * WOULD destroy and writes nothing, which is the only sane default for the one
 * function here that cannot be undone.
 */
export async function purgeRetiredData(
  db: DB,
  opts: { apply?: boolean; now?: Date; budgetMs?: number } = {},
): Promise<PurgeReport> {
  const now = opts.now ?? new Date();
  const dryRun = !opts.apply;
  const clock = deadline(opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const report: PurgeReport = {
    dryRun,
    eventsPurged: [],
    connectionsRemoved: [],
    tombstonesPurged: 0,
    backlog: { events: 0, rawEvents: 0, tombstones: 0 },
    hitBudget: false,
  };

  // ---- Day 30: archive, then shed the bulk. ----------------------------------
  for (const conn of await disabledLongerThan(db, PURGE_EVENTS_AFTER_DAYS, now)) {
    if (clock.expired) break;
    if (dryRun) {
      const [e] = await db.select({ c: sql<number>`count(*)::int` }).from(events).where(eq(events.connectionId, conn.id));
      const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(rawEvents).where(eq(rawEvents.connectionId, conn.id));
      if (Number(e?.c ?? 0) + Number(r?.c ?? 0) > 0) {
        report.eventsPurged.push({ connectionId: conn.id, source: conn.source, events: Number(e?.c ?? 0), rawEvents: Number(r?.c ?? 0) });
      }
      continue;
    }
    // Archive FIRST. A crash between these two leaves an archive with the data
    // still present, which the next run reconciles; the reverse would destroy
    // rows nothing describes.
    await archiveConnection(db, { ...conn, config: conn.config ?? {} });
    const purgedEvents = await drain(
      db,
      (limit) => db.select({ id: events.id }).from(events).where(eq(events.connectionId, conn.id)).limit(limit),
      async (ids) => void (await db.delete(events).where(inArray(events.id, ids))),
      clock,
    );
    const purgedRaw = await drain(
      db,
      (limit) => db.select({ id: rawEvents.id }).from(rawEvents).where(eq(rawEvents.connectionId, conn.id)).limit(limit),
      async (ids) => void (await db.delete(rawEvents).where(inArray(rawEvents.id, ids))),
      clock,
    );
    if (purgedEvents + purgedRaw > 0) {
      report.eventsPurged.push({ connectionId: conn.id, source: conn.source, events: purgedEvents, rawEvents: purgedRaw });
    }
  }

  // ---- Day 60: the identity, and the five tables that leak. ------------------
  for (const conn of await disabledLongerThan(db, PURGE_CONNECTION_AFTER_DAYS, now)) {
    if (clock.expired) break;
    if (dryRun) {
      report.connectionsRemoved.push({ connectionId: conn.id, source: conn.source, rows: {} });
      continue;
    }
    // None of these has a foreign key to `connections`, which is exactly why
    // they leaked: deleting the connection row never touched them.
    const rows: Record<string, number> = {};
    rows.source_streams = (await db.delete(sourceStreams).where(eq(sourceStreams.connectionId, conn.id)).returning({ id: sourceStreams.id })).length;
    rows.sync_state = (await db.delete(syncState).where(eq(syncState.connectionId, conn.id)).returning({ id: syncState.connectionId })).length;
    rows.usage_ledger = (await db.delete(usageLedger).where(eq(usageLedger.connectionId, conn.id)).returning({ id: usageLedger.id })).length;
    rows.dead_letter = (await db.delete(deadLetter).where(eq(deadLetter.connectionId, conn.id)).returning({ id: deadLetter.id })).length;
    rows.stream_fields = (await db.delete(streamFields).where(eq(streamFields.connectionId, conn.id)).returning({ id: streamFields.id })).length;
    // Anything the day-30 pass could not finish. Deleting the connection while
    // its events survive would strand them: no connection means no UI to find
    // them from and no later pass that looks for them.
    rows.events = (await db.delete(events).where(eq(events.connectionId, conn.id)).returning({ id: events.id })).length;
    rows.raw_events = (await db.delete(rawEvents).where(eq(rawEvents.connectionId, conn.id)).returning({ id: rawEvents.id })).length;
    rows.connections = (await db.delete(connections).where(eq(connections.id, conn.id)).returning({ id: connections.id })).length;
    report.connectionsRemoved.push({ connectionId: conn.id, source: conn.source, rows });
  }

  // ---- Expired tombstones on connections that are still LIVE. ----------------
  const tombstoneCutoff = new Date(now.getTime() - PURGE_TOMBSTONES_AFTER_DAYS * DAY_MS);
  // Disabled connections are excluded on purpose: their rows belong to the
  // staged passes above, which archive before deleting. Reaching them here
  // would destroy the data before anything had described it.
  const liveConnectionIds = (
    await db.select({ id: connections.id }).from(connections).where(ne(connections.status, "disabled"))
  ).map((c) => c.id);
  const expiredTombstones = (limit: number) =>
    db
      .select({ id: events.id })
      .from(events)
      .where(and(isNotNull(events.deletedAt), lt(events.deletedAt, tombstoneCutoff), inArray(events.connectionId, liveConnectionIds)))
      .limit(limit);

  if (liveConnectionIds.length > 0) {
    if (dryRun) {
      const [c] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(events)
        .where(and(isNotNull(events.deletedAt), lt(events.deletedAt, tombstoneCutoff), inArray(events.connectionId, liveConnectionIds)));
      report.tombstonesPurged = Number(c?.c ?? 0);
    } else {
      report.tombstonesPurged = await drain(
        db,
        expiredTombstones,
        async (ids) => void (await db.delete(events).where(inArray(events.id, ids))),
        clock,
      );
    }
  }

  report.hitBudget = clock.expired;
  if (!dryRun) report.backlog = await purgeBacklog(db, now);
  return report;
}

/**
 * What is still owed, after a run. Non-zero is normal on a large first pass;
 * non-zero that never falls is the signal the plan asked to be visible — the
 * old sweep could fall permanently behind and say nothing.
 */
export async function purgeBacklog(db: DB, now = new Date()): Promise<PurgeReport["backlog"]> {
  const stale = await disabledLongerThan(db, PURGE_EVENTS_AFTER_DAYS, now);
  const ids = stale.map((c) => c.id);
  const count = async (q: Promise<Array<{ c: number }>>) => Number((await q)[0]?.c ?? 0);

  const eventsOwed = ids.length
    ? await count(db.select({ c: sql<number>`count(*)::int` }).from(events).where(inArray(events.connectionId, ids)))
    : 0;
  const rawOwed = ids.length
    ? await count(db.select({ c: sql<number>`count(*)::int` }).from(rawEvents).where(inArray(rawEvents.connectionId, ids)))
    : 0;

  const cutoff = new Date(now.getTime() - PURGE_TOMBSTONES_AFTER_DAYS * DAY_MS);
  const liveIds = (await db.select({ id: connections.id }).from(connections).where(ne(connections.status, "disabled"))).map((c) => c.id);
  const tombstones = liveIds.length
    ? await count(
        db
          .select({ c: sql<number>`count(*)::int` })
          .from(events)
          .where(and(isNotNull(events.deletedAt), lt(events.deletedAt, cutoff), inArray(events.connectionId, liveIds))),
      )
    : 0;

  return { events: eventsOwed, rawEvents: rawOwed, tombstones };
}
