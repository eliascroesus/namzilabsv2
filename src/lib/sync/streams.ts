import { and, eq, gte, isNull, lte, notInArray } from "drizzle-orm";
import { connections, events, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped, isMirrorSource } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
import { claimCalls, isPaused } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { awaitStreamWriteLock, withStreamWriteLock } from "./locks";
import { hasStreamConfig, normalizeStreamConfig, streamConfigHash } from "./stream-hash";
import type { FlowGraph } from "@/lib/flow/types";

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
    if (!connectionId || !hasStreamConfig(sourceConfig)) continue;
    const source = typeof cfg.source === "string" ? cfg.source : sourceOf(connectionId);
    if (!isStreamScoped(source)) continue;
    const configHash = streamConfigHash(sourceConfig);
    seen.set(`${connectionId}:${configHash}`, { connectionId, config: normalizeStreamConfig(sourceConfig), configHash });
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
  }
  return { created };
}

export type StreamSyncResult = { inserted: number; updated: number; deduped: number; softDeleted: number };

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
export async function syncStream(db: DB, conn: ConnRow, stream: StreamRow, maxPages = 1): Promise<StreamSyncResult> {
  const connector = getConnector(conn.source);
  if (!connector?.poll) return { inserted: 0, updated: 0, deduped: 0, softDeleted: 0 };
  const credentials = await getConnectionCredentials(db, conn);
  const generation = Math.max(1, conn.syncGeneration ?? 0);

  let cursor = stream.cursor ?? null;
  let inserted = 0;
  let updated = 0;
  let deduped = 0;
  let softDeleted = 0;
  try {
    if (isMirrorSource(conn.source)) {
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
        const { records, nextCursor, mirrorScope, preserveOccurredAt } = await connector.poll({
          connectionId: conn.id,
          cursor,
          credentials,
          config: stream.config ?? undefined,
          streamHash: stream.configHash,
        });
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
        if (!advanced || nextCursor == null || records.length === 0) break;
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
  return { inserted, updated, deduped, softDeleted };
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
  const { force = false, maxAgeMs = PRIME_MAX_AGE_MS, maxPages = 3 } = opts;
  const [conn] = await db.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId))).limit(1);
  if (!conn) return { ok: false, error: "This step's connected account no longer exists." };
  if (!isStreamScoped(conn.source) || !hasStreamConfig(sourceConfig)) return { ok: true, refreshed: false };

  const configHash = streamConfigHash(sourceConfig);
  await db
    .insert(sourceStreams)
    .values({ orgId, connectionId, configHash, config: normalizeStreamConfig(sourceConfig) })
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

  // F.8 — interactive lane: a user's Test may claim the reserved headroom that
  // background sweeps never touch, so a busy fleet doesn't block a person.
  const claim = await claimCalls(db, conn, pollOperation(conn.source, stream.config), 1, new Date(), "interactive");
  if (!claim.allowed) {
    return {
      ok: true,
      refreshed: false,
      note: `Couldn't re-read the source — ${claim.reason.toLowerCase()}. Showing the data we already have.`,
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
    await syncStream(db, conn, stream, maxPages);
    return { ok: true, refreshed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
