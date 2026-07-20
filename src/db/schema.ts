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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("connections_org_idx").on(t.orgId), index("connections_status_idx").on(t.status)],
);

/**
 * The unique inbound URL(s) that external apps POST to. One per connection for
 * the generic catch-hook; providers with their own subscription API also get a
 * row so every inbound path is addressable and revocable.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    slug: text("slug").notNull(),
    secretEncrypted: text("secret_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("webhook_endpoints_slug_uq").on(t.slug)],
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
    index("events_org_type_idx").on(t.orgId, t.eventType),
    index("events_occurred_idx").on(t.occurredAt),
    index("events_conn_idx").on(t.connectionId),
    index("events_conn_stream_idx").on(t.connectionId, t.streamHash),
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
