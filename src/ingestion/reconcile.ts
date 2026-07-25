import { eq } from "drizzle-orm";
import { connections, syncState } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "./pipeline";
import { activeStreams, syncStream } from "@/lib/sync/streams";

export type ReconcileResult = {
  inserted: number;
  /** Existing rows whose content actually changed (mirror refresh, upstream edit). */
  updated: number;
  /** Rows soft-deleted because a mirror re-read no longer produced them. */
  softDeleted: number;
  deduped: number;
  polled: boolean;
  /** Tenant + source identity, so callers can mark dependent flows stale. */
  orgId: string;
  source: string;
};

/** Did this sweep change what dashboards would show? (drives staleness) */
export function reconcileChanged(r: Pick<ReconcileResult, "inserted" | "updated" | "softDeleted">): boolean {
  return r.inserted + r.updated + r.softDeleted > 0;
}

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
  if (!connector?.poll) return { inserted: 0, updated: 0, softDeleted: 0, deduped: 0, polled: false, orgId: conn.orgId, source: conn.source };

  if (isStreamScoped(conn.source)) {
    const streams = await activeStreams(db, connectionId);
    let inserted = 0;
    let updated = 0;
    let softDeleted = 0;
    let deduped = 0;
    for (const stream of streams) {
      if (stream.status === "disabled") continue;
      try {
        const r = await syncStream(db, conn, stream, 5);
        inserted += r.inserted;
        updated += r.updated;
        softDeleted += r.softDeleted;
        deduped += r.deduped;
      } catch {
        // Recorded on the stream row; other streams keep syncing.
      }
    }
    return { inserted, updated, softDeleted, deduped, polled: streams.length > 0, orgId: conn.orgId, source: conn.source };
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

  // Connection-scoped reconciliation writes at the connection's current
  // generation (>= 1): these are poll-managed rows a future full re-sync must
  // be able to retire, not append-only webhook rows.
  const res = await upsertEvents(
    db,
    { orgId: conn.orgId, connectionId, source: conn.source, generation: Math.max(1, conn.syncGeneration ?? 0) },
    records,
  );
  await upsertSyncCursor(db, connectionId, nextCursor);

  return { inserted: res.inserted, updated: res.updated, softDeleted: 0, deduped: res.deduped, polled: true, orgId: conn.orgId, source: conn.source };
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
