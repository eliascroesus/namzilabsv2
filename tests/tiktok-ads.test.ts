import { describe, it, expect, vi, afterEach } from "vitest";
import { tiktokAdsConnector } from "@/connectors/tiktok-ads";
import { catalogEntry } from "@/connectors/catalog";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const CONN = "conn_1";
const CREDS = { accessToken: "tok" };
const CONFIG = { advertiserId: "adv1" };

function respond(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ADVERTISER = { code: 0, data: { list: [{ advertiser_id: "adv1", name: "Acme", currency: "EUR", timezone: "Europe/Stockholm" }] } };

const reportRow = (over: Record<string, unknown> = {}) => ({
  dimensions: { campaign_id: "c1", stat_time_day: "2026-09-01 00:00:00" },
  metrics: { spend: "50.25", impressions: "900", clicks: "30", conversion: "4", campaign_name: "Launch" },
  ...over,
});

/** Advertiser info first, then report pages — the order the poll makes them in. */
function serve(reportBodies: unknown[], advertiser: unknown = ADVERTISER) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let page = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes("/advertiser/info/")) return respond(advertiser);
      const body = reportBodies[page] ?? { code: 0, data: { list: [], page_info: { page: 1, total_page: 1 } } };
      page += 1;
      return respond(body);
    }),
  );
  return calls;
}

describe("TikTok Ads: every response is HTTP 200, including the failures", () => {
  /**
   * THE MOST IMPORTANT PROPERTY IN THIS FILE.
   *
   * TikTok answers 200 OK with the real outcome in a `code` field. `fetchJson`
   * throws on `!res.ok` and therefore CANNOT SEE a TikTok failure at all — a
   * throttled or unauthorised sweep would return zero rows and be
   * indistinguishable from an advertiser who spent nothing. Every one of these
   * would be a silent empty dashboard without `expectOk`.
   */
  it("turns a throttle into a real error instead of an empty report", async () => {
    serve([{ code: 40100, message: "Too many requests" }]);
    await expect(
      tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG }),
    ).rejects.toThrow(/rate-limited/i);
  });

  it("turns an authorisation failure into a reconnect instruction", async () => {
    serve([{ code: 40105, message: "Access token is invalid" }]);
    await expect(
      tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG }),
    ).rejects.toThrow(/reconnect/i);
  });

  it("reports the provider's own code and message for anything else", async () => {
    serve([{ code: 40002, message: "Invalid data_level" }]);
    await expect(
      tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG }),
    ).rejects.toThrow(/40002.*Invalid data_level/);
  });

  it("does not mistake a missing code for success", async () => {
    // An empty body is a failure, not an empty report.
    serve([{}]);
    await expect(
      tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG }),
    ).rejects.toThrow();
  });
});

describe("TikTok Ads: poll", () => {
  it("sends the Access-Token header TikTok actually reads", async () => {
    /**
     * NOT `authorization: Bearer`. TikTok ignores the standard header and
     * answers a perfectly formed 200 carrying an auth error inside it, which is
     * the hardest possible way to discover this.
     */
    const calls = serve([{ code: 0, data: { list: [reportRow()], page_info: { page: 1, total_page: 1 } } }]);
    await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    expect(calls[0].headers["Access-Token"]).toBe("tok");
    expect(calls[0].headers["authorization"]).toBeUndefined();
  });

  it("dates a row in the ADVERTISER's timezone", async () => {
    serve([{ code: 0, data: { list: [reportRow()], page_info: { page: 1, total_page: 1 } } }]);
    const res = await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    // Stockholm is +02:00 on 1 Sep, so its midnight is 22:00 UTC the day before.
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-08-31T22:00:00.000Z");
  });

  it("reads a space-separated stat_time_day without handing it to a Date", async () => {
    // `2026-09-01 00:00:00` is `Invalid Date` in some runtimes and a UTC instant
    // in others; taking the first ten characters is the whole parse.
    serve([{ code: 0, data: { list: [reportRow()], page_info: { page: 1, total_page: 1 } } }]);
    const res = await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    expect(Number.isNaN(res.records[0].occurredAt.getTime())).toBe(false);
  });

  it("puts spend on value and carries the advertiser's currency", async () => {
    serve([{ code: 0, data: { list: [reportRow()], page_info: { page: 1, total_page: 1 } } }]);
    const res = await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    const ev = res.records[0];
    expect(ev.value).toBe(50.25);
    expect(ev.currency).toBe("EUR");
    expect(ev.subject).toBe("Launch");
    expect(ev.properties).toMatchObject({ impressions: 900, clicks: 30, conversion: 4 });
  });

  it("asks for the day dimension, without which the timeline collapses to a point", async () => {
    const calls = serve([{ code: 0, data: { list: [reportRow()], page_info: { page: 1, total_page: 1 } } }]);
    await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    const report = decodeURIComponent(calls.find((c) => c.url.includes("/report/integrated/get/"))!.url);
    expect(report).toContain("stat_time_day");
    expect(report).toContain("AUCTION_CAMPAIGN");
    expect(report).toContain("report_type=BASIC");
  });

  it("walks pages until page_info says it is on the last one", async () => {
    serve([
      { code: 0, data: { list: [reportRow()], page_info: { page: 1, total_page: 2 } } },
      { code: 0, data: { list: [reportRow({ dimensions: { campaign_id: "c2", stat_time_day: "2026-09-02 00:00:00" } })], page_info: { page: 2, total_page: 2 } } },
    ]);
    const res = await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    expect(res.records).toHaveLength(2);
    expect(res.retireOutsideWindow).toBeDefined();
  });

  it("re-reads three days, the window TikTok's latency needs", async () => {
    const calls = serve([{ code: 0, data: { list: [], page_info: { page: 1, total_page: 1 } } }]);
    await tiktokAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG });
    const report = decodeURIComponent(calls.find((c) => c.url.includes("/report/"))!.url);
    const start = new Date(report.match(/start_date=([\d-]+)/)![1]).getTime();
    const days = (Date.now() - start) / 86_400_000;
    expect(days).toBeGreaterThan(2);
    expect(days).toBeLessThan(4);
  });
});

describe("TikTok Ads: the advertiser picker", () => {
  it("refuses to run without the app credentials TikTok demands alongside the token", async () => {
    // `/oauth2/advertiser/get/` needs app_id and secret as well as the token —
    // unlike every other picker in this codebase, which needs only the token.
    vi.stubEnv("TIKTOK_APP_ID", "");
    vi.stubEnv("TIKTOK_APP_SECRET", "");
    await expect(tiktokAdsConnector.listOptions!("advertiserId", { connectionId: CONN, credentials: CREDS })).rejects.toThrow(
      /TIKTOK_APP_ID/,
    );
  });

  it("labels each authorised advertiser with its currency", async () => {
    vi.stubEnv("TIKTOK_APP_ID", "app");
    vi.stubEnv("TIKTOK_APP_SECRET", "sec");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/oauth2/advertiser/get/")
          ? respond({ code: 0, data: { list: [{ advertiser_id: "adv1" }] } })
          : respond(ADVERTISER),
      ),
    );
    const opts = await tiktokAdsConnector.listOptions!("advertiserId", { connectionId: CONN, credentials: CREDS });
    expect(opts).toEqual([{ value: "adv1", label: "Acme (EUR)" }]);
  });
});

describe("TikTok Ads: catalog", () => {
  const entry = catalogEntry("tiktok-ads")!;

  it("is a derived mirror connecting through TikTok's own OAuth", () => {
    expect(entry.sync).toBe("derived-mirror");
    expect(entry.oauthProvider).toBe("tiktok");
    expect(entry.credentialFields).toEqual([]);
  });

  it("says out loud that nothing here has been probed live", () => {
    // TikTok's docs portal renders client-side and cannot be cited the way every
    // other entry cites a page, so `verified.live` carries more weight here.
    expect(entry.verified?.live).toBeNull();
  });

  it("refuses an unsigned inbound request", () => {
    expect(tiktokAdsConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(false);
  });
});
