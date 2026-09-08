/**
 * Display metadata that powers the integrations gallery and connect forms.
 * Keeping this separate from the runtime Connector keeps the engine lean while
 * the UI stays data-driven — adding a connector is one entry here.
 */
export type CredentialField = { key: string; label: string; placeholder?: string };

/**
 * A per-flow resource field set inside the Get data step (never at connect time):
 * which spreadsheet + tab, which calendar, whose Calendly meetings, … `dynamic`
 * fields load their options live from the provider via the connector's listOptions;
 * `dependsOn` gates a field until its prerequisites are chosen (and changing those
 * resets it); `showWhen` hides a field until another field holds a given value.
 */
export type FlowConfigField = {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Load options from the provider (connector.listOptions) instead of static ones. */
  dynamic?: boolean;
  dependsOn?: string[];
  /** Only render this field when another field currently equals `equals`. */
  showWhen?: { key: string; equals: string };
  /**
   * Only offer this field when the step's Record type starts with one of
   * these prefixes — for settings that exist on ONE KIND of record.
   *
   * Close's pipeline is the case: only opportunity events carry a
   * `pipeline_id`, so choosing a pipeline on a "Leads created" step matched
   * nothing and the step read `0 loaded` with no explanation. A setting that
   * cannot apply must not be offered, and — see `readFilterConds` — must not
   * apply even when an older saved config still holds a value for it.
   *
   * Empty Record type ("All record types") never matches: across mixed kinds
   * the filter would silently hide every record that has no such field.
   */
  showWhenEventTypePrefix?: readonly string[];
  options?: { value: string; label: string }[];
  /**
   * This field narrows the stored READ, not the provider request — and is
   * therefore NOT part of the stream identity.
   *
   * The distinction is the difference between a setting that works and one that
   * reads as broken. A setting the provider cannot act on (Calendly has no
   * `event_type` parameter) buys no quota at ingest; all it can do there is give
   * that flow its own stream, its own cursor and its own copy of every row —
   * so choosing one starts a scan from zero and shows nothing until it catches
   * up, while N choices scan the same account N times.
   *
   * Declared here instead, the choice is a WHERE clause over a sync every flow
   * on the connection shares: instant, no extra API calls, no duplicate storage.
   *
   * A row matches when ANY path equals the value. More than one path is how a
   * value whose meaning changed stays readable — Calendly's is an event-type URI
   * now and was the type's name before, and a URI never equals a name.
   */
  readFilter?: { paths: readonly string[] };
};

/**
 * How faithfully stored data tracks the source — the guarantee class shown to
 * users and enforced by the sync machinery (docs/DATA_MODEL.md):
 * - "mirror": every sweep re-reads the whole resource; rows refresh in place
 *   and disappear when removed upstream. Stored data == source, always.
 * - "incremental": cursor-forward polling with overlap; edits older than the
 *   rollback window surface on full re-syncs.
 * - "derived-mirror": numbers COMPUTED by the provider, re-read on a schedule
 *   and refreshed in place. Faithful to what the provider reports, including
 *   restatements of recent periods — but not independently verifiable by us,
 *   and the provider's metric definitions govern.
 * - "webhook-only": no list endpoint to reconcile against — data is as
 *   complete as the webhooks that arrived (weakest class; stated in the UI).
 */
export type SyncGuarantee = "mirror" | "incremental" | "derived-mirror" | "webhook-only";

/**
 * The connector's brand tile: the vendor's colour and a one-or-two letter
 * mark. Lives here, not in the builder, so one entry is the whole
 * registration; `sourceStyle` reads it. `label` overrides the display name
 * only where the mark's tooltip has always said something shorter than the
 * catalog name ("Close", "Webhook").
 */
export type ConnectorBrand = { color: string; short: string; label?: string };

/**
 * Where the facts in this entry came from and when they were read. Every
 * rate limit, endpoint and field name a connector relies on is a claim about
 * a provider, and a claim with a date can be re-checked; one without a date
 * is folklore. Required by tests for every entry added after the kit.
 */
export type ConnectorDocs = { url: string; readOn: string; webhooks?: string };

/** `live` is the date the connector's prober last ran against the real API, or null: unprobed. */
export type ConnectorVerification = { live: string | null };

export type ConnectorCatalogEntry = {
  source: string;
  name: string;
  description: string;
  /** How the user connects: paste a key, Google's flow, or another provider's OAuth (see `oauthProvider`). */
  connect: "apiKey" | "google" | "oauth";
  /** The `OAUTH_PROVIDERS` key when `connect` is "oauth". */
  oauthProvider?: string;
  brand?: ConnectorBrand;
  docs?: ConnectorDocs;
  verified?: ConnectorVerification;
  instant: boolean;
  poll: boolean;
  /** Guarantee class (defaults: poll sources "incremental", else "webhook-only"). */
  sync?: SyncGuarantee;
  /**
   * Said out loud when `sync` is not the whole truth for every stream of a
   * source.
   *
   * `sync` is ONE value per source, and the connection page renders it as the
   * connection's "Data guarantee". That is exact for five of the six sources.
   * Instantly is the exception: its analytics streams really are
   * provider-computed totals, but its legacy per-email stream is an ordinary
   * incremental record walk — `docs/DATA_MODEL.md` lists it that way, and the
   * runtime agrees, because the retire is driven by the per-read `mirrorScope`
   * and not by this field. Only the LABEL was wrong, telling a per-email user
   * they had a mirror guarantee they do not have.
   *
   * A qualifier rather than a per-stream class, because the connection page is
   * connection-scoped and has no stream in hand — and inventing a query to
   * resolve one would be a lot of machinery to restate a sentence.
   */
  syncNote?: string;
  /**
   * How far back the provider's history can reach AT ALL — said next to
   * "History imported", because "this is everything" is true of the API and
   * false of the account whenever the provider forgets its own past. Close is
   * the case: its event log retains ~30 days, so a CRM with 1,083 leads
   * yields ~400 "Lead created" events, and a lead from six weeks ago simply
   * has no created event to import. Without this sentence, that reads as our
   * sync losing data.
   *
   * ONE SENTENCE. It renders under a line that already says "History
   * imported.", in a config panel where every other field is a control — a
   * paragraph here is read once, by the person who wrote it. State the limit
   * and stop; the second sentence explaining what to do about it belongs on
   * the connection page, where the button that does it lives.
   */
  historyNote?: string;
  /**
   * Provider-declared budgets per operation (from published docs), keyed
   * `"resource.verb"`. The reactive layer sizes page walks under them today;
   * the provider-gateway token buckets (workstream F) will enforce them.
   */
  rateLimits?: Record<string, { requestsPerMinute: number }>;
  /**
   * A limit consumed by EVERY customer at once, because every customer's
   * requests reach the provider under one credential of OURS.
   *
   * `rateLimits` is per connection, which is right when the credential belongs
   * to the customer: Calendly's 60/min is that account's 60/min, and one
   * customer cannot spend another's. Google is the opposite. Sheets and
   * Calendar authorize through a single `GOOGLE_CLIENT_ID`
   * (`src/lib/oauth/providers.ts`), so the quota is charged to our Cloud project
   * and the fleet shares one bucket. Ten connections each politely under a
   * per-connection budget can still take the project over its limit together,
   * and the failure mode is not one customer throttled — it is every Google
   * connection failing at once.
   *
   * Keyed the same way as `rateLimits` (the operation), and claimed IN ADDITION
   * to it: a request needs room in both buckets. Declaring none means no fleet
   * ceiling, which is the correct answer for a per-customer credential.
   *
   * Deliberately NOT folded into `rateLimits`: those keys are checked both ways
   * against the connector's `operations` (tests/budget-operations.test.ts), and
   * a fleet limit is a property of how WE authenticate rather than an endpoint
   * the connector names.
   */
  fleetLimits?: Record<string, { requestsPerMinute: number }>;
  /** Whether we auto-create the provider webhook subscription on connect. */
  autoWebhook: boolean;
  /**
   * The webhook is an ENHANCEMENT the provider may refuse (plan gating —
   * Calendly limits subscriptions to Standard+), and refusing it must not
   * break the connection: `createConnection` logs and continues instead of
   * marking status "error", and the sweep's health check maps the provider's
   * plan refusal to "no signal" rather than "failed". Polling is primary
   * either way.
   */
  webhookOptional?: boolean;
  credentialFields: CredentialField[];
  /**
   * Flow-level resource settings (the Get data step's Configure section) — the ONLY
   * place any "what data to pull" choice lives. A connector with flowFields is
   * stream-scoped: each distinct config becomes its own synced stream with its own
   * cursor, and events are tagged per stream. Connecting an account asks for auth only.
   */
  flowFields?: FlowConfigField[];
  /**
   * Field paths this source's records carry but nobody can build anything from,
   * hidden from the variable picker.
   *
   * Two kinds qualify, and only these two:
   * - **Constant on every row** — `kind` is always `"calendar#event"`, `source`
   *   is always the connector. A condition on a constant passes every record or
   *   none, so offering it can only mislead.
   * - **An exact restatement of another field** — a calendar's canonical
   *   `subject` is its `summary`, listed twice under two names.
   *
   * Opaque-but-unique values (`etag`, `iCalUID`) count as the first kind in
   * practice: unique per row, meaningful to nobody, and impossible to filter on.
   *
   * This hides fields from the PICKER ONLY. The data is untouched and stored
   * references still resolve, so a flow that already points at one keeps
   * working — which is why this is a display list and not a drop at ingest.
   */
  hiddenFields?: readonly string[];
  /**
   * The handful of fields most flows are actually built on, in the order a
   * person looks for them — floated to the top of the field picker.
   *
   * A Close call record carries ~480 fields. Every one is real and every one
   * stays reachable (search spans everything, and the rest are one click
   * away), but a list that opens on `data.address_id` makes the user hunt for
   * `data.direction`. This is display ranking ONLY: nothing is dropped, and
   * an unlisted field is still perfectly pickable.
   */
  commonFields?: readonly string[];
  /**
   * Display names for stored `eventType` values — presentation ONLY.
   *
   * The stored strings are load-bearing (flow configs, Filter rules, metric
   * definitions all match them with `=`), so they are never renamed; this map
   * is how a raw vocabulary gets a human face without a replay and without
   * silently zeroing anyone's saved filter. Unmapped types fall through to
   * `eventTypeLabel`'s humanizer.
   */
  eventTypeLabels?: Record<string, string>;
  /**
   * Stored eventTypes PICKERS should not offer (see isHiddenEventType).
   * Display-only by contract: nothing at ingest, query, or filter level may
   * ever consult this — a hidden type is stored, filterable, and remains
   * selectable where it is already the saved value.
   */
  hiddenEventTypes?: {
    exact?: readonly string[];
    prefixes?: readonly string[];
    suffixes?: readonly string[];
  };
  /** Manual webhook setup note shown on the connection page when not auto. */
  webhookSetup?: string;
};

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    source: "calendly",
    name: "Calendly",
    brand: { color: "#006BFF", short: "Ca" },
    description: "Booked and canceled meetings, no-shows and routing forms.",
    connect: "apiKey",
    // HYBRID: the poll stays primary (reliable reconciliation, per-stream
    // attribution), and the webhook is the instant DOORBELL — a signed
    // delivery proves something changed and triggers an immediate
    // incremental sync through the queue that always runs. Registration is
    // org-scoped (one subscription covers every stream) and PLAN-GATED
    // (Standard+), hence webhookOptional: a free-plan connect degrades to
    // poll-only with no error and no red strip.
    instant: true,
    poll: true,
    autoWebhook: true,
    webhookOptional: true,
    credentialFields: [{ key: "accessToken", label: "Personal Access Token", placeholder: "eyJ..." }],
    // Calendly publishes 60 requests/minute (120 on Enterprise). One account-wide
    // bucket in practice, declared per endpoint so any one can be raised alone.
    rateLimits: {
      "scheduled_events.list": { requestsPerMinute: 60 },
      "event_types.list": { requestsPerMinute: 60 },
      "groups.list": { requestsPerMinute: 60 },
    },
    /**
     * `/scheduled_events` accepts organization | user | group, a start-time
     * window and a status — and nothing else.
     *
     * Scope and status change the REQUEST, so they cut API usage. Meeting type
     * cannot: there is no event-type parameter, so the pages fetched are
     * identical either way. It is therefore a `readFilter` — a WHERE clause over
     * the shared sync, not a second stream. Ingesting per type bought nothing
     * and cost everything: a fresh cursor per choice (so a newly-picked type
     * showed 0 until its own scan caught up), a duplicate row per copy, and the
     * same account scanned once per type against one 60/min bucket.
     *
     * A flow can slice the same sync further with a Filter step: `meeting_type`,
     * `host_email` and `host_name` are flattened onto every record.
     */
    flowFields: [
      {
        key: "scope",
        label: "Fetch meetings for",
        required: true,
        hint: "Fewer API calls: the narrower the scope, the less Calendly is asked for. Whole organization needs an admin or owner token.",
        options: [
          { value: "user", label: "Just me" },
          { value: "organization", label: "Whole organization" },
          { value: "group", label: "A specific group" },
        ],
      },
      {
        key: "groupUri",
        label: "Group",
        dynamic: true,
        dependsOn: ["scope"],
        showWhen: { key: "scope", equals: "group" },
        placeholder: "Choose a group…",
        hint: "Groups are a paid Calendly feature — an empty list means this account has none.",
      },
      {
        key: "status",
        label: "Meetings to include",
        options: [
          { value: "", label: "Booked and canceled" },
          { value: "active", label: "Booked only" },
          { value: "canceled", label: "Canceled only" },
        ],
        hint: "Fewer API calls. Booked only stops recording cancellations — a meeting that gets canceled will still read as booked.",
      },
      {
        key: "meetingType",
        label: "Meeting type",
        dynamic: true,
        dependsOn: ["scope"],
        placeholder: "All meeting types",
        hint: "Shows only this type — Calendly cannot filter by type, so the same meetings are fetched either way and this narrows what you see. Changing it takes effect immediately. Two meeting types sharing a name stay separate choices.",
        // The value is the type's URI; configs saved before that was true hold
        // its name. Either matches, so no saved step silently reads zero.
        readFilter: { paths: ["properties.event_type", "properties.meeting_type"] },
      },
    ],
  },
  {
    source: "close",
    name: "Close CRM",
    brand: { color: "#1E88E5", short: "Cl", label: "Close" },
    description: "Leads, opportunities, calls and SMS from the Close event log.",
    connect: "apiKey",
    instant: true,
    poll: true,
    historyNote: "Close's event log only reaches back about 30 days.",
    /**
     * NO DECLARED rateLimits, deliberately — the DEFAULT_RPM of 60/min governs,
     * and for Close that is a conservative floor rather than a guess at a
     * ceiling. Close does not publish fixed per-endpoint numbers: its limits
     * are per endpoint GROUP, per API key, with an org-wide limit ~3x the
     * key's (developer.close.com/api/overview/rate-limits — their worked
     * example is 20 rps per key, i.e. 1200/min), and the ACTUAL limit arrives
     * on every response in the `ratelimit` header. Two consequences pinned
     * here:
     *
     * - Bans are prevented REACTIVELY, not by this catalog: `parseRateLimit` →
     *   `applyObservedRateLimit` pauses the connection the moment Close says
     *   its quota is spent, and a 429's `rate_reset` is honoured. The declared
     *   number only paces us; the header is the authority.
     * - The right declared number is a MEASUREMENT waiting in
     *   `usage_ledger.observed_limit` (recorded every sweep since F.1). Once a
     *   few days have accumulated, read `scripts/observed-limits.sql` and
     *   declare what Close actually reported — with `operations`/`operationFor`
     *   on the connector, which the budget-operations contract requires of any
     *   entry that declares keys. Raising the pace before that data exists
     *   would be inventing a number, which is how the DEFAULT got here.
     */
    autoWebhook: true,
    credentialFields: [{ key: "apiKey", label: "API Key", placeholder: "api_..." }],
    /**
     * readFilter-ONLY, deliberately — and it must stay that way. Server-side
     * type/pipeline filtering of Close's event log is a measured NO (the
     * numbers live above `canonicalType` in close.ts: one object_type+action
     * pair per request means a cursor per choice and ~6x the requests in
     * steady state). So the picker is a WHERE clause over the one shared
     * sync, and — because readFilter keys never enter stream identity —
     * `isStreamScoped("close")` stays false and Close keeps its
     * connection-scoped sync, webhook ingest and Test priming untouched.
     *
     * The filter path is the raw event envelope: Close events store
     * `properties = {object_type, action, data: {...}}`, and an opportunity's
     * `data` carries `pipeline_id`. Verified against real synced events with
     * the census query in scripts/verify-close-pipeline-fields.sql; only
     * opportunity records carry one, which is what the hint says out loud.
     */
    flowFields: [
      {
        key: "pipelineId",
        label: "Pipeline",
        dynamic: true,
        placeholder: "All pipelines",
        /**
         * Close models pipelines on OPPORTUNITIES — a lead, a call and an
         * email carry no pipeline at all, so offering this on those steps
         * could only ever produce an unexplained empty result.
         *
         * Two record kinds qualify, both verified against Close's documented
         * response schemas: the opportunity itself (`data.pipeline_id`) and
         * its status-change activity, which names the pipeline a stage move
         * happened in (`data.new_pipeline_id`). The second is what answers
         * "how many entered Demo Booked in this pipeline" — and those rows
         * are already synced, they were simply never filterable because the
         * stored type is `activity.opportunity_status_change.created`, which
         * does not start with "opportunity".
         */
        showWhenEventTypePrefix: ["opportunity", "activity.opportunity_status_change"],
        readFilter: { paths: ["properties.data.pipeline_id", "properties.data.new_pipeline_id"] },
      },
    ],
    /**
     * What a sales team builds Close metrics from — dial outcome, who and
     * which lead, deal value, timing. Ordered as someone reasons about a
     * call: what kind, how it went, how long, whose it was.
     */
    commonFields: [
      "properties.data.direction",
      "properties.data.disposition",
      "properties.data.duration",
      "properties.data.status",
      "properties.data.status_label",
      "properties.data.lead_name",
      "properties.data.contact_name",
      "properties.data.user_name",
      "properties.lead_id",
      "properties.data.pipeline_id",
      "properties.data.value",
      "properties.data.value_formatted",
      "properties.data.activity_at",
      "properties.data.date_created",
      "properties.object_type",
      "properties.action",
    ],
    /**
     * Display names for the stored type strings — presentation ONLY, the
     * stored values never change (renaming stored types silently zeroes every
     * flow filtering on the old name; a label can't break anything). Kept
     * deliberately apart from Calendly's vocabulary: a Close activity logged
     * for a meeting and the Calendly booking of that same meeting are
     * different rows, and shared naming would invite counting one thing
     * twice (see the docstring above `canonicalType` in close.ts).
     */
    eventTypeLabels: {
      /**
       * TRUTH IN LABELS, verified against Close's docs (see the census notes
       * above `canonicalType` in close.ts):
       * - Close's `created` action on email/SMS fires for synced INBOUND
       *   messages and outbox/drafts too — so the mapped `email_sent` /
       *   `sms_sent` are logged-either-direction counts, and say so. The
       *   true send signal is the `.sent` action, which is stored raw and
       *   wears the plain name here.
       * - `task_completed` is a DEAD key (Close emits `task.SUBTYPE.*`);
       *   the real completion signal is `activity.task_completed.created`.
       * - `activity.created.created` is Close's "Created" timeline activity
       *   — the same fact as `lead_created`, arriving twice; labeled so a
       *   saved reference renders honestly, and hidden from pickers.
       */
      sms_sent: "SMS logged (sent or received)",
      email_sent: "Email logged (sent or received)",
      "activity.sms.sent": "SMS sent",
      "activity.email.sent": "Email sent",
      call_logged: "Call logged",
      call_connected: "Call connected",
      call_completed: "Call completed",
      meeting_scheduled: "Meeting scheduled",
      meeting_logged: "Meeting logged",
      meeting_held: "Meeting held",
      "activity.meeting.started": "Meeting started",
      "activity.meeting.canceled": "Meeting canceled",
      lead_created: "Lead created",
      "activity.created.created": "Lead created (timeline)",
      opportunity_created: "Opportunity created",
      task_completed: "Task completed (legacy)",
      "activity.task_completed.created": "Task completed",
      "activity.lead_status_change.created": "Lead status changed",
      "activity.opportunity_status_change.created": "Opportunity status changed",
      "task.missed_call.created": "Missed-call task created",
      "activity.form_submission.created": "Form submitted",
    },
    /**
     * What no analytics picker should offer (display-only; see
     * isHiddenEventType). Three planes: cascade/deletion churn (`.deleted`
     * fires on every child when a lead is deleted), edit noise
     * (`activity.note.updated` fires WHILE TYPING a note), and the
     * workspace-admin plane a sales metric can never be about. Plus
     * `activity.created.created`, which double-counts `lead_created`.
     */
    hiddenEventTypes: {
      exact: ["activity.note.updated", "activity.email.updated", "activity.created.created"],
      prefixes: [
        "activity.email_thread.",
        "activity.lead_merge.",
        "custom_fields.",
        "custom_activity_type",
        "custom_object_type",
        "status.lead",
        "status.opportunity",
        "saved_search",
        "import.",
        "export.",
        "bulk_action.",
        "membership.",
        "sequence.",
        "email_template",
        "sms_template",
        "comment",
        "phone_number",
        "group.",
      ],
      suffixes: [".deleted"],
    },
  },
  {
    source: "instantly",
    name: "Instantly",
    brand: { color: "#7C3AED", short: "In" },
    description: "Campaign performance — sent, opens, replies, bounces — per campaign.",
    connect: "apiKey",
    instant: true,
    poll: true,
    /**
     * Instantly's `email_sent` IS a true send (its webhook and per-email walk
     * only emit it for actual sends) — unlike Close's, which counts inbound
     * and drafts. Same stored key, different meanings: each source declares
     * its own truth, and the unbound lookup (eventTypeLabel with null source)
     * falls back to the neutral humanizer when declarations disagree.
     */
    eventTypeLabels: {
      email_sent: "Email sent",
      reply: "Reply received",
    },
    // Analytics-first: the primary streams read provider-COMPUTED totals, which
    // is a different guarantee from mirroring records. See docs/DATA_MODEL.md.
    sync: "derived-mirror",
    // …but not for every stream. See `syncNote`.
    syncNote:
      "That applies to the Daily performance and Campaign totals streams. A per-email stream — no longer " +
      "offered, but still synced where one was configured — is incremental instead: individual records, " +
      "reconciled by polling.",
    /**
     * ONE WORKSPACE-WIDE BUCKET, because that is the limit Instantly actually
     * publishes (developer.instantly.ai/getting-started/rate-limit, read
     * 2026-08-05): **6,000 requests/minute** (and 100/sec), applied to the
     * ENTIRE workspace, shared between API v1 and v2 and across every API key
     * of that workspace. There is no per-endpoint figure at all.
     *
     * The previous declaration was four per-endpoint buckets of 20/min — a
     * guess recorded as conservative, and it was 300× below the published
     * number on the product's highest-volume source. Worse than slow: four
     * separate buckets modelled a limit the provider charges as one, so the
     * shape was wrong as well as the size.
     *
     * Declared on `"*"` — the shared account-wide bucket — and the connector
     * deliberately has NO `operationFor`, so every claim lands in that one
     * bucket exactly as Instantly charges it. With the 70% share: 4,200/min,
     * 3,150 for background sweeps. The 100/sec ceiling is not modelled here
     * (the ledger's grain is the minute); nothing in this codebase can reach
     * 100 concurrent Instantly requests for one connection today, and the
     * reactive layer (Retry-After on 429) covers the burst edge.
     */
    rateLimits: {
      "*": { requestsPerMinute: 6_000 },
    },
    autoWebhook: false,
    credentialFields: [{ key: "apiKey", label: "API Key (v2)", placeholder: "..." }],
    // Which campaign, and what shape of data, is chosen per flow — never at
    // connect time. A workspace-wide pull is what made a 37.9K-email account
    // unable to finish a first sync at all.
    flowFields: [
      {
        key: "campaignId",
        label: "Campaign",
        required: true,
        dynamic: true,
        placeholder: "Choose a campaign…",
        hint: "Each flow reads one campaign. Add another Get data step for a second campaign.",
      },
      {
        key: "streamType",
        label: "What to pull",
        required: true,
        hint: "Daily performance is the usual choice — one row per day, restated as Instantly updates it.",
        // No per-email option. It answers no question the analytics rows do not
        // answer better, and it is the expensive one: tens of thousands of rows
        // against Instantly's tightest rate bucket. The connector still handles
        // `raw_emails` so any stream already configured that way keeps syncing —
        // it just cannot be chosen again.
        options: [
          { value: "analytics_daily", label: "Daily performance (one row per day)" },
          { value: "analytics_totals", label: "Campaign totals (one row)" },
        ],
      },
      {
        key: "days",
        label: "Days of history",
        showWhen: { key: "streamType", equals: "analytics_daily" },
        placeholder: "30",
        hint: "How far back each refresh re-reads. Older days stay stored.",
      },
    ],
    webhookSetup:
      "In Instantly, add a webhook pointing to the URL below. Copy the signing secret shown on this page into " +
      "Instantly's webhook HMAC field so deliveries verify. Instantly syncs by polling, so a delivery only " +
      "triggers an immediate refresh — it isn't how records themselves arrive.",
  },
  {
    source: "whop",
    name: "Whop",
    brand: { color: "#FF6243", short: "Wh" },
    description: "Payments and memberships from your Whop company.",
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    historyNote: "First sync reaches back 90 days.",
    /**
     * Whop publishes one ceiling — 600 requests per minute per API credential
     * (docs.whop.com) — and does not define what it scopes "per operation" to,
     * so every call shares one declared bucket. One number that is certainly
     * right beats two that split a limit whose scoping is unstated.
     */
    rateLimits: { "api.request": { requestsPerMinute: 600 } },
    /**
     * FALSE BY CHOICE, NOT BY LIMITATION. `POST /api/v1/webhooks` returns
     * `webhook_secret` on the create response and `DELETE /webhooks/{id}`
     * exists, so this connector COULD register its own endpoint — but doing so
     * costs the API key the `developer:manage_webhook` permission, which a
     * read-only key deliberately does not carry. The paste stays optional and
     * the poll covers both collections regardless.
     */
    autoWebhook: false,
    credentialFields: [
      { key: "apiKey", label: "API key", placeholder: "Whop → Developer → API keys" },
      { key: "companyId", label: "Company ID", placeholder: "biz_..." },
      { key: "webhookSecret", label: "Webhook signing secret (optional — Whop → Developer → Webhooks, Secret column)", placeholder: "ws_… or whsec_…" },
    ],
    /**
     * The old copy said Namzilabs would "mint one instead — copy it from the
     * field below into Whop". Whop generates the secret itself and has no
     * field to paste one into, so that route stored a secret no delivery could
     * ever match and every webhook was refused. Say what is actually possible.
     */
    webhookSetup:
      "Optional — payments and memberships arrive by polling either way, so a webhook only makes updates instant. " +
      "To turn it on: in Whop, open Developer → Create webhook, point it at the URL below, then copy the signing " +
      "secret from the Secret column of that table into the Webhook signing secret field here. Whop mints that " +
      "secret itself and has nowhere to paste one in, so if you leave the field blank its deliveries cannot be " +
      "verified and are refused — reconnect with the secret to switch them on.",
  },
  {
    source: "gsheets",
    name: "Google Sheets",
    brand: { color: "#0F9D58", short: "Sh" },
    description: "Rows from any spreadsheet, mirrored faithfully.",
    connect: "google",
    instant: false,
    poll: true,
    // Full-read mirror: every sweep re-reads the whole tab, so edits and
    // deletions anywhere in the sheet are reflected, not just appended rows.
    sync: "mirror",
    /**
     * READ OFF THIS PROJECT'S Google Cloud console (APIs & Services → Quotas),
     * which beats any documented figure because it is the limit the project
     * actually has. Sheets read: 300/min per project, 60/min per user.
     *
     * The per-user number is the per-connection one: a user's OAuth grant is
     * what a connection holds. The per-project number is the fleet's, because
     * every customer authorises through one `GOOGLE_CLIENT_ID`.
     *
     * TWO BUCKETS, NOT ONE, and Sheets is the reason. Drive gets 12,000/min
     * where Sheets gets 300 — a factor of 40 — and one shared bucket would make
     * the Sheets figure govern both. That is not merely conservative, it is
     * self-defeating: the Drive call is the `modifiedTime` probe whose entire
     * purpose is to avoid Sheets reads, so rationing it at the Sheets rate
     * spends the saving it was added to make. `PollResult.extraCalls` is how one
     * poll's spend gets attributed across the two.
     *
     * Sheets is the only tight Google limit here, which is also why the polling
     * probe is worth having and why Drive push notifications are not urgent.
     */
    fleetLimits: {
      "sheets.values.get": { requestsPerMinute: 300 },
      "drive.files.get": { requestsPerMinute: 12_000 },
    },
    rateLimits: {
      "sheets.values.get": { requestsPerMinute: 60 },
      "drive.files.get": { requestsPerMinute: 12_000 },
    },
    autoWebhook: false,
    credentialFields: [],
    // Which spreadsheet + tab is chosen inside each flow's Get data step.
    flowFields: [
      { key: "spreadsheetId", label: "Spreadsheet", required: true, dynamic: true, placeholder: "1AbC…", hint: "Pick a spreadsheet from your Google Drive." },
      { key: "range", label: "Sheet / tab", dynamic: true, dependsOn: ["spreadsheetId"], placeholder: "Sheet1" },
    ],
  },
  {
    source: "gcal",
    name: "Google Calendar",
    brand: { color: "#4285F4", short: "GC" },
    description: "Calendar events via incremental sync.",
    connect: "google",
    instant: false,
    poll: true,
    /**
     * READ OFF THIS PROJECT'S Google Cloud console, same as Sheets: Calendar
     * gets 10,000/min per project and 600/min per user. Its own quota, separate
     * from Sheets and Drive, which is why it is its own bucket and not a shared
     * Google-wide one.
     *
     * Generous enough that this ceiling will not be what stops a Calendar sweep —
     * declared anyway, because an undeclared fleet limit is not a large one, it
     * is NO limit (`fleetBudgetFor` returns null), and 8 pages per poll across a
     * whole fleet is exactly the shape that needs a number rather than an
     * absence.
     */
    fleetLimits: { "events.list": { requestsPerMinute: 10_000 } },
    rateLimits: { "events.list": { requestsPerMinute: 600 } },
    autoWebhook: false,
    credentialFields: [],
    flowFields: [{ key: "calendarId", label: "Calendar", dynamic: true, placeholder: "primary" }],
    hiddenFields: [
      "subject", //               restates properties.summary
      "source", //                always "gcal"
      "properties.kind", //       always "calendar#event"
      "properties.eventType", //  always "default" — Google's, not our canonical one
      "properties.etag",
      "properties.iCalUID",
      "properties.htmlLink",
      "properties.sequence",
      "properties.reminders",
    ],
    // NOT hidden, though it sits in the same block and looks alike: `occurredAt`
    // is the meeting's start time here, and the default date field of every
    // Time-window step. `id` stays too — it is what dedupe debugging needs.
  },
  {
    source: "webhook",
    name: "Custom Webhook",
    brand: { color: "#64748B", short: "Wh", label: "Webhook" },
    description: "Catch events from any app that can POST a webhook.",
    connect: "apiKey",
    instant: true,
    poll: false,
    autoWebhook: false,
    credentialFields: [],
    /**
     * THE COPY IS THE PRODUCT HERE, because this connection has no settings.
     *
     * The old line — "optionally sign the body … using the secret shown" —
     * described a secret that was minted for every one of these connections and
     * shown whether or not anyone wanted it, which made the word "optionally"
     * false: an unsigned POST was refused. It now says what the endpoint does,
     * in the order someone meets it, and every clause is a behaviour with a test
     * behind it rather than an intention.
     */
    webhookSetup:
      "Point any app's outbound webhook at the URL below. Nothing else to set up: JSON, form-encoded bodies and " +
      "values in the query string all work, a wrapper like {\"data\": {…}} is read through, and a batch such as " +
      "{\"events\": [ … ]} is counted as one record per item. Anyone holding this URL can post to it, so treat it " +
      "like a password — and once your app is delivering, use Require signature to lock it to a shared secret.",
  },
  {
    source: "stripe",
    name: "Stripe",
    description: "Payments, refunds, invoices paid, checkouts, subscriptions started and cancelled.",
    brand: { color: "#635BFF", short: "St" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    historyNote: "Stripe keeps 30 days of events, so the first import reaches back 30 days.",
    // The key that already reads /v1/events can also MAKE the endpoint: POST
    // /v1/webhook_endpoints "Returns the webhook endpoint object with the
    // `secret` field populated" (docs.stripe.com/api/webhook_endpoints/create,
    // read 2026-09-08). So there is no whsec_ field any more — asking for one
    // was asking the customer to go and fetch a value we can mint ourselves.
    autoWebhook: true,
    // …but that write is a SEPARATE permission: a restricted key needs "Webhook
    // Endpoints, Event Destinations" = Write (`webhook_write`), which Stripe
    // itself calls "a sensitive permission because it allows subscribing to
    // events across your entire account"
    // (docs.stripe.com/stripe-apps/reference/permissions, read 2026-09-08).
    // A key scoped to Events: read alone is a legitimate, security-conscious
    // choice and must still connect: /v1/events covers Stripe's whole 30-day
    // retention, so a refused endpoint costs latency, never data.
    webhookOptional: true,
    docs: { url: "https://docs.stripe.com/api/events/list", readOn: "2026-09-08", webhooks: "https://docs.stripe.com/api/webhook_endpoints/create" },
    verified: { live: null },
    // https://docs.stripe.com/rate-limits (read 2026-09-08): "Individual API endpoints
    // (unless otherwise noted): 25 requests per second" = 1,500/min; the account-wide
    // 100/s is never the binding one. Separately, read requests must average ≤ 500 per
    // transaction over a rolling 30 days (minimum 10,000/month) — a ten-minute sweep is
    // ~4,300 reads/month per connection, inside the floor.
    rateLimits: { "events.list": { requestsPerMinute: 1_500 } },
    credentialFields: [{ key: "apiKey", label: "Restricted or secret key", placeholder: "rk_live_…" }],
    eventTypeLabels: {
      payment_succeeded: "Payment succeeded",
      checkout_completed: "Checkout completed",
      invoice_paid: "Invoice paid",
      payment_refunded: "Refund",
      subscription_created: "Subscription started",
      subscription_updated: "Subscription changed",
      subscription_canceled: "Subscription cancelled",
    },
    commonFields: ["type", "data.object.amount", "data.object.currency", "data.object.customer", "data.object.status", "livemode"],
    webhookSetup:
      "Nothing to set up in Stripe: connecting creates this endpoint for you and keeps its signing secret. Creating it needs a " +
      "key with Webhook Endpoints → Write — a read-only key connects fine, and polling still covers the last 30 days.",
  },
  {
    source: "calcom",
    name: "Cal.com",
    description: "Meetings booked, cancelled, rescheduled, marked no-show, and held.",
    brand: { color: "#292929", short: "Cal" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    webhookOptional: true,
    docs: { url: "https://cal.com/docs/api-reference/v2/bookings/get-all-bookings", readOn: "2026-09-08", webhooks: "https://cal.com/docs/developing/guides/automation/webhooks" },
    verified: { live: null },
    // https://cal.com/docs/api-reference/v2/introduction (read 2026-09-08): "the default
    // rate limit is 120 requests per minute" per API key; 200 on request, 800 with charges.
    rateLimits: { "bookings.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → Developer → API keys)", placeholder: "cal_live_…" },
      { key: "baseUrl", label: "API base URL (self-hosted only)", placeholder: "https://api.cal.com/v2" },
    ],
    eventTypeLabels: { booked: "Meeting booked", canceled: "Meeting cancelled", rescheduled: "Meeting rescheduled", no_show: "No-show", meeting_held: "Meeting held" },
    commonFields: ["status", "start", "end", "eventType.slug", "attendees.0.email", "createdAt", "rescheduledFromUid"],
  },
  {
    source: "aircall",
    name: "Aircall",
    description: "Calls dialled, answered, completed (talk time in seconds), missed, tagged.",
    brand: { color: "#00B388", short: "Ai" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    docs: { url: "https://developers.aircall.io/api-references", readOn: "2026-09-08", webhooks: "https://developer.aircall.io/tutorials/webhooks-guide/" },
    verified: { live: null },
    // developers.aircall.io/api-references (read 2026-09-08): "Aircall limits the number of
    // requests to its Public API to 120 requests per minute per company."
    rateLimits: { "calls.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiId", label: "API ID (Company settings → Integrations & API)", placeholder: "…" },
      { key: "apiToken", label: "API token", placeholder: "…" },
    ],
    // call_logged / call_connected / call_completed are Close's keys; the humanizer already renders them
    // "Call logged" etc., and one declarer per key keeps the org-wide picker unambiguous.
    eventTypeLabels: { call_missed: "Call missed", call_tagged: "Call tagged", voicemail_left: "Voicemail left" },
    commonFields: ["direction", "status", "user.email", "missed_call_reason", "talk_seconds", "ring_seconds", "tags"],
  },
  {
    source: "pipedrive",
    name: "Pipedrive",
    description: "Deals created, moved between stages, won and lost; people added.",
    brand: { color: "#017737", short: "Pd" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote: "The poll sees each deal's current stage; every intermediate hop arrives by webhook. Archived deals are not listed.",
    autoWebhook: true,
    webhookOptional: true,
    docs: { url: "https://developers.pipedrive.com/docs/api/v1/Deals", readOn: "2026-09-08", webhooks: "https://pipedrive.readme.io/docs/guide-for-webhooks-v2" },
    verified: { live: null },
    // pipedrive.readme.io/docs/core-api-concepts-rate-limiting (read 2026-09-08): burst
    // "20 requests per 2 seconds" per token on Lite (600/min), and a daily budget of
    // "30,000 base tokens × plan multiplier × seats" where a list costs 20 tokens — so
    // the day, not the minute, is the binding limit. 300/min keeps a sweep to a few
    // hundred tokens; the observed layer reads x-ratelimit-* and x-daily-requests-left.
    rateLimits: { "deals.list": { requestsPerMinute: 300 } },
    credentialFields: [
      { key: "apiToken", label: "API token (Settings → Personal preferences → API)", placeholder: "…" },
      { key: "companyDomain", label: "Company domain (the part before .pipedrive.com; optional)", placeholder: "acme" },
    ],
    eventTypeLabels: { opportunity_created: "Deal created", deal_stage_changed: "Deal moved stage", deal_won: "Deal won", deal_lost: "Deal lost", lead_created: "Person added" },
    commonFields: ["status", "stage_id", "pipeline_id", "value", "currency", "person_id", "previous_stage_id", "lost_reason"],
  },
  {
    source: "typeform",
    name: "Typeform",
    description: "Form submissions (and forms started, for a completion rate), one form per step.",
    brand: { color: "#262627", short: "Tf" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    /**
     * What this used to say — "a partial (unfinished) response reaches this
     * connection only through its webhook" — was never true of this codebase.
     * Typeform is stream-scoped, so its inbound route rings the doorbell and
     * returns BEFORE anything is stored (the isStreamScoped branch in
     * src/app/api/webhooks/[connectionId]/route.ts). No delivery has ever been
     * ingested, so no partial has ever arrived by webhook. The poll reads
     * completed responses, and that is the whole of what lands.
     */
    syncNote:
      "Completed responses are read. A partial (unfinished) response is not imported at all — a delivery from Typeform " +
      "only triggers an immediate re-read of that form's step.",
    /**
     * Impossible here, and not for want of an API. Typeform's create endpoint is
     * PUT /forms/{form_id}/webhooks/{tag} and it takes the `secret` WE choose,
     * echoing it back on the response (typeform.com/developers/webhooks/reference/
     * create-or-update-webhook, read 2026-09-08) — everything Stripe's
     * auto-registration needs, except a resource. Every webhook path is under
     * /forms/{form_id}, and the form is a flowField picked inside a step, so at
     * connect time there is nothing to PUT against. Registering at STREAM
     * creation is the version that would work; the reasoning is in typeform.ts.
     */
    autoWebhook: false,
    docs: { url: "https://www.typeform.com/developers/responses/reference/retrieve-responses/", readOn: "2026-09-08", webhooks: "https://www.typeform.com/developers/webhooks/secure-your-webhooks/" },
    verified: { live: null },
    // typeform.com/developers/get-started (read 2026-09-08): "For the Create and Responses
    // APIs, you can send two requests per second, per Typeform account."
    rateLimits: { "responses.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiKey", label: "Personal access token (Account → Personal tokens)", placeholder: "tfp_…" },
      { key: "webhookSecret", label: "Webhook secret (optional)", placeholder: "only if you already set one in Typeform" },
    ],
    flowFields: [{ key: "formId", label: "Form", required: true, dynamic: true, placeholder: "Choose a form…", hint: "Each step reads one form." }],
    eventTypeLabels: { form_submitted: "Form submitted", form_started: "Form started" },
    commonFields: ["form_id", "answers_by_field", "hidden", "metadata.referer", "landed_at", "submitted_at"],
    webhookSetup:
      "Optional — responses arrive by polling either way, and a webhook only makes them instant. Typeform sets webhooks per " +
      "form, so this one cannot be created for you at connect time. To add it: open the form in Typeform, click Connect in " +
      "the top menu, open the Webhooks tab, click Add a webhook, paste the URL below, enter a value under Secret (the eye " +
      "icon reveals what you typed) and click Finish. Simplest is to leave the Webhook secret field blank when you connect " +
      "and copy this connection's Signing secret into Typeform; if you already set your own secret there, paste that same " +
      "string as the Webhook secret instead. A delivery triggers an immediate refresh of that form's step.",
  },
  {
    source: "tally",
    name: "Tally",
    description: "Form submissions, completed and partial, one form per step.",
    brand: { color: "#0D0D0D", short: "Ta" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    /**
     * NOT auto-registerable, and the reason is Tally's shape rather than an
     * unfinished connector. POST /webhooks (developers.tally.so, read
     * 2026-09-08) has `"required": ["formId", "url", "eventTypes"]`, and there
     * is no account- or workspace-wide subscription to fall back on: every
     * Tally webhook belongs to ONE form. `formId` is a flowField — chosen on a
     * flow's Get data step — so at connect time, the only moment
     * `registerWebhook` is ever called, the one required argument does not
     * exist yet. Blanketing every form the key can see would plant
     * subscriptions on forms no step reads and still miss every form made
     * afterwards, so the secret stays a field the customer can fill.
     *
     * It is an HONEST optional, not a reluctant one: the poll reads the same
     * submissions with `filter: "all"`, so completed AND partial arrive with no
     * webhook at all. Left blank, `createConnection` mints a secret (this entry
     * is `instant`) for the customer to paste into Tally's own field.
     */
    autoWebhook: false,
    docs: { url: "https://developers.tally.so/api-reference/endpoint/forms/submissions/list", readOn: "2026-09-08", webhooks: "https://tally.so/help/webhooks" },
    verified: { live: null },
    // developers.tally.so/api-reference/introduction (read 2026-09-08): "100 per minute".
    rateLimits: { "submissions.list": { requestsPerMinute: 100 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → API keys)", placeholder: "tly-…" },
      { key: "webhookSecret", label: "Webhook signing secret (optional)", placeholder: "Blank mints one for you" },
    ],
    flowFields: [{ key: "formId", label: "Form", required: true, dynamic: true, placeholder: "Choose a form…", hint: "Each step reads one form." }],
    eventTypeLabels: { form_submitted: "Form submitted", form_partial: "Form partially filled" },
    commonFields: ["formId", "isCompleted", "fields_by_label", "respondentId", "submittedAt"],
    webhookSetup:
      "Optional — submissions arrive by polling either way, and a webhook only makes them instant. To add one: publish " +
      "the form, open its Integrations tab, click Connect on Webhooks, and point it at the URL below. Already have a " +
      "signing secret from Tally? Paste it into the Webhook signing secret field when you connect. Leave that blank and " +
      "Namzilabs mints one instead — copy it from the field below into Tally's signing secret. Tally scopes a webhook to " +
      "one form, so add one per form your steps read.",
  },
  {
    source: "smartlead",
    name: "Smartlead",
    description: "Cold email sent, opened, clicked and replied — per campaign.",
    brand: { color: "#5B5FEF", short: "Sl" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote:
      "Sends, opens, clicks and replies are read from each lead's statistics row. A bounce, an unsubscribe and a " +
      "lead-category change carry no date in that row, and this source's webhook is a doorbell that asks for a " +
      "refresh rather than a second way in, so those three are not counted on this connection.",
    historyNote: "First sync reaches back 30 days.",
    /**
     * NOT FOR WANT OF AN ENDPOINT, which is the part worth writing down:
     * "Smartlead has a webhook API" is true and still does not help.
     *
     * api.smartlead.ai/api-reference/webhooks/create (read 2026-09-08): POST
     * /api/v1/webhook/create takes webhook_url, association_type ("Valid
     * values: user, client, campaign"), email_campaign_id, name,
     * event_type_map, category_id_map, client_id, event_type, category_id,
     * webhook_type and force_create — eleven parameters, NOT ONE of them a
     * secret we could supply — and answers `{ ok, id, webhook_url }`, which
     * mints none either. .../webhooks/get returns id, email_campaign_id, name,
     * webhook_url, event_type_map, category_id_map, created_at, updated_at, so
     * there is nothing to read back afterwards; .../webhooks/update takes name,
     * webhook_url, event_types and categories, so there is nothing to set
     * afterwards. Registering at connect would therefore create a LIVE
     * subscription this connection could never authenticate, and
     * `verifySignature` — which fails closed — would 401 every delivery we
     * ourselves caused, forever and silently. Strictly worse than asking, so
     * the field stays and the ask is honest about being optional.
     *
     * SCOPE IS NOT THE BLOCKER, in case Smartlead ever publishes a secret. A
     * user-level hook is "applied to all unmapped campaigns. This means that
     * campaigns not mapped with any webhook will be linked to this webhook"
     * (helpcenter.smartlead.ai/en/articles/185-assigning-webhooks-to-campaigns-clients-or-users,
     * read 2026-09-08), so ONE `association_type: "user"` registration at
     * connect would cover campaigns created later — the per-campaign flowField
     * and `isStreamScoped("smartlead")` notwithstanding. On that day this
     * becomes an ordinary `registerWebhook`.
     */
    autoWebhook: false,
    docs: { url: "https://api.smartlead.ai/reference/lead-statistics", readOn: "2026-09-08", webhooks: "https://api.smartlead.ai/guides/webhook-integration" },
    verified: { live: null },
    /**
     * ONE BUCKET, because that is how Smartlead charges it.
     * api.smartlead.ai/guides/rate-limits (read 2026-09-08): Standard 60 per
     * minute per API key (Pro 120), and "Rate limits apply to your API key
     * across all endpoints combined. A mix of campaign, lead, and analytics
     * requests all count toward the same limit." So it is declared on "*" —
     * the shared account-wide bucket, as Instantly's is — and the connector
     * declares NO operations/operationFor, so the poll and the campaign-list
     * lookup claim from the same 60/min the provider meters. Splitting it per
     * endpoint would enforce each half alone and permit a multiple of the real
     * limit in aggregate. 60 is the Standard floor; the observed layer widens.
     */
    rateLimits: { "*": { requestsPerMinute: 60 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → API)", placeholder: "…" },
      { key: "webhookSecret", label: "Webhook signing secret (optional — it only makes the refresh instant)", placeholder: "…" },
    ],
    flowFields: [
      {
        key: "campaignId",
        label: "Campaign",
        required: true,
        dynamic: true,
        placeholder: "Choose a campaign…",
        hint: "Each step reads one campaign. Add another Get data step for a second campaign.",
      },
    ],
    // Only keys no other connector labels: email_sent and reply already carry
    // Close's and Instantly's own declarations, and a second, different label
    // for one key is what tests/event-type-labels.test.ts fails on. The rest
    // (email_opened, bounced, unsubscribed, lead_category_updated) humanize
    // correctly on their own, so they are left to the humanizer.
    // No `lead_interested` label: nothing on this connection can produce that
    // event (see smartlead.ts, where `normalize` used to be), and a label is a
    // promise that the key will one day appear in a picker.
    eventTypeLabels: { email_clicked: "Link clicked" },
    commonFields: ["campaign_id", "lead_email", "sequence_number", "email_subject", "lead_category"],
    webhookSetup:
      "Optional. Smartlead syncs by polling each campaign; a delivery only makes the next refresh immediate. To set " +
      "one up: in Smartlead go to Settings → Webhooks → Add Webhook, name it, pick the campaign (or leave it at user " +
      "level, which covers every campaign not mapped to a webhook of its own, including ones you create later), tick " +
      "the events, and paste the URL below. If that form offers a signing secret, paste the same value into the " +
      "webhook signing secret field on this connection. Smartlead's webhook API neither returns a secret nor accepts " +
      "one, so if the form has no such field, leave ours blank: deliveries are then refused and the campaign simply " +
      "refreshes on its normal schedule, losing no records.",
  },
  {
    source: "helpscout",
    name: "Help Scout",
    description: "Conversations opened and closed, customer and agent replies — first response time straight from the threads.",
    brand: { color: "#1292EE", short: "Hs" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    docs: { url: "https://developer.helpscout.com/mailbox-api/", readOn: "2026-09-08", webhooks: "https://developer.helpscout.com/webhooks/" },
    verified: { live: null },
    // developer.helpscout.com/mailbox-api/overview/rate-limiting (read 2026-09-08):
    // "Your current rate limit depends on your plan", and "Write requests (POST,
    // PUT, DELETE, PATCH) count as 2 requests toward the rate limit." The numbers
    // are in the article that page links, docs.helpscout.com/article/1140-mailbox-api
    // (read 2026-09-08): Standard "Up to 200 calls per minute", Plus 400, Pro 800.
    // The lowest paid plan is declared, and it covers the per-conversation threads
    // reads too — Help Scout charges ONE account-wide bucket across every endpoint,
    // which is why the connector emits a single operation key.
    rateLimits: { "conversations.list": { requestsPerMinute: 200 } },
    credentialFields: [
      { key: "appId", label: "App ID (Your Profile → My Apps → Create My App)", placeholder: "Your app's ID" },
      { key: "appSecret", label: "App secret (shown when the app is created)", placeholder: "Your app's secret" },
    ],
    eventTypeLabels: {
      conversation_created: "Conversation opened",
      customer_replied: "Customer replied",
      agent_replied: "Agent replied",
      conversation_closed: "Conversation closed",
      conversation_assigned: "Conversation assigned",
    },
    commonFields: ["status", "subject", "primaryCustomer.email", "assignee.email", "mailboxId", "conversation_id", "createdBy.email"],
  },
  {
    source: "attio",
    name: "Attio",
    description: "Deals and people created, with each deal's value and the stage it sits in.",
    brand: { color: "#266DF0", short: "Ao" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote:
      "The poll reads records created since the last sweep, with the stage each one currently sits in; a stage change on a record created before the window is not re-read. Attio's webhook carries ids only — no timestamps, no field values — so it is a doorbell that triggers an immediate sync rather than a delivery of its own.",
    autoWebhook: true,
    docs: {
      url: "https://docs.attio.com/rest-api/endpoint-reference/records/list-records",
      readOn: "2026-09-08",
      webhooks: "https://docs.attio.com/rest-api/guides/webhooks",
    },
    verified: { live: null },
    // docs.attio.com/rest-api/guides/rate-limiting (read 2026-09-08): "Read requests: 100
    // requests per second" (6,000/min) — which is what a plain GET /v2/objects gets. The
    // records query is ALSO scored: its complexity is summed "using a sliding window
    // algorithm with a 10 second window", so that bucket is held an order of magnitude
    // under the raw read ceiling and the two are declared separately rather than sharing
    // the tighter one.
    rateLimits: { "records.query": { requestsPerMinute: 600 }, "objects.list": { requestsPerMinute: 6000 } },
    credentialFields: [{ key: "apiKey", label: "Access token (Workspace settings → Developers → Access tokens)", placeholder: "…" }],
    flowFields: [
      {
        key: "object",
        label: "Record type",
        required: true,
        dynamic: true,
        placeholder: "Choose a record type…",
        hint: "Each step reads one Attio object — Deals, People, Companies or a custom one.",
      },
    ],
    commonFields: [
      "stage",
      "created_at",
      "values.name.0.value",
      "values.name.0.full_name",
      "values.email_addresses.0.email_address",
      "values.value.0.currency_value",
      "web_url",
    ],
  },
  {
    source: "lemlist",
    name: "lemlist",
    description: "Outreach emails sent, opened, link-clicked, replied, bounced or failed, marked interested, unsubscribed.",
    brand: { color: "#316BFF", short: "Le" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    autoWebhook: true,
    docs: {
      url: "https://developer.lemlist.com/api-reference/endpoints/activities/get-many-activities",
      readOn: "2026-09-08",
      webhooks: "https://developer.lemlist.com/api-reference/endpoints/webhooks/add-webhook",
    },
    verified: { live: null },
    // developer.lemlist.com/api-reference/getting-started/rate-limits (read 2026-09-08):
    // "20 requests per 2 seconds" per API key, across all routes — 600/min. The
    // X-RateLimit-Reset header is a human-readable DATE, so the observed layer
    // reads remaining and leaves reset null.
    rateLimits: { "activities.list": { requestsPerMinute: 600 } },
    credentialFields: [{ key: "apiKey", label: "API key (Settings → Integrations → API)", placeholder: "…" }],
    // email_sent and reply are Instantly's declarations; one declarer per key keeps
    // the org-wide picker unambiguous, and the humanizer already renders the rest.
    eventTypeLabels: { email_opened: "Email opened", email_clicked: "Email link clicked", bounced: "Email bounced", lead_interested: "Lead marked interested" },
    commonFields: ["type", "campaignName", "campaignId", "leadEmail", "sequenceStep", "stepId", "isFirst"],
  },
  {
    source: "paddle",
    name: "Paddle",
    description: "Transactions paid and completed (total, with earnings and fee alongside), refunds and adjustments, subscriptions started, changed and cancelled.",
    brand: { color: "#FDDD35", short: "Pa" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote: "Completed and paid transactions are reconciled by polling; refunds, credits and subscription changes arrive by webhook only.",
    historyNote: "Paddle keeps 90 days of events, so a refund or subscription change missed for longer than that cannot be recovered — transactions themselves have no such limit.",
    autoWebhook: true,
    docs: { url: "https://developer.paddle.com/api-reference/transactions/list-transactions", readOn: "2026-09-08", webhooks: "https://developer.paddle.com/webhooks/signature-verification" },
    verified: { live: null },
    // https://developer.paddle.com/api-reference/about/rate-limiting (read 2026-09-08):
    // "An IP address can make up to 240 requests per minute." (The 1,000/min figure on
    // that page is the pricing-preview endpoints only, which this connector never calls.)
    rateLimits: { "transactions.list": { requestsPerMinute: 240 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Paddle → Developer tools → Authentication)", placeholder: "pdl_live_apikey_…" },
      { key: "sandbox", label: "Sandbox account? (type yes)", placeholder: "no" },
    ],
    // Only the two keys no other connector labels: payment_succeeded,
    // payment_refunded, subscription_created/_updated/_canceled are Stripe's and
    // must keep Stripe's wording (tests/event-type-labels.test.ts).
    eventTypeLabels: { subscription_activated: "Subscription activated", adjustment_created: "Adjustment" },
    commonFields: ["status", "customer_id", "currency_code", "details.totals.total", "earnings_major", "fee_major", "billed_at"],
  },
  {
    source: "justcall",
    name: "JustCall",
    description: "Calls logged, connected, completed (talk time in seconds) and missed, with direction and disposition.",
    brand: { color: "#004CE6", short: "Jc" },
    connect: "apiKey",
    // POLL ONLY, and not as a stopgap: JustCall signs
    // `secret|urlencoded(webhook_url)|type|timestamp`, and the subscription URL is
    // the one thing a receiver is never independently told — the only copy in hand
    // is the one inside the body being verified. There is no honest yes, so no
    // delivery is accepted and no webhookSecret field is offered.
    instant: false,
    poll: true,
    sync: "incremental",
    syncNote:
      "Synced by polling — JustCall's webhook signature covers the subscription URL, which a receiver cannot check, so " +
      "deliveries are not accepted. Call times come from call_date and call_time, which JustCall documents as UTC; the " +
      "list filter reads the account's own time zone instead, so every sweep re-reads a wide margin around its mark.",
    historyNote: "JustCall's API reaches back about 3 months, so the first import stops there.",
    autoWebhook: false,
    docs: { url: "https://developer.justcall.io/reference/call_list_v21", readOn: "2026-09-08", webhooks: "https://developer.justcall.io/docs/dynamic-webhook-signatures" },
    verified: { live: null },
    // developer.justcall.io/docs/rate-limits (read 2026-09-08): per plan — Team
    // "1800 requests" hourly with a "30 requests" per-minute burst, Pro and Pro Plus
    // 3600/60, Business and SalesPro 5400/90. The LOWEST tier is declared, because the
    // plan is the customer's and not ours. Responses carry X-Rate-Limit-* and the
    // -Burst- triple; justcall.ts reads them itself (the shared parser only knows the
    // ratelimit-* / x-ratelimit-* spellings, and JustCall's reset is an absolute epoch).
    rateLimits: { "calls.list": { requestsPerMinute: 30 } },
    credentialFields: [
      { key: "apiKey", label: "API key (justcall.io → Settings → Developers)", placeholder: "…" },
      { key: "apiSecret", label: "API secret", placeholder: "…" },
    ],
    // No eventTypeLabels on purpose: call_logged / call_connected / call_completed are
    // Close's declarations and call_missed is Aircall's, and one declarer per key is what
    // keeps the org-wide picker unambiguous (tests/event-type-labels.test.ts pins
    // call_logged at exactly one declarer). The humanizer already renders all four.
    commonFields: ["direction", "call_type", "disposition", "agent_email", "contact_number", "talk_seconds", "ring_seconds"],
  },
  {
    source: "oncehub",
    name: "OnceHub",
    description: "Meetings booked, cancelled, rescheduled, held and no-shows — with the charge where payment is collected.",
    brand: { color: "#009BDE", short: "Oh" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    // A subscription created through POST /v2/webhooks is always v2, and only
    // v2 deliveries are signed — so auto-registering is what makes failing
    // closed safe. A hand-made v1 endpoint has no secret to paste.
    autoWebhook: true,
    docs: { url: "https://help.oncehub.com/developers/api/", readOn: "2026-09-08", webhooks: "https://help.oncehub.com/developers/webhooks/webhook-signatures/" },
    verified: { live: null },
    // https://help.oncehub.com/developers/overview/rate-limits/ (read 2026-09-08):
    // "5 requests per second" per account (300/min) AND "200 requests per 5
    // minutes" per IP address (40/min). The tighter of the two is what a walk
    // out of our own egress actually meets first.
    rateLimits: { "bookings.list": { requestsPerMinute: 40 } },
    credentialFields: [{ key: "apiKey", label: "API key (Settings → API & Webhooks)" }],
    hiddenFields: ["object"],
    commonFields: ["status", "creation_time", "starting_time", "last_updated_time", "form_submission.email", "owner.email", "tracking_id", "subject"],
  },
  {
    source: "savvycal",
    name: "SavvyCal",
    description: "Meetings booked, cancelled and rescheduled, with paid-checkout revenue.",
    brand: { color: "#00551F", short: "Sv" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    // developers.savvycal.com/api/list-events (read 2026-09-08) has no created-at
    // filter: the only date bound is `from`/`until` on the meeting's START date.
    syncNote:
      "SavvyCal can only filter its event list by meeting start date, so an import holds meetings that START inside the window, not meetings booked inside it.",
    // developers.savvycal.com/api/create-webhook (read 2026-09-08): POST /v1/webhooks
    // takes `{ url }` and NOTHING else, and answers the Webhook object whose `secret`
    // ("Webhook secret") is one of its six REQUIRED fields. So the personal access
    // token the customer already pasted buys both the subscription and the signing
    // secret in one call, and there is nothing left for anyone to copy by hand.
    //
    // No `webhookOptional`: savvycal.com/pricing sells "API & Webhooks" as ONE feature
    // line, so there is no plan that grants the event list and refuses the
    // subscription. A refusal here is a real fault and belongs in `lastError`, where
    // the sweep retries it, rather than being shrugged off as a tier we expected.
    autoWebhook: true,
    docs: { url: "https://developers.savvycal.com/api/list-events", readOn: "2026-09-08", webhooks: "https://developers.savvycal.com/webhooks" },
    verified: { live: null },
    // developers.savvycal.com (read 2026-09-08) publishes no rate limit and
    // documents no 429 response; 60/min until scripts/verify-savvycal.ts measures one.
    rateLimits: { "events.list": { requestsPerMinute: 60 } },
    // The token is the whole ask. There is no `webhookSecret` field because there is
    // nothing to paste: the secret arrives in the create response and is stored
    // encrypted from there.
    credentialFields: [{ key: "apiKey", label: "Personal access token (Settings → Developers)", placeholder: "pt_secret_…" }],
    commonFields: [
      "state",
      "created_at",
      "start_at",
      "end_at",
      "canceled_at",
      "rescheduled_at",
      "scheduler.email",
      "attendees.0.email",
      "payment.state",
      "cancel_reason",
      "link.name",
    ],
    // No `webhookSetup`: connecting creates the subscription, so there are no manual
    // steps in SavvyCal's UI left to describe.
  },
  {
    source: "thinkific",
    name: "Thinkific",
    description: "Orders, payments and refunds (Thinkific Payments), subscriptions cancelled, enrolments started and completed, signups and leads.",
    brand: { color: "#271526", short: "Th" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    syncNote:
      "Orders are reconciled by polling; transactions, enrolments, signups and leads arrive only by webhook. The transaction and " +
      "subscription topics fire only for sites on Thinkific Payments — a site taking payment through Stripe or PayPal sees none of them.",
    historyNote:
      "Orders reach back through the site's whole history (the first import covers 90 days, deeper on request), but transactions, enrolments, signups and leads have no list endpoint, so their history starts the day this connection was made.",
    autoWebhook: true,
    // Registration is plan- and permission-gated (the API needs Grow / Pro + Growth
    // or above), and a refusal must leave the connection polling, not erroring.
    webhookOptional: true,
    docs: {
      url: "https://developers.thinkific.com/api/api-documentation",
      readOn: "2026-09-08",
      webhooks: "https://support.thinkific.dev/hc/en-us/articles/4422685850775-Using-Webhooks",
    },
    verified: { live: null },
    // support.thinkific.dev/hc/en-us/articles/4422684774935 "REST API Rate Limits"
    // (read 2026-09-08): "REST API requests are limited to 120 requests per minute.
    // If you exceed this maximum amount you'll receive a 429 error", plus a maximum
    // of 10 concurrent requests. Both are per site.
    rateLimits: { "orders.list": { requestsPerMinute: 120 } },
    credentialFields: [
      { key: "apiKey", label: "API key (Settings → Code & Analytics → API)", placeholder: "…" },
      { key: "subdomain", label: "Site subdomain (the part before .thinkific.com)", placeholder: "acme" },
    ],
    // No webhookSecret field: Thinkific signs with the site API key itself, and only
    // documents webhooks CREATED THROUGH THE API as verifiable — so registerWebhook
    // makes them and hands the same key back as the signing secret. Asking for the
    // key a second time would only be a second chance to paste it wrong.
    //
    // payment_succeeded, payment_refunded, subscription_canceled and lead_created are
    // deliberately unlabelled here: Stripe, Close and Pipedrive already name those
    // stored keys, and one key wearing two different labels is what
    // tests/event-type-labels.test.ts exists to stop.
    eventTypeLabels: { order_created: "Order placed", enrollment_created: "Enrolment started", enrollment_completed: "Course completed", user_signup: "Signed up" },
    commonFields: ["product_name", "amount_dollars", "status", "user_email", "user.email", "coupon_code", "order.amount_dollars", "course.name", "percentage_completed"],
  },
  {
    source: "thrivecart",
    name: "ThriveCart",
    description: "Orders, rebills and failed rebills, refunds, cancellations, pauses, abandoned carts, affiliate commissions.",
    brand: { color: "#F5A623", short: "Tc" },
    connect: "apiKey",
    instant: true,
    poll: false,
    sync: "webhook-only",
    historyNote: "ThriveCart publishes no order-list endpoint, so history begins the day you connect.",
    // NOT auto-registerable, and this is the whole working (docs read 2026-09-08).
    // ThriveCart does publish a create endpoint —
    // https://developers.thrivecart.com/documentation/event_subscription/intro/: "you
    // will POST a JSON blob to the subscribe endpoint:
    // https://thrivecart.com/api/external/subscribe", carrying `event` and `target_url`
    // — but it documents NO response body and no secret anywhere in one, and it gates
    // the URL on an app's own settings ("You will only be able to create a target_url
    // that begins with one of the URLs registered to your app"), which needs a public
    // app and an OAuth grant this connector holds no credential for: its ONLY
    // credential IS the secret. What authenticates a delivery is the ACCOUNT's "Secret
    // word", which exists only in the ThriveCart UI — no documented endpoint returns
    // it, none accepts one we mint, and there is no unsubscribe endpoint either. So the
    // field stays, marked required, and the copy names the exact screen instead of
    // pretending the paste can be skipped.
    autoWebhook: false,
    docs: {
      url: "https://support.thrivecart.com/help/using-webhook-notifications/",
      readOn: "2026-09-08",
      webhooks: "https://developers.thrivecart.com/documentation/event_subscription/intro/",
    },
    verified: { live: null },
    // https://developers.thrivecart.com/documentation/intro/index/ (read 2026-09-08):
    // "your use of the API will be rate limited to 60 requests per minute, per account
    // that you are connected to", and they "do not increase rate limits preemptively".
    // Declared for completeness — this connector is webhook-only and calls no endpoint,
    // so it never spends the budget.
    rateLimits: { "*": { requestsPerMinute: 60 } },
    // REQUIRED, and said so: there is no poll behind this source and the secret in the
    // body is the whole of the authentication, so a connection saved without it is a
    // connection that receives nothing. (Whop's webhook secret says "(optional)" and
    // means it — polling covers that one.)
    credentialFields: [
      {
        key: "webhookSecret",
        label: "Order validation secret (required) — Account → Settings → API & Webhooks → ThriveCart order validation",
        placeholder: "JLZE3Y54FEQ1",
      },
    ],
    // Only keys no other connector labels: payment_refunded and subscription_canceled
    // are already named by Stripe, and two sources must not disagree about one key.
    eventTypeLabels: {
      order_created: "Order placed",
      rebill: "Rebill collected",
      rebill_failed: "Rebill failed",
      subscription_paused: "Subscription paused",
      subscription_resumed: "Subscription resumed",
      cart_abandoned: "Cart abandoned",
      commission_earned: "Commission earned",
    },
    commonFields: ["event", "mode", "base_product_name", "order.total", "currency", "customer.email", "order.charges"],
    webhookSetup:
      "ThriveCart has no API that hands out this secret, so it is the one value you copy across by hand. In ThriveCart " +
      "open Account → Settings → API & Webhooks: in the Webhooks area add a webhook with any descriptive name and the " +
      "URL below (or point an app's event subscription at it), then copy the Secret word shown in the ThriveCart order " +
      "validation area on that same page and paste it above. It travels inside the body of every delivery and is the " +
      "whole of the authentication, so deliveries are rejected while it is missing or wrong. Test-mode orders are " +
      "dropped, and there is no list API, so history starts at connect.",
  },
  {
    source: "retell",
    name: "Retell AI",
    description: "AI voice calls: started, completed with the duration in seconds, dials that never connected, analysed outcomes and transfers to a human.",
    // The vendor's own mark: #00122E is the only fill in the icon and wordmark
    // SVGs on https://www.retellai.com/logos (read 2026-09-08).
    brand: { color: "#00122E", short: "Re" },
    connect: "apiKey",
    instant: true,
    poll: true,
    sync: "incremental",
    historyNote: "Retell keeps calls indefinitely unless an agent sets a data-retention period, which then deletes its calls permanently.",
    /**
     * Re-checked against the live docs on 2026-09-08, because every other
     * instant source we ship registers its own subscription and this one
     * cannot:
     * - RETELL HAS NO WEBHOOK RESOURCE. docs.retellai.com/llms.txt — the
     *   published index of every page — lists four webhook pages, all under
     *   `features/`, and not one webhook endpoint under `api-references/`.
     *   features/register-webhook is a DASHBOARD walkthrough: account-level
     *   webhooks are "Set up through the system settings' webhooks tab",
     *   agent-level ones "through the dashboard's agent detail page".
     * - The one API that can write a webhook URL is `PATCH
     *   /update-agent/{agent_id}`, whose `webhook_url` "If set, will binds
     *   webhook events for this agent to the specified url, and will ignore the
     *   account level webhook for this agent". One single-valued field, per
     *   agent, on "an existing agent's latest draft version" (a separate
     *   publish-agent moves a draft to live traffic). Writing it would REDIRECT
     *   the customer's own deliveries rather than add a subscription beside
     *   them, so we do not write it.
     * - No signing secret exists to return or to supply: "Only the API key that
     *   has a webhook badge next to it can be used to verify the webhook"
     *   (features/secure-webhook), Retell having "automatically designate[d]
     *   one of your API keys for webhook authentication"
     *   (accounts/api-keys-overview). That key is one the connect dialog
     *   already collected, which is why the connector's
     *   `webhookSecretFromCredentials` names it and the second field below is
     *   an OVERRIDE rather than a chore.
     */
    autoWebhook: false,
    docs: { url: "https://docs.retellai.com/api-references/list-calls", readOn: "2026-09-08", webhooks: "https://docs.retellai.com/features/webhook" },
    verified: { live: null },
    // https://docs.retellai.com/deploy/concurrency (read 2026-09-08) publishes CALL
    // limits only — concurrent calls per workspace (20 on pay-as-you-go) and calls
    // per second — and no requests-per-minute figure for the REST API anywhere in
    // the docs; 60/min is a conservative stand-in until scripts/verify-retell.ts
    // measures the response headers against a real account.
    rateLimits: { "calls.list": { requestsPerMinute: 60 } },
    credentialFields: [
      { key: "apiKey", label: "API key", placeholder: "key_…" },
      // Optional because it is only ever a correction. A workspace "can have
      // multiple API keys" and Retell badges ONE of them for webhooks, so this
      // is for the account whose badged key is not the key above; left empty,
      // the connection verifies with the key above.
      { key: "webhookSecret", label: "Webhook signing key (optional — only if it isn't the API key above)", placeholder: "The key badged “webhook” in Retell → API keys" },
    ],
    eventTypeLabels: { call_analyzed: "Call analysed", call_transferred: "Call transferred" },
    commonFields: ["direction", "call_status", "disconnection_reason", "call_successful", "user_sentiment", "custom_analysis_data", "agent_id", "duration_ms"],
    webhookSetup:
      "In Retell, open the dashboard's system settings → Webhooks tab, set the URL below, and press Test to check it — or set an " +
      "agent's own webhook_url on its detail page, which takes that agent's events away from the account-wide one. There is no secret " +
      "to copy back: Retell signs every delivery with one of your API keys, and Namzilabs verifies with the key you already pasted. " +
      "Only if the key badged “webhook” under Retell's API keys is a different one, paste that key as the signing key. Polling covers " +
      "the last 30 days either way.",
  },
  {
    source: "customerio",
    name: "Customer.io",
    description: "Messages delivered, opened, clicked, converted and replied to; subscribers gained and lost.",
    // Evergreen, the dark half of the 2024 identity, read off Customer.io's own
    // stylesheet: `--evergreen-500: 187 69% 14%` (customer.io, 8 Sep 2026).
    brand: { color: "#0B373C", short: "Ci" },
    connect: "apiKey",
    instant: true,
    poll: false,
    sync: "webhook-only",
    syncNote:
      "Opens are pixel-based and inflated by Apple Mail Privacy Protection and scanning proxies — delivered, clicked and " +
      "converted are the defensible counts.",
    historyNote:
      "Customer.io's activity list has no time filter, so nothing can be backfilled — history starts when you connect.",
    /**
     * FALSE ON PURPOSE, and NOT for the usual reason — there IS a create API.
     * `POST /v1/reporting_webhooks` takes `{name, endpoint, events, disabled,
     * full_resolution, with_content}` and has a matching `DELETE
     * /v1/reporting_webhooks/{webhook_id}`
     * (docs.customer.io/integrations/api/app/tag/reporting-webhooks/, read
     * 8 Sep 2026). What it returns is the problem: `{name, id, type, endpoint,
     * disabled, full_resolution, with_content, events}` — the same eight fields
     * on create, get and list, none of them a secret, and none accepted on the
     * way in. So registering would leave this paste exactly where it is and ADD
     * an "Auth Required" App API Key to it. The full ruling is in customerio.ts.
     */
    autoWebhook: false,
    docs: {
      url: "https://docs.customer.io/integrations/data-out/connections/webhooks/",
      readOn: "2026-09-08",
      webhooks: "https://docs.customer.io/integrations/data-out/connections/webhooks/",
    },
    verified: { live: null },
    /**
     * ONE ACCOUNT-WIDE BUCKET, and today nothing spends from it. Customer.io's
     * App API reference (docs.customer.io/integrations/api/app, read 8 Sep 2026)
     * publishes one figure for the endpoints that matter here — "Most endpoints
     * on this page are limited to 10 requests per second" — so 600/min on "*"
     * is the shape the provider actually charges, not a per-endpoint guess.
     * Declared rather than omitted so the number carries a date: this connector
     * makes no outbound requests at all (no poll — see customerio.ts on why the
     * activity list cannot be walked), so it is the ceiling any future read
     * would inherit, already cited.
     */
    rateLimits: { "*": { requestsPerMinute: 600 } },
    /**
     * ONE FIELD, AND IT IS REQUIRED. There is no poll behind it, so an empty box
     * is not a slower integration — it is an integration whose deliveries this
     * app refuses, because `verifySignature` fails closed. The label names the
     * PAGE rather than the product because that is the whole of the difficulty:
     * the key is shown beside the endpoint in Customer.io's UI and no API
     * returns it, so nothing but the customer's own eyes can fetch this value.
     */
    credentialFields: [
      {
        key: "webhookSecret",
        label: "Reporting webhook signing key (Integrations → Reporting webhooks, shown beside the endpoint)",
        placeholder: "…",
      },
    ],
    eventTypeLabels: {
      email_delivered: "Email delivered",
      email_opened: "Email opened",
      email_clicked: "Email clicked",
      email_converted: "Email converted",
      sms_replied: "SMS reply received",
      subscribed: "Subscribed",
      unsubscribed: "Unsubscribed",
      bounced: "Bounced",
    },
    commonFields: ["channel", "metric", "data.campaign_id", "data.subject", "data.identifiers.email", "data.delivery_id"],
    webhookSetup:
      "In Customer.io → Integrations → Reporting webhooks, choose Add Reporting Webhook, paste the URL below as the Webhook " +
      "Endpoint URL, tick the metrics you count (leave Drafted and Attempted off — they are internal stages and are dropped " +
      "anyway), and Save and Enable Webhook. That same page then shows a signing key beside the endpoint: paste it as the " +
      "secret on this connection. Customer.io's API can create the endpoint but never hands back that key, so this is the one " +
      "step nothing can do for you. By default Customer.io reports only the FIRST open or click per message; raise Send " +
      "Frequency on the endpoint if you need every one. There is no list API to backfill from, so history starts here.",
  },
  {
    source: "airtable",
    name: "Airtable",
    description: "Rows of one table, re-read every sweep — leads, jobs, deliverables, whatever the base models.",
    brand: { color: "#FCB400", short: "At" },
    connect: "apiKey",
    instant: false,
    poll: true,
    // Whole-resource mirror: every sweep re-reads the table, so an edit or a
    // deletion anywhere in it is reflected, not just appended rows. There is no
    // choice about this — list-records has NO time filter, so there is no field
    // the provider filters on and therefore no honest watermark to walk.
    sync: "mirror",
    syncNote:
      "Each sweep re-reads the whole table, up to 5,000 records; a larger table mirrors only its first 5,000 rows, in Airtable's own order.",
    autoWebhook: false,
    docs: {
      url: "https://airtable.com/developers/web/api/list-records",
      readOn: "2026-09-08",
      webhooks: "https://airtable.com/developers/web/api/webhooks-overview",
    },
    verified: { live: null },
    // airtable.com/developers/web/api/rate-limits (read 2026-09-08): "5 requests
    // per second per base" — 300/min, and the binding figure because one stream
    // is one base. The same page's other limit, "50 requests per second for all
    // traffic using personal access tokens from a given user or service
    // account", is ~10x looser and only bites across many bases at once. A 429
    // there costs 30 seconds ("you will need to wait 30 seconds before
    // subsequent requests will succeed"), which is why the connector paces its
    // own page walk under this number rather than discovering it.
    rateLimits: { "records.list": { requestsPerMinute: 300 } },
    credentialFields: [
      {
        key: "apiKey",
        label: "Personal access token (airtable.com/create/tokens — scopes data.records:read and schema.bases:read)",
        placeholder: "pat…",
      },
    ],
    // Which base + table is chosen inside each flow's Get data step.
    flowFields: [
      { key: "baseId", label: "Base", required: true, dynamic: true, placeholder: "Choose a base…" },
      {
        key: "tableId",
        label: "Table",
        required: true,
        dynamic: true,
        dependsOn: ["baseId"],
        placeholder: "Choose a table…",
        hint: "Each step reads one table.",
      },
    ],
    hiddenFields: ["_airtable.id", "_airtable.baseId", "_airtable.tableId"],
    commonFields: ["_airtable.createdTime"],
  },
];

export function catalogEntry(source: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG.find((c) => c.source === source);
}

/**
 * Sources whose resource lives on the flow (streams), not on the connection.
 *
 * "Has a flowField" is NOT the definition, and the difference is load-bearing:
 * a readFilter-only field narrows the READ, never the fetch, so it must not
 * make a source stream-scoped. If it did, every gate keyed on this answer
 * would strand the source — Test would demand a "resource" the source doesn't
 * have (test-run.ts), runSync would walk zero streams (resync.ts), the
 * webhook route would degrade to doorbell-only and store nothing, and the
 * legacy-ghost retire would read the whole dataset as orphaned. Close is the
 * case that makes this real: its Pipeline picker is a WHERE clause over one
 * shared event-log sync, and the account stays the resource.
 */
export function isStreamScoped(source: string | null | undefined): boolean {
  return (catalogEntry(source ?? "")?.flowFields ?? []).some((f) => (f.readFilter?.paths.length ?? 0) === 0);
}

/**
 * The flowFields of a source that narrow the READ rather than the request
 * (see FlowConfigField.readFilter).
 */
export function readFilterFields(source: string | null | undefined): FlowConfigField[] {
  return (catalogEntry(source ?? "")?.flowFields ?? []).filter((f) => (f.readFilter?.paths.length ?? 0) > 0);
}

/**
 * Does this field apply to a step reading `eventType`?
 *
 * ONE definition, used by both halves that must agree: the panel (which
 * offers the field) and the engine (which applies it). If they ever
 * disagreed, a saved value would keep filtering a step whose UI no longer
 * shows the control — the exact silent zero this gate exists to prevent.
 */
export function fieldAppliesToEventType(field: FlowConfigField, eventType: string | null | undefined): boolean {
  const prefixes = field.showWhenEventTypePrefix;
  if (!prefixes || prefixes.length === 0) return true;
  const t = (eventType ?? "").trim();
  if (!t) return false; // "All record types" spans kinds that have no such field
  return prefixes.some((p) => t.startsWith(p));
}

/**
 * Config keys that must NOT enter a stream's identity, because they describe how
 * a flow READS the sync rather than what the sync fetches.
 *
 * Keyed by source, deliberately: `normalizeStreamConfig` cannot tell a read
 * filter from a resource selector by looking at the value, and guessing from the
 * key name would make one connector's choice silently reshape another's streams.
 */
export function readFilterKeys(source: string | null | undefined): Set<string> {
  return new Set(readFilterFields(source).map((f) => f.key));
}

/** The effective guarantee class of a source (see SyncGuarantee). */
export function syncGuarantee(source: string | null | undefined): SyncGuarantee {
  const entry = catalogEntry(source ?? "");
  if (!entry) return "webhook-only";
  return entry.sync ?? (entry.poll ? "incremental" : "webhook-only");
}

/** Mirror sources re-read the whole resource every sweep (stored == source). */
export function isMirrorSource(source: string | null | undefined): boolean {
  return syncGuarantee(source) === "mirror";
}

/**
 * Display name for a stored eventType. NEVER touches stored values — every
 * surface that shows a type to a person goes through here; every surface that
 * stores or matches one uses the raw string.
 *
 * Null source is the org-wide dropdowns (metrics/funnels), where the type
 * string arrives without its connection: first declared match wins, which is
 * safe while the label-collision test forbids two sources declaring the same
 * key with different labels (tests/event-type-labels.test.ts).
 */
/**
 * Words the humanizer must not sentence-case. Applied at ANY word position:
 * "activity.sms.updated" reads "SMS updated", not "Sms updated".
 */
const LABEL_ACRONYMS: Record<string, string> = { sms: "SMS", whatsapp: "WhatsApp" };

/**
 * Humanize a raw provider pair: "activity.email_thread.updated" →
 * "Email thread updated". The "activity." prefix is Close's namespace for
 * most of its event log and carries no meaning a person needs — but ONLY
 * as the LEADING segment: `custom_fields.activity.created` is the custom
 * fields OF activities, and deleting the word that says so once mislabeled
 * it as plain "Custom fields created".
 */
function humanizeEventType(eventType: string): string {
  const segments = eventType.split(".");
  if (segments[0] === "activity") segments.shift();
  const words = segments
    .join(" ")
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => LABEL_ACRONYMS[w] ?? w);
  if (words.length === 0) return eventType;
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function eventTypeLabel(source: string | null | undefined, eventType: string): string {
  if (source) {
    return catalogEntry(source)?.eventTypeLabels?.[eventType] ?? humanizeEventType(eventType);
  }
  // Unbound lookup (org-wide dropdowns): a declared label is only usable when
  // every source that declares this key AGREES. Two sources can share a
  // stored key with different meanings — Close's `email_sent` counts inbound
  // and drafts, Instantly's is a true send — and picking either label would
  // describe the other source's rows wrongly on a surface that mixes both.
  // Disagreement falls back to the neutral humanizer, pinned by test.
  const declared = new Set<string>();
  for (const c of CONNECTOR_CATALOG) {
    const l = c.eventTypeLabels?.[eventType];
    if (l) declared.add(l);
  }
  if (declared.size === 1) return [...declared][0];
  return humanizeEventType(eventType);
}

/**
 * Whether a stored eventType is hidden from PICKERS for this source.
 *
 * Display-only, always: hidden types stay stored, stay filterable by exact
 * string, and stay selectable wherever they are already the saved value —
 * `eventTypeOptions` enforces that last part. Hiding exists because Close's
 * event log carries planes no analytics dropdown should offer: cascade
 * deletions, keystroke-rate note updates, and the workspace-admin plane
 * (custom field definitions, imports, memberships…).
 */
function hiddenBy(h: ConnectorCatalogEntry["hiddenEventTypes"], eventType: string): boolean {
  if (!h) return false;
  return (
    (h.exact?.includes(eventType) ?? false) ||
    (h.prefixes?.some((p) => eventType.startsWith(p)) ?? false) ||
    (h.suffixes?.some((s) => eventType.endsWith(s)) ?? false)
  );
}

export function isHiddenEventType(source: string | null | undefined, eventType: string): boolean {
  if (source) return hiddenBy(catalogEntry(source)?.hiddenEventTypes, eventType);
  // Unbound (org-wide pickers): noise is noise regardless of which source's
  // list a mixed dropdown was built from — without this fallback, the
  // funnels/metrics pickers still offered every `.deleted` cascade and
  // admin-plane type the hiding existed to remove.
  return CONNECTOR_CATALOG.some((c) => hiddenBy(c.hiddenEventTypes, eventType));
}

/**
 * The one options builder every event-type picker goes through: hidden types
 * filtered out, the CURRENT value always retained (even hidden, even absent
 * from the fresh list — deselecting someone's saved filter because a fetch
 * was slow or a type was later hidden would silently widen their data), raw
 * string as the hint when the label differs, and sorted by LABEL — stored-
 * string order scatters related labels ("activity.email.sent" and
 * "email_sent" landed a full alphabet apart, which is how a collision went
 * unnoticed).
 */
export function eventTypeOptions(
  source: string | null | undefined,
  types: readonly string[],
  current?: string | null,
): Array<{ value: string; label: string; hint?: string }> {
  const values = new Set(types.filter((t) => !isHiddenEventType(source, t)));
  if (current) values.add(current);
  return [...values]
    .map((t) => {
      const label = eventTypeLabel(source, t);
      return { value: t, label, hint: label === t ? undefined : t };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
