import { and, eq, inArray, sql } from "drizzle-orm";
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
import { streamRefsOfGraph } from "@/lib/sync/streams";
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

/**
 * One stream that the reset will re-create, and the flows that asked for it.
 *
 * Computed identically in inspect and apply, and in apply it is the literal
 * work list — so the list printed before the run is the list performed by it,
 * and a human can check it against the flows they expect to be syncing rather
 * than trusting a bare count.
 */
export type ReRegisterPlanEntry = {
  connectionId: string;
  /** Connection name as shown on the Integrations page. */
  connectionName: string;
  /** Connector source key: calendly | gsheets | gcal | instantly | … */
  source: string;
  configHash: string;
  /** The resource this stream reads (spreadsheet + tab, calendar, campaign …). */
  config: Record<string, unknown>;
  /** Names of the flows referencing it, from their draft or published graph. */
  flows: string[];
};

export type ResetReport = {
  level: ResetLevel;
  dryRun: boolean;
  /** Rows found (inspect) or deleted (apply), per table, in execution order. */
  tables: Array<{ table: string; rows: number }>;
  /** Connection rows whose sync bookkeeping was cleared. */
  connectionsRearmed: number;
  /**
   * Streams re-registered afterwards (level=data only) — in inspect, how many
   * WOULD be. Equals `reRegisterPlan.length` on a clean run; a smaller number
   * in apply means some rows already existed, which only happens when a
   * previous run was interrupted after this step.
   */
  streamsReRegistered: number;
  /** Exactly which streams those are. Empty at level=all (flows are deleted). */
  reRegisterPlan: ReRegisterPlanEntry[];
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
 * Work out which stream rows the reset will have to re-create, and for whom.
 *
 * Without re-registration, clearing `source_streams` leaves stream-scoped
 * connections (Calendly, Sheets, Calendar, Instantly) DARK: the sweep iterates
 * `activeStreams(connectionId)` and does nothing when there are no rows, and the
 * only two things that create them are a flow save and a Test. So a wipe would
 * silently stop those connections syncing until a human opened every flow.
 *
 * Both the DRAFT graph and the CURRENTLY PUBLISHED version are read, matching
 * `referencedStreamKeys` — a published flow keeps running against the graph it
 * was published with, so restoring only the draft's streams would leave a
 * published flow reading a stream that no longer exists. Older versions are not
 * read: nothing runs them.
 */
async function reRegisterPlan(db: DB): Promise<ReRegisterPlanEntry[]> {
  const conns = await db
    .select({ id: connections.id, orgId: connections.orgId, source: connections.source, name: connections.name })
    .from(connections);
  const flowRows = await db
    .select({ id: flows.id, orgId: flows.orgId, name: flows.name, graph: flows.draftGraph })
    .from(flows);
  const publishedRows = await db
    .select({ flowId: flowVersions.flowId, graph: flowVersions.graph })
    .from(flowVersions)
    .innerJoin(flows, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)));

  const byFlow = new Map<string, Array<Record<string, unknown>>>();
  for (const f of flowRows) byFlow.set(f.id, [f.graph]);
  for (const v of publishedRows) byFlow.get(v.flowId)?.push(v.graph);

  const plan = new Map<string, ReRegisterPlanEntry>();
  for (const flow of flowRows) {
    const orgConns = conns.filter((c) => c.orgId === flow.orgId);
    const sourceOf = (id: string) => orgConns.find((c) => c.id === id)?.source;
    for (const raw of byFlow.get(flow.id) ?? []) {
      let refs;
      try {
        refs = streamRefsOfGraph(parseGraph(raw), sourceOf);
      } catch {
        // An unparseable or stale graph must not abort the reset; its flow
        // simply re-registers the next time it is saved.
        continue;
      }
      for (const ref of refs) {
        const conn = orgConns.find((c) => c.id === ref.connectionId);
        if (!conn) continue; // stale/foreign connection id
        const key = `${ref.connectionId}:${ref.configHash}`;
        const entry = plan.get(key) ?? {
          connectionId: ref.connectionId,
          connectionName: conn.name,
          source: conn.source,
          configHash: ref.configHash,
          config: ref.config,
          flows: [],
        };
        if (!entry.flows.includes(flow.name)) entry.flows.push(flow.name);
        plan.set(key, entry);
      }
    }
  }
  return [...plan.values()];
}

/**
 * Create exactly the rows `reRegisterPlan` listed.
 *
 * The registration comes back with a NULL cursor, which is the desired end
 * state: the stream exists, and its next poll is a first sync.
 */
async function reRegisterStreams(db: DB, plan: ReRegisterPlanEntry[]): Promise<number> {
  const conns = await db.select({ id: connections.id, orgId: connections.orgId }).from(connections);
  let created = 0;
  for (const entry of plan) {
    const orgId = conns.find((c) => c.id === entry.connectionId)?.orgId;
    if (!orgId) continue;
    const rows = await db
      .insert(sourceStreams)
      .values({ orgId, connectionId: entry.connectionId, configHash: entry.configHash, config: entry.config })
      .onConflictDoNothing({ target: [sourceStreams.connectionId, sourceStreams.configHash] })
      .returning({ id: sourceStreams.id });
    created += rows.length;
    // A row surviving from an interrupted run may have been pruned as an orphan
    // before the reset; a referenced stream is by definition not one.
    if (rows.length === 0) {
      await db
        .update(sourceStreams)
        .set({ status: "active", updatedAt: new Date() })
        .where(
          and(
            eq(sourceStreams.connectionId, entry.connectionId),
            eq(sourceStreams.configHash, entry.configHash),
            eq(sourceStreams.status, "disabled"),
          ),
        );
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

  // At `all` the flows and connections this reads are gone, so there is nothing
  // to re-register and nothing to re-arm.
  const plan = level === "all" ? [] : await reRegisterPlan(db);

  if (dryRun) {
    return {
      level,
      dryRun,
      tables,
      connectionsRearmed: level === "all" ? 0 : await countRows(db, connections),
      streamsReRegistered: plan.length,
      reRegisterPlan: plan,
    };
  }

  const connectionsRearmed = level === "all" ? 0 : await rearmConnections(db);
  const streamsReRegistered = level === "all" ? 0 : await reRegisterStreams(db, plan);
  return { level, dryRun, tables, connectionsRearmed, streamsReRegistered, reRegisterPlan: plan };
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
