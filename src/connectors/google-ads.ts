import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  ListOptionsArgs,
  SourceOption,
} from "./types";
import { fetchJson } from "@/lib/http-client";
import { str } from "./field-utils";
import { dailyReportWalk, dateInZone, fromMicros, metricNumber, reportRowId, reportShape, ymdUtc } from "./kit/ads";

/**
 * GOOGLE ADS — INCLUDING YOUTUBE, WHICH IS NOT A SEPARATE PRODUCT.
 *
 * A YouTube ad is a Google Ads campaign whose `advertising_channel_type` is
 * VIDEO (or DEMAND_GEN, which also serves on YouTube). There is no YouTube Ads
 * API to connect to and no second connector to write: the channel type is a
 * column, and `channelType` below turns it into a WHERE clause so a flow can
 * ask for YouTube alone without a second sync.
 *
 * ═══ TWO APPROVALS, AT TWO DIFFERENT QUEUES ═══
 *
 * Nothing here works until both land, and they are independent:
 *
 *   1. AN ACCESS LEVEL ON OUR GOOGLE CLOUD PROJECT. Until 9 Sep 2026 this was
 *      a developer token obtained from a Google Ads manager account's API
 *      Center; Google sunset that and access now attaches to the Cloud project
 *      whose OAuth credentials made the call. Enabling the API grants Test
 *      access (test accounts only); Explorer allows 2,880 operations/day
 *      against production accounts, Basic 15,000 after brand verification, and
 *      Standard unlimited after a manual audit.
 *
 *      IT IS OURS, NOT THE CUSTOMER'S, and every customer's requests count
 *      against it — which is what makes it a `fleetLimits` entry rather than a
 *      `rateLimits` one.
 *   2. GOOGLE'S OAUTH VERIFICATION, because `auth/adwords` has been a SENSITIVE
 *      scope since 1 Oct 2020. Free, 3-5 business days, and entirely separate
 *      from the access level above.
 *
 * Read 21 Sep 2026:
 *   developers.google.com/google-ads/api/docs/api-policy/developer-token
 *   developers.google.com/google-ads/api/docs/api-policy/access-levels
 *   developers.google.com/google-ads/api/docs/best-practices/quotas
 *
 * ═══ `search`, NOT `searchStream`, AND THE REASON IS THE QUOTA ═══
 *
 * Both cost one operation. But Google counts a paginated continuation carrying
 * a VALID page token as free, so a `search` walk over a large report costs one
 * operation however many pages it takes, while `searchStream` hands back the
 * whole result set in a single response that has to be held in memory and
 * cannot be resumed when a budget runs out. On Explorer's 2,880/day shared by
 * every customer, free continuations are not a micro-optimisation.
 */

/**
 * The REST path carries the MAJOR version only; minor releases (v25.1) are
 * served under it and are non-breaking by Google's own contract.
 * developers.google.com/google-ads/api/docs/release-notes, read 21 Sep 2026.
 */
export const GOOGLE_ADS_API_VERSION = "v25";
const API = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

const SEARCH_OP = "googleAds.search";
const CUSTOMERS_OP = "customers.list";

/**
 * FOURTEEN DAYS, AND THIS ONE IS A JUDGEMENT RATHER THAN A QUOTED FIGURE.
 *
 * Google publishes freshness, not finality: clicks, impressions and cost are
 * "delayed by less than 3 hours", last-click conversions up to 3 hours, and
 * conversions on other attribution models up to about 15. None of that is when
 * a number STOPS moving — conversion lag keeps restating a day's conversions
 * for as long as the conversion window allows, which is commonly 30 days and
 * can be 90.
 *
 * So 14 is a deliberate compromise with the reasoning written down: it covers
 * the overwhelming majority of conversion lag at a quarter of the re-read cost
 * of covering all of it, on an API whose daily operation ceiling is shared by
 * every customer. A flow that needs the long tail can deepen its own window.
 *
 * support.google.com/google-ads/answer/2544985, read 21 Sep 2026.
 */
const TRAILING_DAYS = 14;

/** Google's documented maximum page size for search is 10,000. */
const PAGE = 10_000;
const MAX_PAGES = 10;

const LEVELS = { account: "customer", campaign: "campaign", adgroup: "ad_group" } as const;
type Level = keyof typeof LEVELS;
const DEFAULT_LEVEL: Level = "campaign";

/**
 * The selected columns per level. `customer.currency_code` and
 * `customer.time_zone` ride along on every query — they cost nothing extra and
 * they are what stop a row being dated in the wrong zone.
 */
const LEVEL_SELECT: Record<Level, readonly string[]> = {
  account: [],
  campaign: ["campaign.id", "campaign.name", "campaign.advertising_channel_type", "campaign.status"],
  adgroup: [
    "campaign.id",
    "campaign.name",
    "campaign.advertising_channel_type",
    "ad_group.id",
    "ad_group.name",
    "ad_group.status",
  ],
};

/** The column whose value makes a row its own row, alongside the date. */
const LEVEL_KEY: Record<Level, string | null> = { account: null, campaign: "campaign.id", adgroup: "ad_group.id" };
const LEVEL_NAME: Record<Level, string | null> = {
  account: null,
  campaign: "campaign.name",
  adgroup: "ad_group.name",
};

const METRICS = [
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.ctr",
  "metrics.average_cpc",
  "metrics.video_views",
  "metrics.video_view_rate",
] as const;

type SearchResponse = { results?: Array<Record<string, unknown>>; nextPageToken?: string };

/**
 * GAQL IS snake_case; THE REST RESPONSE IS camelCase.
 *
 * You select `metrics.cost_micros` and Google returns `{metrics: {costMicros}}`.
 * Nothing warns about this: reading the field back under the name you asked for
 * yields `undefined`, which `metricNumber` turns into `null`, which renders as a
 * blank tile rather than as an error. Every read of a response goes through
 * here so the conversion happens in exactly one place.
 */
function pick(row: Record<string, unknown>, path: string): unknown {
  const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[camel(part)];
  }
  return cur;
}

/** `customers/1234567890` or `1234567890@9876543210` → the two ids the headers need. */
function parseCustomer(value: string): { customerId: string; loginCustomerId: string | null } {
  const [id, login] = value.replace(/^customers\//, "").split("@");
  return { customerId: id.replace(/-/g, ""), loginCustomerId: login ? login.replace(/-/g, "") : null };
}

function headers(token: string, loginCustomerId: string | null): Record<string, string> {
  /**
   * THE DEVELOPER TOKEN IS GONE, AND SENDING ONE IS NOW A LIABILITY.
   *
   * Google SUNSET developer tokens on 9 September 2026: "API access levels are
   * now determined by the Google Cloud project you used to generate your OAuth
   * credentials", and "You can continue sending developer tokens in your API
   * call headers, but this is optional and ignored by the API servers" — with
   * the warning that "We will start rejecting developer tokens in API calls in
   * a future major version."
   * developers.google.com/google-ads/api/docs/api-policy/developer-token,
   * read 21 Sep 2026.
   *
   * So the header is sent ONLY when someone has deliberately set the variable,
   * and its absence is the normal, correct state. This function used to THROW
   * without one, which after the sunset would have made a working API
   * permanently unreachable over a credential Google no longer issues.
   */
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  return {
    authorization: `Bearer ${token}`,
    ...(devToken ? { "developer-token": devToken } : {}),
    "content-type": "application/json",
    /**
     * REQUIRED WHENEVER THE ACCOUNT IS REACHED THROUGH A MANAGER, and harmful
     * when it is not: sending a manager id for an account that is not under it
     * fails the request outright. Hence the encoded option value — the picker
     * already knows which accounts were found through which manager, and this
     * is the only place that knowledge survives to.
     */
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

async function search<T = SearchResponse>(
  token: string,
  customerId: string,
  loginCustomerId: string | null,
  query: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  return fetchJson<T>(`${API}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: headers(token, loginCustomerId),
    body: JSON.stringify({ query, ...body }),
  });
}

export const googleAdsConnector: Connector = {
  source: "gads",
  authType: "oauth2",
  operations: [SEARCH_OP, CUSTOMERS_OP] as const,
  operationFor: () => SEARCH_OP,
  listOperationFor: (key: string) => (key === "customerId" ? CUSTOMERS_OP : undefined),

  // Read-only reporting; Google Ads has no push for report data.
  verifySignature(_args: VerifyArgs): boolean {
    return false;
  },

  normalize(_rawPayload: unknown, _ctx: NormalizeContext): CanonicalEvent[] {
    return [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("google-ads: missing access token");

    const selected = str(args.config?.["customerId"]);
    if (!selected) throw new Error("google-ads: no Google Ads account selected");
    const { customerId, loginCustomerId } = parseCustomer(selected);

    const level = (str(args.config?.["level"]) ?? "") in LEVELS ? (str(args.config?.["level"]) as Level) : DEFAULT_LEVEL;
    const channelType = str(args.config?.["channelType"]);

    const select = [
      ...LEVEL_SELECT[level],
      "customer.currency_code",
      "customer.time_zone",
      "segments.date",
      ...METRICS,
    ];
    const shape = reportShape([...LEVEL_SELECT[level], "segments.date", channelType ?? ""], METRICS);
    const keyField = LEVEL_KEY[level];
    const nameField = LEVEL_NAME[level];

    // Resolved from the first row rather than assumed; every row of one query
    // belongs to one customer, so one read settles it for the whole walk.
    let timeZone = "UTC";
    let currency: string | null = null;

    const result = await dailyReportWalk<Record<string, unknown>>({
      trailingDays: TRAILING_DAYS,
      windowFloor: args.windowFloor,
      budget: args.budget,
      maxPages: MAX_PAGES,
      fetchPage: async ({ from, to, cont }) => {
        /**
         * THE DATE BOUND IS THE WINDOW, and it is the same `from` the walk will
         * declare as its retirement span — one value, both purposes, which is
         * what `types.ts` requires of anything honouring `windowFloor`.
         *
         * `BETWEEN` is inclusive at both ends in GAQL, and the dates are the
         * ACCOUNT's own days, which is why they are formatted from the window
         * rather than from a local clock.
         */
        const where = [
          `segments.date BETWEEN '${ymdUtc(from)}' AND '${ymdUtc(to)}'`,
          // A request-narrowing filter, so it genuinely costs Google less and
          // is therefore a stream-identity input rather than a read filter.
          ...(channelType && level !== "account" ? [`campaign.advertising_channel_type = '${channelType}'`] : []),
        ].join(" AND ");
        const query = `SELECT ${select.join(", ")} FROM ${LEVELS[level]} WHERE ${where}`;

        const data = await search<SearchResponse>(token, customerId, loginCustomerId, query, {
          pageSize: PAGE,
          ...(cont ? { pageToken: cont } : {}),
        });
        return { rows: data.results ?? [], next: data.nextPageToken ?? null };
      },
      map: (row) => {
        timeZone = str(pick(row, "customer.time_zone")) ?? timeZone;
        currency = str(pick(row, "customer.currency_code")) ?? currency;

        const day = str(pick(row, "segments.date"));
        const occurredAt = day ? dateInZone(day, timeZone) : null;
        if (!occurredAt) return null;

        const properties: Record<string, unknown> = {};
        for (const m of METRICS) {
          const key = m.replace(/^metrics\./, "");
          properties[key] = m === "metrics.cost_micros" ? fromMicros(pick(row, m)) : metricNumber(pick(row, m));
        }
        // Named for what it is, not for how Google stores it: nothing on a
        // dashboard should have to know that cost arrives in millionths.
        properties["cost"] = properties["cost_micros"];
        delete properties["cost_micros"];
        for (const f of LEVEL_SELECT[level]) properties[f.replace(/\./g, "_")] = str(pick(row, f)) ?? null;
        properties["customerId"] = customerId;
        properties["level"] = level;
        properties["timeZone"] = timeZone;

        const entityId = keyField ? (str(pick(row, keyField)) ?? "") : "";

        return {
          eventId: reportRowId("gads", [args.streamHash ?? "", customerId, shape, level, day, entityId]),
          eventType: `gads.report.${level}`,
          subject: (nameField ? str(pick(row, nameField)) : null) ?? customerId,
          occurredAt,
          value: typeof properties["cost"] === "number" ? (properties["cost"] as number) : null,
          currency,
          properties,
        };
      },
    });

    return result;
  },

  /**
   * WHICH GOOGLE ADS ACCOUNTS THIS PERSON CAN READ.
   *
   * `listAccessibleCustomers` returns only resource names — no names, no
   * currency, and no indication of which are manager accounts holding a hundred
   * others. So each one is expanded through `customer_client`, which is also
   * what discovers the children an agency's login actually reaches.
   *
   * MANAGER ACCOUNTS ARE EXCLUDED FROM THE LIST, because they hold no campaigns
   * and a report against one returns nothing at all — an empty dashboard is a
   * far worse answer than an absent option. A customer who sees nothing here
   * has access only to managers, which the setup page says out loud.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "customerId") return [];
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("google-ads: missing access token");

    const roots = await fetchJson<{ resourceNames?: string[] }>(`${API}/customers:listAccessibleCustomers`, {
      headers: headers(token, null),
    });

    const out: SourceOption[] = [];
    const seen = new Set<string>();
    for (const resource of (roots.resourceNames ?? []).slice(0, 20)) {
      const rootId = resource.replace(/^customers\//, "");
      try {
        const data = await search<SearchResponse>(
          token,
          rootId,
          // The root IS the login context for its own hierarchy; a non-manager
          // root simply returns itself.
          rootId,
          "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, " +
            "customer_client.manager, customer_client.status FROM customer_client " +
            "WHERE customer_client.status = 'ENABLED'",
        );
        for (const row of data.results ?? []) {
          const id = str(pick(row, "customer_client.id"));
          if (!id || seen.has(id)) continue;
          // A manager holds no campaigns; see the note above.
          if (pick(row, "customer_client.manager") === true) continue;
          seen.add(id);
          const name = str(pick(row, "customer_client.descriptive_name")) ?? `Account ${id}`;
          const currency = str(pick(row, "customer_client.currency_code"));
          // `id@login` when reached through a different account, so the poll can
          // rebuild the `login-customer-id` header it will need.
          const value = id === rootId ? id : `${id}@${rootId}`;
          out.push({ value, label: currency ? `${name} (${currency})` : name });
        }
      } catch {
        /**
         * ONE UNREADABLE HIERARCHY MUST NOT EMPTY THE WHOLE PICKER. A Google
         * login commonly touches an account that has since been cancelled or
         * that this developer token may not reach; that is a fact about one
         * entry, and letting it throw would present the customer with no
         * accounts at all and no way to tell why.
         */
        continue;
      }
    }
    return out;
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
