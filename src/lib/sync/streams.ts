import { and, eq, gt, gte, isNull, lt, lte, notInArray, or } from "drizzle-orm";
import { connections, events, flows, flowVersions, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped, isMirrorSource } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
import { claimCalls, isPaused, type CallLane } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { awaitStreamWriteLock, withStreamWriteLock } from "./locks";
import { hasStreamConfig, normalizeStreamConfig, streamConfigHash } from "./stream-hash";
import { parseGraph, type FlowGraph } from "@/lib/flow/types";

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
    if (!conns.some((c) => c.id === ref.connectionId)) continue; // stale/foreign connection id
    const rows = await db
      .insert(sourceStreams)
      .values({ orgId, connectionId: ref.connectionId, configHash: ref.configHash, config: ref.config })
      .onConflictDoNothing({ target: [sourceStreams.connectionId, sourceStreams.configHash] })
      .returning({ id: sourceStreams.id });
    created += rows.length;
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
async function retireAbsent(
  db: DB,
  conn: ConnRow,
  stream: StreamRow,
  records: { eventId: string }[],
  scope?: { from: Date; to: Date },
): Promise<number> {
  const present = records.map((r) => r.eventId);
  const gone = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(events.connectionId, conn.id),
        eq(events.streamHash, stream.configHash),
        isNull(events.deletedAt),
        ...(scope ? [gte(events.occurredAt, scope.from), lte(events.occurredAt, scope.to)] : []),
        ...(present.length ? [notInArray(events.eventId, present)] : []),
      ),
    )
    .returning({ id: events.id });
  return gone.length;
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
export async function syncStream(
  db: DB,
  conn: ConnRow,
  stream: StreamRow,
  maxPages = 1,
  lane: CallLane = "background",
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
  const claimPage = async (): Promise<boolean> => {
    const claim = await claimCalls(db, conn, operation, 1, new Date(), lane);
    if (claim.allowed) return true;
    deferred = { reason: claim.reason, retryAfterMs: claim.retryAfterMs };
    return false;
  };

  let cursor = stream.cursor ?? null;
  let inserted = 0;
  let updated = 0;
  let deduped = 0;
  let softDeleted = 0;
  let incomplete = false;
  let covered: { from: Date; to: Date } | null = null;
  try {
    if (isMirrorSource(conn.source)) {
      if (!(await claimPage())) return { inserted: 0, updated: 0, deduped: 0, softDeleted: 0, incomplete: true, deferred };
      // Full re-read, ignoring any stored cursor: the read IS the truth.
      const { records, nextCursor, mirrorScope } = await connector.poll({
        connectionId: conn.id,
        cursor: null,
        credentials,
        config: stream.config ?? undefined,
        streamHash: stream.configHash,
      });
      // C.1: the upsert and the retire are ONE swap. Wrapped so that on the
      // pool driver they run in a transaction holding the stream's advisory
      // lock — no reader can observe the window half-replaced, and a concurrent
      // writer skips rather than interleaving. Inert on the http driver (runs
      // the body directly), so behavior here is unchanged until DB_DRIVER=pool.
      // Provider I/O stays OUTSIDE: the poll above already returned.
      const swap = await withStreamWriteLock(db, `stream:${stream.id}`, async (tx) => {
        const res = await upsertEvents(
          tx,
          { orgId: conn.orgId, connectionId: conn.id, source: conn.source, streamHash: stream.configHash, generation, preserveOccurredAt: true },
          records,
        );
        const gone = await retireAbsent(tx, conn, stream, records, mirrorScope);
        return { res, gone };
      });
      if (swap.acquired && swap.result) {
        inserted = swap.result.res.inserted;
        updated = swap.result.res.updated;
        deduped = swap.result.res.deduped;
        softDeleted = swap.result.gone;
      }
      cursor = nextCursor ?? null;
    } else {
      for (let page = 0; page < maxPages; page++) {
        if (!(await claimPage())) {
          incomplete = true;
          break;
        }
        const { records, nextCursor, mirrorScope, preserveOccurredAt, retireOutsideWindow } = await connector.poll({
          connectionId: conn.id,
          cursor,
          credentials,
          config: stream.config ?? undefined,
          streamHash: stream.configHash,
        });
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
        if (!swap.acquired || !swap.result) break; // another writer holds this stream
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
      .set({ cursor, status: "active", lastError: null, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(sourceStreams.id, stream.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(sourceStreams)
      .set({ status: "error", lastError: message, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(sourceStreams.id, stream.id));
    throw e;
  }
  return { inserted, updated, deduped, softDeleted, incomplete, covered: covered ?? undefined, deferred };
}

/** All streams of one connection that should be polled. */
export async function activeStreams(db: DB, connectionId: string): Promise<StreamRow[]> {
  return db
    .select()
    .from(sourceStreams)
    .where(and(eq(sourceStreams.connectionId, connectionId)));
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
 * Raising this also raises the real provider request rate without the ledger
 * seeing it: `claimCalls` is claimed once per stream-sync, not per page, so a
 * budget of N means one claim authorises N requests.
 */
const PRIME_MAX_PAGES = 4;

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

  try {
    // F.8 — the interactive lane may claim the reserved headroom background
    // sweeps never touch, so a busy fleet doesn't block a person clicking Test.
    // Claimed per page inside syncStream, which is the only place that knows
    // how many pages this walk will actually take.
    const res = await syncStream(db, conn, stream, maxPages, "interactive");
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
    return { ok: true, refreshed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
 * Both denominator and numerator are real: the connector knows the floor it is
 * aiming for and the oldest record it has actually ingested. Nothing is
 * estimated, which is why this can ship without the backfill lane's
 * bookkeeping.
 */
export function importProgressNote(progress?: { reachedBack: Date; targetBack: Date }, now = Date.now()): string {
  if (!progress) return "Still importing this source — the numbers below can still grow.";
  const day = 86_400_000;
  const target = Math.max(1, Math.round((now - progress.targetBack.getTime()) / day));
  const reached = Math.min(target, Math.max(0, Math.round((now - progress.reachedBack.getTime()) / day)));
  return `Still importing — covering ${reached} of ${target} days so far, reaching further back each sync.`;
}

function partialScanNote(covered?: { from: Date; to: Date }, now = Date.now()): string {
  if (!covered) return "Still loading — the numbers below cover what has arrived so far.";
  const days = Math.max(1, Math.round((now - covered.from.getTime()) / 86_400_000));
  return `Only getting the last ${days} days and onwards — still loading, so the numbers below can still grow.`;
}
