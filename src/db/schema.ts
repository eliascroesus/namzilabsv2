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
 * IDENTITY LIVES IN WORKOS, NOT HERE — deliberately, and the schema now says
 * so by omission. Early versions mirrored `organizations`, `users` and
 * `memberships` locally; nothing ever read any of them (users/memberships
 * were never even written), so migration 0022 dropped all three. `orgId` on
 * every domain table is the WorkOS organization id and is the tenant
 * isolation key — only ever derived from the authenticated session
 * (src/lib/auth.ts), never from a local mirror that can drift. If a future
 * feature (billing, per-org settings) needs local org state, add a table FOR
 * THAT FEATURE, with a reader — a mirror with no reader is how these three
 * earned their drop.
 */

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
  (t) => [
    index("connections_org_idx").on(t.orgId),
    index("connections_status_idx").on(t.status),
    // The sweep's work-list question, asked every 10 minutes of the whole
    // table: "active, and due by cadence". `connections_status_idx` alone
    // degrades to scanning every active connection — at fleet size that is a
    // full scan per tick for the three-value status column. Partial on the
    // status the sweep actually dispatches; NULL next_sweep_at rows (never
    // swept → due immediately) are still in the index, btree stores them.
    index("connections_due_sweep_idx").on(t.nextSweepAt).where(sql`status = 'active'`),
  ],
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
    // The purge's access path: "this connection's raw payloads, older than X".
    // Without it that is a sequential scan of the largest table in the schema.
    // Also serves every lookup the old `raw_events_conn_idx` served — a btree
    // on (a, b) answers a-only queries, so the single-column index was pure
    // write amplification on the highest-write table here (migration 0020
    // drops it).
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
 * E.8 / Phase 6 — one unit of historical import for one stream.
 *
 * A row per PIECE OF WORK, not a set of columns on `source_streams`, because a
 * stream can be deepened more than once (30 days, then 90, then a year) and each
 * attempt has its own target, its own outcome and its own reason for stopping.
 * Columns on the stream would overwrite the record of the previous one, which is
 * exactly the bookkeeping whose absence makes an interrupted import
 * unresumable — the failure mode checklist 9a is written about.
 *
 * THE CHECKPOINT IS THE POINT. `reached_floor` and `checkpoint` are what let a
 * job resume rather than restart: work already committed stays committed, and
 * the next attempt picks up where the last one stopped. A backfill without them
 * is a long-running job that loses everything to any interruption.
 *
 * HOW THIS RELATES TO `source_streams.window_floor` (6.2), which is the part
 * that is easy to get wrong: the stream's window is extended to this job's
 * `target_floor` when the job STARTS, not as it progresses. Mid-import, rows
 * land older than the stream's declared window, and the next ordinary sweep
 * declares `retireOutsideWindow` from that window and tombstones them — the 6.2
 * retire trap, re-appearing while the import is still running. Over-declaring
 * retires LESS, which is the safe direction; a job that ends partial narrows the
 * window back to `reached_floor`, where by definition nothing lies outside.
 */
export const backfillJobs = pgTable(
  "backfill_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    /** `source_streams.id`. Backfill state belongs to the stream, never the flow (6.1). */
    streamId: uuid("stream_id").notNull(),
    /** Denormalized so a job is legible without a join, and survives the stream row. */
    streamHash: text("stream_hash").notNull(),
    /**
     * queued | running | complete | partial | failed
     *
     * `partial` is a TERMINAL success, and having it is the difference between
     * an honest lane and one that retries forever: the provider had less
     * history than asked for, or the row ceiling was reached. The job is done
     * and did not get everything, which is a fact to display rather than an
     * error to keep retrying.
     */
    status: text("status").notNull().default("queued"),
    /** How far back this job is trying to reach. */
    targetFloor: timestamp("target_floor", { withTimezone: true }).notNull(),
    /** How far back it HAS reached. The checkpoint's depth; null until the first lands. */
    reachedFloor: timestamp("reached_floor", { withTimezone: true }),
    /** The connector cursor at `reached_floor` — resume, never restart. */
    checkpoint: text("checkpoint"),
    rowsImported: integer("rows_imported").notNull().default(0),
    /**
     * 6.3's ceiling, stored PER JOB rather than read from config at display
     * time, so changing the policy later cannot retroactively alter what a
     * finished job means.
     */
    rowCeiling: integer("row_ceiling").notNull(),
    /** Why a terminal state is terminal, in language a user can read. */
    detail: text("detail"),
    attempts: integer("attempts").notNull().default(0),
    /**
     * When the checkpoint last MOVED — not when the row was last written.
     * 10(b) scans for a job that is `running` and has not progressed, which is
     * indistinguishable from a healthy one by `updated_at` alone.
     */
    lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    /**
     * 6.1, enforced in the database rather than in a check somewhere: asking for
     * a depth this stream is already importing or has already imported finds the
     * existing job instead of starting a second one. A second flow on a
     * backfilled stream therefore costs zero provider calls, and only a request
     * for a DEEPER floor is new work.
     */
    uniqueIndex("backfill_jobs_stream_target_uq").on(t.streamId, t.targetFloor),
    /** The lane's own work query, and 10(b)'s stuck-job scan, share this shape. */
    index("backfill_jobs_status_progress_idx").on(t.status, t.lastProgressAt),
    index("backfill_jobs_org_idx").on(t.orgId),
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
    // THE LIVE INDEX IS `NULLS NOT DISTINCT` (migration 0021) AND THIS
    // DECLARATION CANNOT SAY SO: drizzle-orm 0.45 only exposes
    // nullsNotDistinct() on unique() table constraints, and drizzle-kit's
    // snapshot has no field for it on indexes — so the declaration
    // under-describes, deliberately, and the migration file is the truth.
    // Safe because drizzle-kit cannot diff what it cannot represent (no
    // later db:generate can emit a spurious "correction"), and the schema
    // audit checks index NAMES only. Why it matters: stream_hash is NULL for
    // connection-scoped sources, and with default NULLS-DISTINCT semantics
    // recordFields' ON CONFLICT never fired for those scopes — a duplicate
    // row per field per batch, forever.
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
    /**
     * Which column of this resource holds a row's event time.
     *
     * A spreadsheet row has no timestamp of its own, so the Sheets connector
     * stamped `occurred_at` with `new Date()` — the import moment — and
     * `preserveOccurredAt` then froze it there. Every time-based metric over a
     * sheet was measuring when the data was imported. The sheet's real date was
     * sitting in a column all along, and `normalize-dates.ts` (built to read
     * exactly these shapes, "7/21/2026 14:23:45" among them) was already parsing
     * it into `properties` and never into `occurred_at`.
     *
     * PER STREAM, not per flow, and that is load-bearing rather than tidy.
     * `occurred_at` is a fact about a ROW, and a stream's rows are shared by
     * every flow reading it — two flows cannot hold different opinions about
     * when something happened. Per-node config would let the last sweep to read
     * a graph silently restamp another flow's numbers; putting it in the config
     * HASH instead would fork the stream and re-import the history (6.1). A
     * stream column is neither. Two tabs of one workbook are two streams and get
     * independent columns, which is right — "Bookings" may date from `Date`
     * while "Refunds" dates from `Processed at`.
     *
     * Deliberately NOT a `FlowConfigField.readFilter`, which was the obvious
     * home and would have been a silent no-op: `normalizeStreamConfig` STRIPS
     * readFilter keys before the config is stored, so the value would never
     * reach `poll()`. A read filter is also a WHERE clause over rows; this
     * changes how a row is stamped, not which rows are read.
     *
     * NULL means first-seen, which stays honest as long as the UI says that is
     * what it is.
     */
    dateField: text("date_field"),
    /**
     * Whether a HUMAN has answered the date-column question for this stream.
     *
     * `date_field` alone cannot say. NULL means "no column", and the two ways to
     * arrive at NULL need opposite treatment: a stream nobody has touched should
     * be dated automatically, and a stream whose owner deliberately chose "use
     * import time" must be left alone. Collapsing them is what made a sheet with
     * an obvious date column sit on import time until somebody noticed — broken
     * by default, which is the same defect one layer up from the one `date_field`
     * was added to fix.
     *
     * So: FALSE (the default) lets the sweep date rows from whatever column it
     * can detect, and TRUE means the picker has spoken — column or no column —
     * and detection stays out of it. The picker sets it; "Detect automatically"
     * clears it back, because an override with no way back is a one-way door.
     *
     * The DETECTION IS NOT STORED HERE, or anywhere. It is recomputed from the
     * header row and the values on every read, so `date_field` keeps exactly one
     * meaning — the user's answer — and the sweep never writes to a column the
     * picker owns. What the read actually used lands in `date_field_state`,
     * which is where "what happened" already lives.
     *
     * Backfilled TRUE for every stream that already had a `date_field` when this
     * column was added: those were explicit picks and must not be re-decided.
     */
    dateFieldLocked: boolean("date_field_locked").notNull().default(false),
    /**
     * Set when `date_field` changes; cleared by the sweep that acts on it.
     *
     * `preserveOccurredAt` pins `occurred_at` on conflict, so choosing a column
     * fixes NEW rows and leaves every existing one stamped with its import time
     * — and a full re-sync does not help, because it still upserts on `event_id`
     * and the pin still wins. The person who notices the problem and corrects it
     * is exactly the person the correction would silently fail for.
     *
     * So the restamp is one sweep that does not pin. Not an
     * `UPDATE events SET occurred_at`: that would make something other than
     * `upsertEvents` a writer of event content, and the pin is right for every
     * normal write — it is the CALLER that changes for one sweep, not the writer.
     *
     * THREE batches, not two, and the difference is not cosmetic. "Keep
     * first-seen" and "pass `preserveOccurredAt`" are the same thing only on the
     * FIRST restamp: preserve keeps whatever is STORED, so after one restamp a
     * row with no date in the newly-chosen column would keep the PREVIOUS
     * column's value — a column the user has explicitly abandoned — while the UI
     * reported it as having kept its import time. Reverting the picker to NULL
     * would be worse still: every row lands in the preserve batch, so nothing
     * changes and "first seen" becomes a one-way door.
     *
     * `events.received_at` is the recoverable first-seen. It defaults to now on
     * insert and appears in neither the insert list nor the `onConflictDoUpdate`
     * set (`pipeline.ts`), so no upsert or full re-sync has ever moved it, and
     * for every row written before this feature it sits within milliseconds of
     * the `new Date()` that stamped `occurred_at`. So:
     *   parsed              -> occurred_at = the column's date   (no pin)
     *   no date, column set -> occurred_at = received_at         (no pin)
     *   picker cleared      -> occurred_at = received_at         (no pin)
     * The caller must SELECT `received_at` for the stream's existing event ids
     * before building those batches, because `upsertEvents` only ever takes
     * `occurred_at` from the incoming record and a connector has no db handle.
     * That belongs in `syncStream`, not in the connector.
     *
     * A TIMESTAMP rather than a boolean, for the same reason `backfill_jobs`
     * carries `last_progress_at`: a restamp that never fires is otherwise
     * indistinguishable from one that already did. The known way for it to never
     * fire is Phase 3's `modifiedTime` skip — a settled sheet is not re-read, so
     * the restamp sweep must force a read past it.
     */
    restampRequestedAt: timestamp("restamp_requested_at", { withTimezone: true }),
    /**
     * What the last read actually did about a row's event time, as OBSERVATION
     * rather than configuration — which is why it is a separate column from the
     * settings above rather than folded in with them. Those are inputs, written
     * by the picker; this is an output, written by the sweep.
     *
     * `{ column, source, presentInHeader, dated, undated, candidates?, at }`.
     *
     * `column` is NULL when the read dated nothing — no column chosen and none
     * detected, or several detected and therefore none used. Recorded rather
     * than left absent, because "we looked and found nothing" and "we have never
     * looked" are different states and only one of them should force a read of a
     * settled sheet.
     *
     * `source` says who decided, so the UI can mark a detected column as
     * detected. A row written before this field existed has none; read it as
     * "user", which is what it was — nothing detected anything back then.
     *
     * `candidates` is the ambiguous case: several columns qualified, so none was
     * used and the user has to choose. It carries the names so the question can
     * be asked properly instead of as "pick a date column".
     *
     * `presentInHeader` is the named condition for a chosen column that has gone
     * missing. Without it a renamed column reads as "500 of 500 rows kept import
     * time" — visible, but indistinguishable from a sheet whose dates are all
     * malformed, and the two need different fixes. Not derivable from
     * `stream_fields`: that registry is sampled and approximate by its own
     * declaration, so a column present in the sheet could lag there for benign
     * reasons and raise a false alarm.
     *
     * jsonb because the counts and the conditions are read together, by the same
     * UI, and a scalar per number would mean a migration every time the display
     * wants one more — this shape has already grown twice without one.
     */
    dateFieldState: jsonb("date_field_state").$type<{
      column: string | null;
      source?: "user" | "detected";
      presentInHeader: boolean;
      dated: number;
      undated: number;
      candidates?: string[];
      at: string;
    }>(),
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
    // No org-scoped index: nothing has ever queried this table by org alone,
    // and this is the highest-write-rate table in the schema — every provider
    // call touches it, so a read-by-nothing index was pure write cost
    // (migration 0020 drops the one that used to be here).
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
  (t) => [
    index("delivery_log_conn_idx").on(t.connectionId),
    index("delivery_log_status_idx").on(t.status),
    // Retention's access path: `created_at < now() - 30d`, connection-blind
    // (storage-lifecycle.ts). Neither index above helps that shape — before
    // this the nightly prune was a sequential scan, up to 400 batch passes.
    index("delivery_log_created_idx").on(t.createdAt),
  ],
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
  (t) => [
    index("dead_letter_conn_idx").on(t.connectionId),
    // raw_events retention correlates on this column for EVERY candidate row
    // (`not exists … where dead_letter.raw_event_id = raw_events.id and
    // resolved_at is null`, storage-lifecycle.ts). Unindexed, each candidate
    // cost a scan of this whole table — a per-row sequential scan inside the
    // largest table's prune.
    index("dead_letter_raw_event_idx").on(t.rawEventId),
  ],
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
    // The 10-minute recompute asks "which tiles are stale?" fleet-wide
    // (materializeStaleAll) and the org dashboard counts non-fresh tiles —
    // both filter on status with no supporting index. Tiny per row, hot per
    // tick.
    index("flow_results_status_idx").on(t.status),
  ],
);
