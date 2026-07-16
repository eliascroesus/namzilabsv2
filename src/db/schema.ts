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
  },
  (t) => [
    uniqueIndex("events_event_id_uq").on(t.eventId),
    index("events_org_type_idx").on(t.orgId, t.eventType),
    index("events_occurred_idx").on(t.occurredAt),
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
