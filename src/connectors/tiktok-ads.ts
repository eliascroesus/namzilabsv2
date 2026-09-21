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
 * TIKTOK ADS, VIA THE TIKTOK API FOR BUSINESS (MARKETING API) v1.3.
 *
 * ═══ EVERY RESPONSE IS HTTP 200, INCLUDING THE FAILURES ═══
 *
 * This is the single most important fact about this API and the one most likely
 * to be missed, because every other provider in this codebase uses status
 * codes. TikTok answers `200 OK` with the real outcome in a `code` field in the
 * body: `0` is success, `40100` is "rate limited", `40001` is a bad parameter,
 * and an expired token is a body rather than a 401.
 *
 * So `fetchJson` — which throws on `!res.ok` and is what gives every other
 * connector its "reconnect this credential" message — CANNOT SEE A TIKTOK
 * FAILURE AT ALL. A throttled sweep would return zero rows and look exactly
 * like an advertiser who spent nothing. `expectOk` below is the whole defence,
 * and it is why this connector does not use the shared `bearerClient`.
 *
 * Read 21 Sep 2026. TikTok's docs portal (business-api.tiktok.com/portal/docs)
 * is rendered client-side and cannot be read by any fetcher, so the figures here
 * come from TikTok's own SDK reference on GitHub plus the live prober —
 * `scripts/verify-tiktok-ads.ts` — rather than from a page anyone can cite.
 * That is weaker provenance than every other entry in this catalog and is
 * recorded honestly as such in `verified.live`.
 *
 * ═══ 3 DAYS TRAILING, AND AN 11-HOUR LATENCY ═══
 *
 * TikTok's reporting lags roughly 11 hours, and conversions keep landing behind
 * that. Three days is the window the mature open-source connectors settle on
 * and is the value to argue with once the prober has measured the real one.
 */

export const TIKTOK_API_VERSION = "v1.3";
const API = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;

const REPORT_OP = "report.integrated";
const ADVERTISER_OP = "advertiser.info";

/** See the header. Revisit once the prober has measured TikTok's real settle time. */
const TRAILING_DAYS = 3;

/** TikTok's documented maximum page size on this endpoint is 1000. */
const PAGE = 1000;
const MAX_PAGES = 10;

/**
 * THE GRAIN. Campaign by default, for the same reason as Meta: ad level on a
 * busy advertiser is thousands of rows a day, re-read every sweep.
 */
const LEVELS = {
  advertiser: "AUCTION_ADVERTISER",
  campaign: "AUCTION_CAMPAIGN",
  adgroup: "AUCTION_ADGROUP",
  ad: "AUCTION_AD",
} as const;
type Level = keyof typeof LEVELS;
const DEFAULT_LEVEL: Level = "campaign";

/** The id dimension each level groups by, alongside the day. */
const LEVEL_DIMENSION: Record<Level, string | null> = {
  advertiser: null,
  campaign: "campaign_id",
  adgroup: "adgroup_id",
  ad: "ad_id",
};

/** The name field TikTok returns beside each id, so a row can say what it is. */
const LEVEL_NAME: Record<Level, string | null> = {
  advertiser: null,
  campaign: "campaign_name",
  adgroup: "adgroup_name",
  ad: "ad_name",
};

const METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "frequency",
  "conversion",
  "cost_per_conversion",
  "conversion_rate",
  "video_play_actions",
  "video_watched_2s",
  "video_watched_6s",
  "average_video_play",
] as const;

type ReportRow = { dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> };
type Envelope<T> = { code?: number; message?: string; request_id?: string; data?: T };
type ReportData = {
  list?: ReportRow[];
  page_info?: { page?: number; page_size?: number; total_number?: number; total_page?: number };
};

/**
 * UNWRAP TIKTOK'S ENVELOPE, OR THROW.
 *
 * `code === 0` is the only success. Everything else is turned into a real error
 * so the sweep records it, the breaker can see it, and the connection says
 * something true — rather than the silent empty page described in the header.
 *
 * 40001/40105/40110 and friends are credential problems, and are worded the way
 * every other connector words a 401: name the fix, not the status.
 */
function expectOk<T>(res: Envelope<T>, what: string): T {
  const code = res.code ?? -1;
  if (code === 0) return (res.data ?? {}) as T;
  const message = res.message ?? "no message";
  if (code === 40100) {
    throw new Error(`TikTok rate-limited this request (40100) while reading ${what}. It will be retried.`);
  }
  // TikTok uses the 401xx family for authorisation problems, including a
  // revoked or invalidated token, which arrives as a 200 like everything else.
  if (code >= 40100 && code < 40200) {
    throw new Error(`TikTok rejected this credential (${code}: ${message}) — open the connection and reconnect.`);
  }
  throw new Error(`TikTok refused ${what} (${code}: ${message}).`);
}

async function call<T>(token: string, path: string, params: Record<string, string>, what: string): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchJson<Envelope<T>>(url.toString(), {
    // NOT `authorization: Bearer`. TikTok reads its own header and ignores the
    // standard one, so a Bearer token produces a perfectly formed 200 with an
    // auth error inside it.
    headers: { "Access-Token": token },
  });
  return expectOk(res, what);
}

export const tiktokAdsConnector: Connector = {
  source: "tiktok-ads",
  authType: "oauth2",
  operations: [REPORT_OP, ADVERTISER_OP] as const,
  operationFor: () => REPORT_OP,
  listOperationFor: (key: string) => (key === "advertiserId" ? ADVERTISER_OP : undefined),

  // Read-only reporting; TikTok has no outbound webhook carrying report data.
  verifySignature(_args: VerifyArgs): boolean {
    return false;
  },

  normalize(_rawPayload: unknown, _ctx: NormalizeContext): CanonicalEvent[] {
    return [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("tiktok-ads: missing access token");

    const advertiserId = str(args.config?.["advertiserId"]);
    if (!advertiserId) throw new Error("tiktok-ads: no advertiser account selected");

    const level = (str(args.config?.["level"]) ?? "") in LEVELS ? (str(args.config?.["level"]) as Level) : DEFAULT_LEVEL;

    /**
     * THE ADVERTISER'S CURRENCY AND TIMEZONE, fetched rather than assumed — the
     * report's `stat_time_day` is a wall-clock day in the ADVERTISER's zone and
     * carries no zone of its own. Same reasoning as Meta: parsed as UTC, every
     * row west of London lands a day early, permanently.
     */
    const info = await call<{ list?: Array<Record<string, unknown>> }>(
      token,
      "/advertiser/info/",
      { advertiser_ids: JSON.stringify([advertiserId]) },
      "advertiser info",
    );
    const advertiser = info.list?.[0] ?? {};
    const timeZone = str(advertiser["timezone"]) ?? "UTC";
    const currency = str(advertiser["currency"]) ?? null;

    const idDim = LEVEL_DIMENSION[level];
    const nameField = LEVEL_NAME[level];
    // `stat_time_day` is what makes a row a DAY. Without it TikTok returns one
    // aggregate row for the whole range and the timeline collapses to a point.
    const dimensions = [...(idDim ? [idDim] : []), "stat_time_day"];
    const shape = reportShape(dimensions, METRICS);

    const result = await dailyReportWalk<ReportRow>({
      trailingDays: TRAILING_DAYS,
      windowFloor: args.windowFloor,
      budget: args.budget,
      maxPages: MAX_PAGES,
      fetchPage: async ({ from, to, page }) => {
        const data = await call<ReportData>(
          token,
          "/report/integrated/get/",
          {
            advertiser_id: advertiserId,
            report_type: "BASIC",
            service_type: "AUCTION",
            data_level: LEVELS[level],
            dimensions: JSON.stringify(dimensions),
            metrics: JSON.stringify([...METRICS, ...(nameField ? [nameField] : [])]),
            start_date: ymdUtc(from),
            end_date: ymdUtc(to),
            page: String(page + 1),
            page_size: String(PAGE),
          },
          "the integrated report",
        );
        const info = data.page_info ?? {};
        const current = info.page ?? page + 1;
        const total = info.total_page ?? 1;
        return {
          rows: data.list ?? [],
          // Page NUMBERS, not a token: the walk's own counter drives the next
          // request, so this only has to say whether there IS a next one.
          next: current < total ? String(current) : null,
        };
      },
      map: (row) => {
        const dims = row.dimensions ?? {};
        const mets = row.metrics ?? {};
        /**
         * `stat_time_day` arrives as `2026-09-01 00:00:00`, not as a bare date.
         * Taking the first 10 characters is the whole parse; handing the full
         * string to a Date constructor is how a space-separated timestamp
         * becomes `Invalid Date` in some runtimes and a UTC instant in others.
         */
        const day = (str(dims["stat_time_day"]) ?? "").slice(0, 10);
        const occurredAt = day ? dateInZone(day, timeZone) : null;
        if (!occurredAt) return null;

        const properties: Record<string, unknown> = {};
        for (const m of METRICS) properties[m] = metricNumber(mets[m]);
        const entityId = idDim ? (str(dims[idDim]) ?? "") : "";
        if (idDim) properties[idDim] = entityId;
        const name = nameField ? str(mets[nameField]) : null;
        if (nameField) properties[nameField] = name;
        properties["advertiserId"] = advertiserId;
        properties["level"] = level;
        properties["timeZone"] = timeZone;

        return {
          eventId: reportRowId("tiktok", [args.streamHash ?? "", advertiserId, shape, level, day, entityId]),
          eventType: `tiktok.report.${level}`,
          subject: name ?? entityId ?? advertiserId,
          occurredAt,
          value: metricNumber(mets["spend"]),
          currency,
          properties,
        };
      },
    });

    return {
      ...result,
      providerCalls: (result.providerCalls ?? 0) + 1,
      extraCalls: { [ADVERTISER_OP]: 1 },
    };
  },

  /**
   * WHICH ADVERTISER ACCOUNTS THIS AUTHORISATION COVERS.
   *
   * TikTok settles this at authorisation time rather than here: the customer
   * picks the advertisers on TikTok's own consent screen, and the token is
   * scoped to exactly those. `/oauth2/advertiser/get/` asks the token what it
   * was given, which is why it needs the app id and secret alongside it.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "advertiserId") return [];
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("tiktok-ads: missing access token");
    const appId = process.env.TIKTOK_APP_ID;
    const secret = process.env.TIKTOK_APP_SECRET;
    if (!appId || !secret) throw new Error("tiktok-ads: TIKTOK_APP_ID / TIKTOK_APP_SECRET are not set");

    const granted = await call<{ list?: Array<Record<string, unknown>> }>(
      token,
      "/oauth2/advertiser/get/",
      { app_id: appId, secret },
      "the authorised advertisers",
    );
    const ids = (granted.list ?? []).map((a) => str(a["advertiser_id"])).filter((x): x is string => !!x);
    if (ids.length === 0) return [];

    /**
     * The grant list carries ids and often a name; the info call is what
     * reliably carries the name AND the currency, which is what makes two
     * similarly-named accounts distinguishable in a dropdown.
     */
    const info = await call<{ list?: Array<Record<string, unknown>> }>(
      token,
      "/advertiser/info/",
      { advertiser_ids: JSON.stringify(ids) },
      "advertiser info",
    );
    return (info.list ?? [])
      .map((a) => {
        const id = str(a["advertiser_id"]);
        if (!id) return null;
        const name = str(a["name"]) ?? `Advertiser ${id}`;
        const currency = str(a["currency"]);
        return { value: id, label: currency ? `${name} (${currency})` : name };
      })
      .filter((o): o is SourceOption => !!o);
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
