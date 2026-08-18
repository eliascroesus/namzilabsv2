import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { connections, events, sourceStreams, syncState, rawEvents } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped, isMirrorSource } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { processRawEvent, upsertEvents } from "@/ingestion/pipeline";
import {
  activeStreams,
  firstSeenByEventId,
  importProgressNote,
  restampRecords,
  syncStream,
  SWEEP_MAX_PAGES,
  SYNC_BUDGET_MS,
  type PrimeStreamResult,
  type SyncBudget,
} from "@/lib/sync/streams";
import { awaitConnectionSyncLock, releaseConnectionSyncLock, tryConnectionSyncLock } from "@/lib/sync/locks";
import { applyObservedRateLimit, claimCalls, isPaused, recordObservedLimit, settlePollCalls } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import type { CanonicalEvent, Connector, PollArgs, ImportCoverage } from "@/connectors/types";

const PAGE_CAP = 200;

/** The stream row's own shape, so the dating state travels back in its stored form. */
type StreamRow = typeof sourceStreams.$inferSelect;

export type SyncMode = "full" | "incremental";
export type SyncResult = {
  mode: SyncMode;
  polled: boolean;
  /** Records processed this run (insert + update + unchanged). */
  upserted: number;
  /** New rows this run. */
  inserted: number;
  /** Existing rows whose content actually changed this run. */
  updated: number;
  softDeleted: number;
  generation: number;
  orgId: string;
  source: string;
  /**
   * Another writer held this connection, so this run did nothing. Distinct from
   * a run that polled and found nothing: `polled` is false and every count is
   * zero, so downstream staleness marking correctly stays quiet either way.
   */
  skipped?: boolean;
  /**
   * The source says it has more to fetch — it stopped on its own page budget,
   * not on the end of the data.
   *
   * Connection-scoped sources have no page loop in the runner (`connector.poll`
   * is called exactly once), so this is the ONLY channel by which Close or
   * Close can say "still importing". Without it a new account watched a
   * number climb for a day with nothing to explain it.
   */
  incomplete?: boolean;
  /** How far back the import has reached vs how far it is aiming, when reported. */
  importProgress?: ImportCoverage;
};

/** Did this run change what dashboards would show? (drives staleness) */
export function syncChanged(r: Pick<SyncResult, "inserted" | "updated" | "softDeleted">): boolean {
  return r.inserted + r.updated + r.softDeleted > 0;
}

/**
 * Sync a connection's data.
 *
 * Generation model (no extra column needed):
 * - `syncGeneration = 0` marks append-only / webhook-captured rows — NEVER soft-deleted.
 * - Poll/backfill/full-resync rows are tagged with generation >= 1.
 * - A FULL re-sync bumps to generation N, upserts every polled record at N (working
 *   data stays live the whole time), and only AFTER that succeeds soft-deletes
 *   poll-managed rows still at an older generation (records removed upstream).
 */
export async function runSync(db: DB, connectionId: string, mode: SyncMode): Promise<SyncResult> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new Error(`connection ${connectionId} not found`);

  const connector = getConnector(conn.source);
  if (!connector?.poll) {
    // Webhook-only source: nothing to poll.
    await db.update(connections).set({ syncStatus: "live", updatedAt: new Date() }).where(eq(connections.id, connectionId));
    return { mode, polled: false, upserted: 0, inserted: 0, updated: 0, softDeleted: 0, generation: conn.syncGeneration, orgId: conn.orgId, source: conn.source };
  }

  /**
   * C.1 — one sync per connection, across every entry point.
   *
   * Inngest's per-connection keys are the first-line serializer but cannot
   * cover this on their own: `singleton`/`concurrency` scope PER FUNCTION, so
   * `sync-connection` and `reconcile-one-connection` never see each other, and
   * the inline Test path (`primeConnection`) does not go through Inngest at
   * all. The lease is the one guard all three share.
   *
   * Taken BEFORE the `importing` status write: a skipped run must leave no
   * trace, least of all a status the winning writer then has to correct.
   */
  const lock = await tryConnectionSyncLock(db, connectionId);
  if (!lock) {
    return {
      mode, polled: false, upserted: 0, inserted: 0, updated: 0, softDeleted: 0,
      generation: conn.syncGeneration, orgId: conn.orgId, source: conn.source, skipped: true,
    };
  }

  await db.update(connections).set({ syncStatus: "importing", updatedAt: new Date() }).where(eq(connections.id, connectionId));

  try {
    // Stream-scoped sources (Sheets, Calendar): the connection is auth-only; each
    // flow-configured resource is its own stream with its own cursor.
    if (isStreamScoped(conn.source)) return await runStreamSync(db, conn, mode);

    const credentials = await getConnectionCredentials(db, conn);
    const meta = { orgId: conn.orgId, connectionId: conn.id, source: conn.source };
    const base: PollArgs = { connectionId: conn.id, cursor: null, credentials, config: conn.config ?? undefined };

    if (mode === "full") {
      const gen = Math.max(1, (conn.syncGeneration ?? 0) + 1);
      const { records, cursor, complete, deferred } = await pollAll(db, conn, connector, base);
      const res = await upsertEvents(db, { ...meta, generation: gen }, records);

      /**
       * ABSENCE LICENSES DELETION ONLY WHERE THE READ WAS OF THE WHOLE RESOURCE,
       * and on this path it never is.
       *
       * The delete is scoped by connection and by generation, and by nothing
       * else — no date, no window. It was gated on `complete`, which
       * distinguishes a truncated walk from a finished one and nothing more. Two
       * ways that is not enough, both live:
       *
       * COMPLETION WITH NOTHING. `pollAll` sets `complete` when `nextCursor` is
       * null, and Close's drained branch passes `{hw: maxSeen ?? hw, …}` with no
       * `floor` key, so `serializeCloseCursor` falls through to `maxSeen ?? hw` —
       * both null on a fresh walk that returned zero records. So a full re-sync
       * of a Close workspace with no Event Log activity in thirty days reported a
       * complete walk of nothing and tombstoned the connection's entire history.
       * Instantly's serializer has the identical shape. This is `ebc1ec3` through
       * a different door: `complete` separates truncation from completion, not
       * completion-with-data from completion-with-nothing, and an empty read
       * means NOTHING WAS READ rather than everything was deleted — the same rule
       * the mirror path already enforces with `unchanged`.
       *
       * COMPLETION WITH A WINDOW. Worse, because it needs no edge case. Close's
       * Event Log retains thirty days, so a completed walk covers thirty days of
       * a database that may hold years. Every older row stays at the previous
       * generation and is tombstoned — a full re-sync of any mature Close
       * connection deleting all history older than the provider's retention,
       * from a button labelled "rebuild this dataset safely".
       *
       * Both come from the same missing idea: this walk reads a WINDOW, and
       * "not seen this run" cannot mean "gone from the source" unless the run
       * saw everything that should exist. That is exactly what a mirror does and
       * exactly what an incremental source does not — and it is the distinction
       * `mirrorScope` and `retireOutsideWindow` already draw for the stream path,
       * where a connector must DECLARE the span inside which absence means
       * deletion. Neither connection-scoped connector declares one, and `pollAll`
       * discards those fields anyway.
       *
       * So the retire runs for mirror-class sources only. No connection-scoped
       * source is one today (Close and Instantly are both incremental), which
       * makes this branch unreachable — and that is the honest outcome rather
       * than a regression: the only conditions under which it fired were the two
       * above. A connection-scoped mirror added later gets the behaviour it can
       * actually support.
       */
      const del = complete && isMirrorSource(conn.source)
        ? await db
            .update(events)
            .set({ deletedAt: new Date() })
            .where(and(eq(events.connectionId, conn.id), gte(events.syncGeneration, 1), lt(events.syncGeneration, gen), isNull(events.deletedAt)))
            .returning({ id: events.id })
        : [];

      await db
        .update(connections)
        .set({ syncGeneration: gen, syncStatus: "live", historicalSyncedAt: new Date(), lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(connections.id, conn.id));
      await upsertCursor(db, conn.id, cursor);

      return {
        mode: "full", polled: true, upserted: res.total, inserted: res.inserted, updated: res.updated,
        softDeleted: del.length, generation: gen, orgId: conn.orgId, source: conn.source,
        // A budget-denied walk is a truncated walk: more to fetch, retire
        // already withheld by `complete` staying false. Saying so keeps the
        // cadence from tiering the connection down mid-import.
        ...(deferred ? { incomplete: true } : {}),
      };
    }

    // incremental: fetch from the stored cursor, additive (no soft-delete).
    const gen = Math.max(1, conn.syncGeneration ?? 0);
    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, conn.id)).limit(1);
    const { records, nextCursor, incomplete, importProgress } = await connector.poll({ ...base, cursor: state?.cursor ?? null });
    const res = await upsertEvents(db, { ...meta, generation: gen }, records);
    await db
      .update(connections)
      .set({ syncStatus: "live", lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    await upsertCursor(db, conn.id, nextCursor);

    return { mode: "incremental", polled: true, upserted: res.total, inserted: res.inserted, updated: res.updated, softDeleted: 0, generation: gen, orgId: conn.orgId, source: conn.source, incomplete, importProgress };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(connections).set({ syncStatus: "error", lastError: message, updatedAt: new Date() }).where(eq(connections.id, connectionId));
    throw e;
  } finally {
    // A failed sync must not hold the connection for the rest of the TTL.
    await releaseConnectionSyncLock(db, connectionId, lock.token);
  }
}

type ConnRow = typeof connections.$inferSelect;

/**
 * Full / incremental sync for a stream-scoped connection: every flow-configured
 * resource (stream) is polled with its own cursor. A full re-sync repolls each
 * stream from the start at a new generation, then soft-deletes poll-managed rows
 * the run no longer saw — including rows of streams no flow references anymore.
 */
async function runStreamSync(db: DB, conn: ConnRow, mode: SyncMode): Promise<SyncResult> {
  const connector = getConnector(conn.source)!;
  const streams = (await activeStreams(db, conn.id)).filter((s) => s.status !== "disabled");
  // One wall-clock budget for this sync-unit, same as the sweep's (O1).
  const nowMs = Date.now;
  const budget: SyncBudget = { deadlineMs: nowMs() + SYNC_BUDGET_MS, nowMs };

  if (mode === "incremental") {
    let inserted = 0;
    let updated = 0;
    let softDeleted = 0;
    let upserted = 0;
    let incomplete = false;
    for (const stream of streams) {
      if (budget.nowMs() >= budget.deadlineMs) {
        // Out of clock: honest truncation, LRU ordering resumes the tail.
        incomplete = true;
        break;
      }
      try {
        const r = await syncStream(db, conn, stream, SWEEP_MAX_PAGES, "background", budget);
        inserted += r.inserted;
        updated += r.updated;
        softDeleted += r.softDeleted;
        upserted += r.inserted + r.updated + r.deduped;
        if (r.incomplete) incomplete = true;
      } catch {
        // Recorded on the stream row; other streams keep syncing.
      }
    }
    await db
      .update(connections)
      .set({ syncStatus: "live", lastEventAt: inserted + updated > 0 ? new Date() : conn.lastEventAt, lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    return { mode, polled: streams.length > 0, upserted, inserted, updated, softDeleted, generation: Math.max(1, conn.syncGeneration ?? 0), orgId: conn.orgId, source: conn.source, incomplete };
  }

  // Full: re-poll every stream from the beginning at the next generation, then
  // remove poll-managed rows not seen this run (upstream-deleted).
  const credentials = await getConnectionCredentials(db, conn);
  const gen = Math.max(1, (conn.syncGeneration ?? 0) + 1);
  let upserted = 0;
  let inserted = 0;
  let updated = 0;
  const polledHashes: string[] = [];
  for (const stream of streams) {
    /**
     * THE STREAM'S OWN SETTINGS TRAVEL WITH THE RE-POLL. They were being dropped
     * here, and a full re-sync is the one place where dropping them destroys
     * data rather than merely producing a worse read.
     *
     * `windowFloor` is the live loss. It is how far back a stream is SUPPOSED to
     * reach when a backfill deepened it past the connector's default, and
     * Calendly's `parseCursor` reads it to set the request bound. Absent, the
     * bound falls back to the default — so a stream deepened to 90 days is
     * re-polled over 30, the older rows are never re-fetched, and the retire
     * below tombstones every row it did not see because they are still at the
     * previous generation. Deliberately-imported history, deleted by the
     * operation the user asked for to REPAIR their data, with the deletion
     * counted as ordinary cleanup.
     *
     * `dateField` corrupts rather than deletes, and it is permanent. Sheets
     * dates a row from the column nominated here; without it the connector falls
     * back to first-seen, which is the import moment. `preserveOccurredAt` is
     * true for mirrors, so rows the re-sync sees for the FIRST time are stamped
     * with the moment of the re-sync and then frozen there by every later
     * sweep — a wrong date that no amount of re-reading corrects.
     *
     * `detectDateField` carries the same answer for a stream nobody has answered
     * for, on the same terms `syncStream` uses: locked means a human decided,
     * unlocked means find one.
     *
     * `restamp` is unconditionally true here, and only here. It means "read even
     * if you believe nothing changed", and a full re-sync is exactly the caller
     * that must not be told nothing changed: it re-polls from a null cursor at a
     * NEW generation, so an `unchanged` answer returns no records while the
     * retire is looking for rows at that generation. Today the empty answer also
     * returns a non-null cursor, so the walk does not report `complete` and the
     * retire is skipped — the damage is bounded by a coincidence rather than by
     * intent, and this removes the dependence on it.
     */
    const base: PollArgs = {
      connectionId: conn.id,
      cursor: null,
      credentials,
      config: stream.config ?? undefined,
      streamHash: stream.configHash,
      windowFloor: stream.windowFloor ?? null,
      dateField: stream.dateField ?? null,
      detectDateField: !stream.dateFieldLocked,
      restamp: true,
    };
    const { records, cursor, complete, dateFieldState, undatedEventIds } = await pollAll(db, conn, connector, base);
    /**
     * THE SAME DATING RULE AS AN ORDINARY SWEEP, and it has to be, because this
     * is the path a customer reaches for when the numbers look wrong. Pinning
     * unconditionally — what this did — meant "Re-sync" re-froze every row onto
     * whatever date it already carried, so the one button that promises to fix
     * stale data was the one guaranteed not to.
     *
     * Shared helpers rather than a second copy of the rule: `restampRecords`
     * sends undated rows back to their first-seen time and leaves every dated
     * row on the column's own date, and the writer is then asked not to pin.
     */
    const usedColumn = dateFieldState?.column ?? null;
    const dates = isMirrorSource(conn.source) && usedColumn != null;
    const toWrite = dates
      ? restampRecords(
          records,
          usedColumn,
          undatedEventIds,
          undatedEventIds.size > 0 ? await firstSeenByEventId(db, conn.id, stream.configHash, undatedEventIds) : new Map(),
        )
      : records;
    const res = await upsertEvents(
      db,
      {
        orgId: conn.orgId,
        connectionId: conn.id,
        source: conn.source,
        streamHash: stream.configHash,
        generation: gen,
        preserveOccurredAt: isMirrorSource(conn.source) && !dates,
        /**
         * Same rule as the sweep: only a mirror's whole-resource read licenses
         * the registry to retire a column, and `complete` guards the truncated
         * walk — a re-sync cut short by its budget has not seen everything.
         *
         * IN PRACTICE THIS IS FALSE TODAY, deliberately left rather than
         * forced: `complete` means the connector returned a NULL cursor, and
         * Sheets — the only mirror source — always returns its Drive marker
         * instead. So a re-sync does not retire fields; the ordinary sweep
         * does, within one ten-minute cycle. The conservative direction is the
         * right one to be wrong in, and this becomes live on its own the day a
         * mirror reports a finished walk.
         */
        wholeResource: isMirrorSource(conn.source) && complete,
      },
      toWrite,
    );
    upserted += res.total;
    inserted += res.inserted;
    updated += res.updated;
    /**
     * Eligible for the retire only if THIS stream's walk reached the end. Scoped
     * per stream rather than per connection, so one truncated stream does not
     * stop the others being pruned — and does not get pruned itself on the
     * strength of a prefix.
     *
     * AND ONLY IF IT ACTUALLY READ SOMETHING, unless the read was a mirror's.
     * The distinction is the whole point rather than caution: a mirror re-reads
     * the entire resource, so an empty read genuinely means an empty resource
     * and the rows SHOULD go — that is what makes a sheet with its rows deleted
     * come out empty here. Every other class reads a bounded window, where an
     * empty result says only that the window was empty and nothing at all about
     * the rows outside it.
     *
     * Instantly is why this is not hypothetical. Its analytics streams return
     * `nextCursor: null` on every poll by construction, so `complete` is ALWAYS
     * true for them — a campaign whose analytics response comes back empty
     * tombstoned that stream's whole history on any full re-sync, with no edge
     * case required. Calendly reaches the same place whenever an account has no
     * meetings in its window.
     */
    if (complete && (isMirrorSource(conn.source) || records.length > 0)) polledHashes.push(stream.configHash);
    await db
      .update(sourceStreams)
      .set({
        cursor,
        status: "active",
        lastError: null,
        lastPolledAt: new Date(),
        updatedAt: new Date(),
        // A DATING DECISION THAT NOBODY CAN SEE IS WORSE THAN NONE, which is the
        // rule `dateFieldState` exists to enforce — so a re-sync that detected a
        // column records it, exactly as a sweep would. Without this the next
        // sweep sees "never looked", detects the same column, calls it a change
        // and restamps the rows it just wrote. Self-healing, and a whole sweep
        // of wasted work explaining itself as a correction.
        ...(dateFieldState !== undefined ? { dateFieldState } : {}),
      })
      .where(eq(sourceStreams.id, stream.id));
  }

  // Soft-delete is scoped to the streams actually re-polled THIS run. A blanket
  // connection-wide delete would tombstone rows of streams the run never read
  // (e.g. a disabled/paused stream) — cross-stream data loss, not cleanup.
  //
  // The webhook exemption here is STRUCTURAL, not numeric: webhook/instant rows
  // carry stream_hash = NULL and can never match the polled-hash scope. Rows
  // WITH a polled stream's hash are stream-managed whatever their generation —
  // including legacy generation-0 rows from the pre-unified writer — so a row
  // whose sheet row disappeared before the first new-style sweep is still
  // retired by this pass instead of lingering as a ghost.
  const del = polledHashes.length
    ? await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(events.connectionId, conn.id),
            inArray(events.streamHash, polledHashes),
            lt(events.syncGeneration, gen),
            isNull(events.deletedAt),
          ),
        )
        .returning({ id: events.id })
    : [];

  await db
    .update(connections)
    .set({ syncGeneration: gen, syncStatus: "live", historicalSyncedAt: new Date(), lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(connections.id, conn.id));

  return { mode: "full", polled: streams.length > 0, upserted, inserted, updated, softDeleted: del.length, generation: gen, orgId: conn.orgId, source: conn.source };
}

/** Re-run normalization from the immutable raw_events (no provider calls). */
export async function reprocessConnection(db: DB, orgId: string, connectionId: string): Promise<{ processed: number }> {
  const raws = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(and(eq(rawEvents.connectionId, connectionId), eq(rawEvents.orgId, orgId)));
  let processed = 0;
  for (const r of raws) {
    try {
      await processRawEvent(db, r.id);
      processed += 1;
    } catch {
      // keep going; a bad payload shouldn't stop the reprocess.
    }
  }
  await db.update(connections).set({ syncStatus: "live", updatedAt: new Date() }).where(eq(connections.id, connectionId));
  return { processed };
}

/**
 * Walk a source to exhaustion for a full re-sync, and say whether it got there.
 *
 * `complete` is what licenses the retire. A full re-sync tombstones every
 * poll-managed row the walk did not re-fetch, which is right for a record the
 * provider no longer has and catastrophic for one the walk simply never reached
 * — and those two are indistinguishable from the row.
 *
 * ONLY a null `nextCursor` counts as done. That is the connector's explicit
 * "the scan is finished" (PollResult.nextCursor: null means START OVER next
 * time). Every other exit is a PREFIX and says so:
 *
 *  - a cursor that stopped advancing is a connector that cannot go further,
 *    which is exactly what Google Calendar returns when it spends its internal
 *    page budget;
 *  - an A→B→A oscillation is a walk that is not converging;
 *  - `PAGE_CAP` is our own ceiling, and hitting it says nothing about the
 *    provider having run out of data.
 *
 * `records.length === 0` USED TO END THE WALK HERE, and that is the defect this
 * shape removes. `syncStream` deleted the same condition from its own page loop
 * and the comment beside it explains why: a connector that filters client-side
 * returns an empty page while the next one is full, and Calendly's two-sided
 * scan returns an empty PAST page for any account with no meetings in the last
 * 30 days. The walk stopped there, upserted nothing at the new generation, and
 * the retire below tombstoned every live upcoming meeting.
 *
 * F.1 — THE BUDGET IS CLAIMED PER PAGE, and this walk was the one path in the
 * system that claimed nothing at all. Up to PAGE_CAP pages of real provider
 * requests per stream — and for a connector that pages internally, several
 * requests per page (Calendar makes up to 8) — none of it visible to the
 * ledger, none of it deniable, none of it settling into the fleet bucket that
 * every Google customer shares. It fires automatically on EVERY new
 * connection (`createConnection` sends `mode: "full"`), so the largest
 * unmetered spend in the system was also the one that ran at onboarding.
 *
 * The lane is "background": a full re-sync is import-class work, not a person
 * waiting on one page, so it must never drain the interactive reserve that
 * keeps a Test responsive. A denied claim ends the walk exactly like the
 * PAGE_CAP ceiling does — `complete` stays false, so the retire that absence
 * licenses cannot run on a prefix, which is the semantics every truncated
 * walk already has (tests/resync-truncated-walk.test.ts). The next sweep
 * continues incrementally from the persisted cursor; nothing is lost.
 */
async function pollAll(
  db: DB,
  conn: ConnRow,
  connector: Connector,
  base: PollArgs,
): Promise<{
  records: CanonicalEvent[];
  cursor: string | null;
  complete: boolean;
  dateFieldState?: StreamRow["dateFieldState"];
  /**
   * Records the date column could not date, unioned across the walk the same
   * way `seen` unions the records themselves — so the caller can send exactly
   * those back to their first-seen time and let every other row take the
   * column's date.
   */
  undatedEventIds: Set<string>;
  /** The walk stopped on the provider budget, not on the data or PAGE_CAP. */
  deferred?: { reason: string; retryAfterMs: number };
}> {
  const operation = pollOperation(conn.source, base.config);
  let deferred: { reason: string; retryAfterMs: number } | undefined;
  const seen = new Map<string, CanonicalEvent>();
  let cursor: string | null = null; // full re-sync starts from the beginning
  let last: string | null = null;
  let complete = false;
  /**
   * The dating decision of the LAST page that reported one.
   *
   * Last rather than first because the counts accumulate as the walk proceeds
   * and the later answer is taken over more of the resource. `at` is stamped
   * here rather than by the connector, which does not own the clock that says
   * when a row was written — the same split `syncStream` makes.
   */
  let dateFieldState: StreamRow["dateFieldState"] | undefined;
  /**
   * Per-id and last-answer-wins, exactly like `seen`: a row re-read on a later
   * page with a parseable date must not stay marked undated by an earlier one.
   */
  const undatedEventIds = new Set<string>();
  // The full re-sync's own wall clock: PAGE_CAP bounds memory in `seen`, but
  // the honest stop for a long walk is the deadline — a walk cut short keeps
  // `complete` false, so nothing is retired on the strength of a prefix.
  const nowMs = Date.now;
  const deadlineMs = nowMs() + SYNC_BUDGET_MS;
  for (let page = 0; page < PAGE_CAP; page++) {
    if (page > 0 && nowMs() >= deadlineMs) break;
    // One claim buys ONE request; the settle below corrects for connectors
    // that page internally. Charged at the claim instant, not the settle
    // instant, so a page straddling a minute boundary cannot refund out of
    // the next window (see settlePollCalls).
    const claimedAt = new Date();
    const claim = await claimCalls(db, conn, operation, 1, claimedAt, "background");
    if (!claim.allowed) {
      deferred = { reason: claim.reason, retryAfterMs: claim.retryAfterMs };
      break;
    }
    // O1: bound the connector's internal walk BEFORE it spends.
    const res = await connector.poll!({
      ...base,
      cursor,
      budget: { maxCalls: 1 + Math.max(0, claim.remaining), deadlineMs, nowMs },
    });
    // The claim bought one call; the connector may have made several inside
    // it (Calendar walks up to 8 pages per poll). Settle so the NEXT claim —
    // and the fleet bucket every Google customer shares — sees the truth.
    await settlePollCalls(db, conn, operation, res, 1, claimedAt);
    // The provider's own account of its budget beats our declared guess:
    // record the ceiling it stated, and stop the walk if it says exhausted —
    // strictly better than discovering the limit through a 429 on page N+1.
    await recordObservedLimit(db, conn, operation, res.rateLimit, claimedAt);
    const observedPause = await applyObservedRateLimit(db, conn, res.rateLimit, claimedAt);
    const { records, nextCursor } = res;
    if (res.dateFieldState) dateFieldState = { ...res.dateFieldState, at: new Date().toISOString() };
    for (const r of records) {
      seen.set(r.eventId, r);
      if (res.undatedEventIds?.has(r.eventId)) undatedEventIds.add(r.eventId);
      else undatedEventIds.delete(r.eventId);
    }
    if (!nextCursor) {
      // null means START OVER (PollResult.nextCursor), so it is stored as null —
      // the following incremental sweep then begins a fresh scan instead of
      // resuming from a page token whose scan already completed. It is also the
      // only answer that means the source ran out of data rather than us.
      cursor = null;
      complete = true;
      break;
    }
    if (nextCursor === cursor || nextCursor === last) break; // stalled or cycling
    last = cursor;
    cursor = nextCursor;
    if (observedPause) {
      deferred = { reason: "provider reports its rate limit is spent", retryAfterMs: Math.max(1_000, observedPause.getTime() - Date.now()) };
      break;
    }
  }
  return { records: [...seen.values()], cursor, complete, dateFieldState, undatedEventIds, deferred };
}

async function upsertCursor(db: DB, connectionId: string, cursor: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ connectionId, cursor, lastPolledAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.connectionId, set: { cursor, lastPolledAt: now, updatedAt: now } });
}

/**
 * On-demand refresh for a connection that has NO per-flow resource — the
 * counterpart to `primeStream`, for sources `primeStream` cannot serve.
 *
 * Not every source is stream-scoped. Sheets picks a tab, Calendar a calendar,
 * Instantly a campaign; each has a `sourceConfig`, which is what `primeStream`
 * keys on. Close has none — the account IS the resource, so its
 * Get data step carries an empty config and `hasStreamConfig` is false.
 *
 * That gap made Test silently skip the refresh for exactly those sources: it
 * never called the provider, ran the flow against whatever storage happened to
 * hold, and printed "0 loaded — No records returned". Which is the same lie this
 * codebase keeps having to unpick. It is indistinguishable from a source that
 * genuinely is empty, and undebuggable, because the request that would have
 * failed was never made. Worse, it makes connector fixes look ineffective —
 * changing the poll cannot change a Test that does not call it.
 *
 * `runSync(…, "incremental")` is the connection-level equivalent of syncStream:
 * poll from the stored cursor, upsert, advance. The guards are deliberately the
 * same ones `primeStream` applies — paused connection, then a budget claim on
 * the interactive lane — so both kinds of source behave alike under a tripped
 * breaker or an exhausted quota.
 */
export async function primeConnection(db: DB, orgId: string, connectionId: string): Promise<PrimeStreamResult> {
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
    .limit(1);
  if (!conn) return { ok: false, error: "This step's connected account no longer exists." };
  // Stream-scoped sources go through primeStream. Webhook-only sources have
  // nothing to poll — that is their design, not a failure, so it is not a note.
  if (isStreamScoped(conn.source) || !getConnector(conn.source)?.poll) return { ok: true, refreshed: false };

  if (isPaused(conn)) {
    const when = conn.pausedUntil ? ` Retrying around ${conn.pausedUntil.toLocaleTimeString()}.` : "";
    return {
      ok: true,
      refreshed: false,
      note: `Couldn't re-read the source — syncing is paused (${conn.pausedReason ?? "provider limit"}).${when} Showing the data we already have.`,
    };
  }

  /**
   * Q6, connection scope. A Test that collides with an in-flight sync — the
   * 10-minute sweep, a "Sync now", the previous Test — AWAITS it and adopts its
   * result rather than skipping (which would show stale data) or erroring
   * (which would blame the user for good luck). Bounded, so a wedged holder
   * cannot hang the editor.
   *
   * Ahead of the budget claim, for the same reason the sweep takes its lease
   * first: a read we end up adopting rather than making should not spend a
   * provider call from the connection's quota.
   */
  const t0 = new Date();
  const waited = await awaitConnectionSyncLock(db, connectionId);
  if (waited === "free") {
    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId)).limit(1);
    if (state?.lastPolledAt != null && state.lastPolledAt.getTime() >= t0.getTime()) {
      // A sync finished while we waited, and it polled AFTER we arrived — its
      // read is the fresh data. Adopt it: refreshed, but not by us, and above
      // all not a second provider call for the same records.
      return { ok: true, refreshed: true };
    }
  }

  const claim = await claimCalls(db, conn, pollOperation(conn.source, conn.config), 1, new Date(), "interactive");
  if (!claim.allowed) {
    return {
      ok: true,
      refreshed: false,
      note: `Couldn't re-read the source — ${claim.reason.toLowerCase()}. Showing the data we already have.`,
    };
  }

  try {
    const res = await runSync(db, connectionId, "incremental");
    // The holder outlived the wait and still has the lease. Say so plainly
    // rather than implying a refresh that did not happen.
    if (res.skipped) {
      return { ok: true, refreshed: false, note: "A sync of this source is already running — showing the data we have so far." };
    }
    // Mid-import. This is the whole reason the connection path carries
    // `incomplete` at all: the numbers below are a floor, and saying so is the
    // difference between "still importing" and a number that climbs for a day
    // with no explanation.
    if (res.incomplete) return { ok: true, refreshed: true, note: importProgressNote(res.importProgress) };
    return { ok: true, refreshed: true };
  } catch (e) {
    // A provider error now reaches the user as an error, where before the Test
    // reported zero records and no reason.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
