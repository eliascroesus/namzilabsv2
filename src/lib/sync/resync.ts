import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { connections, events, rawEvents, syncState } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { processRawEvent, upsertEvents } from "@/ingestion/pipeline";
import { activeStreams, mirrorStream, pollAll, syncStream } from "@/lib/sync/streams";
import type { PollArgs } from "@/connectors/types";

export type SyncMode = "full" | "incremental";
export type SyncResult = {
  mode: SyncMode;
  polled: boolean;
  upserted: number;
  softDeleted: number;
  generation: number;
  orgId: string;
  source: string;
};

/**
 * Sync a connection's data.
 *
 * Stream-scoped sources (Sheets, Calendar, Calendly — the connection is auth
 * only) sync per stream by the connector's declared strategy: mirror streams
 * run a full-refresh pass ({@link mirrorStream} — after it, live rows ≡ the
 * source), incremental streams walk their cursor with refresh-on-conflict.
 * "full" forces a mirror pass for every stream regardless of strategy.
 *
 * Connection-scoped sources (Close) keep the connection-level generation
 * model: gen 0 marks webhook-captured rows (NEVER soft-deleted — they share
 * the null streamHash with polled rows, so the generation floor is their
 * protection); a full re-sync upserts everything at gen N and only then
 * soft-deletes poll-managed rows (gen ≥ 1) still below N.
 */
export async function runSync(db: DB, connectionId: string, mode: SyncMode): Promise<SyncResult> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new Error(`connection ${connectionId} not found`);

  const connector = getConnector(conn.source);
  if (!connector?.poll) {
    // Webhook-only source: nothing to poll.
    await db.update(connections).set({ syncStatus: "live", updatedAt: new Date() }).where(eq(connections.id, connectionId));
    return { mode, polled: false, upserted: 0, softDeleted: 0, generation: conn.syncGeneration, orgId: conn.orgId, source: conn.source };
  }

  await db.update(connections).set({ syncStatus: "importing", updatedAt: new Date() }).where(eq(connections.id, connectionId));

  try {
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

      return { mode: "full", polled: true, upserted: res.inserted + res.updated, softDeleted: del.length, generation: gen, orgId: conn.orgId, source: conn.source };
    }

    // incremental: fetch from the stored cursor; re-seen records refresh in place.
    const gen = Math.max(1, conn.syncGeneration ?? 0);
    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, conn.id)).limit(1);
    const { records, nextCursor } = await connector.poll({ ...base, cursor: state?.cursor ?? null });
    const res = await upsertEvents(db, { ...meta, generation: gen }, records);
    await db
      .update(connections)
      .set({ syncStatus: "live", lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    await upsertCursor(db, conn.id, nextCursor);

    return { mode: "incremental", polled: true, upserted: res.inserted + res.updated, softDeleted: 0, generation: gen, orgId: conn.orgId, source: conn.source };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(connections).set({ syncStatus: "error", lastError: message, updatedAt: new Date() }).where(eq(connections.id, connectionId));
    throw e;
  }
}

type ConnRow = typeof connections.$inferSelect;

/**
 * Sync every flow-configured resource (stream) of a stream-scoped connection.
 * Each stream is independent — its own generation, its own cursor, its own
 * try/catch, so one broken resource never blocks the others.
 *
 * incremental: each stream runs its connector's declared strategy (mirror
 * streams full-refresh — for them this IS the incremental sync).
 * full: every stream runs a mirror pass — the explicit "rebuild it 1:1" action.
 */
async function runStreamSync(db: DB, conn: ConnRow, mode: SyncMode): Promise<SyncResult> {
  const connector = getConnector(conn.source)!;
  const streams = (await activeStreams(db, conn.id)).filter((s) => s.status !== "disabled");

  let upserted = 0;
  let softDeleted = 0;
  for (const stream of streams) {
    try {
      if (mode === "full" || connector.syncStrategy === "mirror") {
        const r = await mirrorStream(db, conn, stream);
        upserted += r.inserted + r.updated;
        softDeleted += r.softDeleted;
      } else {
        const r = await syncStream(db, conn, stream, 5);
        upserted += r.inserted + r.updated;
      }
    } catch {
      // Recorded on the stream row; other streams keep syncing.
    }
  }

  await db
    .update(connections)
    .set({
      syncStatus: "live",
      lastEventAt: upserted > 0 ? new Date() : conn.lastEventAt,
      ...(mode === "full" ? { historicalSyncedAt: new Date() } : {}),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, conn.id));

  return { mode, polled: streams.length > 0, upserted, softDeleted, generation: Math.max(1, conn.syncGeneration ?? 0), orgId: conn.orgId, source: conn.source };
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

async function upsertCursor(db: DB, connectionId: string, cursor: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ connectionId, cursor, lastPolledAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.connectionId, set: { cursor, lastPolledAt: now, updatedAt: now } });
}
