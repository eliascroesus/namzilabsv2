import { eq } from "drizzle-orm";
import { connections, syncState } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "./pipeline";
import { activeStreams, syncStream } from "@/lib/sync/streams";

export type ReconcileResult = { inserted: number; deduped: number; polled: boolean };

/**
 * The safety net that makes "never breaks" true: re-pull recent records from the
 * source and dedup them against what we already have, so any event a webhook
 * missed is still captured on the next sweep.
 *
 * Stream-scoped sources (Sheets, Calendar — the resource is chosen per flow)
 * poll each of their streams with its own cursor; a failing stream records its
 * error on the stream row and never blocks the others. Connection-scoped
 * sources keep the single connection-level cursor.
 */
export async function reconcileConnection(db: DB, connectionId: string): Promise<ReconcileResult> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new Error(`connection ${connectionId} not found`);

  const connector = getConnector(conn.source);
  // Sources that only push (no list endpoint) have nothing to reconcile.
  if (!connector?.poll) return { inserted: 0, deduped: 0, polled: false };

  if (isStreamScoped(conn.source)) {
    const streams = await activeStreams(db, connectionId);
    let inserted = 0;
    let deduped = 0;
    for (const stream of streams) {
      if (stream.status === "disabled") continue;
      try {
        const r = await syncStream(db, conn, stream, 5);
        inserted += r.inserted;
        deduped += r.deduped;
      } catch {
        // Recorded on the stream row; other streams keep syncing.
      }
    }
    return { inserted, deduped, polled: streams.length > 0 };
  }

  const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId)).limit(1);
  const cursor = state?.cursor ?? null;

  const credentials = await getConnectionCredentials(db, conn);

  const { records, nextCursor } = await connector.poll({
    connectionId,
    cursor,
    credentials,
    config: conn.config ?? undefined,
  });

  const res = await upsertEvents(db, { orgId: conn.orgId, connectionId, source: conn.source }, records);
  await upsertSyncCursor(db, connectionId, nextCursor);

  return { inserted: res.inserted, deduped: res.deduped, polled: true };
}

async function upsertSyncCursor(db: DB, connectionId: string, cursor: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ connectionId, cursor, lastPolledAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: syncState.connectionId,
      set: { cursor, lastPolledAt: now, updatedAt: now },
    });
}
