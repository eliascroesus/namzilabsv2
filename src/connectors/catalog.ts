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
  options?: { value: string; label: string }[];
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
   * Provider-declared budgets per operation (from published docs), keyed
   * `"resource.verb"`. The reactive layer sizes page walks under them today;
   * the provider-gateway token buckets (workstream F) will enforce them.
   */
  rateLimits?: Record<string, { requestsPerMinute: number }>;
  /** Whether we auto-create the provider webhook subscription on connect. */
  autoWebhook: boolean;
  credentialFields: CredentialField[];
  /**
   * Flow-level resource settings (the Get data step's Configure section) — the ONLY
   * place any "what data to pull" choice lives. A connector with flowFields is
   * stream-scoped: each distinct config becomes its own synced stream with its own
   * cursor, and events are tagged per stream. Connecting an account asks for auth only.
   */
  flowFields?: FlowConfigField[];
  /** Manual webhook setup note shown on the connection page when not auto. */
  webhookSetup?: string;
};

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    source: "calendly",
    name: "Calendly",
    description: "Booked and canceled meetings, no-shows and routing forms.",
    connect: "apiKey",
    // Poll-based (reliable reconciliation). The scope below makes it stream-scoped, so
    // each flow pulls exactly the meetings it wants; instant per-stream webhooks are a
    // later enhancement.
    instant: false,
    poll: true,
    autoWebhook: false,
    credentialFields: [{ key: "accessToken", label: "Personal Access Token", placeholder: "eyJ..." }],
    // Whose meetings to import is chosen per flow, in the Get data step — not here.
    flowFields: [
      {
        key: "scope",
        label: "Fetch meetings for",
        required: true,
        hint: "Whose Calendly meetings this flow pulls.",
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
    autoWebhook: true,
    credentialFields: [{ key: "apiKey", label: "API Key", placeholder: "api_..." }],
  },
  {
    source: "instantly",
    name: "Instantly",
    description: "Campaign performance — sent, opens, replies, bounces — per campaign.",
    connect: "apiKey",
    instant: true,
    poll: true,
    // Analytics-first: the primary streams read provider-COMPUTED totals, which
    // is a different guarantee from mirroring records. See docs/DATA_MODEL.md.
    sync: "derived-mirror",
    /**
     * CONSERVATIVE by decision (documented in DATA_MODEL.md): the analytics
     * endpoints are assumed to share the same tight 20/min bucket as the emails
     * list, because that is the only published figure we have and being wrong
     * in this direction only costs throughput. If they turn out to be more
     * generous, raise these — they are enforced per endpoint now, so each moves
     * independently.
     */
    rateLimits: {
      "emails.list": { requestsPerMinute: 20 },
      "campaigns.list": { requestsPerMinute: 20 },
      "campaigns.analytics": { requestsPerMinute: 20 },
      "campaigns.analytics.daily": { requestsPerMinute: 20 },
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
      "In Instantly, add a webhook pointing to the URL below. Optionally set an HMAC secret and paste it here to verify signatures.",
  },
  {
    source: "sendblue",
    name: "Sendblue",
    description: "iMessage/SMS sent, delivered and received.",
    connect: "apiKey",
    instant: true,
    // Poll backstop over the message history list; the sweep also verifies the
    // provider-side webhook subscription and re-registers it when missing.
    poll: true,
    autoWebhook: false,
    credentialFields: [
      { key: "apiKey", label: "API Key ID", placeholder: "..." },
      { key: "apiSecret", label: "API Secret", placeholder: "..." },
    ],
    webhookSetup:
      "In Sendblue, configure an outbound (status) webhook pointing to the URL below, with the signing secret shown.",
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
    autoWebhook: false,
    credentialFields: [],
    flowFields: [{ key: "calendarId", label: "Calendar", dynamic: true, placeholder: "primary" }],
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

/** Sources whose resource lives on the flow (streams), not on the connection. */
export function isStreamScoped(source: string | null | undefined): boolean {
  return (catalogEntry(source ?? "")?.flowFields?.length ?? 0) > 0;
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
