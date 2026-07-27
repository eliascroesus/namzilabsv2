import { eq, inArray, sql } from "drizzle-orm";
import {
  connections,
  deadLetter,
  deliveryLog,
  events,
  flowResults,
  flowVersions,
  flows,
  metrics,
  rawEvents,
  sourceStreams,
  streamFields,
  syncState,
  testRuns,
  usageLedger,
} from "@/db/schema";
import type { DB } from "@/db/types";
import { ensureStreamsForGraph } from "@/lib/sync/streams";
import { parseGraph } from "@/lib/flow/types";

/**
 * Wipe synced and computed data so the product can be exercised from a clean
 * state. Destructive by design, so every guard is deliberate: inspect by
 * default, an explicit confirmation to write, batched deletes, and idempotent
 * (a re-run, or a resumed interrupted run, finds nothing left).
 *
 * `data` — everything the product DERIVED. Accounts, connections, metric
 * definitions and flows survive, so the app is immediately usable and simply
 * has no data yet.
 *
 * `all` — additionally the things a USER authored (connections, metrics, flows
 * and their versions). Organizations, users and memberships always survive;
 * there is no level that deletes an account.
 */
export type ResetLevel = "data" | "all";

export type ResetReport = {
  level: ResetLevel;
  dryRun: boolean;
  /** Rows found (inspect) or deleted (apply), per table, in execution order. */
  tables: Array<{ table: string; rows: number }>;
  /** Connection rows whose sync bookkeeping was cleared. */
  connectionsRearmed: number;
  /** Streams re-registered from flow config afterwards (level=data only). */
  streamsReRegistered: number;
};

/** Rows removed per statement, so one delete can't lock a hot table. */
const BATCH = 5_000;

/**
 * Tables holding data the product derived from a provider or computed itself.
 * Order matters only for readability — none of these reference each other.
 */
const DATA_TABLES = [
  { name: "events", table: events },
  { name: "raw_events", table: rawEvents },
  { name: "sync_state", table: syncState },
  { name: "source_streams", table: sourceStreams },
  { name: "stream_fields", table: streamFields },
  { name: "usage_ledger", table: usageLedger },
  { name: "delivery_log", table: deliveryLog },
  { name: "dead_letter", table: deadLetter },
  { name: "test_runs", table: testRuns },
  { name: "flow_results", table: flowResults },
] as const;

/**
 * User-authored config, cleared only at `all`. `flow_versions` and `flows` are
 * last because the versions reference the flow; `flow_results` is already gone
 * with the data tables above.
 */
const CONFIG_TABLES = [
  { name: "metrics", table: metrics },
  { name: "flow_versions", table: flowVersions },
  { name: "flows", table: flows },
  { name: "connections", table: connections },
] as const;

type AnyTable = (typeof DATA_TABLES)[number]["table"] | (typeof CONFIG_TABLES)[number]["table"];

async function countRows(db: DB, table: AnyTable): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(table);
  return Number(row?.c ?? 0);
}

/**
 * Delete every row, in bounded batches.
 *
 * `sync_state` is keyed by `connection_id` rather than `id`, so the batch key is
 * chosen per table rather than assumed.
 */
async function purge(db: DB, table: AnyTable): Promise<number> {
  let removed = 0;
  for (;;) {
    if (table === syncState) {
      const batch = await db.select({ k: syncState.connectionId }).from(syncState).limit(BATCH);
      if (batch.length === 0) break;
      const done = await db
        .delete(syncState)
        .where(inArray(syncState.connectionId, batch.map((b) => b.k)))
        .returning({ k: syncState.connectionId });
      removed += done.length;
      if (done.length < BATCH) break;
      continue;
    }
    const t = table as Exclude<AnyTable, typeof syncState>;
    const batch = await db.select({ k: t.id }).from(t).limit(BATCH);
    if (batch.length === 0) break;
    const done = await db
      .delete(t)
      .where(inArray(t.id, batch.map((b) => b.k)))
      .returning({ k: t.id });
    removed += done.length;
    if (done.length < BATCH) break;
  }
  return removed;
}

/**
 * Put every connection back to how it looked before it had ever synced —
 * WITHOUT touching credentials, config or name.
 *
 * Needed because `connections` survives a `data` reset while carrying the sync
 * bookkeeping: a connection parked on the 6-hour idle tier, or paused by the
 * breaker, would not sweep for hours after a wipe, which defeats the point of
 * resetting.
 *
 * `sync_generation` is deliberately NOT reset, and this is load-bearing rather
 * than an oversight. The generation only ever ratchets up (`GREATEST` in
 * `upsertEvents`), so starting from a high number costs nothing. Resetting it
 * while ANY event row survives — a partially completed run, an interrupted
 * delete — would leave those rows at a HIGHER generation than the connection's
 * current one, where the upsert's `excluded.sync_generation >= events.
 * sync_generation` guard makes every later write a no-op against them and the
 * full-resync retire (`sync_generation < gen`) never matches them. They would be
 * permanent, un-updatable duplicates. If this ever does need resetting, it must
 * happen strictly AFTER events are confirmed empty, never before.
 */
async function rearmConnections(db: DB): Promise<number> {
  const rows = await db
    .update(connections)
    .set({
      syncStatus: "synced",
      status: "active",
      lastError: null,
      lastEventAt: null,
      historicalSyncedAt: null,
      pausedUntil: null,
      pausedReason: null,
      consecutiveFailures: 0,
      nextSweepAt: null,
      consecutiveNoOpSweeps: 0,
      webhookHealthyAt: null,
      updatedAt: new Date(),
    })
    .returning({ id: connections.id });
  return rows.length;
}

/**
 * Re-create a stream row for every resource the org's flows still reference.
 *
 * Without this, clearing `source_streams` leaves stream-scoped connections
 * (Calendly, Sheets, Calendar, Instantly) DARK: the sweep iterates
 * `activeStreams(connectionId)` and does nothing when there are no rows, and the
 * only two things that create them are a flow save and a Test. So a wipe would
 * silently stop those connections syncing until a human opened each flow.
 *
 * Re-registering restores the registration with a NULL cursor, which is exactly
 * the desired end state: the stream exists, and its next poll is a first sync.
 */
async function reRegisterStreams(db: DB): Promise<number> {
  const rows = await db.select({ orgId: flows.orgId, graph: flows.draftGraph }).from(flows);
  let created = 0;
  for (const row of rows) {
    try {
      const res = await ensureStreamsForGraph(db, row.orgId, parseGraph(row.graph));
      created += res.created;
    } catch {
      // An unparseable or stale graph must not abort the reset; its flow simply
      // re-registers the next time it is saved.
    }
  }
  return created;
}

export async function resetData(db: DB, opts: { level?: ResetLevel; apply?: boolean } = {}): Promise<ResetReport> {
  const level = opts.level ?? "data";
  const dryRun = !opts.apply;
  const targets = level === "all" ? [...DATA_TABLES, ...CONFIG_TABLES] : DATA_TABLES;

  const tables: ResetReport["tables"] = [];
  for (const t of targets) {
    tables.push({ table: t.name, rows: dryRun ? await countRows(db, t.table) : await purge(db, t.table) });
  }

  if (dryRun) {
    return {
      level,
      dryRun,
      tables,
      connectionsRearmed: level === "all" ? 0 : await countRows(db, connections),
      streamsReRegistered: 0,
    };
  }

  // Both only make sense while connections and flows still exist.
  const connectionsRearmed = level === "all" ? 0 : await rearmConnections(db);
  const streamsReRegistered = level === "all" ? 0 : await reRegisterStreams(db);
  return { level, dryRun, tables, connectionsRearmed, streamsReRegistered };
}

/** Flows whose Get-data steps reference a connection that no longer exists. */
export async function orphanedFlowCount(db: DB): Promise<number> {
  const conns = new Set((await db.select({ id: connections.id }).from(connections)).map((c) => c.id));
  const rows = await db.select({ graph: flows.draftGraph }).from(flows);
  let n = 0;
  for (const row of rows) {
    try {
      const graph = parseGraph(row.graph);
      const refs = graph.nodes
        .filter((node) => node.type === "app")
        .map((node) => (node.data.config as { connectionId?: unknown } | undefined)?.connectionId)
        .filter((id): id is string => typeof id === "string");
      if (refs.some((id) => !conns.has(id))) n += 1;
    } catch {
      // Unparseable graphs are their own problem, not this count's.
    }
  }
  return n;
}

/** Connection ids with no `sync_state` row — i.e. never polled since a reset. */
export async function unsyncedConnectionCount(db: DB): Promise<number> {
  const all = await db.select({ id: connections.id }).from(connections);
  let n = 0;
  for (const c of all) {
    const [state] = await db.select({ id: syncState.connectionId }).from(syncState).where(eq(syncState.connectionId, c.id)).limit(1);
    if (!state) n += 1;
  }
  return n;
}
