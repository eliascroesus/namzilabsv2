import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/**
 * WHAT EACH SOURCE IS FOR, AND WHAT IT ACTUALLY GIVES YOU.
 *
 * The index used to answer one question — "is my tool on the list?" — when the
 * visitor's real question is "will it give me the thing I need?". Categories
 * answer the first at a glance; the field tags answer the second without them
 * having to open anything.
 *
 * ═══ THIS LIVES HERE, NOT IN THE CATALOGUE ═══
 *
 * A `category` field on `CONNECTOR_CATALOG` would be the tidier home and it is
 * the wrong one: the catalogue is the product's, this taxonomy is the
 * marketing page's way of grouping it, and the landing page is not allowed to
 * reach into app data structures to add a column it alone reads.
 *
 * The consequence is that this map can fall behind the catalogue, so it is
 * written not to lie when it does: a connector with no entry still appears in
 * the index, still counts toward "All", and falls into `Data & docs` rather
 * than vanishing. `tests`-free code cannot catch that, but the count beside
 * "All" is read from CONNECTOR_CATALOG itself, so a missing entry shows up as
 * the category counts failing to sum rather than as a source going missing.
 */
export const CATEGORIES = [
  "Scheduling",
  "CRM",
  "Outreach",
  "Payments",
  "Forms",
  "Calls",
  "Data & docs",
  "Commerce",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_OF: Record<string, Category> = {
  calendly: "Scheduling",
  gcal: "Scheduling",
  calcom: "Scheduling",
  oncehub: "Scheduling",
  savvycal: "Scheduling",

  close: "CRM",
  pipedrive: "CRM",
  attio: "CRM",
  helpscout: "CRM",

  instantly: "Outreach",
  smartlead: "Outreach",
  lemlist: "Outreach",
  customerio: "Outreach",
  mailchimp: "Outreach",
  klaviyo: "Outreach",

  stripe: "Payments",
  paddle: "Payments",

  typeform: "Forms",
  tally: "Forms",

  aircall: "Calls",
  justcall: "Calls",
  retell: "Calls",
  fathom: "Calls",

  gsheets: "Data & docs",
  ganalytics: "Data & docs",
  airtable: "Data & docs",
  notion: "Data & docs",
  webhook: "Data & docs",

  whop: "Commerce",
  thinkific: "Commerce",
  thrivecart: "Commerce",
  woocommerce: "Commerce",
  shopify: "Commerce",
};

/**
 * Three fields per source, taken from what its connector actually reads —
 * every one of these appears in that connector's own catalogue description.
 * Three is the cap on purpose: a buyer scans for one word, and a wall of tags
 * is the same as no tags.
 */
const TAGS_OF: Record<string, [string, string, string]> = {
  calendly: ["Booked", "No-show", "Rescheduled"],
  gcal: ["Events", "Attendees", "Incremental"],
  calcom: ["Booked", "Held", "No-show"],
  oncehub: ["Booked", "Held", "Charge"],
  savvycal: ["Booked", "Rescheduled", "Checkout"],

  close: ["Leads", "Calls", "Deal stage"],
  pipedrive: ["Deals", "Stages", "Won / lost"],
  attio: ["Deals", "Deal value", "Stage"],
  helpscout: ["Opened", "Replies", "First reply"],

  instantly: ["Sent", "Replies", "Bounces"],
  smartlead: ["Sent", "Opened", "Replied"],
  lemlist: ["Sent", "Clicked", "Bounced"],
  customerio: ["Delivered", "Clicked", "Converted"],
  mailchimp: ["Contacts", "Opt-in date", "Audience"],
  klaviyo: ["Orders", "Opens", "Carts"],

  stripe: ["Revenue", "Refunds", "Invoices"],
  paddle: ["Transactions", "Earnings", "Fees"],

  typeform: ["Submissions", "Starts", "Completion"],
  tally: ["Submissions", "Partial", "Per form"],

  aircall: ["Dialled", "Talk time", "Disposition"],
  justcall: ["Calls", "Connected", "Talk time"],
  retell: ["AI calls", "Duration", "Transfers"],
  fathom: ["Recorded", "Attendees", "Meetings"],

  gsheets: ["Any column", "Mirrored rows", "Live"],
  ganalytics: ["Sessions", "Users", "Conversions"],
  airtable: ["Any table", "Any field", "Re-read"],
  notion: ["Rows", "Properties", "Mirrored"],
  webhook: ["Any event", "Any app", "POST"],

  whop: ["Payments", "Members", "Company"],
  thinkific: ["Orders", "Refunds", "Subscriptions"],
  thrivecart: ["Orders", "Rebills", "Refunds"],
  woocommerce: ["Orders", "Totals", "Paid"],
  shopify: ["Orders", "Refunds", "Totals"],
};

const FALLBACK: Category = "Data & docs";

export type IndexSource = {
  source: string;
  name: string;
  blurb: string;
  category: Category;
  tags: string[];
};

/** Every catalogue entry, with its category and fields attached. */
export const INDEX_SOURCES: IndexSource[] = CONNECTOR_CATALOG.map((entry) => ({
  source: entry.source,
  name: entry.name,
  blurb: entry.description,
  category: CATEGORY_OF[entry.source] ?? FALLBACK,
  tags: TAGS_OF[entry.source] ?? [],
}));

/**
 * Counts DERIVED from the catalogue rather than typed beside each label — a
 * hand-written count is wrong the first time a connector ships and nothing
 * fails when it is.
 */
export const CATEGORY_COUNTS: Array<{ label: string; count: number }> = [
  { label: `All ${INDEX_SOURCES.length}`, count: INDEX_SOURCES.length },
  ...CATEGORIES.map((category) => ({
    label: category,
    count: INDEX_SOURCES.filter((s) => s.category === category).length,
  })).filter((c) => c.count > 1),
];
