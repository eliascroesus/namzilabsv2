import { eq } from "drizzle-orm";
import { connections, syncState } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { markStaleForSource } from "@/lib/flow/materialize";
import { upsertEvents } from "./pipeline";
import { activeStreams, mirrorStream, syncStream } from "@/lib/sync/streams";

export type ReconcileResult = {
  inserted: number;
  updated: number;
  deduped: number;
  softDeleted: number;
  polled: boolean;
  /** Anything actually changed — drives dashboard staleness. */
  changed: boolean;
  orgId: string;
  source: string;
};

/**
 * The recurring accuracy sweep (every 10 minutes): each connection's data is
 * brought back to 1:1 with its source, by the connector's declared strategy:
 *
 *  - mirror streams (Sheets, Calendly): a FULL refresh pass — every record
 *    re-read and refreshed, rows the source no longer has soft-deleted. After
 *    the pass, live rows ≡ the current source. Cell edits, reschedules,
 *    deletions and re-sorts all land here, automatically.
 *  - incremental streams/connections (Calendar sync tokens, Close event log):
 *    cursor walk; re-seen records refresh; source-reported cancellations
 *    arrive as soft-deletes.
 *
 * Per stream try/catch: a failing resource records its error on its own stream
 * row and never blocks the others.
 */
export async function reconcileConnection(db: DB, connectionId: string): Promise<ReconcileResult> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new Error(`connection ${connectionId} not found`);

  const zero: ReconcileResult = { inserted: 0, updated: 0, deduped: 0, softDeleted: 0, polled: false, changed: false, orgId: conn.orgId, source: conn.source };

  const connector = getConnector(conn.source);
  // Sources that only push (no list endpoint) have nothing to reconcile.
  if (!connector?.poll) return zero;

  if (isStreamScoped(conn.source)) {
    const streams = await activeStreams(db, connectionId);
    const acc = { ...zero, polled: streams.length > 0 };
    for (const stream of streams) {
      if (stream.status === "disabled") continue;
      try {
        if (connector.syncStrategy === "mirror") {
          const r = await mirrorStream(db, conn, stream);
          acc.inserted += r.inserted;
          acc.updated += r.updated;
          acc.softDeleted += r.softDeleted;
        } else {
          const r = await syncStream(db, conn, stream, 5);
          acc.inserted += r.inserted;
          acc.updated += r.updated;
          acc.deduped += r.deduped;
        }
      } catch {
        // Recorded on the stream row; other streams keep syncing.
      }
    }
    acc.changed = acc.inserted + acc.updated + acc.softDeleted > 0;
    return acc;
  }

  // Connection-scoped incremental (Close): walk the connection-level cursor.
  // Generation 0 on purpose — these rows live alongside webhook rows (both have
  // a null streamHash) and must never become delete-eligible by a sweep; only
  // an explicit full re-sync stamps generations there.
  const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId)).limit(1);
  const credentials = await getConnectionCredentials(db, conn);
  const { records, nextCursor } = await connector.poll({
    connectionId,
    cursor: state?.cursor ?? null,
    credentials,
    config: conn.config ?? undefined,
  });

  const res = await upsertEvents(db, { orgId: conn.orgId, connectionId, source: conn.source }, records);
  await upsertSyncCursor(db, connectionId, nextCursor);

  return {
    ...zero,
    inserted: res.inserted,
    updated: res.updated,
    deduped: res.deduped,
    polled: true,
    changed: res.inserted + res.updated > 0,
  };
}

/**
 * Reconcile + downstream freshness: when the sweep changed anything, every
 * published flow reading this source is marked stale so the next materialize
 * pass recomputes its dashboard tiles. This is what carries a sheet edit all
 * the way to the dashboard with no user action.
 */
export async function sweepConnection(db: DB, connectionId: string): Promise<ReconcileResult> {
  const res = await reconcileConnection(db, connectionId);
  if (res.changed) await markStaleForSource(db, res.orgId, res.source, connectionId);
  return res;
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
