import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { thinkificConnector } from "@/connectors/thinkific";
import { catalogEntry } from "@/connectors/catalog";
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

const KEY = "thinkific_api_key";
const CREDS = { apiKey: KEY, subdomain: "acme" };
/** Thinkific signs with the site API key itself — the same string that authenticates the poll. */
const sign = (body: string) => createHmac("sha256", KEY).update(body).digest("hex");

/** The documented envelope: { id, resource, action, tenant_id, created_at, timestamp, payload }. */
const envelope = (resource: string, action: string, payload: Record<string, unknown>, createdAtIso = "2026-09-06T09:00:00Z") => ({
  id: "01HXAAXSZ80KZ0QS58T75YMD8J",
  resource,
  action,
  tenant_id: "3",
  tenant_global_id: "31000002-0000-0000-0000-000000000000",
  created_at: createdAtIso,
  timestamp: 1_757_149_200,
  payload,
});

/** A row as the ADMIN API lists it: flat user_email, amount_dollars as a string. */
const order = (over: Record<string, unknown> = {}) => ({
  id: 501,
  created_at: "2026-09-01T10:00:00Z",
  user_id: 123456,
  user_email: "s@x.io",
  user_name: "Robert Smith",
  product_id: 1,
  product_name: "Introduction to Webhooks",
  amount_cents: 19900,
  amount_dollars: "199.0",
  status: "complete",
  subscription: false,
  ...over,
});

/** A transaction as the WEBHOOK sends it: the money lives on the nested order. */
const transaction = (over: Record<string, unknown> = {}) => ({
  id: 22,
  created_at: "2026-09-01T10:00:00Z",
  amount: 85,
  action: "purchase",
  currency: "cad",
  payment_provider: "thinkific_payments",
  order: {
    id: 73,
    created_at: "2026-09-01T10:00:00Z",
    product_name: "Introduction to Webhooks",
    amount_cents: 9950,
    amount_dollars: 99.5,
    order_number: "ORD000073",
    user: { id: 22, first_name: "Robert", last_name: "Smith", email: "s@x.io" },
  },
  refunded: false,
  refunded_amount: null,
  presentment_amount: 4098,
  presentment_currency: "usd",
  ...over,
});

const one = (body: unknown) => thinkificConnector.normalize!(body, { connectionId: CONN });

describe("thinkific: registration", () => {
  it("is the registered connector, connection-scoped, claiming one operation", () => {
    expect(getConnector("thinkific")).toBe(thinkificConnector);
    expect(thinkificConnector.authType).toBe("apiKey");
    expect(thinkificConnector.operations).toEqual(["orders.list"]);
    expect(thinkificConnector.operationFor!()).toBe("orders.list");
    // autoWebhook: Thinkific only documents webhooks CREATED THROUGH THE API as
    // verifiable, so registration is ours to do — and it can be torn down again.
    expect(typeof thinkificConnector.registerWebhook).toBe("function");
    expect(typeof thinkificConnector.unregisterWebhook).toBe("function");
  });

  it("is in the catalog with dated provenance and an unprobed verification", () => {
    const e = catalogEntry("thinkific")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.docs?.webhooks).toMatch(/^https:\/\//);
    expect(e.verified).toEqual({ live: null });
    expect(e.autoWebhook).toBe(true);
    expect(e.credentialFields.map((f) => f.key)).toEqual(["apiKey", "subdomain"]);
    expect(Object.keys(e.rateLimits!)).toEqual(["orders.list"]);
  });
});

describe("thinkific: signature", () => {
  /**
   * "Each webhook request includes a hexadecimal-encoded X-Thinkific-Hmac-Sha256
   * header generated using … Site's API Key". No timestamp rides in the scheme,
   * so there is no staleness case to pin — only the five below.
   */
  const body = JSON.stringify(envelope("order", "created", order()));

  it("accepts a hex HMAC-SHA256 over the raw body keyed on the API key", () => {
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: { "x-thinkific-hmac-sha256": sign(body) }, secret: KEY })).toBe(true);
  });
  it("rejects a signature made with another key", () => {
    const wrong = createHmac("sha256", "someone_elses_key").update(body).digest("hex");
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: { "x-thinkific-hmac-sha256": wrong }, secret: KEY })).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: {}, secret: KEY })).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(thinkificConnector.verifySignature({ rawBody: `${body} `, headers: { "x-thinkific-hmac-sha256": sign(body) }, secret: KEY })).toBe(false);
  });
  it("fails closed with no secret configured", () => {
    expect(thinkificConnector.verifySignature({ rawBody: body, headers: { "x-thinkific-hmac-sha256": sign(body) }, secret: null })).toBe(false);
  });
});

describe("thinkific: normalize", () => {
  it("order.created is an order_created dated by the ORDER's created_at, valued in dollars", () => {
    const [e] = one(envelope("order", "created", { ...order(), amount_dollars: 50, amount_cents: 5000, user: { email: "s@x.io" }, presentment_currency: "cad", presentment_amount: 15896 }));
    expect(e).toMatchObject({ eventId: "thinkific:conn_1:order:501", eventType: "order_created", subject: "s@x.io", value: 50 });
    // No currency: presentment_currency describes presentment_amount, not amount_dollars.
    expect(e.currency).toBeNull();
    expect(e.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(e.properties).toMatchObject({ product_name: "Introduction to Webhooks", presentment_currency: "cad" });
  });

  it("an order with no created_at of its own falls back to the delivery's", () => {
    const [e] = one(envelope("order", "created", { id: 502, user_email: "s@x.io", amount_cents: 2000 }));
    expect(e.occurredAt.toISOString()).toBe("2026-09-06T09:00:00.000Z");
    // amount_dollars absent → cents, in major units.
    expect(e.value).toBe(20);
  });

  it("order_transaction.succeeded is payment_succeeded, valued from the nested order in its own currency", () => {
    const [e] = one(envelope("order_transaction", "succeeded", transaction()));
    expect(e).toMatchObject({ eventId: "thinkific:conn_1:transaction:22", eventType: "payment_succeeded", subject: "s@x.io", value: 99.5, currency: "CAD" });
    expect(e.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    // The transaction's own `amount` has no documented unit; it stays a property.
    expect(e.properties).toMatchObject({ amount: 85 });
  });

  it("order_transaction.refunded is dated by the DELIVERY, not by the charge it refunds", () => {
    const [e] = one(envelope("order_transaction", "refunded", transaction({ refunded: true }), "2026-09-06T09:00:00Z"));
    expect(e).toMatchObject({ eventId: "thinkific:conn_1:transaction:22:refunded", eventType: "payment_refunded", value: 99.5, currency: "CAD" });
    expect(e.occurredAt.toISOString()).toBe("2026-09-06T09:00:00.000Z");
  });

  it("a cancelled subscription is dated by cancelled_at — the scheduled date stays a property", () => {
    const payload = {
      id: 6,
      created_at: "2026-01-08T21:51:25.830Z",
      payment_type: "subscription",
      amount: "9374",
      interval: "month",
      cancelled_at: "2026-08-24T10:30:00.000Z",
      scheduled_cancellation_at: "2026-11-24T10:30:00.000Z",
      status: "cancelled",
      user: { id: 86, email: "s@x.io" },
    };
    // The topic is subscription.cancelled; the documented example delivers action "canceled".
    for (const action of ["cancelled", "canceled"]) {
      const [e] = one(envelope("subscription", action, payload));
      expect(e).toMatchObject({ eventId: "thinkific:conn_1:subscription:6:canceled", eventType: "subscription_canceled", subject: "s@x.io", value: null });
      expect(e.occurredAt.toISOString()).toBe("2026-08-24T10:30:00.000Z");
      expect(e.properties).toMatchObject({ scheduled_cancellation_at: "2026-11-24T10:30:00.000Z" });
    }
  });

  it("enrolments: created at created_at, completed at completed_at, under distinct ids", () => {
    const enrollment = {
      id: 97472,
      created_at: "2026-09-01T10:00:00Z",
      activated_at: "2026-09-01T09:59:00Z",
      completed_at: null,
      percentage_completed: "0.0",
      course: { id: 4, name: "Introduction to Webhooks" },
      course_id: 4,
      user: { id: 123456, email: "s@x.io" },
    };
    const [created] = one(envelope("enrollment", "created", enrollment));
    expect(created).toMatchObject({ eventId: "thinkific:conn_1:enrollment:97472", eventType: "enrollment_created", subject: "s@x.io" });
    expect(created.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");

    const [done] = one(envelope("enrollment", "completed", { ...enrollment, completed_at: "2026-09-05T20:17:20.571Z", percentage_completed: "1.0" }));
    expect(done).toMatchObject({ eventId: "thinkific:conn_1:enrollment:97472:completed", eventType: "enrollment_completed" });
    expect(done.occurredAt.toISOString()).toBe("2026-09-05T20:17:20.571Z");
  });

  it("user.signup and lead.created carry the person's email as the subject", () => {
    const [signup] = one(envelope("user", "signup", { id: 3, email: "n@x.io", created_at: "2026-09-02T08:00:00Z", roles: [] }));
    expect(signup).toMatchObject({ eventId: "thinkific:conn_1:user:3", eventType: "user_signup", subject: "n@x.io", value: null });
    expect(signup.occurredAt.toISOString()).toBe("2026-09-02T08:00:00.000Z");

    const [lead] = one(envelope("lead", "created", { id: 33, email: "l@x.io", first_name: "John", created_at: "2026-09-03T23:23:03.758Z", subscribed: true }));
    expect(lead).toMatchObject({ eventId: "thinkific:conn_1:lead:33", eventType: "lead_created", subject: "l@x.io" });
    expect(lead.occurredAt.toISOString()).toBe("2026-09-03T23:23:03.758Z");
  });

  it("topics this connector does not count, and payloads with no id, produce nothing", () => {
    expect(one(envelope("lesson", "completed", { id: 1 }))).toEqual([]);
    expect(one(envelope("user", "signin", { id: 3, email: "n@x.io" }))).toEqual([]);
    expect(one(envelope("order", "created", { user_email: "s@x.io" }))).toEqual([]);
    expect(one({})).toEqual([]);
  });
});

describe("thinkific: poll", () => {
  /** Pinned so the 90-day default floor can never age the fixtures out. */
  const FLOOR = new Date("2026-01-01T00:00:00Z");
  const page = (items: unknown[], current: number, total: number, next: number | null) => ({
    items,
    meta: { pagination: { current_page: current, next_page: next, prev_page: null, total_pages: total, total_items: 3 } },
  });

  it("lists orders with both auth headers, keeps only rows inside the window, and settles on the newest created_at", async () => {
    const calls = stubFetch([
      page([order(), order({ id: 500, created_at: "2020-01-01T00:00:00Z" })], 1, 3, 2),
      page([order({ id: 499, created_at: "2019-01-01T00:00:00Z" })], 2, 3, 3),
    ]);
    const res = await thinkificConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, windowFloor: FLOOR });

    expect(res.records.map((r) => r.eventId)).toEqual(["thinkific:conn_1:order:501"]);
    expect(res.records[0]).toMatchObject({ eventType: "order_created", subject: "s@x.io", value: 199, currency: null });
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    // Page 2 holds nothing inside the window, which ends the walk: the mark
    // settles as a bare high-water string, not a continuation.
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
    expect(res.providerCalls).toBe(2);

    const first = new URL(calls[0].url);
    expect(first.pathname).toBe("/api/public/v1/orders");
    expect(first.searchParams.get("page")).toBe("1");
    expect(first.searchParams.get("limit")).toBe("250");
    // No date parameter exists on this endpoint — the window is applied client-side.
    expect([...first.searchParams.keys()].sort()).toEqual(["limit", "page"]);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["x-auth-api-key"]).toBe(KEY);
    expect(h["x-auth-subdomain"]).toBe("acme");
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
    expect(calls).toHaveLength(2);
  });

  it("a page budget of one leaves a continuation on the next page, not a settled mark", async () => {
    stubFetch([page([order()], 1, 3, 2)]);
    const res = await thinkificConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, windowFloor: FLOOR, budget: { maxCalls: 1 } });

    expect(res.incomplete).toBe(true);
    expect(res.providerCalls).toBe(1);
    const cursor = JSON.parse(res.nextCursor!) as { cont: string; maxSeen: string; hw: string | null };
    expect(cursor).toMatchObject({ hw: null, cont: "2", maxSeen: "2026-09-01T10:00:00.000Z" });
  });

  it("resumes at the stored page, and a settled mark bounds the next window", async () => {
    const cont = JSON.stringify({ hw: null, cont: "3", maxSeen: "2026-09-01T10:00:00.000Z", floor: "2026-01-01T00:00:00.000Z" });
    const resumed = stubFetch([page([order({ id: 498, created_at: "2018-01-01T00:00:00Z" })], 3, 3, null)]);
    const res = await thinkificConnector.poll!({ connectionId: CONN, cursor: cont, credentials: CREDS, windowFloor: FLOOR });
    expect(new URL(resumed[0].url).searchParams.get("page")).toBe("3");
    expect(res.records).toEqual([]);
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");

    // A bare mark re-reads from page 1 with a five-minute overlap behind it, so
    // the row on the mark itself is seen again (and dedupes on its eventId).
    const again = stubFetch([page([order()], 1, 1, null)]);
    const next = await thinkificConnector.poll!({ connectionId: CONN, cursor: "2026-09-01T10:00:00.000Z", credentials: CREDS });
    expect(new URL(again[0].url).searchParams.get("page")).toBe("1");
    expect(next.records.map((r) => r.eventId)).toEqual(["thinkific:conn_1:order:501"]);
    expect(next.nextCursor).toBe("2026-09-01T10:00:00.000Z");
  });

  it("refuses to run without both credentials", async () => {
    await expect(thinkificConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY } })).rejects.toThrow(/subdomain/);
  });
});

describe("thinkific: webhook registration", () => {
  it("creates one subscription per topic on the v2 API with a bearer key, and signs with that same key", async () => {
    const calls = stubFetch([{ id: "20200227213233625839530", topic: "order.created", status: "active" }]);
    const res = await thinkificConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://hooks.namzi.io/t/abc", credentials: CREDS });

    expect(calls).toHaveLength(8);
    expect(calls[0].url).toBe("https://api.thinkific.com/api/v2/webhooks");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ topic: "order.created", target_url: "https://hooks.namzi.io/t/abc" });
    expect(JSON.parse(String(calls[7].init.body)).topic).toBe("lead.created");
    expect(res.signingSecret).toBe(KEY);
    expect(res.externalId).toBe(new Array(8).fill("20200227213233625839530").join(","));
  });

  it("tears every subscription down again, and a 404 is success", async () => {
    const calls = stubFetch([{}]);
    await thinkificConnector.unregisterWebhook!({ connectionId: CONN, credentials: CREDS, externalId: "wh_1,wh_2" });
    expect(calls.map((c) => c.url)).toEqual(["https://api.thinkific.com/api/v2/webhooks/wh_1", "https://api.thinkific.com/api/v2/webhooks/wh_2"]);
    expect(calls[0].init.method).toBe("DELETE");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found", headers: { get: () => null }, json: async () => ({}), text: async () => "" }) as unknown as Response),
    );
    await expect(thinkificConnector.unregisterWebhook!({ connectionId: CONN, credentials: CREDS, externalId: "wh_1" })).resolves.toBeUndefined();
  });
});
