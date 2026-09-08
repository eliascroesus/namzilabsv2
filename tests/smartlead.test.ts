import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { smartleadConnector, SMARTLEAD_EVENTS } from "@/connectors/smartlead";
import { catalogEntry, isStreamScoped } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";

/** A fetch stub that answers a queue of JSON bodies in order and records every request. */
function stubFetch(bodies: unknown[], headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = bodies[Math.min(i++, bodies.length - 1)];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

const SECRET = "sl_signing_secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

/** A leads-statistics row: the send, the open and the reply of one lead's step. */
const row = (over: Record<string, unknown> = {}) => ({
  stats_id: "st1",
  lead_email: "lead@example.com",
  lead_name: "John Doe",
  sequence_number: 1,
  email_subject: "Quick question",
  sent_time: "2026-09-01T09:00:00.000Z",
  open_time: "2026-09-01T10:30:00.000Z",
  click_time: null,
  reply_time: "2026-09-02T11:00:00.000Z",
  ...over,
});

/** A webhook delivery, shaped as api.smartlead.ai/guides/webhook-integration prints it. */
const hook = (type: string, over: Record<string, unknown> = {}) => ({
  event_type: type,
  from_email: "sender@yourcompany.com",
  to_email: "lead@example.com",
  to_name: "John Doe",
  campaign_name: "Q1 SaaS Outreach",
  campaign_id: 123,
  sequence_number: 1,
  ...over,
});

describe("smartlead: registration", () => {
  it("is in the catalog and the registry with dated provenance, stream-scoped on the campaign", () => {
    expect(getConnector("smartlead")).toBe(smartleadConnector);
    const e = catalogEntry("smartlead")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
    expect(e.flowFields?.map((f) => f.key)).toEqual(["campaignId"]);
    // "Rate limits apply to your API key across all endpoints combined"
    // (guides/rate-limits) — ONE bucket, so the connector names no operation.
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["*"]);
    expect(smartleadConnector.operations).toBeUndefined();
    // instant + not auto-registered ⇒ the customer pastes the secret.
    expect(e.credentialFields.map((f) => f.key)).toEqual(["apiKey", "webhookSecret"]);
    expect(e.webhookSetup).toContain("webhook");
  });

  /**
   * WHY THERE IS NO `registerWebhook`, AND IT IS NOT FOR WANT OF AN ENDPOINT.
   *
   * api.smartlead.ai/api-reference/webhooks/create (read 8 Sep 2026) publishes
   * POST /api/v1/webhook/create with eleven request parameters — webhook_url,
   * association_type ("Valid values: user, client, campaign"), email_campaign_id,
   * name, event_type_map, category_id_map, client_id, event_type, category_id,
   * webhook_type, force_create — and NOT ONE of them is a secret we could
   * supply; its 200 is `ok`, `id`, `webhook_url`, which mints none either.
   * `.../webhooks/get` (id, email_campaign_id, name, webhook_url,
   * event_type_map, category_id_map, created_at, updated_at) has none to read
   * back afterwards, and `.../webhooks/update` (name, webhook_url, event_types,
   * categories) none to set afterwards.
   *
   * So auto-registering would create a LIVE subscription this connection could
   * never authenticate: `verifySignature` fails closed, and every delivery we
   * ourselves caused would 401 forever, silently. That is strictly worse than
   * asking — which is the whole reason the field stays.
   */
  it("does not auto-register: Smartlead's create API neither returns a signing secret nor accepts ours", () => {
    expect(catalogEntry("smartlead")!.autoWebhook).toBe(false);
    expect(smartleadConnector.registerWebhook).toBeUndefined();
    expect(smartleadConnector.unregisterWebhook).toBeUndefined();
  });

  it("is stream-scoped on the campaign, so a delivery is a doorbell and the copy must point at Smartlead's own UI", () => {
    expect(isStreamScoped("smartlead")).toBe(true);
    const e = catalogEntry("smartlead")!;
    // The route verifies, sweeps and returns 202 without storing the payload
    // (src/app/api/webhooks/[connectionId]/route.ts), so the poll is the only
    // way a record ever lands and a missing secret costs freshness, not data.
    expect(e.poll).toBe(true);
    // Somewhere for a pasted value to land: C21 lifts `webhookSecret` out of
    // `credentials` into the connection's signing secret, and with no field
    // there is nowhere for it to come from.
    expect(e.credentialFields.map((f) => f.key)).toContain("webhookSecret");
    // Named place in the provider's UI, and no promise of an automatic
    // registration this connector cannot perform.
    expect(e.webhookSetup).toMatch(/Settings\s*→\s*Webhooks/);
    expect(e.webhookSetup ?? "").not.toMatch(/automatic|we create|created for you/i);
  });

  it("the secret is OPTIONAL in behaviour: the poll alone yields every fact this connection counts", async () => {
    stubFetch([{ ok: true, data: [row()] }]);
    const res = await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" }, config: { campaignId: "7" } });
    // No webhookSecret anywhere in the credentials, and the three dated facts
    // still land. A click would too — this row simply has none.
    expect(res.records.map((r) => r.eventType)).toEqual(["email_sent", "email_opened", "reply"]);
  });

  it("verifySignature fails closed on exactly one line", () => {
    const src = readFileSync("src/connectors/smartlead.ts", "utf8");
    expect(src.match(/if \(!secret\) return false;/g)).toHaveLength(1);
    expect(smartleadConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(false);
  });
});

describe("smartlead: signature", () => {
  const body = JSON.stringify(hook("EMAIL_REPLY", { time_replied: "2026-09-02T11:00:00.000Z" }));

  it("hex HMAC-SHA256 over the raw body behind sha256=, in X-Smartlead-Signature", () => {
    expect(smartleadConnector.verifySignature({ rawBody: body, headers: { "x-smartlead-signature": sign(body) }, secret: SECRET })).toBe(true);
  });
  it("rejects a wrong secret, a missing header, a tampered body and no secret at all", () => {
    const wrong = `sha256=${createHmac("sha256", "other").update(body).digest("hex")}`;
    expect(smartleadConnector.verifySignature({ rawBody: body, headers: { "x-smartlead-signature": wrong }, secret: SECRET })).toBe(false);
    expect(smartleadConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(smartleadConnector.verifySignature({ rawBody: `${body} `, headers: { "x-smartlead-signature": sign(body) }, secret: SECRET })).toBe(false);
    expect(smartleadConnector.verifySignature({ rawBody: body, headers: { "x-smartlead-signature": sign(body) }, secret: null })).toBe(false);
  });
});

describe("smartlead: normalize", () => {
  it("dates each delivery by its own time field, keyed by campaign, lead+step and fact", () => {
    const cases: Array<[string, string, string]> = [
      ["EMAIL_SENT", "time_sent", "email_sent"],
      ["FIRST_EMAIL_SENT", "time_sent", "email_sent"],
      ["EMAIL_OPEN", "time_opened", "email_opened"],
      ["EMAIL_LINK_CLICK", "time_clicked", "email_clicked"],
      ["EMAIL_REPLY", "time_replied", "reply"],
      ["EMAIL_BOUNCE", "time_sent", "bounced"],
    ];
    for (const [type, field, ours] of cases) {
      const [ev] = smartleadConnector.normalize!(hook(type, { [field]: "2026-09-02T11:00:00.000Z" }), { connectionId: CONN });
      expect(ev, type).toMatchObject({ eventType: ours, subject: "lead@example.com" });
      expect(ev.eventId, type).toBe(`smartlead:conn_1:123:lead@example.com:1:${ours}`);
      expect(ev.occurredAt.toISOString(), type).toBe("2026-09-02T11:00:00.000Z");
    }
  });

  it("accepts core/webhooks' other spelling of the same event, dated by its `timestamp`", () => {
    const [ev] = smartleadConnector.normalize!(hook("EMAIL_OPENED", { timestamp: "2026-09-02T11:00:00.000Z" }), { connectionId: CONN });
    expect(ev.eventType).toBe("email_opened");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-02T11:00:00.000Z");
  });

  it("an unsubscribe has no documented timestamp, so it is dated by the delivery moment", () => {
    const payload = { event_type: "LEAD_UNSUBSCRIBED", lead_email: "lead@example.com", lead_name: "John Doe", campaign_id: 123, unsubscribed_client_id_map: {} };
    const [ev] = smartleadConnector.normalize!(payload, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-03T00:00:00Z") });
    expect(ev).toMatchObject({ eventType: "unsubscribed", eventId: "smartlead:conn_1:123:lead@example.com:unsubscribed" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("a positive category is lead_interested, dated by the reply that provoked it", () => {
    const payload = {
      event_type: "LEAD_CATEGORY_UPDATED",
      lead_id: 789,
      lead_email: "lead@example.com",
      campaign_id: 123,
      category: "Interested",
      lead_category_id: 5,
      lead_data: { email: "lead@example.com", category: { name: "Interested", sentiment_type: "positive" } },
      history: [
        { type: "SENT", time: "2026-09-01T09:00:00.000Z" },
        { type: "REPLY", time: "2026-09-02T11:00:00.000Z" },
      ],
      lastReply: { type: "REPLY", time: "2026-09-02T11:00:00.000Z" },
    };
    const [ev] = smartleadConnector.normalize!(payload, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-05T00:00:00Z") });
    expect(ev).toMatchObject({ eventType: "lead_interested", subject: "lead@example.com" });
    expect(ev.eventId).toBe("smartlead:conn_1:123:lead@example.com:category:interested");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-02T11:00:00.000Z");
  });

  it("a category Smartlead does not call positive is a plain category change, dated by the delivery", () => {
    const payload = {
      event_type: "LEAD_CATEGORY_UPDATED",
      lead_id: 790,
      lead_email: "lead@example.com",
      campaign_id: 123,
      category: "Out Of Office",
      lead_data: { category: { name: "Out Of Office", sentiment_type: "neutral" } },
    };
    const [ev] = smartleadConnector.normalize!(payload, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-05T00:00:00Z") });
    expect(ev).toMatchObject({ eventType: "lead_category_updated" });
    expect(ev.eventId).toBe("smartlead:conn_1:123:lead@example.com:category:out_of_office");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("account plumbing and out-of-campaign replies are not outreach events", () => {
    for (const type of ["CAMPAIGN_STATUS_CHANGED", "UNTRACKED_REPLIES", "MANUAL_STEP_REACHED", "EMAIL_ACCOUNT_DISCONNECTED"]) {
      expect(smartleadConnector.normalize!(hook(type), { connectionId: CONN }), type).toEqual([]);
      expect(SMARTLEAD_EVENTS[type], type).toBeUndefined();
    }
  });
});

describe("smartlead: poll (stream = one campaign)", () => {
  it("reads one campaign's lead statistics with the key in the query, bounded by event_time_gt", async () => {
    const calls = stubFetch([{ ok: true, data: [row()] }]);
    const res = await smartleadConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: { apiKey: "K" },
      config: { campaignId: "7" },
      streamHash: "h1",
      windowFloor: new Date("2026-08-01T00:00:00Z"),
    });

    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://server.smartlead.ai/api/v1/campaigns/7/leads-statistics");
    expect(u.searchParams.get("api_key")).toBe("K");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("offset")).toBe("0");
    // A whole day behind the floor: the parameter is an exclusive DATE, so
    // asking from 2026-08-01 could drop an event later that same day.
    expect(u.searchParams.get("event_time_gt")).toBe("2026-07-31");
    expect(res.providerCalls).toBe(1);
  });

  it("fans one row into its send, open and reply, and settles on the newest event time", async () => {
    stubFetch([{ ok: true, data: [row()] }]);
    const res = await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" }, config: { campaignId: "7" } });

    expect(res.records.map((r) => r.eventType)).toEqual(["email_sent", "email_opened", "reply"]);
    expect(res.records.map((r) => r.eventId)).toEqual([
      "smartlead:conn_1:7:st1:email_sent",
      "smartlead:conn_1:7:st1:email_opened",
      "smartlead:conn_1:7:st1:reply",
    ]);
    expect(res.records.map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T10:30:00.000Z",
      "2026-09-02T11:00:00.000Z",
    ]);
    expect(res.records.every((r) => r.subject === "lead@example.com")).toBe(true);
    expect(res.records[0].properties).toMatchObject({ campaign_id: "7", email_subject: "Quick question", sequence_number: 1 });
    // The watermark is the field event_time_gt bounds: the row's LAST event.
    expect(res.nextCursor).toBe("2026-09-02T11:00:00.000Z");
  });

  it("follows the offset while a full page comes back, and stops on a short one", async () => {
    const full = Array.from({ length: 100 }, (_, i) => row({ stats_id: `p${i}`, open_time: null, click_time: null, reply_time: null, sent_time: new Date(Date.UTC(2026, 7, 10, 0, i)).toISOString() }));
    const calls = stubFetch([
      { ok: true, data: full },
      { ok: true, data: [row({ stats_id: "last", open_time: null, click_time: null, reply_time: "2026-09-05T00:00:00.000Z" })] },
    ]);
    const res = await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" }, config: { campaignId: "7" } });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("offset")).toBe("0");
    expect(new URL(calls[1].url).searchParams.get("offset")).toBe("100");
    expect(res.providerCalls).toBe(2);
    expect(res.records).toHaveLength(102); // 100 sends, plus the last row's send and reply
    expect(res.nextCursor).toBe("2026-09-05T00:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
  });

  it("resumes from a settled mark, asking only for what changed since", async () => {
    const calls = stubFetch([{ ok: true, data: [] }]);
    const res = await smartleadConnector.poll!({ connectionId: CONN, cursor: "2026-09-02T11:00:00.000Z", credentials: { apiKey: "K" }, config: { campaignId: "7" } });
    // The mark, less the 5-minute overlap, floored to its day and one day back.
    expect(new URL(calls[0].url).searchParams.get("event_time_gt")).toBe("2026-09-01");
    expect(res.records).toEqual([]);
    expect(res.nextCursor).toBe("2026-09-02T11:00:00.000Z");
  });

  it("a row it cannot date produces nothing — an undated row is never stamped `now`", async () => {
    stubFetch([{ ok: true, data: [{ stats_id: "st9", lead_email: "lead@example.com", is_bounced: true }] }]);
    const res = await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" }, config: { campaignId: "7" } });
    expect(res.records).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it("without a campaign there is nothing to read; listOptions names the campaigns", async () => {
    expect(await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" }, config: {} })).toEqual({ records: [], nextCursor: null });
    const calls = stubFetch([[{ id: 7, name: "Q3 outbound", status: "ACTIVE" }]]);
    expect(await smartleadConnector.listOptions!("campaignId", { connectionId: CONN, credentials: { apiKey: "K" } })).toEqual([{ value: "7", label: "Q3 outbound" }]);
    expect(new URL(calls[0].url).pathname).toBe("/api/v1/campaigns");
    expect(await smartleadConnector.listOptions!("nope", { connectionId: CONN, credentials: { apiKey: "K" } })).toEqual([]);
  });

  it("never lets the key out in an error: the URL IS the credential here", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "bad request",
      })) as unknown as typeof fetch,
    );
    const err = await smartleadConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "SECRET_KEY" }, config: { campaignId: "7" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("SECRET_KEY");
    expect((err as Error).message).toContain("api_key=…");
  });
});
