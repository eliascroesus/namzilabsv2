import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { connections, events, sourceStreams, syncState, rawEvents } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped, isMirrorSource } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { processRawEvent, upsertEvents } from "@/ingestion/pipeline";
import { activeStreams, syncStream, type PrimeStreamResult } from "@/lib/sync/streams";
import { claimCalls, isPaused } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import type { CanonicalEvent, Connector, PollArgs } from "@/connectors/types";

const PAGE_CAP = 200;

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
      const { records, cursor } = await pollAll(connector, base);
      const res = await upsertEvents(db, { ...meta, generation: gen }, records);

      // Only NOW (after the replacement generation is in) remove poll-managed rows
      // that were not seen this run — i.e. removed upstream. Webhook rows (gen 0) are safe.
      const del = await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(and(eq(events.connectionId, conn.id), gte(events.syncGeneration, 1), lt(events.syncGeneration, gen), isNull(events.deletedAt)))
        .returning({ id: events.id });

      await db
        .update(connections)
        .set({ syncGeneration: gen, syncStatus: "live", historicalSyncedAt: new Date(), lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(connections.id, conn.id));
      await upsertCursor(db, conn.id, cursor);

      return { mode: "full", polled: true, upserted: res.total, inserted: res.inserted, updated: res.updated, softDeleted: del.length, generation: gen, orgId: conn.orgId, source: conn.source };
    }

    // incremental: fetch from the stored cursor, additive (no soft-delete).
    const gen = Math.max(1, conn.syncGeneration ?? 0);
    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, conn.id)).limit(1);
    const { records, nextCursor } = await connector.poll({ ...base, cursor: state?.cursor ?? null });
    const res = await upsertEvents(db, { ...meta, generation: gen }, records);
    await db
      .update(connections)
      .set({ syncStatus: "live", lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    await upsertCursor(db, conn.id, nextCursor);

    return { mode: "incremental", polled: true, upserted: res.total, inserted: res.inserted, updated: res.updated, softDeleted: 0, generation: gen, orgId: conn.orgId, source: conn.source };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(connections).set({ syncStatus: "error", lastError: message, updatedAt: new Date() }).where(eq(connections.id, connectionId));
    throw e;
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

  if (mode === "incremental") {
    let inserted = 0;
    let updated = 0;
    let softDeleted = 0;
    let upserted = 0;
    for (const stream of streams) {
      try {
        const r = await syncStream(db, conn, stream, 5);
        inserted += r.inserted;
        updated += r.updated;
        softDeleted += r.softDeleted;
        upserted += r.inserted + r.updated + r.deduped;
      } catch {
        // Recorded on the stream row; other streams keep syncing.
      }
    }
    await db
      .update(connections)
      .set({ syncStatus: "live", lastEventAt: inserted + updated > 0 ? new Date() : conn.lastEventAt, lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    return { mode, polled: streams.length > 0, upserted, inserted, updated, softDeleted, generation: Math.max(1, conn.syncGeneration ?? 0), orgId: conn.orgId, source: conn.source };
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
    const base: PollArgs = { connectionId: conn.id, cursor: null, credentials, config: stream.config ?? undefined, streamHash: stream.configHash };
    const { records, cursor } = await pollAll(connector, base);
    const res = await upsertEvents(
      db,
      {
        orgId: conn.orgId,
        connectionId: conn.id,
        source: conn.source,
        streamHash: stream.configHash,
        generation: gen,
        preserveOccurredAt: isMirrorSource(conn.source),
      },
      records,
    );
    upserted += res.total;
    inserted += res.inserted;
    updated += res.updated;
    polledHashes.push(stream.configHash);
    await db
      .update(sourceStreams)
      .set({ cursor, status: "active", lastError: null, lastPolledAt: new Date(), updatedAt: new Date() })
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

async function pollAll(connector: Connector, base: PollArgs): Promise<{ records: CanonicalEvent[]; cursor: string | null }> {
  const seen = new Map<string, CanonicalEvent>();
  let cursor: string | null = null; // full re-sync starts from the beginning
  let last: string | null = null;
  for (let page = 0; page < PAGE_CAP; page++) {
    const { records, nextCursor } = await connector.poll!({ ...base, cursor });
    for (const r of records) seen.set(r.eventId, r);
    if (!nextCursor || nextCursor === cursor || records.length === 0) {
      cursor = nextCursor ?? cursor;
      break;
    }
    if (nextCursor === last) break;
    last = cursor;
    cursor = nextCursor;
  }
  return { records: [...seen.values()], cursor };
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
 * keys on. Sendblue and Close have none — the account IS the resource, so their
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

  const claim = await claimCalls(db, conn, pollOperation(conn.source, conn.config), 1, new Date(), "interactive");
  if (!claim.allowed) {
    return {
      ok: true,
      refreshed: false,
      note: `Couldn't re-read the source — ${claim.reason.toLowerCase()}. Showing the data we already have.`,
    };
  }

  try {
    await runSync(db, connectionId, "incremental");
    return { ok: true, refreshed: true };
  } catch (e) {
    // A provider error now reaches the user as an error, where before the Test
    // reported zero records and no reason.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
