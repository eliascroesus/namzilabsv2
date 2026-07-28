import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Multi-tenant identity. `organizations.id` / `users.id` are the WorkOS ids
 * (strings), so WorkOS remains the source of truth for identity and membership.
 * `orgId` on every domain table is the WorkOS organization id and is the tenant
 * isolation key — it is only ever derived from the authenticated session.
 */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId)],
);

/**
 * A connected external account (one Calendly account, one Close org, one
 * Google account, one generic catch-hook, ...). Credentials are always stored
 * encrypted (AES-256-GCM) — never in plaintext.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    source: text("source").notNull(), // calendly | close | instantly | sendblue | gsheets | gcal | webhook
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // active | error | disabled
    authType: text("auth_type").notNull().default("none"), // apiKey | oauth2 | secret | none
    credentialsEncrypted: text("credentials_encrypted"),
    signingSecretEncrypted: text("signing_secret_encrypted"),
    config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
    lastError: text("last_error"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    // Data freshness for the canvas + integrations: importing | live | synced | outdated | error
    syncStatus: text("sync_status").notNull().default("synced"),
    // Incremented by a full re-sync; events are tagged with the generation they were last seen in.
    syncGeneration: integer("sync_generation").notNull().default(0),
    historicalSyncedAt: timestamp("historical_synced_at", { withTimezone: true }),
    /**
     * F.3/F.6 — never a terminal state. When a connection is throttled
     * (budget exhausted) or its breaker trips (consecutive failures), work is
     * DEFERRED to `pausedUntil` and retried automatically: the sweep skips it
     * until then, and the connection page shows a countdown, not a dead end.
     * `consecutiveFailures` drives the probe ladder (1h → 4h → daily) and
     * resets to 0 on any success.
     */
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    /** Why it's paused, in plain language, for the connection page. */
    pausedReason: text("paused_reason"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /**
     * H.2 — adaptive cadence. Background work scales with CHANGE RATE, not
     * tenant count: `next_sweep_at` is when this connection is next due, and
     * the sweep only dispatches connections that are due. Quiet connections
     * back off (10min → hourly → daily); any activity promotes them instantly.
     */
    nextSweepAt: timestamp("next_sweep_at", { withTimezone: true }),
    /** H.1 — consecutive sweeps that found nothing; drives the backoff tier. */
    consecutiveNoOpSweeps: integer("consecutive_no_op_sweeps").notNull().default(0),
    /**
     * F.5 — when the provider-side webhook subscription was last verified
     * healthy. A live instant path makes frequent polling redundant, so the
     * poll demotes to a slow backstop instead of racing the webhook.
     */
    webhookHealthyAt: timestamp("webhook_healthy_at", { withTimezone: true }),
    /**
     * When the user disconnected this integration.
     *
     * Disconnecting used to hard-delete the row, which made reconnecting
     * impossible to do WELL: every connector namespaces its eventId with the
     * connection UUID, so a delete-and-re-add produced a second complete copy of
     * the dataset under new ids, with the old copy tombstoned beside it. No
     * amount of matching on the provider account could undo that — the two
     * copies are genuinely different rows.
     *
     * Keeping the row keeps the UUID, and keeping the UUID makes reconnecting
     * free: flip `status` back to active, clear this, clear `deleted_at` on its
     * events. Nothing is re-fetched and nothing is duplicated.
     *
     * It is also the clock the purge runs on. Nothing may be hard-deleted on the
     * strength of `status` alone — a connection disabled a minute ago and one
     * disabled two months ago look identical without this.
     */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("connections_org_idx").on(t.orgId), index("connections_status_idx").on(t.status)],
);

/**
 * IMMUTABLE source of truth. Every inbound payload lands here first, exactly as
 * received, before any processing. This is what makes replay + audit possible.
 */
export const rawEvents = pgTable(
  "raw_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    source: text("source").notNull(),
    headers: jsonb("headers").$type<Record<string, string>>().default({}).notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").default(false).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("raw_events_conn_idx").on(t.connectionId),
    // The purge's access path: "this connection's raw payloads, older than X".
    // Without it that is a sequential scan of the largest table in the schema.
    index("raw_events_conn_received_idx").on(t.connectionId, t.receivedAt),
  ],
);

/**
 * The canonical, source-agnostic event model. EVERY connector normalizes into
 * this shape. `eventId` is the stable dedup primary key — unique across the
 * whole table (it is namespaced with source + connection by the connector).
 *
 * QUERY CONVENTION (load-bearing since the B.1 index redesign): every read of
 * this table MUST filter `deleted_at IS NULL` — soft-deleted rows are records
 * the source no longer has, and the composite indexes are PARTIAL over live
 * rows, so a query without the predicate silently degrades to a sequential
 * scan at scale. The only exemptions are lookups by `event_id` (unique index)
 * and deliberate tombstone inspection (admin/debug). Audited call sites:
 * engine appConds, metrics baseWhere/distinct*, resync + mirror sweeps,
 * dashboard widgets, flow editor type listing.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id").notNull(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(), // booked | canceled | reply | email_sent | sms_sent | ...
    subject: text("subject"), // person/lead identifier: email / phone / name
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    value: numeric("value"),
    currency: text("currency"),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}).notNull(),
    rawEventId: uuid("raw_event_id"),
    /**
     * A.2 — normalized identity handles extracted from the record (emails
     * lowercased, phones E.164, provider ids as-is). Additive and defaulted,
     * so nothing depends on it yet; it is what a future person/company
     * resolution joins on WITHOUT another schema change.
     */
    identifiers: jsonb("identifiers").$type<Record<string, unknown>>().default({}).notNull(),
    // Full-sync generation this row was last seen in (for versioned/safe re-sync).
    syncGeneration: integer("sync_generation").notNull().default(0),
    // Soft-delete: set when a full re-sync no longer sees a previously-synced record.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Which source stream (connection + resource config) produced this row. Null for
    // webhook/instant events and for connectors whose connection is the whole resource.
    streamHash: text("stream_hash"),
  },
  (t) => [
    uniqueIndex("events_event_id_uq").on(t.eventId),
    // Only index carrying event_type (distinct-type dropdowns, type filters).
    index("events_org_type_idx").on(t.orgId, t.eventType),
    // B.1 partial composites over LIVE rows — every production reader filters
    // deleted_at IS NULL. EXPLAIN-verified in tests/indexes-explain.test.ts.
    // The old single-purpose indexes (occurred_at), (connection_id) and
    // (connection_id, stream_hash) were strictly dominated by these for every
    // live query shape in the code and were dropped: redundant indexes cost
    // every write and left the planner picking between near-identical paths.
    //
    // Engine Get-data reads: newest-first scan of one stream (prefix also
    // serves whole-connection reads); (occurred_at DESC, id DESC) matches the
    // compiled engine's future deterministic total order.
    index("events_conn_stream_live_idx")
      .on(t.connectionId, t.streamHash, t.occurredAt.desc(), t.id.desc())
      .where(sql`deleted_at is null`),
    // Classic metrics / org-wide reads: org + time-range over live rows.
    index("events_org_live_occurred_idx").on(t.orgId, t.occurredAt).where(sql`deleted_at is null`),
    // Full-resync sweeps: retire live rows below the new generation.
    index("events_conn_gen_live_idx").on(t.connectionId, t.syncGeneration).where(sql`deleted_at is null`),
    // The one index over DEAD rows, and the reason it has to exist separately:
    // every index above is `WHERE deleted_at IS NULL`, which is precisely the
    // set a purge does NOT want. Finding tombstones older than a cutoff had no
    // supporting index at all, so any retention pass was a sequential scan of
    // the biggest table in the schema — which is why Phase 2 was unrunnable at
    // scale before this.
    index("events_deleted_idx").on(t.deletedAt).where(sql`deleted_at is not null`),
  ],
);

/**
 * What a purged connection HELD, after its data is gone.
 *
 * Phase 2 hard-deletes a disconnected connection's events at thirty days. That
 * is unrecoverable by design — but "unrecoverable" should not also mean
 * "unexplainable". Without this row, a user who reconnects at day 45 and sees
 * a shorter history than they remember has no way to tell whether their data
 * was deleted, never imported, or is still arriving.
 *
 * A summary, deliberately, and not a compressed copy: counts, a date range, the
 * resources it read. It answers "what was here and when did it go" and cannot
 * answer anything a per-row query could, which is the honest bargain — keeping
 * a partial copy would make every count in the product ambiguous about whether
 * archived rows are in it.
 *
 * Deliberately NOT the alternative that was considered: nulling `properties`
 * off retained rows. A row whose custom fields have been emptied reads as a
 * real row with empty values, so every filter over it silently changes answer —
 * and it would make something other than `upsertEvents` a writer of event
 * content.
 */
export const connectionArchive = pgTable(
  "connection_archive",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    /** The id the connection HAD. Not a foreign key: the row it named is gone. */
    connectionId: uuid("connection_id").notNull(),
    source: text("source").notNull(),
    name: text("name").notNull(),
    /** Its resource config, and the stream hashes it synced under. */
    config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
    streamHashes: jsonb("stream_hashes").$type<string[]>().default([]).notNull(),
    eventCount: integer("event_count").notNull().default(0),
    rawEventCount: integer("raw_event_count").notNull().default(0),
    oldestOccurredAt: timestamp("oldest_occurred_at", { withTimezone: true }),
    newestOccurredAt: timestamp("newest_occurred_at", { withTimezone: true }),
    /** When the user disconnected it — the clock the purge ran on. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One archive row per connection: the purge writes it before deleting, and
    // must be safe to resume after an interruption without writing a second.
    uniqueIndex("connection_archive_conn_uq").on(t.connectionId),
    index("connection_archive_org_idx").on(t.orgId),
  ],
);

/**
 * A.1 — the field registry. What fields a stream's records actually carry,
 * maintained by the WRITER instead of inferred by reading a sample at query
 * time. Field pickers read this (one indexed lookup, no scan), and E.7 uses
 * `approxCardinality` to warn when a dedupe key would collapse unrelated rows.
 */
export const streamFields = pgTable(
  "stream_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    /** Null for connection-scoped sources (the connection is the resource). */
    streamHash: text("stream_hash"),
    fieldPath: text("field_path").notNull(),
    inferredType: text("inferred_type").notNull().default("string"),
    /** Distinct values seen (approximate — sampled, not exact). */
    approxCardinality: integer("approx_cardinality").notNull().default(0),
    /** Rows seen carrying this field, for the null-rate estimate. */
    seenCount: integer("seen_count").notNull().default(0),
    sample: jsonb("sample").$type<Record<string, unknown>>(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("stream_fields_key_uq").on(t.connectionId, t.streamHash, t.fieldPath),
    index("stream_fields_org_idx").on(t.orgId),
  ],
);

/**
 * One synced resource of a connection — e.g. one spreadsheet+tab, one calendar.
 * The connection holds only authentication; each flow's "Get data" step declares
 * WHAT to pull (its sourceConfig), and saving the flow upserts the matching
 * stream here. The reconcile sweep polls every active stream with its own
 * cursor, and events are tagged with the stream's configHash so flows read
 * exactly the resource they configured. Streams are the long-term unit of sync.
 */
export const sourceStreams = pgTable(
  "source_streams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    /** Stable hash of the normalized resource config (also stamped on events). */
    configHash: text("config_hash").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
    cursor: text("cursor"),
    /**
     * 6.2 — how far back THIS stream is supposed to reach, when that is further
     * than the connector's own default.
     *
     * The stream owns its window because one value has to drive both the
     * request bound and the `retireOutsideWindow` the connector declares. Split
     * them and they disagree: a backfill importing 90 days of past meetings is
     * soft-deleted by the very next completed sweep, because Calendly declares
     * `{now-30d, now+90d}` and `syncStream` prunes outside it.
     *
     * The rejected alternative was marking backfilled rows exempt from the
     * retire. That creates a second class of row and makes the declared window
     * untrue — the stream would claim to cover 30 days while holding 90, and
     * every later reader would have to know which rows to believe.
     *
     * NULL means "the connector's default", which is the right answer for every
     * stream nobody has deepened.
     */
    windowFloor: timestamp("window_floor", { withTimezone: true }),
    status: text("status").notNull().default("active"), // active | error | disabled
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("source_streams_conn_cfg_uq").on(t.connectionId, t.configHash),
    index("source_streams_org_idx").on(t.orgId),
  ],
);

/**
 * F.1/F.7 — provider-call accounting. One row per
 * (connection, provider, operation, minute window): the token bucket's
 * counter, incremented atomically via INSERT … ON CONFLICT DO UPDATE so
 * concurrent workers can't overspend a published budget. Also the audit trail
 * for "how much of our quota did we actually use", and the breaker's evidence.
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    provider: text("provider").notNull(), // = connections.source
    /** Catalog rateLimits key, e.g. "emails.list"; "*" = whole-provider budget. */
    operation: text("operation").notNull().default("*"),
    /** Start of the counting window (minute-aligned). */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    calls: integer("calls").notNull().default(0),
    throttled: integer("throttled").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    /**
     * F.1 (observed) — the ceiling the PROVIDER said it had, from its own
     * response headers, as opposed to the figure guessed in the catalog.
     *
     * Recorded because it was already being parsed and thrown away.
     * `parseRateLimit` reads `limit`, `remaining` and `reset`; the runner acted
     * on `remaining` (defer when spent) and dropped `limit` on the floor — which
     * is the one number needed to declare a real budget. Four of seven sources
     * are currently governed by a DEFAULT_RPM of 60 that no provider ever
     * stated, and Close is the one that reports its true limit on every single
     * response.
     *
     * Nullable forever: most providers send no such header, and a window with no
     * observation is not a window with a limit of zero.
     */
    observedLimit: integer("observed_limit"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("usage_ledger_bucket_uq").on(t.connectionId, t.operation, t.windowStart),
    index("usage_ledger_org_idx").on(t.orgId),
    index("usage_ledger_window_idx").on(t.windowStart),
  ],
);

/**
 * Per-connection sync bookkeeping: polling cursor, Google push-channel id +
 * expiry (channels must be renewed before they expire), last poll / last event.
 */
export const syncState = pgTable("sync_state", {
  connectionId: uuid("connection_id").primaryKey(),
  cursor: text("cursor"),
  channelId: text("channel_id"),
  channelResourceId: text("channel_resource_id"),
  channelExpiry: timestamp("channel_expiry", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  /**
   * C.1 (connection scope): the lease held by whoever is currently syncing this
   * connection, and the deadline it expires at. See `withConnectionSyncLock` in
   * src/lib/sync/locks.ts for why the connection-level critical section is a
   * durable lease and not an advisory lock — in short, it has to span a provider
   * HTTP call, which an advisory lock cannot do without holding a transaction
   * open across the network.
   *
   * The token fences the release: a waiter that timed out and proceeded anyway
   * must never clear the lease of the writer it gave up on.
   */
  syncLockUntil: timestamp("sync_lock_until", { withTimezone: true }),
  syncLockToken: text("sync_lock_token"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Every processing attempt, for observability. */
export const deliveryLog = pgTable(
  "delivery_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    rawEventId: uuid("raw_event_id"),
    status: text("status").notNull(), // success | retry | failed
    attempt: integer("attempt").notNull().default(1),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("delivery_log_conn_idx").on(t.connectionId), index("delivery_log_status_idx").on(t.status)],
);

/** Exhausted-retry events. Never silently dropped — visible here and replayable. */
export const deadLetter = pgTable(
  "dead_letter",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    rawEventId: uuid("raw_event_id"),
    error: text("error").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("dead_letter_conn_idx").on(t.connectionId)],
);

/**
 * User-defined metric definitions (no-code). `definition` holds the full builder
 * config (source/event_type/filters/aggregation, or funnel stages), validated by
 * the Zod schema in src/lib/metrics/types.ts. Metrics are computed on-read over
 * the canonical `events` table, always org-scoped.
 */
export const metrics = pgTable(
  "metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // aggregate | funnel
    display: text("display").notNull().default("number"), // number | trend | bar | funnel
    unit: text("unit"),
    target: numeric("target"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("metrics_org_idx").on(t.orgId)],
);

/**
 * A visual metrics flow (the canvas document). `draftGraph` is the editable
 * working copy (autosaved). Publishing snapshots it into an immutable
 * `flow_versions` row; the live dashboard only ever reads the published version,
 * so draft edits never change dashboard output until republish.
 */
export const flows = pgTable(
  "flows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    draftGraph: jsonb("draft_graph")
      .$type<Record<string, unknown>>()
      .default({ nodes: [], edges: [] })
      .notNull(),
    status: text("status").notNull().default("draft"), // draft | published
    publishedVersion: integer("published_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("flows_org_idx").on(t.orgId)],
);

/** Immutable published snapshots of a flow graph. */
export const flowVersions = pgTable(
  "flow_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    version: integer("version").notNull(),
    graph: jsonb("graph").$type<Record<string, unknown>>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("flow_versions_flow_version_uq").on(t.flowId, t.version),
    index("flow_versions_org_idx").on(t.orgId),
  ],
);

/**
 * One user-initiated Test execution (D.1-full): the editor's Test button
 * enqueues a run on the high-priority lane and polls this row for the result,
 * so the interactive path never holds a long request open and never loses to a
 * serverless timeout. Rows are ephemeral working state (TTL cleanup rides the
 * delivery_log retention job when that ships).
 */
export const testRuns = pgTable(
  "test_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | ok | error
    /** The NodeTestDTO the editor renders, once settled. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("test_runs_org_idx").on(t.orgId), index("test_runs_created_idx").on(t.createdAt)],
);

/**
 * Materialized latest result for each Output node of a published flow. The
 * dashboard reads these (fast) instead of recomputing flows on every load; a
 * materializer refreshes them on publish, on relevant new data, on a schedule,
 * or on manual refresh.
 */
export const flowResults = pgTable(
  "flow_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    outputNodeId: text("output_node_id").notNull(),
    tile: jsonb("tile").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("stale"), // fresh | stale | computing | error
    error: text("error"),
    /**
     * E.5 — provenance. HOW this number was produced: the compiled SQL and its
     * bound parameters per Get-data node, which filters were folded, how many
     * rows were read, and the as-of watermark. A number a customer questions
     * can be traced to the exact query that produced it.
     */
    provenance: jsonb("provenance").$type<Record<string, unknown>>(),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("flow_results_flow_output_uq").on(t.flowId, t.outputNodeId),
    index("flow_results_org_idx").on(t.orgId),
  ],
);
