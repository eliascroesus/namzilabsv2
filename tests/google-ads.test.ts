import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { googleAdsConnector } from "@/connectors/google-ads";
import { catalogEntry } from "@/connectors/catalog";

// No developer token by default: Google sunset them on 9 Sep 2026 and a
// deployment that has never had one is now the ordinary case.
beforeEach(() => vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", ""));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

/**
 * THE RESPONSE IS camelCase EVEN THOUGH THE QUERY IS snake_case. Every fixture
 * here is spelled the way Google actually answers, which is the whole point:
 * a fixture written in snake_case would make a broken connector pass.
 */
const result = (over: Record<string, unknown> = {}) => ({
  campaign: { id: "111", name: "Brand", advertisingChannelType: "VIDEO", status: "ENABLED" },
  customer: { currencyCode: "GBP", timeZone: "Europe/London" },
  segments: { date: "2026-09-01" },
  metrics: { impressions: "5000", clicks: "120", costMicros: "45230000", conversions: 3.5, videoViews: "900" },
  ...over,
});

function serve(bodies: unknown[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ""),
      });
      const body = bodies[n] ?? { results: [] };
      n += 1;
      return respond(body);
    }),
  );
  return calls;
}

describe("Google Ads: the REST response is camelCase", () => {
  it("reads costMicros, not cost_micros — and converts it out of millionths", async () => {
    /**
     * You SELECT `metrics.cost_micros` and Google returns `{metrics:
     * {costMicros}}`. Nothing warns about this: reading the field back under the
     * name you asked for yields undefined, which becomes null, which renders as
     * a blank tile rather than as an error.
     */
    serve([{ results: [result()] }]);
    const res = await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    const ev = res.records[0];
    expect(ev.value, "45,230,000 micros is £45.23").toBe(45.23);
    expect(ev.properties!["cost"]).toBe(45.23);
    // Named for what it is, not for how Google stores it.
    expect(ev.properties!["cost_micros"]).toBeUndefined();
  });

  it("reads the nested camelCase fields the rest of the row depends on", async () => {
    serve([{ results: [result()] }]);
    const res = await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    const ev = res.records[0];
    expect(ev.subject).toBe("Brand");
    expect(ev.currency).toBe("GBP");
    expect(ev.properties).toMatchObject({
      impressions: 5000,
      clicks: 120,
      conversions: 3.5,
      video_views: 900,
      campaign_advertising_channel_type: "VIDEO",
    });
  });

  it("dates a row in the CUSTOMER's timezone", async () => {
    serve([{ results: [result()] }]);
    const res = await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    // London is +01:00 on 1 Sep 2026.
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-08-31T23:00:00.000Z");
  });
});

describe("Google Ads: the headers Google refuses requests without", () => {
  it("works with NO developer token, because Google sunset them", async () => {
    /**
     * THE CORRECTION THIS TEST PINS. Google sunset developer tokens on
     * 9 Sep 2026 — access now attaches to the Cloud project behind the OAuth
     * credentials, and a token sent in the header is "optional and ignored by
     * the API servers", with rejection promised in a future major version.
     *
     * This connector originally THREW without one. After the sunset that made a
     * working API permanently unreachable over a credential Google had stopped
     * issuing — a self-inflicted outage with a confident error message on it.
     */
    const calls = serve([{ results: [result()] }]);
    const res = await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    expect(res.records).toHaveLength(1);
    expect(calls[0].headers["developer-token"], "a header Google now ignores must not be sent").toBeUndefined();
    expect(calls[0].headers["authorization"]).toBe("Bearer tok");
  });

  it("still sends one when someone has deliberately set it", async () => {
    // Harmless today and needed by nobody, but a deployment that kept its old
    // token should not silently stop sending it mid-migration.
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "legacy-token");
    const calls = serve([{ results: [result()] }]);
    await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    expect(calls[0].headers["developer-token"]).toBe("legacy-token");
  });

  it("sends login-customer-id only for an account reached through a manager", async () => {
    /**
     * Required when the account sits under a manager, and HARMFUL when it does
     * not — sending a manager id for an account that is not under it fails the
     * request outright. Hence the `id@login` option value: the picker is the
     * only place that knows, and this is where that knowledge has to survive to.
     */
    const viaManager = serve([{ results: [result()] }]);
    await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123@999" } });
    expect(viaManager[0].headers["login-customer-id"]).toBe("999");
    expect(viaManager[0].url).toContain("/customers/123/");

    vi.unstubAllGlobals();
    const direct = serve([{ results: [result()] }]);
    await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    expect(direct[0].headers["login-customer-id"]).toBeUndefined();
  });

  it("strips the hyphens a customer copies out of the Google Ads interface", async () => {
    // Account ids are shown as 123-456-7890 and the API accepts only digits.
    const calls = serve([{ results: [result()] }]);
    await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123-456-7890" } });
    expect(calls[0].url).toContain("/customers/1234567890/");
  });
});

describe("Google Ads: the query", () => {
  it("bounds on segments.date and asks for one row per campaign per day", async () => {
    const calls = serve([{ results: [result()] }]);
    await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    const query = JSON.parse(calls[0].body).query as string;
    expect(query).toMatch(/FROM campaign/);
    expect(query).toMatch(/segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'/);
    expect(query).toContain("segments.date");
    expect(query).toContain("metrics.cost_micros");
  });

  it("narrows to YouTube in the request when Campaign type is Video", async () => {
    // A WHERE clause, so it genuinely costs Google less rather than only showing
    // less — which is what makes it part of the stream identity.
    const calls = serve([{ results: [result()] }]);
    await googleAdsConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: CREDS,
      config: { customerId: "123", channelType: "VIDEO" },
    });
    expect(JSON.parse(calls[0].body).query).toContain("campaign.advertising_channel_type = 'VIDEO'");
  });

  it("gives a filtered report its own row identity", async () => {
    // A YouTube-only flow and an all-campaigns flow over one account and day are
    // different reports; sharing ids would have them overwrite each other.
    serve([{ results: [result()] }]);
    const all = await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    vi.unstubAllGlobals();
    serve([{ results: [result()] }]);
    const video = await googleAdsConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: CREDS,
      config: { customerId: "123", channelType: "VIDEO" },
    });
    expect(video.records[0].eventId).not.toBe(all.records[0].eventId);
  });

  it("re-reads 14 days, for conversions Google is still restating", async () => {
    const calls = serve([{ results: [] }]);
    await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    const from = JSON.parse(calls[0].body).query.match(/BETWEEN '([\d-]+)'/)[1];
    const days = (Date.now() - new Date(from).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it("follows nextPageToken and retires the window once exhausted", async () => {
    serve([
      { results: [result()], nextPageToken: "TOK" },
      { results: [result({ campaign: { id: "222", name: "Other" } })] },
    ]);
    const res = await googleAdsConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { customerId: "123" } });
    expect(res.records).toHaveLength(2);
    expect(res.retireOutsideWindow).toBeDefined();
  });
});

describe("Google Ads: the account picker", () => {
  it("leaves out manager accounts, which hold no campaigns", async () => {
    /**
     * A report against a manager returns nothing at all, and an empty dashboard
     * is a far worse answer than an absent option.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("listAccessibleCustomers")
          ? respond({ resourceNames: ["customers/999"] })
          : respond({
              results: [
                { customerClient: { id: "999", descriptiveName: "Agency MCC", manager: true, status: "ENABLED" } },
                { customerClient: { id: "123", descriptiveName: "Client A", currencyCode: "USD", manager: false, status: "ENABLED" } },
              ],
            }),
      ),
    );
    const opts = await googleAdsConnector.listOptions!("customerId", { connectionId: CONN, credentials: CREDS });
    expect(opts).toEqual([{ value: "123@999", label: "Client A (USD)" }]);
  });

  it("keeps the rest of the list when one hierarchy cannot be read", async () => {
    // A Google login commonly touches an account that has since been cancelled;
    // letting that throw would present the customer with no accounts and no clue.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("listAccessibleCustomers")) {
          return respond({ resourceNames: ["customers/111", "customers/222"] });
        }
        call += 1;
        if (call === 1) throw new Error("PERMISSION_DENIED");
        return respond({ results: [{ customerClient: { id: "222", descriptiveName: "Works", manager: false } }] });
      }),
    );
    const opts = await googleAdsConnector.listOptions!("customerId", { connectionId: CONN, credentials: CREDS });
    expect(opts).toEqual([{ value: "222", label: "Works" }]);
  });
});

describe("Google Ads: catalog", () => {
  const entry = catalogEntry("gads")!;

  it("is a derived mirror riding Google's existing OAuth", () => {
    expect(entry.sync).toBe("derived-mirror");
    expect(entry.connect).toBe("google");
    expect(entry.credentialFields).toEqual([]);
  });

  it("declares a FLEET limit, because the developer token is ours", () => {
    // Every customer's operations count against one token; a per-connection
    // budget cannot see that ceiling at all.
    expect(entry.fleetLimits?.["googleAds.search"]).toBeDefined();
  });

  it("offers YouTube as a campaign type rather than as a second connector", () => {
    const channel = entry.flowFields?.find((f) => f.key === "channelType");
    expect(channel?.options?.some((o) => o.value === "VIDEO" && /youtube/i.test(o.label))).toBe(true);
  });
});
