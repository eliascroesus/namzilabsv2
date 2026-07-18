import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { connections, events, syncState, rawEvents } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { getConnectionCredentials } from "@/lib/credentials";
import { processRawEvent } from "@/ingestion/pipeline";
import type { CanonicalEvent, Connector, PollArgs } from "@/connectors/types";

const PAGE_CAP = 200;

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
    return { mode, polled: false, upserted: 0, softDeleted: 0, generation: conn.syncGeneration, orgId: conn.orgId, source: conn.source };
  }

  await db.update(connections).set({ syncStatus: "importing", updatedAt: new Date() }).where(eq(connections.id, connectionId));

  try {
    const credentials = await getConnectionCredentials(db, conn);
    const meta = { orgId: conn.orgId, connectionId: conn.id, source: conn.source };
    const base: PollArgs = { connectionId: conn.id, cursor: null, credentials, config: conn.config ?? undefined };

    if (mode === "full") {
      const gen = Math.max(1, (conn.syncGeneration ?? 0) + 1);
      const { records, cursor } = await pollAll(connector, base);
      const upserted = await upsertEventsGen(db, meta, records, gen);

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

      return { mode: "full", polled: true, upserted, softDeleted: del.length, generation: gen, orgId: conn.orgId, source: conn.source };
    }

    // incremental: fetch from the stored cursor, additive (no soft-delete).
    const gen = Math.max(1, conn.syncGeneration ?? 0);
    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, conn.id)).limit(1);
    const { records, nextCursor } = await connector.poll({ ...base, cursor: state?.cursor ?? null });
    const upserted = await upsertEventsGen(db, meta, records, gen);
    await db
      .update(connections)
      .set({ syncStatus: "live", lastEventAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    await upsertCursor(db, conn.id, nextCursor);

    return { mode: "incremental", polled: true, upserted, softDeleted: 0, generation: gen, orgId: conn.orgId, source: conn.source };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(connections).set({ syncStatus: "error", lastError: message, updatedAt: new Date() }).where(eq(connections.id, connectionId));
    throw e;
  }
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

async function upsertEventsGen(
  db: DB,
  meta: { orgId: string; connectionId: string; source: string },
  records: CanonicalEvent[],
  generation: number,
): Promise<number> {
  let n = 0;
  for (const ev of records) {
    const shared = {
      eventType: ev.eventType,
      subject: ev.subject ?? null,
      occurredAt: ev.occurredAt,
      value: ev.value != null ? String(ev.value) : null,
      currency: ev.currency ?? null,
      properties: ev.properties ?? {},
      syncGeneration: generation,
      deletedAt: null,
    };
    await db
      .insert(events)
      .values({ eventId: ev.eventId, orgId: meta.orgId, connectionId: meta.connectionId, source: meta.source, ...shared })
      .onConflictDoUpdate({ target: events.eventId, set: shared });
    n += 1;
  }
  return n;
}

async function upsertCursor(db: DB, connectionId: string, cursor: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ connectionId, cursor, lastPolledAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.connectionId, set: { cursor, lastPolledAt: now, updatedAt: now } });
}
