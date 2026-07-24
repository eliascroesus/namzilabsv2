import { and, eq } from "drizzle-orm";
import { connections, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
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

export type StreamSyncResult = { inserted: number; deduped: number };

type StreamRow = typeof sourceStreams.$inferSelect;
type ConnRow = typeof connections.$inferSelect;

/**
 * Poll one stream incrementally from its stored cursor and upsert the results
 * (deduped, tagged with the stream's hash). `maxPages` bounds inline/first-run
 * syncs so a huge sheet can't blow a request timeout — the sweep finishes the
 * rest, page by page, on its schedule.
 */
export async function syncStream(db: DB, conn: ConnRow, stream: StreamRow, maxPages = 1): Promise<StreamSyncResult> {
  const connector = getConnector(conn.source);
  if (!connector?.poll) return { inserted: 0, deduped: 0 };
  const credentials = await getConnectionCredentials(db, conn);

  let cursor = stream.cursor ?? null;
  let inserted = 0;
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
      const res = await upsertEvents(db, { orgId: conn.orgId, connectionId: conn.id, source: conn.source, streamHash: stream.configHash }, records);
      inserted += res.inserted;
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
  return { inserted, deduped };
}

/** All streams of one connection that should be polled. */
export async function activeStreams(db: DB, connectionId: string): Promise<StreamRow[]> {
  return db
    .select()
    .from(sourceStreams)
    .where(and(eq(sourceStreams.connectionId, connectionId)));
}

/**
 * First-use sync for a flow's freshly configured resource: make sure the stream
 * exists and, if it has never been polled, pull its first pages right now so the
 * user's explicit Test has real data to show. Returns the error message instead
 * of throwing so the Test surface can present it.
 */
export async function primeStream(
  db: DB,
  orgId: string,
  connectionId: string,
  sourceConfig: Record<string, unknown>,
  maxPages = 3,
): Promise<{ ok: true } | { ok: false; error: string }> {
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
  if (stream.lastPolledAt != null) return { ok: true }; // already syncing on the sweep

  try {
    await syncStream(db, conn, stream, maxPages);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
