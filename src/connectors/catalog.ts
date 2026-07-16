/**
 * Display metadata that powers the integrations gallery and connect forms.
 * Keeping this separate from the runtime Connector keeps the engine lean while
 * the UI stays data-driven — adding a connector is one entry here.
 */
export type CredentialField = { key: string; label: string; placeholder?: string };
export type ConfigField = { key: string; label: string; placeholder?: string; required?: boolean };

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
  configFields?: ConfigField[];
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
    configFields: [
      { key: "spreadsheetId", label: "Spreadsheet ID", placeholder: "1AbC...", required: true },
      { key: "range", label: "Sheet / range", placeholder: "Sheet1" },
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
    configFields: [{ key: "calendarId", label: "Calendar ID", placeholder: "primary" }],
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
