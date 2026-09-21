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
import { dailyReportWalk, dateInZone, metricNumber, reportRowId, reportShape, ymdUtc } from "./kit/ads";

/**
 * META ADS (Facebook + Instagram), VIA THE MARKETING API's INSIGHTS EDGE.
 *
 * ═══ THE VERSION IS PINNED, AND THE PIN IS THE POINT ═══
 *
 * Meta ships three to four major versions a year and each lives about two.
 * v26.0 released 29 Jul 2026; v24.0 expires 6 Oct 2026, a fortnight after this
 * was written. An unpinned caller floats onto whatever is newest and breaks
 * with no deploy here — which is exactly what happened to the Whop connector
 * twice (see WHOP_API_VERSION). The version is in the URL, so there is no
 * header to forget.
 *
 * Read 21 Sep 2026: developers.facebook.com/docs/graph-api/changelog
 *
 * ═══ THIS CONNECTOR HAS NO CURSOR ═══
 *
 * Insights is an aggregation engine over a warehouse Meta keeps revising, not
 * an event log: no sync token, no webhook for report data, no `updated_time`,
 * and no row id. See `kit/ads.ts` for why that makes a date-windowed re-read the
 * only available sync, and why the row identity below carries the whole design.
 *
 * ═══ 28 DAYS, BECAUSE META SAYS 28 DAYS ═══
 *
 * "Insights refresh every 15 minutes and do not change after 28 days of being
 * reported" — developers.facebook.com/docs/marketing-api/insights/best-practices,
 * read 21 Sep 2026. That sentence IS `TRAILING_DAYS`. A shorter window freezes
 * numbers Meta has since restated, and nothing here would ever contradict it:
 * the stored row would simply stay at a value the advertiser can no longer find
 * anywhere in Ads Manager.
 */

/** In the URL path, so there is no header to forget. Bump deliberately, with a prober run. */
export const META_GRAPH_VERSION = "v26.0";
export const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const INSIGHTS_OP = "insights.read";
const ACCOUNTS_OP = "adaccounts.list";

/**
 * Meta's own words, above. Not a guess, and not tunable per flow: a window
 * shorter than the provider's restatement period is silently wrong, and a
 * longer one only costs calls.
 */
const TRAILING_DAYS = 28;

/** Meta's `limit` ceiling on this edge is generous; this is one comfortable page. */
const PAGE = 500;
/** Bound the walk, not the data — the same shape as every other connector here. */
const MAX_PAGES = 12;

/**
 * THE GRAIN, AND WHY CAMPAIGN IS THE DEFAULT.
 *
 * `level` decides how many rows a day produces: one per account, per campaign,
 * per ad set, or per ad. Ad level on a busy account is thousands of rows a day
 * per connection, every one of them re-read on every sweep for 28 days — which
 * is a real bill, in a product whose egress ceiling is already the thing being
 * watched. Campaign is the grain nearly every dashboard question is asked at;
 * the rest are one dropdown away in the flow's own Get data step.
 */
const LEVELS = ["account", "campaign", "adset", "ad"] as const;
type Level = (typeof LEVELS)[number];
const DEFAULT_LEVEL: Level = "campaign";

/** The id and name fields that exist at each level, so a row can say what it is. */
const LEVEL_FIELDS: Record<Level, readonly string[]> = {
  account: [],
  campaign: ["campaign_id", "campaign_name"],
  adset: ["campaign_id", "campaign_name", "adset_id", "adset_name"],
  ad: ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name"],
};

/** Which field identifies the row's own entity — the part of the id that varies. */
const LEVEL_KEY: Record<Level, string | null> = {
  account: null,
  campaign: "campaign_id",
  adset: "adset_id",
  ad: "ad_id",
};

/**
 * The metrics every row carries. Deliberately the ones a dashboard is built
 * from rather than everything Meta will return: each extra field costs
 * computation on Meta's side, and `error_code = 100` ("too much data") is
 * charged per query, not per field.
 */
const METRICS = [
  "spend",
  "impressions",
  "clicks",
  "reach",
  "frequency",
  "cpc",
  "cpm",
  "ctr",
  "account_currency",
  "actions",
  "action_values",
  "purchase_roas",
] as const;

type InsightRow = Record<string, unknown>;
type InsightsResponse = {
  data?: InsightRow[];
  paging?: { cursors?: { after?: string }; next?: string };
};

/**
 * `actions` and `action_values` arrive as ARRAYS OF OBJECTS, not as numbers:
 * `[{action_type: "purchase", value: "12"}, …]`. Left as-is they are unusable —
 * nothing in the metric engine can sum the third element of an array — so each
 * one is flattened to its own key.
 *
 * UNDERSCORED, NOT DOTTED. A dotted key would collide with the `properties.<k>`
 * path grammar the filter and field picker already speak, and `offsite_conversion.fb_pixel_purchase`
 * is a real action type with a dot already in it.
 */
function flattenActions(row: InsightRow, prefix: string, key: string, out: Record<string, unknown>): void {
  const list = row[key];
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const type = str(rec["action_type"]);
    if (!type) continue;
    const n = metricNumber(rec["value"]);
    if (n != null) out[`${prefix}${type.replace(/\./g, "_")}`] = n;
  }
}

export const metaAdsConnector: Connector = {
  source: "meta-ads",
  authType: "oauth2",
  operations: [INSIGHTS_OP, ACCOUNTS_OP] as const,
  operationFor: () => INSIGHTS_OP,
  listOperationFor: (key: string) => (key === "adAccountId" ? ACCOUNTS_OP : undefined),

  /**
   * Read-only reporting. Meta has webhooks, but none of them carry report data —
   * there is no event for "yesterday's spend was restated", which is precisely
   * the change this connector exists to notice.
   */
  verifySignature(_args: VerifyArgs): boolean {
    return false;
  },

  normalize(_rawPayload: unknown, _ctx: NormalizeContext): CanonicalEvent[] {
    return [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("meta-ads: missing access token");

    const raw = str(args.config?.["adAccountId"]);
    if (!raw) throw new Error("meta-ads: no ad account selected");
    // Stored with the prefix, because that is what the edge's path wants — but
    // a customer pasting a bare id into a config should not silently 404.
    const account = raw.startsWith("act_") ? raw : `act_${raw}`;

    const level = (LEVELS as readonly string[]).includes(str(args.config?.["level"]) ?? "")
      ? (str(args.config?.["level"]) as Level)
      : DEFAULT_LEVEL;

    /**
     * THE ACCOUNT'S OWN TIMEZONE, FETCHED RATHER THAN ASSUMED.
     *
     * Insights rows carry `date_start` as a bare `YYYY-MM-DD` in the AD
     * ACCOUNT's timezone, and say nothing about which zone that is. Parsed as
     * UTC, every row on every account west of London lands on the previous day —
     * a whole day's spend attributed to the wrong date, for ever, with nothing
     * on screen to suggest it.
     *
     * One extra call per poll, reported as such: it is a different operation
     * with a different budget, and charging it against the insights bucket
     * would have the tighter limit govern both.
     */
    const meta = await fetchJson<{ timezone_name?: string; currency?: string }>(
      `${META_GRAPH}/${account}?fields=timezone_name,currency`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const timeZone = meta.timezone_name ?? "UTC";

    const fields = [...LEVEL_FIELDS[level], ...METRICS];
    const shape = reportShape([...LEVEL_FIELDS[level], "date"], METRICS);
    const entityKey = LEVEL_KEY[level];

    const result = await dailyReportWalk<InsightRow>({
      trailingDays: TRAILING_DAYS,
      windowFloor: args.windowFloor,
      budget: args.budget,
      maxPages: MAX_PAGES,
      fetchPage: async ({ from, to, cont }) => {
        const url = new URL(`${META_GRAPH}/${account}/insights`);
        url.searchParams.set("level", level);
        url.searchParams.set("fields", fields.join(","));
        // ONE ROW PER DAY. Without this Meta collapses the whole range into a
        // single row and every number lands on one date.
        url.searchParams.set("time_increment", "1");
        url.searchParams.set("time_range", JSON.stringify({ since: ymdUtc(from), until: ymdUtc(to) }));
        /**
         * THE ACCOUNT'S OWN ATTRIBUTION SETTING, rather than ours.
         *
         * Conversion counts depend entirely on the attribution window, and Meta
         * will happily answer with a default that differs from what the
         * advertiser sees in Ads Manager. Two numbers for one fact, with our
         * copy the one that looks wrong. This asks for THEIR setting, so the
         * figures reconcile with the screen the customer is comparing against.
         */
        url.searchParams.set("use_account_attribution_setting", "true");
        url.searchParams.set("limit", String(PAGE));
        if (cont) url.searchParams.set("after", cont);

        const data = await fetchJson<InsightsResponse>(url.toString(), {
          headers: { authorization: `Bearer ${token}` },
        });
        return {
          rows: data.data ?? [],
          /**
           * `paging.next` IS PRESENT ON THE LAST PAGE TOO, and following it
           * returns an empty `data`. Cursor-or-nothing is the honest read: the
           * `after` cursor is absent once there is nothing after.
           */
          next: data.paging?.cursors?.after && (data.data?.length ?? 0) > 0 ? data.paging.cursors.after : null,
        };
      },
      map: (row) => {
        const date = str(row["date_start"]);
        const occurredAt = date ? dateInZone(date, timeZone) : null;
        // A row with no date has no honest place on a timeline, and stamping it
        // with "now" would make last week's spend arrive today.
        if (!occurredAt) return null;

        const properties: Record<string, unknown> = {};
        for (const f of METRICS) {
          if (f === "actions" || f === "action_values" || f === "purchase_roas" || f === "account_currency") continue;
          properties[f] = metricNumber(row[f]);
        }
        for (const f of LEVEL_FIELDS[level]) properties[f] = str(row[f]) ?? null;
        flattenActions(row, "action_", "actions", properties);
        flattenActions(row, "action_value_", "action_values", properties);
        // `purchase_roas` is an action array too, with one entry per action type.
        flattenActions(row, "roas_", "purchase_roas", properties);
        properties["adAccountId"] = account;
        properties["level"] = level;
        properties["timeZone"] = timeZone;

        const entityId = entityKey ? (str(row[entityKey]) ?? "") : "";
        const currency = str(row["account_currency"]) ?? meta.currency ?? null;

        return {
          eventId: reportRowId("meta", [args.streamHash ?? "", account, shape, level, date, entityId]),
          eventType: `meta.insights.${level}`,
          subject:
            str(row[`${level}_name` as keyof InsightRow as string]) ??
            str(row["campaign_name"]) ??
            account,
          occurredAt,
          // Spend is the number a spend row is ABOUT, so it is the one that
          // lands on the canonical `value` column every chart defaults to.
          value: metricNumber(row["spend"]),
          currency,
          properties,
        };
      },
    });

    return {
      ...result,
      providerCalls: (result.providerCalls ?? 0) + 1,
      // The account lookup is a different endpoint with a different budget; the
      // runner subtracts these from the primary operation rather than adding
      // them on, so the total charged still equals `providerCalls`.
      extraCalls: { [ACCOUNTS_OP]: 1 },
    };
  },

  /**
   * WHICH AD ACCOUNTS THIS PERSON CAN READ.
   *
   * `/me/adaccounts` returns only what the authorising user has a role on, so
   * there is no permission filtering to do here — and someone with no ad
   * accounts gets an empty list rather than an error, which is "nothing to
   * connect", not a failure.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "adAccountId") return [];
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("meta-ads: missing access token");

    const out: SourceOption[] = [];
    let url: string | null =
      `${META_GRAPH}/me/adaccounts?fields=account_id,name,currency,account_status&limit=200`;
    // Bounded: an agency user can sit on hundreds of accounts, and an unbounded
    // `while` over a provider's paging is how a picker hangs a page.
    for (let page = 0; page < 10 && url; page++) {
      const data: { data?: Array<Record<string, unknown>>; paging?: { next?: string } } = await fetchJson(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      for (const acct of data.data ?? []) {
        const id = str(acct["account_id"]);
        if (!id) continue;
        const name = str(acct["name"]) ?? `Account ${id}`;
        const currency = str(acct["currency"]);
        // Status 1 is active; everything else is disabled, closed, pending or
        // in grace. Said in the label rather than filtered out, because a
        // customer whose account is paused still wants its history.
        const suffix = acct["account_status"] === 1 ? "" : " — inactive";
        out.push({ value: `act_${id}`, label: currency ? `${name} (${currency})${suffix}` : `${name}${suffix}` });
      }
      url = data.paging?.next ?? null;
    }
    return out;
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
