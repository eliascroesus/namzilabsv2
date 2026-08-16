import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { connections, events, flows, flowVersions, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import type { CanonicalEvent } from "@/connectors/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped, isMirrorSource } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
import { applyObservedRateLimit, claimCalls, isPaused, recordObservedLimit, settlePollCalls, type CallLane } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { awaitConnectionSyncLock, awaitStreamWriteLock, releaseConnectionSyncLock, tryConnectionSyncLock, withStreamWriteLock } from "./locks";
import { hasStreamConfig, normalizeStreamConfig, streamConfigHash } from "./stream-hash";
import { parseGraph, type FlowGraph } from "@/lib/flow/types";
import { defaultTargetFloor, requestBackfill, streamImportProgress } from "@/lib/backfill/jobs";

/**
 * Streams are the unit of sync for connectors whose resource is chosen per flow
 * (which spreadsheet + tab, which calendar). A connection holds only auth; each
 * flow's Get data step declares WHAT to pull (its sourceConfig). Saving a flow
 * upserts the matching stream rows here, the 10-minute reconcile sweep polls
 * every active stream with its own cursor, and events are tagged with the
 * stream's hash so each flow reads exactly the resource it configured.
 */

export type StreamRef = { connectionId: string; config: Record<string, unknown>; configHash: string };

/** The stream-scoped resources a graph's Get data steps declare. */
export function streamRefsOfGraph(graph: FlowGraph, sourceOf: (connectionId: string) => string | undefined): StreamRef[] {
  const seen = new Map<string, StreamRef>();
  for (const node of graph.nodes) {
    if (node.type !== "app") continue;
    const cfg = (node.data.config ?? {}) as { connectionId?: unknown; source?: unknown; sourceConfig?: unknown };
    const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : null;
    const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
    if (!connectionId) continue;
    const source = typeof cfg.source === "string" ? cfg.source : sourceOf(connectionId);
    if (!isStreamScoped(source) || !hasStreamConfig(sourceConfig, source)) continue;
    const configHash = streamConfigHash(sourceConfig, source);
    seen.set(`${connectionId}:${configHash}`, { connectionId, config: normalizeStreamConfig(sourceConfig, source), configHash });
  }
  return [...seen.values()];
}

/**
 * Make sure a stream row exists for every resource this graph references.
 * Idempotent (unique on connection + configHash); returns how many were new,
 * so callers can kick off a first sync for fresh resources.
 */
export async function ensureStreamsForGraph(db: DB, orgId: string, graph: FlowGraph): Promise<{ created: number }> {
  const conns = await db.select({ id: connections.id, source: connections.source }).from(connections).where(eq(connections.orgId, orgId));
  const sourceOf = (id: string) => conns.find((c) => c.id === id)?.source;
  const refs = streamRefsOfGraph(graph, sourceOf);
  let created = 0;
  for (const ref of refs) {
    const source = conns.find((c) => c.id === ref.connectionId)?.source;
    if (!source) continue; // stale/foreign connection id
    const rows = await db
      .insert(sourceStreams)
      .values({ orgId, connectionId: ref.connectionId, configHash: ref.configHash, config: ref.config })
      .onConflictDoNothing({ target: [sourceStreams.connectionId, sourceStreams.configHash] })
      .returning({ id: sourceStreams.id });
    created += rows.length;
    /**
     * A genuinely NEW stream imports its default history on its own.
     *
     * Leaving this to a button meant almost nobody got it: a customer's metrics
     * would sit on whatever the ordinary sweep had happened to accumulate since
     * they connected, with nothing saying the number was short. This is the case
     * the progress display was built for — it only makes sense if the import it
     * describes actually starts.
     *
     * Safe to run on every save because `requestBackfill` compares DEPTH: a
     * stream that already has a job reaching this far back gets nothing new, so
     * only a genuinely new stream costs anything.
     *
     * Mirrors are skipped, and not as an optimisation. A mirror re-reads its
     * whole resource on every poll; it has no lookback to deepen, so a
     * "historical import" of one is a job that can never mean anything.
     */
    if (rows.length > 0 && !isMirrorSource(source)) {
      await requestBackfill(
        db,
        { id: rows[0].id, orgId, connectionId: ref.connectionId, configHash: ref.configHash },
        source,
        defaultTargetFloor(),
      );
    }
    // A referenced stream is by definition not an orphan: undo any earlier
    // prune, so editing a step back to a previous resource resumes its sync
    // instead of leaving it permanently disabled.
    if (rows.length === 0) {
      await db
        .update(sourceStreams)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(sourceStreams.connectionId, ref.connectionId), eq(sourceStreams.configHash, ref.configHash), eq(sourceStreams.status, "disabled")));
    }
  }
  return { created };
}

/**
 * `connectionId:configHash` for every stream an org's flows currently read.
 *
 * Each flow's DRAFT graph and its CURRENTLY PUBLISHED version — not every
 * version ever published. `flow_versions` grows by a row per publish and each
 * row holds a whole graph, so reading them all made this cost scale with a
 * team's publishing history rather than with what is actually running.
 */
export async function referencedStreamKeys(
  db: DB,
  orgId: string,
  sourceOf: (connectionId: string) => string | undefined,
): Promise<Set<string>> {
  const drafts = await db.select({ graph: flows.draftGraph }).from(flows).where(eq(flows.orgId, orgId));
  const published = await db
    .select({ graph: flowVersions.graph })
    .from(flowVersions)
    .innerJoin(flows, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
    .where(eq(flows.orgId, orgId));

  const keys = new Set<string>();
  for (const { graph: raw } of [...drafts, ...published]) {
    let graph: FlowGraph;
    try {
      graph = parseGraph(raw);
    } catch {
      continue; // an unparseable graph must never license retiring live data
    }
    for (const ref of streamRefsOfGraph(graph, sourceOf)) keys.add(`${ref.connectionId}:${ref.configHash}`);
  }
  return keys;
}

/**
 * Retire the streams of an org that no flow references any more.
 *
 * A stream is created when a Get data step declares a resource and is never
 * removed when that step changes — so every edit to a stream-identity setting
 * leaves the previous one behind, still returned by `activeStreams`, still
 * polled every sweep, still spending the connection's per-minute budget on data
 * nobody can read. Calendly made that expensive and then visible: the meeting
 * type used to be part of the identity, so a few clicks through a dropdown left
 * a stream per click, each re-walking the same account.
 *
 * DISABLED, never deleted: the sweep already filters on `status`
 * (`reconcile.ts`), so this stops the cost immediately, and
 * `ensureStreamsForGraph` re-activates one the moment a flow references it
 * again.
 *
 * `retireRows` is OFF by default, and that is the important part. This runs on
 * every draft save, including the half-finished ones — a user switching scope to
 * look at something and switching back must not find their import gone. Dead
 * rows are unreadable anyway (the read is stream-scoped) and cost only storage,
 * so clearing them is a deliberate cleanup, not a side effect of typing.
 *
 * Reads the draft AND published graph of every flow in the org, because either
 * can be the one referencing a stream.
 */
export async function pruneOrphanStreams(db: DB, orgId: string, opts: { retireRows?: boolean } = {}): Promise<{ disabled: number; retired: number }> {
  const conns = await db.select({ id: connections.id, source: connections.source }).from(connections).where(eq(connections.orgId, orgId));
  if (conns.length === 0) return { disabled: 0, retired: 0 };
  const sourceOf = (id: string) => conns.find((c) => c.id === id)?.source;

  const referenced = await referencedStreamKeys(db, orgId, sourceOf);

  const all = await db
    .select({ id: sourceStreams.id, connectionId: sourceStreams.connectionId, configHash: sourceStreams.configHash, status: sourceStreams.status })
    .from(sourceStreams)
    .where(eq(sourceStreams.orgId, orgId));
  let disabled = 0;
  let retired = 0;
  for (const s of all) {
    if (s.status === "disabled" || referenced.has(`${s.connectionId}:${s.configHash}`)) continue;
    await db.update(sourceStreams).set({ status: "disabled", updatedAt: new Date() }).where(eq(sourceStreams.id, s.id));
    disabled += 1;
    if (!opts.retireRows) continue;
    const gone = await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.connectionId, s.connectionId), eq(events.streamHash, s.configHash), isNull(events.deletedAt)))
      .returning({ id: events.id });
    retired += gone.length;
  }
  return { disabled, retired };
}

export type StreamSyncResult = {
  inserted: number;
  updated: number;
  deduped: number;
  softDeleted: number;
  /**
   * The walk stopped because it ran out of its page budget, not because the
   * source ran out of data — so what was written is a PREFIX of the window, and
   * a count taken now is smaller than the truth.
   *
   * Worth carrying all the way to the user. "0 loaded" and "0 loaded so far"
   * are different claims, and a Test that cannot tell them apart is the failure
   * mode this codebase keeps having to unpick.
   */
  incomplete?: boolean;
  /**
   * This stream ended the sweep holding a provider-issued continuation that
   * expires, per `Connector.holdsContinuation`.
   *
   * Feeds the cadence, which must not widen the gap to the next sweep past the
   * continuation's life. Evaluated against the cursor that was actually
   * PERSISTED, so it is right on every exit from the walk — including the one
   * where the write-lock was contended and the previous cursor was kept, which
   * is the exit that sets no other signal at all.
   */
  heldContinuation?: boolean;
  /**
   * The occurred-at window this stream now covers, when the connector declared
   * one (`retireOutsideWindow`). Carried out so the UI can name the window in
   * plain words rather than leaving a short count looking like a bug — a
   * Calendly source reads the last 30 days plus everything upcoming BY DESIGN.
   */
  covered?: { from: Date; to: Date };
  /**
   * The walk stopped because the provider budget ran out mid-page, not because
   * the data did. Distinct from `incomplete`, which only says "more to fetch":
   * this says WHY, and carries when it resumes, so the caller can pause the
   * connection or tell the user rather than reporting a short count as final.
   */
  deferred?: { reason: string; retryAfterMs: number };
  /**
   * The PROVIDER said its quota is spent (`ratelimit-remaining: 0`), and the
   * connection has ALREADY been paused until this expiry — `applyObservedRateLimit`
   * writes the pause where it observes the header, so no caller can forget to.
   *
   * Distinct from `deferred`, and the caller must treat them oppositely.
   * `deferred` is OUR ledger denying ONE `(operation, minute)` bucket — the
   * next stream may claim from a different bucket, so the right move is to skip
   * this stream and keep going. This is the provider's own account of the
   * CREDENTIAL's remaining quota, which every stream of the connection shares —
   * polling the next stream would spend requests straight into the exhaustion
   * the header just warned about, so the right move is to stop the sweep.
   */
  observedPause?: Date;
  /**
   * 10(c) — the mirror guarantee, checked against what is stored.
   *
   * Present only when they DISAGREE. A mirror's contract is "stored live rows ≡
   * the source after every sweep", so a read that produced N distinct records
   * and left anything other than N live rows behind has broken it.
   *
   * This is the one provider count worth taking, and the only reason it is worth
   * taking is that it costs nothing: for a whole-resource mirror the read IS the
   * count, so the number is already in hand. Everywhere else a count means a
   * full pagination — the opposite of what the rate-limit work was for — which
   * is why Calendly and Close get no equivalent.
   */
  mirrorDrift?: { read: number; stored: number };
};

type StreamRow = typeof sourceStreams.$inferSelect;
type ConnRow = typeof connections.$inferSelect;

/**
 * Retire this stream's live rows that the read did not produce.
 *
 * `scope` is the window the read is complete for. With a scope, ONLY rows whose
 * occurred_at falls inside it are eligible — that is what lets a rolling window
 * self-correct without deleting the history behind it. Without one (a
 * whole-resource mirror like a spreadsheet tab), the read covered everything, so
 * everything absent is genuinely gone.
 *
 * Always scoped to the stream's own hash, so webhook rows (null hash) and other
 * streams on the same connection are untouchable either way.
 */
/**
 * Rows retired per UPDATE. Matches UPSERT_CHUNK's parameter arithmetic
 * (pipeline.ts): 500 ids per statement stays orders of magnitude under
 * Postgres's 65,535 wire-protocol bind limit.
 */
const RETIRE_CHUNK = 500;

async function retireAbsent(
  db: DB,
  conn: ConnRow,
  stream: StreamRow,
  records: { eventId: string }[],
  scope?: { from: Date; to: Date },
): Promise<number> {
  const present = records.map((r) => r.eventId);
  const scopeFilter = scope ? [gte(events.occurredAt, scope.from), lte(events.occurredAt, scope.to)] : [];
  // Nothing present: the whole (scoped) set is absent — one statement, no
  // per-row parameters, nothing to chunk.
  if (present.length === 0) {
    const gone = await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.connectionId, conn.id), eq(events.streamHash, stream.configHash), isNull(events.deletedAt), ...scopeFilter))
      .returning({ id: events.id });
    return gone.length;
  }
  /**
   * Read–diff–write, NOT one `NOT IN` statement, and NOT a chunked `NOT IN`.
   *
   * The single statement bound one parameter per present row: a 50,000-row
   * sheet was a 50,000-parameter UPDATE every sweep, and past Postgres's
   * 65,535-bind wire limit (~a 70k-row tab) the sweep hard-failed. And
   * `NOT IN` cannot be chunked — a row absent from chunk 1 but present in
   * chunk 2 would be retired by the chunk-1 pass, tombstoning live data.
   *
   * So: read the stream's live ids (an id-only scan over
   * `events_conn_stream_live_idx`, which exists for exactly this shape), diff
   * against the present set in memory, retire by PRIMARY KEY in bounded
   * chunks. Runs inside the caller's stream-write-lock, so the read and the
   * writes see one writer — the same atomicity discipline the single
   * statement had under the sweep's single-writer rule.
   */
  const live = await db
    .select({ id: events.id, eventId: events.eventId })
    .from(events)
    .where(and(eq(events.connectionId, conn.id), eq(events.streamHash, stream.configHash), isNull(events.deletedAt), ...scopeFilter));
  const presentSet = new Set(present);
  const toRetire = live.filter((r) => !presentSet.has(r.eventId)).map((r) => r.id);
  // One instant for the whole retire: rows tombstoned by one sweep should
  // carry one timestamp, not drift across chunk boundaries.
  const now = new Date();
  let gone = 0;
  for (let i = 0; i < toRetire.length; i += RETIRE_CHUNK) {
    const chunk = toRetire.slice(i, i + RETIRE_CHUNK);
    const res = await db
      .update(events)
      .set({ deletedAt: now })
      .where(and(inArray(events.id, chunk), isNull(events.deletedAt)))
      .returning({ id: events.id });
    gone += res.length;
  }
  return gone;
}

/**
 * Retire this stream's rows that fall OUTSIDE the window it now covers.
 *
 * The complement of `retireAbsent`: that one needs the read to be complete for
 * the window (so it can judge what is missing from inside it), while this one
 * judges only by the boundary — so it stays correct on a paginated source where
 * any single call sees a fraction of the data.
 *
 * Scoped to the stream's own hash like every other retire, so webhook rows (null
 * hash) and other streams on the same connection can never be caught by it.
 */
async function retireOutside(db: DB, conn: ConnRow, stream: StreamRow, window: { from: Date; to: Date }): Promise<number> {
  const gone = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(events.connectionId, conn.id),
        eq(events.streamHash, stream.configHash),
        isNull(events.deletedAt),
        or(lt(events.occurredAt, window.from), gt(events.occurredAt, window.to)),
      ),
    )
    .returning({ id: events.id });
  return gone.length;
}

/**
 * When each of this stream's stored rows was FIRST SEEN, by event id.
 *
 * `events.received_at` defaults to now on insert and appears in neither the
 * insert list nor the `onConflictDoUpdate` set (`pipeline.ts`), so no upsert and
 * no full re-sync has ever moved it. That makes it the recoverable first-seen —
 * and for every sheet row written before the date column existed it sits within
 * milliseconds of the `new Date()` that stamped `occurred_at`, so restamping a
 * row back to it returns the value it already had.
 *
 * TOMBSTONES INCLUDED, deliberately. A row deleted from the sheet and re-added
 * is resurrected by this same upsert, and its first-seen is still the day it was
 * first seen. Filtering them out would hand it `new Date()` instead — inventing
 * a fresher origin than the row has.
 *
 * ASK FOR THE IDS YOU NEED. The stream-wide form is a SEQUENTIAL SCAN of the
 * largest table in the schema, shared by every tenant: the predicate cannot say
 * `deleted_at is null` (tombstones are the point, above) and every
 * connection-leading index on `events` is partial on exactly that, so none of
 * them can serve it. That was affordable while this ran once per change of date
 * column. It is not affordable now that a row's date follows its content on
 * every sweep, because a single blank cell in the chosen column — an ordinary,
 * permanent state for something like "Closed on" — makes a caller need
 * first-seen times forever after.
 *
 * Given ids, this probes the unique index on `event_id` instead, in chunks so a
 * whole-sheet restamp cannot build one enormous statement. The connection and
 * stream still bound the query: event ids are namespaced per connection, and a
 * lookup that trusts that rather than restating it is one refactor away from
 * reading another tenant's rows.
 */
const FIRST_SEEN_CHUNK = 1_000;

export async function firstSeenByEventId(
  db: DB,
  connectionId: string,
  streamHash: string,
  eventIds?: Set<string>,
): Promise<Map<string, Date>> {
  const scope = and(eq(events.connectionId, connectionId), eq(events.streamHash, streamHash));
  const cols = { eventId: events.eventId, receivedAt: events.receivedAt };
  if (!eventIds) {
    const rows = await db.select(cols).from(events).where(scope);
    return new Map(rows.map((r) => [r.eventId, r.receivedAt]));
  }
  const out = new Map<string, Date>();
  const ids = [...eventIds];
  for (let i = 0; i < ids.length; i += FIRST_SEEN_CHUNK) {
    const rows = await db
      .select(cols)
      .from(events)
      .where(and(scope, inArray(events.eventId, ids.slice(i, i + FIRST_SEEN_CHUNK))));
    for (const r of rows) out.set(r.eventId, r.receivedAt);
  }
  return out;
}

/**
 * The restamp: what `occurred_at` should be for each record of the ONE sweep
 * that follows a change to the stream's date column.
 *
 * THREE cases, and the third is why "just pass `preserveOccurredAt`" is not the
 * answer. Preserve keeps whatever is STORED, which is only equivalent to
 * "first-seen" on the very first restamp — after one, a row with no date in the
 * newly-chosen column would keep the PREVIOUS column's value, a column the user
 * has explicitly abandoned, while the UI reported it as having kept its import
 * time. Clearing the picker is worse still: every row would land in the preserve
 * batch, nothing would change, and "first seen" would become a one-way door.
 *
 *   parsed under the current column -> the column's date (already stamped)
 *   no usable date, column set      -> received_at
 *   no column at all                -> received_at
 *
 * The last two are one expression because they are one answer, not because they
 * are one case: they arrive differently and a reader has to be able to see both.
 *
 * A record with no `received_at` is one this read is INSERTING, so it has no
 * first-seen yet — the connector's own stamp becomes it, milliseconds later.
 */
export function restampRecords(
  records: CanonicalEvent[],
  dateField: string | null,
  undatedEventIds: Set<string> | undefined,
  firstSeen: Map<string, Date>,
): CanonicalEvent[] {
  return records.map((r) => {
    if (dateField != null && !undatedEventIds?.has(r.eventId)) return r;
    const seen = firstSeen.get(r.eventId);
    return seen ? { ...r, occurredAt: seen } : r;
  });
}

/**
 * Sync one stream and upsert the results (deduped, tagged with the stream's
 * hash) at the connection's current generation.
 *
 * Two shapes, by the source's guarantee class (docs/DATA_MODEL.md):
 * - MIRROR sources (Sheets): every sweep re-reads the ENTIRE resource,
 *   refreshes rows in place (first-seen occurred_at preserved) and
 *   soft-deletes this stream's rows that the read no longer produced — the
 *   stored data is a faithful mirror of the current resource after every sweep.
 * - Incremental sources (Calendar, Calendly): poll forward from the stored
 *   cursor; `maxPages` bounds inline/first-run syncs so a huge resource can't
 *   blow a request timeout — the sweep finishes the rest on its schedule.
 */
/**
 * Wall-clock budget for one sweep-unit (one connection's reconcile, one
 * runSync, one prime). Same class of bound as PRUNE_BUDGET_MS and derived the
 * same way: sync work executes under routes declaring `maxDuration = 60`, one
 * unit gets under half of it, and the deadline is checked BETWEEN pages and
 * BETWEEN streams — so a run can overshoot by at most one
 * PROVIDER_CALL_BUDGET_MS-bounded call (30s), landing worst-case ≈ 55s,
 * inside the container. A cut-short walk stores its continuation and the LRU
 * stream ordering rotates the unpolled tail to the front next sweep — the
 * existing truncation semantics, no new state.
 */
export const SYNC_BUDGET_MS = 25_000;

/** The clock a sweep-unit hands down to every page walk it authorizes. */
export type SyncBudget = { deadlineMs: number; nowMs: () => number };

/**
 * Runner pages per stream per sweep. Was a literal 5 at both call sites —
 * a throughput guess from before per-page claims existed. With every page
 * individually claimed against the ledger and the SYNC_BUDGET_MS deadline
 * checked between pages, the honest bound is "as many as budget and clock
 * allow", and this constant is just the backstop that keeps one
 * pathologically deep stream from eating the whole sweep-unit.
 */
export const SWEEP_MAX_PAGES = 20;

export async function syncStream(
  db: DB,
  conn: ConnRow,
  stream: StreamRow,
  maxPages = 1,
  lane: CallLane = "background",
  budget?: SyncBudget,
): Promise<StreamSyncResult> {
  const connector = getConnector(conn.source);
  if (!connector?.poll) return { inserted: 0, updated: 0, deduped: 0, softDeleted: 0 };
  const credentials = await getConnectionCredentials(db, conn);
  const generation = Math.max(1, conn.syncGeneration ?? 0);
  const operation = pollOperation(conn.source, stream.config);
  let deferred: StreamSyncResult["deferred"];

  /**
   * F.1 — one claim per PROVIDER REQUEST, not per sync.
   *
   * The claim used to be taken once by the caller and then authorise the whole
   * page walk, so a budget of N permitted up to N × maxPages real requests: the
   * ledger read 20% while the connection was several times over the provider's
   * published limit. Claiming here is the only place that knows how many pages
   * are actually being walked.
   */
  const claimPage = async (): Promise<{ at: Date; remaining: number } | null> => {
    // Returned, not discarded: the settle-up has to be booked against the window
    // this claim was charged to. A poll that straddles a minute boundary would
    // otherwise refund out of the next window — see settlePollCalls.
    // `remaining` rides along for O1: it sizes the connector's internal walk
    // (PollArgs.budget.maxCalls) so the walk is bounded BEFORE it spends,
    // instead of settled into overdraft afterwards.
    const at = new Date();
    const claim = await claimCalls(db, conn, operation, 1, at, lane);
    if (claim.allowed) return { at, remaining: claim.remaining };
    deferred = { reason: claim.reason, retryAfterMs: claim.retryAfterMs };
    return null;
  };

  /**
   * A claimed page bought ONE request; the connector may have made several
   * inside it. Settle up so the NEXT claim is authorised on the truth.
   *
   * The connection-scoped path has always done this (`reconcile.ts`), but the
   * stream path never did — and it is the path every Google connection takes.
   * Calendar walks up to 8 pages inside one `poll()` and Sheets makes up to 3
   * requests, so the ledger was recording between an eighth and a third of the
   * real spend. That is survivable for a per-customer API key, where the only
   * account at risk is the one making the calls. It is not survivable for
   * Google, whose quota is per Cloud PROJECT and therefore shared by every
   * customer at once.
   *
   * Connectors that do not report `providerCalls` are counted as one, which is
   * the pre-existing behaviour and correct for a connector that makes one call.
   * (Instantly used to under-report here — a 3-page walk billed as 1 — and now
   * counts every request. Calendly makes one request per poll, so its default
   * of 1 is exact; its only residual under-report is the identity-cache miss.)
   *
   * `extraCalls` re-attributes the part of that spend which went to a DIFFERENT
   * endpoint — Sheets' Drive probe against Sheets' own tab read, whose project
   * quotas are 40× apart — so the tighter bucket does not govern both.
   */
  const settleUp = async (res: { providerCalls?: number; extraCalls?: Record<string, number> }, at: Date) => {
    await settlePollCalls(db, conn, operation, res, 1, at);
  };

  /** The budget one poll() may spend: ledger headroom + the caller's clock. */
  const pollBudget = (remaining: number) => ({
    // 1 + remaining: the claim that authorized this poll already bought one.
    maxCalls: 1 + Math.max(0, remaining),
    deadlineMs: budget?.deadlineMs,
    nowMs: budget?.nowMs,
  });

  let cursor = stream.cursor ?? null;
  let inserted = 0;
  let updated = 0;
  let deduped = 0;
  let softDeleted = 0;
  let incomplete = false;
  let covered: { from: Date; to: Date } | null = null;
  let dateFieldState: StreamRow["dateFieldState"] | undefined;
  let mirrorDrift: StreamSyncResult["mirrorDrift"];
  // F.1 (observed) — set when the provider's own headers said "spent". The
  // pause is written where it is observed; this carries WHEN out to the caller.
  let observedPause: Date | undefined;
  /**
   * The date column changed and every stored row is about to be restamped from
   * this read. Captured as the VALUE, not a boolean, because it is cleared by
   * comparison — see the end of this function.
   */
  const restampRequestedAt = stream.restampRequestedAt ?? null;
  let restampWrote = false;
  /**
   * Nobody has answered the date-column question for this stream, so the read
   * answers it. FALSE once the picker has spoken — including when it said "use
   * import time", which is an answer and not an absence.
   */
  const detectDateField = !stream.dateFieldLocked;
  /**
   * The read that establishes a detection cannot be skipped, and Phase 3's
   * `modifiedTime` probe would skip it: a settled sheet is the normal state, so
   * a stream that has never had this question answered would keep its import-time
   * stamps until somebody edited the tab.
   *
   * Bounded to exactly that case. Once a read has recorded what it found —
   * INCLUDING finding nothing, which is why the connector reports a state with a
   * null column rather than no state — this is false again and the skip resumes.
   */
  const owesDetection = detectDateField && stream.dateFieldState == null;
  try {
    if (isMirrorSource(conn.source)) {
      const claim = await claimPage();
      if (!claim) return { inserted: 0, updated: 0, deduped: 0, softDeleted: 0, incomplete: true, deferred };
      const claimedAt = claim.at;
      // The cursor is passed as a CHANGE-DETECTION HINT, not as a resume point:
      // a mirror still re-reads the whole resource whenever it reads at all.
      // What it buys is the option not to read — see `unchanged` below.
      const mirrorRes = await connector.poll({
        connectionId: conn.id,
        cursor: stream.cursor ?? null,
        credentials,
        config: stream.config ?? undefined,
        streamHash: stream.configHash,
        budget: pollBudget(claim.remaining),
        windowFloor: stream.windowFloor ?? null,
        // The stream owns which column holds a row's event time, for the same
        // reason it owns its window: the rows are shared by every flow reading
        // it, so this cannot be a per-flow opinion.
        dateField: stream.dateField ?? null,
        detectDateField,
        // A settled sheet is not re-read (Phase 3's `modifiedTime` probe), and a
        // settled sheet is the normal state — so both of these have to ask for
        // the read that would otherwise be skipped. Nothing about the SHEET
        // changed; what changed is which column we read the date from, or that
        // nobody has ever looked for one.
        restamp: restampRequestedAt != null || owesDetection,
      });
      const { records, nextCursor, mirrorScope, unchanged } = mirrorRes;
      // Before the `unchanged` return below — a skip still spends the Drive
      // probe, and a probe nobody counts is how a "cheap" sweep stops being one.
      await settleUp(mirrorRes, claimedAt);
      // The stream path never read these headers — only the connection-scoped
      // branch did — so Calendly/Instantly/Sheets/Calendar contributed no
      // `observed_limit` evidence and never deferred on `remaining: 0`. The
      // mirror's read is already whole at this point, so the pause only stops
      // the SWEEP from starting more streams; nothing here is cut short.
      await recordObservedLimit(db, conn, operation, mirrorRes.rateLimit, claimedAt);
      observedPause = (await applyObservedRateLimit(db, conn, mirrorRes.rateLimit)) ?? undefined;

      // The source says it has not changed, so nothing was fetched. Returning
      // here is load-bearing: falling through would hand an EMPTY record set to
      // `retireAbsent`, which for a whole-resource mirror means "every row was
      // deleted upstream" and would tombstone the entire sheet.
      if (unchanged) {
        await db
          .update(sourceStreams)
          .set({ cursor: nextCursor ?? cursor, status: "active", lastError: null, lastPolledAt: new Date(), updatedAt: new Date() })
          .where(eq(sourceStreams.id, stream.id));
        return { inserted: 0, updated: 0, deduped: 0, softDeleted: 0, observedPause };
      }
      /**
       * The column this read actually dated from — chosen or detected — against
       * the one the last read used.
       *
       * A DETECTION IS A CHANGE, exactly like a pick. A stream that gains one
       * has every stored row still stamped with its import moment, and leaving
       * those behind would make auto-detect fix new rows while silently
       * disagreeing with the old ones inside the same number. The comparison is
       * against `date_field_state`, not `date_field`, because the detected
       * column is deliberately stored nowhere else.
       */
      const usedColumn = mirrorRes.dateFieldState?.column ?? null;
      const columnChanged = usedColumn !== (stream.dateFieldState?.column ?? null);
      /**
       * WHETHER THIS SWEEP DATES ITS OWN ROWS, instead of letting the writer pin
       * whatever the row happened to hold the first time it was seen.
       *
       * True whenever a column dated this read — re-decided every sweep, never
       * latched by a marker, and that is the whole point. A SHEET ROW'S IDENTITY
       * IS ITS ROW NUMBER, so when rows shift, row 10 becomes a different lead
       * while staying the same event id. The writer updates `properties` and
       * pins `occurred_at`, so the new occupant silently inherited the previous
       * one's date. Measured live before this changed: 22 of 33 rows carried a
       * date belonging to somebody else — true timestamps spanning 12-14 Aug,
       * stored dates saying 7-8 Aug — and every Today/Yesterday metric over that
       * sheet read 0 while the data was sitting right there.
       *
       * Content is the trigger because content is what moved. The marker and the
       * column change still force it, for the one case a column cannot cover:
       * the column going away, where every row has to go back to first-seen.
       */
      const restamping = usedColumn != null || restampRequestedAt != null || columnChanged;
      /**
       * The restamp is the CALLER doing something different for one sweep, not
       * the writer changing. `preserveOccurredAt` is right for every normal
       * mirror write — a re-read tab must not shift its rows' event times — and
       * an `UPDATE events SET occurred_at` would make something other than
       * `upsertEvents` a writer of event content. So this sweep hands the writer
       * the values it wants and asks it not to pin them.
       */
      /**
       * First-seen times are read only for the rows that will consult them, and
       * only when there are any. A fully dated sheet — the common case now that
       * this runs every sweep — costs no query at all; a sheet with a few blank
       * date cells costs a few index probes rather than a scan of every event
       * in the database. With no column at all, every row needs one, so the
       * stream-wide read is the right shape and stays as rare as it was.
       */
      const undated = mirrorRes.undatedEventIds;
      const firstSeen =
        usedColumn == null
          ? await firstSeenByEventId(db, conn.id, stream.configHash)
          : undated && undated.size > 0
            ? await firstSeenByEventId(db, conn.id, stream.configHash, undated)
            : new Map<string, Date>();
      const toWrite = restamping ? restampRecords(records, usedColumn, undated, firstSeen) : records;
      // C.1: the upsert and the retire are ONE swap. Wrapped so that on the
      // pool driver they run in a transaction holding the stream's advisory
      // lock — no reader can observe the window half-replaced, and a concurrent
      // writer skips rather than interleaving. Inert on the http driver (runs
      // the body directly), so behavior here is unchanged until DB_DRIVER=pool.
      // Provider I/O stays OUTSIDE: the poll above already returned.
      const swap = await withStreamWriteLock(db, `stream:${stream.id}`, async (tx) => {
        const res = await upsertEvents(
          tx,
          {
            orgId: conn.orgId,
            connectionId: conn.id,
            source: conn.source,
            streamHash: stream.configHash,
            generation,
            preserveOccurredAt: !restamping,
          },
          toWrite,
        );
        const gone = await retireAbsent(tx, conn, stream, toWrite, mirrorScope);
        return { res, gone };
      });
      if (swap.acquired && swap.result) {
        inserted = swap.result.res.inserted;
        updated = swap.result.res.updated;
        deduped = swap.result.res.deduped;
        softDeleted = swap.result.gone;
        // The restamp counts as DONE only here, on the branch where the write
        // actually ran. Zero rows written is fine — an empty tab has nothing to
        // restamp — but zero rows written because another writer held the lock
        // is not, and the two are indistinguishable from the counts alone.
        restampWrote = true;
        /**
         * What this read did about the date column, recorded for the node and
         * the connection page — and, in the same breath, the record of which
         * column the stored rows are now dated from.
         *
         * INSIDE this branch for that second reason. Persisting it after a
         * contended swap would tell the next sweep that the detected column had
         * already been applied to rows it never touched, and the restamp that
         * detection implies would be lost silently. It also leaves
         * `owesDetection` true, so the forced read happens again rather than
         * being spent on nothing.
         *
         * Never written by the `unchanged` return above either: that describes
         * the last read, and a skipped sweep did not read anything.
         *
         * NULL when the connector reports nothing at all — an explicit "use
         * import time" — so the picker's choice clears the state rather than
         * leaving a stale column name on screen.
         */
        dateFieldState = mirrorRes.dateFieldState ? { ...mirrorRes.dateFieldState, at: new Date().toISOString() } : null;
        /**
         * 10(c) — the mirror's own guarantee, checked.
         *
         * "Stored live rows ≡ the source after every sweep" is the strongest
         * claim any class here makes and the only one nothing was verifying.
         * Both halves of it — the upsert and the retire — have been wrong
         * before, and when they are the rows still look right one at a time:
         * the failure is a COUNT, which no per-row assertion can see.
         *
         * Free, and that is why it is here rather than in the nightly scan. A
         * whole-resource mirror has just read its entire resource, so the
         * denominator is already in hand; the only cost is one indexed count on
         * the stream's own hash. For every other class a count means a full
         * pagination, which is the expense the rate-limit work exists to avoid —
         * so Calendly and Close get no equivalent, deliberately.
         *
         * Reported, never corrected. A sweep that "fixed" a discrepancy it does
         * not understand would destroy the evidence of the bug that caused it.
         */
        const read = new Set(toWrite.map((r) => r.eventId)).size;
        const [live] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(events)
          .where(
            and(eq(events.connectionId, conn.id), eq(events.streamHash, stream.configHash), isNull(events.deletedAt)),
          );
        const stored = live?.c ?? 0;
        if (stored !== read) {
          mirrorDrift = { read, stored };
          console.warn(`[mirror-drift] stream=${stream.id} source=${conn.source} read=${read} stored=${stored}`);
        }
      }
      cursor = nextCursor ?? null;
    } else {
      for (let page = 0; page < maxPages; page++) {
        // Out of clock between pages: the cursor persisted below carries the
        // walk into the next sweep, and LRU ordering puts this stream first.
        if (page > 0 && budget && budget.nowMs() >= budget.deadlineMs) {
          incomplete = true;
          break;
        }
        const claim = await claimPage();
        if (!claim) {
          incomplete = true;
          break;
        }
        const claimedAt = claim.at;
        const pageRes = await connector.poll({
          connectionId: conn.id,
          cursor,
          credentials,
          config: stream.config ?? undefined,
          streamHash: stream.configHash,
          budget: pollBudget(claim.remaining),
          // 6.2: the STREAM owns how far back it reaches. The connector uses
          // this for the request bound and for the window it declares, so a
          // deepened import cannot be retired by its own declaration.
          windowFloor: stream.windowFloor ?? null,
          dateField: stream.dateField ?? null,
        });
        const { records, nextCursor, mirrorScope, preserveOccurredAt, retireOutsideWindow } = pageRes;
        // The connector's OWN "there is more to fetch", which this loop used to
        // drop on the floor — it destructured five fields and not this one. So
        // Calendly's restart alarm reached the log and nothing else, and
        // `PollResult.incomplete`'s promise that it "feeds the cadence" was true
        // only for connection-scoped sources, which read it in reconcile.ts.
        // ORed, never assigned: a later page finishing cleanly does not undo an
        // earlier page saying it was cut short.
        if (pageRes.incomplete) incomplete = true;
        await settleUp(pageRes, claimedAt);
        // Same headers the connection-scoped branch has always read, finally
        // read here too. Recorded per page — the evidence the catalog's
        // declarations are waiting on — and acted on AFTER this page's rows and
        // cursor are persisted below, so nothing fetched is thrown away.
        await recordObservedLimit(db, conn, operation, pageRes.rateLimit, claimedAt);
        observedPause = (await applyObservedRateLimit(db, conn, pageRes.rateLimit)) ?? observedPause;
        if (retireOutsideWindow) covered = retireOutsideWindow;
        const swap = await withStreamWriteLock(db, `stream:${stream.id}`, async (tx) => {
          const res = await upsertEvents(
            tx,
            // A window-scoped mirror restates rows in place, so its stored
            // occurred_at must stay the day it describes, not drift to
            // first-seen — same reason whole-resource mirrors preserve it.
            { orgId: conn.orgId, connectionId: conn.id, source: conn.source, streamHash: stream.configHash, generation, preserveOccurredAt: mirrorScope != null || preserveOccurredAt === true },
            records,
          );
          // Per-stream mirror-ness: a source that is incremental overall can
          // still have streams that enumerate a window completely (provider
          // analytics). The DECLARATION drives the retire, not the source.
          const gone = mirrorScope ? await retireAbsent(tx, conn, stream, records, mirrorScope) : 0;
          return { res, gone };
        });
        if (!swap.acquired || !swap.result) {
          /**
           * Another writer holds this stream, so this walk stops HERE — with the
           * previous cursor still stored and the window only partly read.
           *
           * That is not a finished sweep, and until now it reported as one. The
           * page-budget rule below never runs, so `incomplete` stayed false: the
           * retire-outside-window pass would go ahead on a prefix, the cadence
           * would tier the connection down as idle, and a Test would render a
           * short count as final. It also lets the gap to the next sweep widen
           * while a perishable continuation sits in the row, which is the exact
           * state `heldContinuation` exists to prevent — and the only exit that
           * sets no other signal at all.
           *
           * Unreachable on the http driver (`withStreamWriteLock` runs the body
           * directly), and reachable the moment `DB_DRIVER=pool` engages the
           * advisory locks. Fixed before the flip rather than after it.
           */
          incomplete = true;
          break;
        }
        inserted += swap.result.res.inserted;
        updated += swap.result.res.updated;
        deduped += swap.result.res.deduped;
        softDeleted += swap.result.gone;
        // `null` means START OVER (see PollResult.nextCursor) — so it is stored
        // as null rather than folded back to the previous value. The old
        // `?? cursor` pinned a finished scan to its final page token forever:
        // Calendly never saw a booking after its first sweep, and one 410 made
        // Calendar re-send a dead sync token indefinitely.
        const advanced = nextCursor !== cursor;
        cursor = nextCursor;
        // Stop when the connector is not moving forward, or when it says the
        // scan is done (null) — the next sweep restarts it.
        //
        // NOT when a page merely produced no records. A connector that filters
        // client-side — Calendly narrowing to one meeting type, because its API
        // has no event_type parameter — legitimately returns an empty page while
        // the very next one is full. Ending the walk there reported "0 loaded"
        // for an account with hundreds of matching meetings, and the wider the
        // scope the likelier it was: "just me" fit on page one and worked, the
        // whole organization did not. An advancing cursor is the connector
        // saying there IS more; `maxPages` is what bounds the walk.
        if (!advanced || nextCursor == null) break;
        // The provider said its quota is spent. The break waits until HERE —
        // after the write and the cursor advance — so the page it arrived on is
        // kept; what stops is fetching the next one. More remained (the cursor
        // is non-null), so this walk is a prefix and must say so.
        if (observedPause) {
          incomplete = true;
          break;
        }
        // Still more to fetch, and no budget left to fetch it: what we wrote is
        // a prefix, and the caller must be able to say so.
        if (page === maxPages - 1) incomplete = true;
      }

      // Rows this stream no longer covers, retired ONCE after the walk rather
      // than per page. It depends only on the window's boundary, never on what
      // a given page happened to contain — which is what makes it safe on a
      // paginated source, where `mirrorScope` would not be.
      //
      // Skipped when the scan was cut short: a prefix of the window is not
      // grounds for tombstoning anything, and the next sweep will finish and
      // prune then.
      const w: { from: Date; to: Date } | null = covered;
      if (w && !incomplete) {
        const pruned = await withStreamWriteLock(db, `stream:${stream.id}`, (tx) => retireOutside(tx, conn, stream, w));
        if (pruned.acquired && pruned.result) softDeleted += pruned.result;
      }
    }
    await db
      .update(sourceStreams)
      .set({
        cursor,
        status: "active",
        lastError: null,
        lastPolledAt: new Date(),
        updatedAt: new Date(),
        // `undefined` leaves the column alone — a source that reports nothing
        // about a date column must not clear another source's state — while an
        // explicit null is how clearing the picker clears what is on screen.
        ...(dateFieldState !== undefined ? { dateFieldState } : {}),
      })
      .where(eq(sourceStreams.id, stream.id));
    /**
     * Clear the restamp marker LAST, in its own statement, and only against the
     * exact value this sweep acted on.
     *
     * Last, because anything that dies before the rows are written must leave
     * the request standing — a marker cleared ahead of the write is a correction
     * the user asked for, was told had been queued, and that silently never
     * happens. Re-running it costs one extra read and recomputes the same
     * values, so the surviving direction is the harmless one.
     *
     * Compare-and-clear, because the user can pick a THIRD column while this
     * sweep is mid-flight. That write stamps a newer time; an unconditional
     * clear would swallow it and leave the stream showing a column it never
     * restamped to.
     */
    if (restampRequestedAt && restampWrote) {
      await db
        .update(sourceStreams)
        .set({ restampRequestedAt: null })
        .where(and(eq(sourceStreams.id, stream.id), eq(sourceStreams.restampRequestedAt, restampRequestedAt)));
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(sourceStreams)
      .set({ status: "error", lastError: message, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(sourceStreams.id, stream.id));
    throw e;
  }
  /**
   * Asked of the cursor that was actually PERSISTED, once, at the end.
   *
   * Not per poll, and not from the `PollResult`. When the write-lock is
   * contended the loop breaks and the PREVIOUS cursor is kept, so a per-poll
   * flag would describe a value that never reached the database — and that exit
   * is the one this signal exists for, because it is the only one that leaves a
   * continuation stored while setting no other flag.
   *
   * `?? false` is the default for a connector that declares nothing, which is
   * Calendar and Sheets: their cursors are non-null for the life of the
   * connection, and pinning them at base cadence forever would trade H.1/H.2 for
   * a problem they do not have.
   */
  const heldContinuation = connector.holdsContinuation?.(cursor) ?? false;
  return { inserted, updated, deduped, softDeleted, incomplete, heldContinuation, covered: covered ?? undefined, deferred, observedPause, mirrorDrift };
}

/**
 * All streams of one connection that should be polled — least-recently-polled
 * FIRST, never-polled before everything.
 *
 * The order is load-bearing, not cosmetic. Without an ORDER BY Postgres returns
 * heap order, which is stable in practice: every sweep walked the same prefix,
 * and when the minute's budget ran out mid-list the same tail streams were cut
 * off sweep after sweep — starved forever while their siblings stayed fresh.
 * LRU-first makes the scarce budget rotate: whichever streams were cut short
 * last time have the oldest `last_polled_at` and go to the front of the next
 * sweep. NULLS FIRST because a stream that has never been polled is the most
 * starved of all. `id` is the tiebreak that keeps the order deterministic when
 * timestamps collide (bulk-created streams share a `created_at` to the ms).
 */
export async function activeStreams(db: DB, connectionId: string): Promise<StreamRow[]> {
  return db
    .select()
    .from(sourceStreams)
    .where(and(eq(sourceStreams.connectionId, connectionId)))
    .orderBy(sql`${sourceStreams.lastPolledAt} asc nulls first`, asc(sourceStreams.createdAt), asc(sourceStreams.id));
}

/** Default freshness window for a non-forced prime: skip re-polling a stream
 * polled more recently than this. The background sweep keeps it current anyway. */
const PRIME_MAX_AGE_MS = 60_000;

/**
 * Pages an interactive Test walks inline — and the ONLY thing in the Test path
 * that is real work. Each page is one sequential provider request, so a person
 * waits for all of them; everything else here is indexed queries in the
 * milliseconds.
 *
 * Even, because a connector that scans outward from now alternates directions
 * (Calendly: recent past / soonest upcoming) — an odd budget hands one end more
 * pages than the other for no reason. Four is two from each end.
 *
 * The ceiling is NOT the provider's page limit, it is
 * `INLINE_TEST_BUDGET_MS` (8s, in flows/actions.ts): a Test that overruns it is
 * handed to the background lane, where the client polls every 800ms and the work
 * restarts from the top. At a few hundred ms per page that cliff is somewhere
 * around 15 pages, and crossing it makes a Test dramatically SLOWER, not more
 * complete. Anything above ~8 wants the budget raised alongside it.
 *
 * (The paragraph that used to close this comment — "claimCalls is claimed
 * once per stream-sync, not per page" — has been false since the F.1 rework
 * moved the claim inside syncStream, per page. The ledger sees every page.)
 */
const PRIME_MAX_PAGES = 4;

/**
 * The wall clock a Test's page walk hands to the connector. Under
 * INLINE_TEST_BUDGET_MS (8s) so a connector's INTERNAL walk (Calendar's 8
 * pages, Instantly's budget-driven walk) self-bounds before the inline race
 * abandons the whole Test — a walk cut short returns what it has; a walk
 * abandoned returns nothing.
 */
const PRIME_BUDGET_MS = 6_000;

export type PrimeStreamResult =
  | { ok: true; refreshed: boolean; note?: string }
  | { ok: false; error: string };

export type PrimeStreamOptions = {
  /**
   * Re-poll even if the stream was polled recently. The explicit user "Test"
   * demands the CURRENT source, so it forces a fresh read regardless of age.
   */
  force?: boolean;
  /**
   * Skip re-polling when the last poll is younger than this (ms). Ignored when
   * `force`. Defaults to {@link PRIME_MAX_AGE_MS}.
   */
  maxAgeMs?: number;
  /** Page bound for the inline first-run / refresh poll. */
  maxPages?: number;
};

/**
 * First-use / on-demand sync for a flow's configured resource: make sure the
 * stream exists and pull its pages now so the caller sees real data. Returns the
 * error message instead of throwing so the Test surface can present it.
 *
 * Freshness gate (Defect #1): a stream is re-polled when the caller `force`s it
 * (explicit Test), when it has never been polled, or when its last poll is older
 * than `maxAgeMs`. The previous behavior skipped forever after the first poll —
 * so once the 10-minute sweep touched a stream, every Test read stale, pre-edit
 * data indefinitely. `force` closes that; the small age window keeps incidental
 * primers (e.g. field listing) from re-polling on every call.
 */
export async function primeStream(
  db: DB,
  orgId: string,
  connectionId: string,
  sourceConfig: Record<string, unknown>,
  opts: PrimeStreamOptions = {},
): Promise<PrimeStreamResult> {
  const { force = false, maxAgeMs = PRIME_MAX_AGE_MS, maxPages = PRIME_MAX_PAGES } = opts;
  const [conn] = await db.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId))).limit(1);
  if (!conn) return { ok: false, error: "This step's connected account no longer exists." };
  if (!isStreamScoped(conn.source) || !hasStreamConfig(sourceConfig, conn.source)) return { ok: true, refreshed: false };

  const configHash = streamConfigHash(sourceConfig, conn.source);
  await db
    .insert(sourceStreams)
    .values({ orgId, connectionId, configHash, config: normalizeStreamConfig(sourceConfig, conn.source) })
    .onConflictDoNothing({ target: [sourceStreams.connectionId, sourceStreams.configHash] });
  const [stream] = await db
    .select()
    .from(sourceStreams)
    .where(and(eq(sourceStreams.connectionId, connectionId), eq(sourceStreams.configHash, configHash)))
    .limit(1);
  if (!stream) return { ok: false, error: "Couldn't register this data source." };

  if (!force && stream.lastPolledAt != null && Date.now() - stream.lastPolledAt.getTime() < maxAgeMs) {
    return { ok: true, refreshed: false }; // recently polled; the sweep keeps it current
  }

  // F.3/F.6 — the connection is deferred (budget spent or breaker open).
  // A Test must be HONEST, not broken: compute on stored data and say plainly
  // that the source wasn't re-read, with when it resumes.
  if (isPaused(conn)) {
    const when = conn.pausedUntil ? ` Retrying around ${conn.pausedUntil.toLocaleTimeString()}.` : "";
    return {
      ok: true,
      refreshed: false,
      note: `Couldn't re-read the source — syncing is paused (${conn.pausedReason ?? "provider limit"}).${when} Showing the data we already have.`,
    };
  }

  // Q6 (active on the pool driver): a forced Test that collides with an
  // in-flight writer AWAITS its completion — bounded, never skipped, never an
  // error at the user — then adopts that sync's result instead of
  // double-polling the provider. If the wait times out (wedged holder), we
  // proceed with our own sync; the guarded writer makes that safe.
  if (force) {
    const t0 = Date.now();
    const waited = await awaitStreamWriteLock(db, `stream:${stream.id}`);
    if (waited === "free") {
      const [fresh] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id)).limit(1);
      if (fresh?.lastPolledAt != null && fresh.lastPolledAt.getTime() >= t0 && fresh.status !== "error") {
        // Another sync just finished — its read IS the fresh data (refreshed:
        // true, because the source WAS re-read; we just didn't do it ourselves).
        return { ok: true, refreshed: true };
      }
    }
  }

  /**
   * The CONNECTION lease, which the advisory-lock wait above is not (it is a
   * no-op on the http driver). Every other stream writer holds it — the
   * sweep, runSync, the backfill slice — so a Test that skipped it was the
   * one path that could double-poll a stream mid-sweep. Same shape as
   * primeConnection: a FORCED Test waits (bounded) and adopts a finished
   * writer's read; then either kind takes the lease, and one grabbed in the
   * gap gets said plainly rather than implying a refresh that did not
   * happen. Only `force` waits: a non-forced prime is opportunistic
   * freshness, and blocking a Test for 15s to maybe save a page is the wrong
   * trade.
   */
  if (force) {
    const t1 = Date.now();
    const waited = await awaitConnectionSyncLock(db, conn.id);
    if (waited === "free") {
      const [fresh] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id)).limit(1);
      if (fresh?.lastPolledAt != null && fresh.lastPolledAt.getTime() >= t1 && fresh.status !== "error") {
        return { ok: true, refreshed: true };
      }
    }
  }
  const lease = await tryConnectionSyncLock(db, conn.id);
  if (!lease) {
    return { ok: true, refreshed: false, note: "A sync of this source is already running — showing the data we have so far." };
  }

  try {
    // F.8 — the interactive lane may claim the reserved headroom background
    // sweeps never touch, so a busy fleet doesn't block a person clicking Test.
    // Claimed per page inside syncStream, which is the only place that knows
    // how many pages this walk will actually take.
    const nowMs = Date.now;
    const res = await syncStream(db, conn, stream, maxPages, "interactive", {
      deadlineMs: nowMs() + PRIME_BUDGET_MS,
      nowMs,
    });
    if (res.deferred) {
      // Which sentence is true depends on whether ANY page got through. Denied
      // on page one, nothing was re-read; denied on page three, a partial
      // refresh did happen and claiming otherwise would be the same dishonesty
      // this note exists to prevent.
      const readSomething = res.inserted + res.updated + res.deduped > 0;
      return {
        ok: true,
        refreshed: readSomething,
        note: readSomething
          ? `Couldn't finish re-reading the source — ${res.deferred.reason.toLowerCase()}. Showing what arrived before it stopped.`
          : `Couldn't re-read the source — ${res.deferred.reason.toLowerCase()}. Showing the data we already have.`,
      };
    }
    if (res.incomplete) return { ok: true, refreshed: true, note: partialScanNote(res.covered) };
    // Phase 6 — a historical import may still be reaching backwards through
    // this stream even though THIS read finished. The state belongs to the
    // stream rather than to a flow, so every flow reading it says the same
    // thing: a number that is still growing has to say so, in one voice.
    const importing = await streamImportProgress(db, stream.id);
    if (importing) return { ok: true, refreshed: true, note: importProgressNote(importing) };
    return { ok: true, refreshed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    // Every return above passes through here — the lease never outlives the
    // Test that took it. Token-fenced, so a lease that expired mid-sync and
    // was re-taken by another writer is not cleared out from under them.
    await releaseConnectionSyncLock(db, conn.id, lease.token);
  }
}

/**
 * The line shown when a scan stopped on its page budget rather than on the end
 * of the data.
 *
 * It leads with the WINDOW, because that is the fact worth knowing: a source
 * that deliberately reads the last 30 days plus everything upcoming will show a
 * count that looks short, and calling that "still importing" invited the user to
 * wait for numbers that were never coming. Naming the window says the number is
 * bounded on purpose.
 *
 * The second clause stays — shortened — for the same reason it existed: a count
 * taken mid-scan is a floor, and a Test that renders "0 loaded" and "0 loaded so
 * far" identically is the silent zero this codebase keeps having to unpick.
 */
/**
 * The line shown while an import is still reaching BACKWARDS through history.
 *
 * Different question from {@link partialScanNote}, and the distinction is the
 * point: that one names a window a source deliberately bounds itself to (a
 * count that looks short is correct and final); this one names a floor that is
 * still moving. Rendering them the same way would tell a user to stop waiting
 * for numbers that are genuinely still coming — or to keep waiting for numbers
 * that are not.
 *
 * Both denominator and numerator are real: the connector knows the window it is
 * aiming at and the span it has actually ingested. Nothing is estimated, which
 * is why this can ship without the backfill lane's bookkeeping.
 *
 * The sentence carries no DIRECTION, and that is deliberate. It used to end
 * "reaching further back each sync", which is only true of a source that walks
 * newest-first. Every source here does today — but this string is rendered for
 * all of them and a provider's ordering is the provider's to change, so
 * "widening" is true either way. A note that describes the wrong motion is the
 * same class of wrong as a number that describes the wrong quantity.
 */
export function importProgressNote(progress?: { coveredMs: number; targetMs: number }): string {
  if (!progress) return "Still importing this source — the numbers below can still grow.";
  const day = 86_400_000;
  const target = Math.max(1, Math.round(progress.targetMs / day));
  // FLOORED, not rounded. Rounding the numerator turns anything within twelve
  // hours of the target into "covering 30 of 30 days" — a sentence that says the
  // import is finished, attached to a note whose entire job is to say it is not.
  // The denominator rounds because it names a policy (30 days, 90 days) rather
  // than a measurement, and a flooring numerator can then only understate.
  const covered = Math.min(target, Math.max(0, Math.floor(progress.coveredMs / day)));
  return `Still importing — covering ${covered} of ${target} days so far, widening each sync.`;
}

function partialScanNote(covered?: { from: Date; to: Date }, now = Date.now()): string {
  if (!covered) return "Still loading — the numbers below cover what has arrived so far.";
  const days = Math.max(1, Math.round((now - covered.from.getTime()) / 86_400_000));
  return `Only getting the last ${days} days and onwards — still loading, so the numbers below can still grow.`;
}
