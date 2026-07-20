/**
 * Display metadata that powers the integrations gallery and connect forms.
 * Keeping this separate from the runtime Connector keeps the engine lean while
 * the UI stays data-driven — adding a connector is one entry here.
 */
export type CredentialField = { key: string; label: string; placeholder?: string };
export type ConfigField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Optional short help text shown under the field. */
  hint?: string;
  /** When present, render a dropdown instead of a text input. */
  options?: { value: string; label: string }[];
};

/**
 * A per-flow resource field set inside the Get data step (never at connect time):
 * which spreadsheet + tab, which calendar, … `dynamic` fields load their options
 * live from the provider via the connector's listOptions; `dependsOn` gates a
 * field until its prerequisites are chosen (and changing those resets it).
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
  options?: { value: string; label: string }[];
};

export type ConnectorCatalogEntry = {
  source: string;
  name: string;
  description: string;
  /** How the user connects: paste an API key/token, or Google OAuth. */
  connect: "apiKey" | "google";
  instant: boolean;
  poll: boolean;
  /** Whether we auto-create the provider webhook subscription on connect. */
  autoWebhook: boolean;
  credentialFields: CredentialField[];
  /** Connection-level settings (auth-domain only, e.g. Calendly webhook scope). */
  configFields?: ConfigField[];
  /**
   * Flow-level resource settings (the Get data step's Configure section). A
   * connector with flowFields is stream-scoped: each distinct config becomes its
   * own synced stream with its own cursor, and events are tagged per stream.
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
    instant: true,
    poll: true,
    autoWebhook: true,
    credentialFields: [{ key: "accessToken", label: "Personal Access Token", placeholder: "eyJ..." }],
    configFields: [
      {
        key: "scope",
        label: "Fetch meetings for",
        required: true,
        options: [
          { value: "user", label: "Just me (User)" },
          { value: "organization", label: "Whole organization" },
          { value: "group", label: "A specific group" },
        ],
        hint: "Choose whose Calendly meetings to import.",
      },
      {
        key: "groupUri",
        label: "Group URI",
        placeholder: "https://api.calendly.com/groups/…",
        hint: "Only required when scope is a specific group.",
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
    description: "Emails sent, opens, replies and bounces from cold outreach.",
    connect: "apiKey",
    instant: true,
    poll: false,
    autoWebhook: false,
    credentialFields: [{ key: "apiKey", label: "API Key", placeholder: "..." }],
    webhookSetup:
      "In Instantly, add a webhook pointing to the URL below. Optionally set an HMAC secret and paste it here to verify signatures.",
  },
  {
    source: "sendblue",
    name: "Sendblue",
    description: "iMessage/SMS sent, delivered and received.",
    connect: "apiKey",
    instant: true,
    poll: false,
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
    description: "New rows from any spreadsheet, polled reliably.",
    connect: "google",
    instant: false,
    poll: true,
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
