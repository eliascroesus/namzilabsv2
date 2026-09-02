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

export type ConnectorCatalogEntry = {
  source: string;
  name: string;
  description: string;
  /** How the user connects: paste an API key/token, or Google OAuth. */
  connect: "apiKey" | "google";
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
   * (`src/lib/google-oauth.ts`), so the quota is charged to our Cloud project
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
    autoWebhook: false,
    credentialFields: [
      { key: "apiKey", label: "API key", placeholder: "Whop → Developer → API keys" },
      { key: "companyId", label: "Company ID", placeholder: "biz_..." },
      { key: "webhookSecret", label: "Webhook signing secret (optional)", placeholder: "ws_… or whsec_…" },
    ],
    webhookSetup:
      "In Whop, add a webhook pointing at the URL below. Already have a signing secret from Whop? Paste it into " +
      "the Webhook signing secret field when you connect. Leave that blank and Namzilabs mints one instead — " +
      "copy it from the field below into Whop. Payments and memberships also arrive by polling, so webhooks are " +
      "optional — they only make updates instant.",
  },
  {
    source: "gsheets",
    name: "Google Sheets",
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
    description: "Catch events from any app that can POST a webhook.",
    connect: "apiKey",
    instant: true,
    poll: false,
    autoWebhook: false,
    credentialFields: [],
    webhookSetup:
      "Point any app's outbound webhook at the URL below. Optionally sign the body with HMAC-SHA256 using the secret shown.",
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
