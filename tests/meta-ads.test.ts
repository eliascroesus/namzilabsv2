import { describe, it, expect, vi, afterEach } from "vitest";
import { metaAdsConnector } from "@/connectors/meta-ads";
import { catalogEntry } from "@/connectors/catalog";

afterEach(() => vi.unstubAllGlobals());

const CONN = "conn_1";
const CREDS = { accessToken: "tok" };

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

/** The account lookup first, then insights pages — the order the poll makes them in. */
function serve(pages: Array<Record<string, unknown>>, account: Record<string, unknown> = { timezone_name: "America/Los_Angeles", currency: "USD" }) {
  const urls: string[] = [];
  let page = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (!url.includes("/insights")) return respond(account);
      const body = pages[page] ?? { data: [] };
      page += 1;
      return respond(body);
    }),
  );
  return urls;
}

const insight = (over: Record<string, unknown> = {}) => ({
  date_start: "2026-09-01",
  date_stop: "2026-09-01",
  campaign_id: "c1",
  campaign_name: "Summer",
  spend: "123.45",
  impressions: "1000",
  clicks: "42",
  account_currency: "USD",
  ...over,
});

describe("Meta Ads: poll", () => {
  it("dates a row in the AD ACCOUNT's timezone, not UTC", async () => {
    /**
     * `date_start` is a bare YYYY-MM-DD in the account's own zone and says
     * nothing about which zone that is. Read as UTC, every row on every account
     * west of London lands on the day before — a whole day's spend on the wrong
     * date, for ever, with nothing on screen to suggest it.
     */
    serve([{ data: [insight()] }]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    expect(res.records).toHaveLength(1);
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });

  it("puts spend on value and keeps the rest on the record", async () => {
    serve([{ data: [insight()] }]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    const ev = res.records[0];
    expect(ev.value).toBe(123.45);
    expect(ev.currency).toBe("USD");
    expect(ev.subject).toBe("Summer");
    expect(ev.properties).toMatchObject({ impressions: 1000, clicks: 42, campaign_name: "Summer" });
  });

  it("flattens actions and action_values into summable fields", async () => {
    /**
     * These arrive as ARRAYS OF OBJECTS. Left alone they are unusable — nothing
     * in the metric engine can sum the third element of an array — so a
     * purchase count is only reachable because it becomes its own key.
     */
    serve([
      {
        data: [
          insight({
            actions: [
              { action_type: "purchase", value: "7" },
              { action_type: "offsite_conversion.fb_pixel_purchase", value: "5" },
            ],
            action_values: [{ action_type: "purchase", value: "980.5" }],
          }),
        ],
      },
    ]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    const p = res.records[0].properties!;
    expect(p["action_purchase"]).toBe(7);
    expect(p["action_value_purchase"]).toBe(980.5);
    // A dot inside an action type would collide with the `properties.<key>`
    // path grammar the filter and field picker already speak.
    expect(p["action_offsite_conversion_fb_pixel_purchase"]).toBe(5);
    expect(Object.keys(p).some((k) => k.includes("."))).toBe(false);
  });

  it("asks for one row per day, and for the account's own attribution setting", async () => {
    const urls = serve([{ data: [insight()] }]);
    await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    const insights = urls.find((u) => u.includes("/insights"))!;
    // Without time_increment=1 Meta collapses the whole range into one row and
    // every number lands on a single date.
    expect(insights).toContain("time_increment=1");
    // Conversion counts depend entirely on the attribution window; asking for
    // the account's own setting is what makes them reconcile with Ads Manager.
    expect(insights).toContain("use_account_attribution_setting=true");
    expect(insights).toContain("level=campaign");
  });

  it("re-reads 28 days, because that is the window Meta keeps revising", async () => {
    const urls = serve([{ data: [insight()] }]);
    await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    const range = decodeURIComponent(urls.find((u) => u.includes("/insights"))!).match(/time_range=(\{[^}]+\})/)![1];
    const since = new Date(JSON.parse(range).since).getTime();
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(29);
  });

  it("follows the after cursor and retires the window once it is exhausted", async () => {
    serve([
      { data: [insight({ campaign_id: "c1" })], paging: { cursors: { after: "CUR" } } },
      { data: [insight({ campaign_id: "c2" })] },
    ]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    expect(res.records).toHaveLength(2);
    expect(res.mirrorScope).toBeDefined();
    expect(res.retireOutsideWindow).toBeDefined();
  });

  it("stops rather than looping when Meta returns an empty last page", async () => {
    // `paging.next` is present on the last page too and following it returns an
    // empty `data`; the cursor is the honest end-of-walk signal.
    serve([{ data: [], paging: { cursors: { after: "CUR" }, next: "https://next" } }]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    expect(res.records).toHaveLength(0);
    expect(res.incomplete).toBeUndefined();
  });

  it("accepts a bare account id as well as the act_ prefixed one", async () => {
    const urls = serve([{ data: [insight()] }]);
    await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "12345" } });
    expect(urls.find((u) => u.includes("/insights"))).toContain("act_12345");
  });

  it("drops a row it cannot date rather than stamping it now", async () => {
    serve([{ data: [insight({ date_start: undefined })] }]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    expect(res.records).toHaveLength(0);
  });

  it("counts the account lookup against its own budget, not insights'", async () => {
    serve([{ data: [insight()] }]);
    const res = await metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { adAccountId: "act_1" } });
    expect(res.providerCalls).toBe(2);
    expect(res.extraCalls).toEqual({ "adaccounts.list": 1 });
  });

  it("names the fix when the connection has no token", async () => {
    await expect(
      metaAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: {}, config: { adAccountId: "act_1" } }),
    ).rejects.toThrow(/access token/i);
  });
});

describe("Meta Ads: the ad account picker", () => {
  it("labels each account with its currency and flags the inactive ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond({
          data: [
            { account_id: "1", name: "Main", currency: "USD", account_status: 1 },
            { account_id: "2", name: "Old", currency: "GBP", account_status: 2 },
          ],
        }),
      ),
    );
    const opts = await metaAdsConnector.listOptions!("adAccountId", { connectionId: CONN, credentials: CREDS });
    expect(opts).toEqual([
      { value: "act_1", label: "Main (USD)" },
      // Said rather than filtered: a paused account still has history worth importing.
      { value: "act_2", label: "Old (GBP) — inactive" },
    ]);
  });

  it("answers nothing for a key it does not own", async () => {
    expect(await metaAdsConnector.listOptions!("nope", { connectionId: CONN, credentials: CREDS })).toEqual([]);
  });
});

describe("Meta Ads: catalog", () => {
  const entry = catalogEntry("meta-ads")!;

  it("is a derived mirror that connects through Meta's own OAuth", () => {
    expect(entry.sync).toBe("derived-mirror");
    expect(entry.connect).toBe("oauth");
    expect(entry.oauthProvider).toBe("meta");
    expect(entry.credentialFields).toEqual([]);
  });

  it("declares a FLEET limit, because the app id is ours and shared", () => {
    // Every customer's requests are scored against one Meta app. A per-connection
    // budget cannot see that, and the failure mode is not one customer throttled
    // — it is every Meta connection failing at once.
    expect(entry.fleetLimits?.["insights.read"]).toBeDefined();
  });

  it("refuses an unsigned inbound request — there is no webhook path here", () => {
    expect(metaAdsConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(false);
  });
});
