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
  (t) => [index("raw_events_conn_idx").on(t.connectionId)],
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
    computedAt: timestamp("computed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("flow_results_flow_output_uq").on(t.flowId, t.outputNodeId),
    index("flow_results_org_idx").on(t.orgId),
  ],
);
