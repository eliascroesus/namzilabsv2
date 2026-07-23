import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { connections, events, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
import { hasStreamConfig, normalizeStreamConfig, streamConfigHash } from "./stream-hash";
import type { CanonicalEvent, Connector, PollArgs } from "@/connectors/types";
import type { FlowGraph } from "@/lib/flow/types";

/**
 * Streams are the unit of sync for connectors whose resource is chosen per flow
 * (which spreadsheet + tab, which calendar). A connection holds only auth; each
 * flow's Get data step declares WHAT to pull (its sourceConfig). Saving a flow
 * upserts the matching stream rows here, the 10-minute reconcile sweep syncs
 * every active stream with its connector's declared strategy, and events are
 * tagged with the stream's hash so each flow reads exactly the resource it
 * configured.
 *
 * Two strategies (declared on the Connector — the Airbyte/Fivetran model):
 *  - mirror:      {@link mirrorStream} — full re-read + refresh + soft-delete;
 *                 after any COMPLETE pass, live rows ≡ the current source.
 *  - incremental: {@link syncStream} — cursor walk; re-seen records refresh.
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

type StreamRow = typeof sourceStreams.$inferSelect;
type ConnRow = typeof connections.$inferSelect;

// ---------- polling ----------

/**
 * Walk a connector's pagination from the very beginning until the source is
 * exhausted (or the page budget runs out). `complete` is the load-bearing bit:
 * soft-deletes are only ever allowed after a COMPLETE scan — a partial read
 * proves nothing about what is gone.
 */
export async function pollAll(
  connector: Connector,
  base: PollArgs,
  pageBudget = 200,
): Promise<{ records: CanonicalEvent[]; cursor: string | null; complete: boolean }> {
  const seen = new Map<string, CanonicalEvent>();
  let cursor: string | null = null; // full scan starts from the beginning
  let last: string | null = null;
  for (let page = 0; page < pageBudget; page++) {
    const { records, nextCursor } = await connector.poll!({ ...base, cursor });
    for (const r of records) seen.set(r.eventId, r);
    if (!nextCursor || nextCursor === cursor || records.length === 0) {
      return { records: [...seen.values()], cursor: nextCursor ?? cursor, complete: true };
    }
    if (nextCursor === last) return { records: [...seen.values()], cursor, complete: true };
    last = cursor;
    cursor = nextCursor;
  }
  return { records: [...seen.values()], cursor, complete: false };
}

// ---------- mirror strategy ----------

export type MirrorResult = { inserted: number; updated: number; softDeleted: number; complete: boolean };

const DELETE_CHUNK = 500;

/**
 * One full-refresh pass over a mirror stream (the Fivetran model for sources
 * with no changelog — spreadsheets, booking windows):
 *
 *   1. Re-read the ENTIRE resource from the source.
 *   2. Upsert every record at the NEXT generation — edits refresh in place
 *      (ON CONFLICT DO UPDATE), re-seen rows come back alive.
 *   3. Soft-delete the stream's live rows the scan did NOT see (still below
 *      the new generation) — removed upstream, so removed here.
 *   4. Bump the stream's generation.
 *
 * Invariant delivered: after any COMPLETE pass, the stream's live rows are
 * exactly the current source resource. Two guardrails keep this safe:
 *  - A partial scan (page budget) refreshes what it read at the CURRENT
 *    generation and never deletes or bumps — an incomplete read must never
 *    destroy data.
 *  - `connector.inMirrorScope` protects rows a bounded rescan window could not
 *    have seen (e.g. Calendly meetings outside its ±400-day window).
 *
 * Within a stream's scope there is deliberately NO generation floor on the
 * delete: webhook rows never carry a streamHash, so everything here is
 * poll-managed — and that is what lets legacy rows (from the old append-only
 * sync) and phantom blank-row events clean themselves up on the first pass.
 */
export async function mirrorStream(db: DB, conn: ConnRow, stream: StreamRow, opts: { pageBudget?: number } = {}): Promise<MirrorResult> {
  const connector = getConnector(conn.source);
  if (!connector?.poll) return { inserted: 0, updated: 0, softDeleted: 0, complete: true };
  try {
    const credentials = await getConnectionCredentials(db, conn);
    const base: PollArgs = { connectionId: conn.id, cursor: null, credentials, config: stream.config ?? undefined, streamHash: stream.configHash };
    const gen = (stream.syncGeneration ?? 0) + 1;
    const { records, complete } = await pollAll(connector, base, opts.pageBudget);

    const meta = {
      orgId: conn.orgId,
      connectionId: conn.id,
      source: conn.source,
      streamHash: stream.configHash,
      preserveOccurredAt: connector.preserveOccurredAt,
    };

    if (!complete) {
      // Freshness without a bump: refresh what was read, delete nothing.
      const res = await upsertEvents(db, { ...meta, generation: Math.max(1, stream.syncGeneration ?? 0) }, records);
      await db
        .update(sourceStreams)
        .set({ status: "active", lastError: null, lastPolledAt: new Date(), updatedAt: new Date() })
        .where(eq(sourceStreams.id, stream.id));
      return { inserted: res.inserted, updated: res.updated, softDeleted: 0, complete: false };
    }

    const res = await upsertEvents(db, { ...meta, generation: gen }, records);

    const candidates = await db
      .select({ id: events.id, eventId: events.eventId, occurredAt: events.occurredAt, properties: events.properties })
      .from(events)
      .where(and(eq(events.connectionId, conn.id), eq(events.streamHash, stream.configHash), isNull(events.deletedAt), lt(events.syncGeneration, gen)));
    const scope = connector.inMirrorScope?.bind(connector);
    const doomed = candidates
      .filter((c) =>
        scope
          ? scope(
              { eventId: c.eventId, occurredAt: c.occurredAt instanceof Date ? c.occurredAt : new Date(c.occurredAt), properties: (c.properties as Record<string, unknown>) ?? {} },
              stream.config ?? undefined,
            )
          : true,
      )
      .map((c) => c.id);

    let softDeleted = 0;
    for (let i = 0; i < doomed.length; i += DELETE_CHUNK) {
      const del = await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(inArray(events.id, doomed.slice(i, i + DELETE_CHUNK)))
        .returning({ id: events.id });
      softDeleted += del.length;
    }

    await db
      .update(sourceStreams)
      .set({ syncGeneration: gen, cursor: null, status: "active", lastError: null, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(sourceStreams.id, stream.id));
    return { inserted: res.inserted, updated: res.updated, softDeleted, complete: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(sourceStreams)
      .set({ status: "error", lastError: message, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(sourceStreams.id, stream.id));
    throw e;
  }
}

// ---------- incremental strategy ----------

export type StreamSyncResult = { inserted: number; updated: number; deduped: number };

/**
 * Poll one incremental stream from its stored cursor and upsert the results
 * (re-seen records refresh — a changed calendar event or redelivered record
 * always converges on the source's truth). Records are stamped with the
 * stream's current generation (min 1) so a later full mirror pass can manage
 * them. `maxPages` bounds inline/first-run syncs so a huge backlog can't blow
 * a request timeout — the sweep finishes the rest, page by page.
 */
export async function syncStream(db: DB, conn: ConnRow, stream: StreamRow, maxPages = 1): Promise<StreamSyncResult> {
  const connector = getConnector(conn.source);
  if (!connector?.poll) return { inserted: 0, updated: 0, deduped: 0 };
  const credentials = await getConnectionCredentials(db, conn);

  let cursor = stream.cursor ?? null;
  let inserted = 0;
  let updated = 0;
  let deduped = 0;
  try {
    for (let page = 0; page < maxPages; page++) {
      const { records, nextCursor } = await connector.poll({
        connectionId: conn.id,
        cursor,
        credentials,
        config: stream.config ?? undefined,
        streamHash: stream.configHash,
      });
      const res = await upsertEvents(
        db,
        {
          orgId: conn.orgId,
          connectionId: conn.id,
          source: conn.source,
          streamHash: stream.configHash,
          generation: Math.max(1, stream.syncGeneration ?? 0),
          preserveOccurredAt: connector.preserveOccurredAt,
        },
        records,
      );
      inserted += res.inserted;
      updated += res.updated;
      deduped += res.deduped;
      const advanced = nextCursor != null && nextCursor !== cursor;
      cursor = nextCursor ?? cursor;
      if (!advanced || records.length === 0) break;
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
  return { inserted, updated, deduped };
}

/** All streams of one connection that should be polled. */
export async function activeStreams(db: DB, connectionId: string): Promise<StreamRow[]> {
  return db
    .select()
    .from(sourceStreams)
    .where(and(eq(sourceStreams.connectionId, connectionId)));
}

// ---------- freshness ----------

/**
 * Make a flow-configured resource's data FRESH for an explicit user action
 * (Test this step, opening a field picker): registers the stream if needed and,
 * when its last poll is older than `maxAgeMs`, re-syncs inline — a mirror
 * stream re-reads its resource (a sheet = exactly one API call; an over-budget
 * scan refreshes without deleting), an incremental stream pulls its cursor.
 * A user who just edited their sheet and hits Test sees the current sheet.
 * Returns the error message instead of throwing so the Test surface can
 * present it.
 */
export async function ensureFreshStream(
  db: DB,
  orgId: string,
  connectionId: string,
  sourceConfig: Record<string, unknown>,
  opts: { maxAgeMs?: number; pageBudget?: number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { maxAgeMs = 60_000, pageBudget = 10 } = opts;
  const [conn] = await db.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId))).limit(1);
  if (!conn) return { ok: false, error: "This step's connected account no longer exists." };
  if (!isStreamScoped(conn.source) || !hasStreamConfig(sourceConfig)) return { ok: true };

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

  const last = stream.lastPolledAt ? (stream.lastPolledAt instanceof Date ? stream.lastPolledAt.getTime() : new Date(stream.lastPolledAt).getTime()) : null;
  if (last != null && Date.now() - last < maxAgeMs) return { ok: true }; // fresh enough

  try {
    const connector = getConnector(conn.source);
    if (connector?.syncStrategy === "mirror") await mirrorStream(db, conn, stream, { pageBudget });
    else await syncStream(db, conn, stream, last == null ? 3 : 2);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
