import { describe, it, expect, afterEach, vi } from "vitest";
import { thrivecartConnector, THRIVECART_EVENTS } from "@/connectors/thrivecart";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";
const SECRET = "TCSECRET";

/**
 * The Event Subscription API's JSON delivery. `mode_int` is 2 for LIVE and 1
 * for test — the plan had 0 for test, and
 * developers.thrivecart.com/documentation/event_subscription/order_refund_product/
 * (read 8 Sep 2026) says "1 for test mode only, 2 for live mode only".
 */
const body = (over: Record<string, unknown> = {}) => ({
  event: "order.success",
  mode: "live",
  mode_int: 2,
  thrivecart_account: "generic",
  thrivecart_secret: SECRET,
  event_id: "e1",
  webhook_id: "w1",
  base_product: 2,
  base_product_name: "Course",
  order_timestamp: 1_757_200_000,
  currency: "USD",
  customer: { id: 6_702_306, email: "b@x.io" },
  order: { id: "O-1", total: 9700, charges: [{ name: "Course" }] },
  ...over,
});

/**
 * The account webhook's delivery, verbatim in shape from
 * support.thrivecart.com/help/using-webhook-notifications/ (read 8 Sep 2026):
 * "Webhooks are `x-www-form-urlencoded`", nested with PHP bracket keys. The
 * webhook route cannot JSON-parse this, so it hands the connector `{ _raw }`.
 */
const FORM = [
  "event=order.success",
  "mode=live",
  "mode_int=2",
  "thrivecart_account=generic",
  `thrivecart_secret=${SECRET}`,
  "base_product=2",
  "order_id=1514394",
  "order_timestamp=1757200000",
  "currency=USD",
  "customer%5Bid%5D=6702306",
  "customer%5Bemail%5D=jsmith%40email.com",
  "order%5Btotal%5D=10000",
  "order%5Btotal_str%5D=100.00",
  "order%5Bcharges%5D%5B0%5D%5Bname%5D=Webhook+testing",
].join("&");

describe("thrivecart: registration", () => {
  it("is in the catalog and the registry with dated provenance, webhook-only", () => {
    expect(getConnector("thrivecart")).toBe(thrivecartConnector);
    const e = catalogEntry("thrivecart")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
    expect({ instant: e.instant, poll: e.poll, sync: e.sync, autoWebhook: e.autoWebhook }).toEqual({
      instant: true,
      poll: false,
      sync: "webhook-only",
      autoWebhook: false,
    });
    // No read API is used, so there is nothing to poll and nothing to register.
    expect(thrivecartConnector.poll).toBeUndefined();
    expect(thrivecartConnector.registerWebhook).toBeUndefined();
    // instant + !autoWebhook: the customer must have somewhere to paste the secret.
    expect(e.credentialFields.map((f) => f.key)).toEqual(["webhookSecret"]);
    expect(e.webhookSetup).toContain("order validation");
    // https://developers.thrivecart.com/documentation/intro/index/ — 60/min per account.
    expect(e.rateLimits).toEqual({ "*": { requestsPerMinute: 60 } });
  });
});

describe("thrivecart: signature", () => {
  it("compares the body's thrivecart_secret in constant time; fails closed", () => {
    const ok = { rawBody: JSON.stringify(body()), headers: {}, secret: SECRET };
    expect(thrivecartConnector.verifySignature(ok)).toBe(true);
    // The secret rides in the body, so a tampered body that keeps it still
    // verifies — stated, not hidden: there is no HMAC to detect the edit.
    expect(thrivecartConnector.verifySignature({ ...ok, rawBody: JSON.stringify(body({ order: { id: "O-2", total: 1 } })) })).toBe(true);
    expect(thrivecartConnector.verifySignature({ ...ok, rawBody: JSON.stringify(body({ thrivecart_secret: "no" })) })).toBe(false);
    expect(thrivecartConnector.verifySignature({ ...ok, rawBody: JSON.stringify(body({ thrivecart_secret: undefined })) })).toBe(false);
    expect(thrivecartConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(thrivecartConnector.verifySignature({ ...ok, secret: "" })).toBe(false);
    expect(thrivecartConnector.verifySignature({ rawBody: "{", headers: {}, secret: SECRET })).toBe(false);
    expect(thrivecartConnector.verifySignature({ rawBody: "", headers: {}, secret: SECRET })).toBe(false);
    // A near-miss of the same length must not pass a constant-time compare.
    expect(thrivecartConnector.verifySignature({ ...ok, secret: "TCSECRES" })).toBe(false);
  });

  it("reads the secret out of a form-encoded body too", () => {
    expect(thrivecartConnector.verifySignature({ rawBody: FORM, headers: {}, secret: SECRET })).toBe(true);
    expect(thrivecartConnector.verifySignature({ rawBody: FORM, headers: {}, secret: "other" })).toBe(false);
    expect(thrivecartConnector.verifySignature({ rawBody: FORM.replace(SECRET, "no"), headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("thrivecart: normalize", () => {
  it("a live order is order_created at order_timestamp, in major units, with the secret stripped", () => {
    const evs = thrivecartConnector.normalize!(body(), { connectionId: CONN });
    expect(evs).toHaveLength(1);
    const [o] = evs;
    expect(o).toMatchObject({
      eventId: "thrivecart:conn_1:O-1:order.success",
      eventType: "order_created",
      subject: "b@x.io",
      value: 97,
      currency: "USD",
    });
    expect(o.occurredAt.toISOString()).toBe("2025-09-06T23:06:40.000Z");
    expect(o.properties).not.toHaveProperty("thrivecart_secret");
    expect(o.properties).toMatchObject({ event: "order.success", base_product_name: "Course", mode: "live" });
  });

  it("maps both name families to one vocabulary", () => {
    const cases: Array<[string, string]> = [
      // Account webhook (support.thrivecart.com).
      ["order.success", "order_created"],
      ["order.subscription_payment", "rebill"],
      ["order.rebill_failed", "rebill_failed"],
      ["order.refund", "payment_refunded"],
      ["order.subscription_cancelled", "subscription_canceled"],
      ["order.subscription_paused", "subscription_paused"],
      ["order.subscription_resumed", "subscription_resumed"],
      ["cart.abandoned", "cart_abandoned"],
      ["affiliate.commission_earned", "commission_earned"],
      // Event Subscription API (developers.thrivecart.com).
      ["order_created", "order_created"],
      ["order_rebill", "rebill"],
      ["order_rebill_failed", "rebill_failed"],
      ["order_rebill_cancelled", "subscription_canceled"],
      ["order_refund", "payment_refunded"],
      ["order_refund_product", "payment_refunded"],
      ["order_refund_bump", "payment_refunded"],
      ["order_refund_upsell", "payment_refunded"],
      ["order_refund_downsell", "payment_refunded"],
      ["subscription_paused", "subscription_paused"],
      ["subscription_resumed", "subscription_resumed"],
      ["cart_abandoned", "cart_abandoned"],
      ["affiliate_commission_earned", "commission_earned"],
    ];
    for (const [event, ours] of cases) {
      const [ev] = thrivecartConnector.normalize!(body({ event }), { connectionId: CONN });
      expect(ev.eventType, event).toBe(ours);
      expect(ev.eventId, event).toBe(`thrivecart:conn_1:O-1:${event}`);
    }
    // Every declared mapping is exercised above — a new one cannot arrive untested.
    expect(new Set(cases.map(([event]) => event))).toEqual(new Set(Object.keys(THRIVECART_EVENTS)));
    // The once-per-order event is counted; the per-line-item payments that
    // accompany it are not, or one order's revenue would be counted twice.
    expect(thrivecartConnector.normalize!(body({ event: "order_payment_product" }), { connectionId: CONN })).toEqual([]);
    expect(thrivecartConnector.normalize!(body({ event: "something.else" }), { connectionId: CONN })).toEqual([]);
  });

  it("only money events carry a value: a cancellation, a pause and an abandoned cart do not restate the sale", () => {
    for (const event of ["order.success", "order.subscription_payment", "order.rebill_failed", "order.refund"]) {
      expect(thrivecartConnector.normalize!(body({ event }), { connectionId: CONN })[0], event).toMatchObject({ value: 97, currency: "USD" });
    }
    for (const event of ["cart.abandoned", "order.subscription_cancelled", "order.subscription_paused", "order.subscription_resumed", "affiliate.commission_earned"]) {
      expect(thrivecartConnector.normalize!(body({ event }), { connectionId: CONN })[0], event).toMatchObject({ value: null, currency: null });
    }
  });

  it("drops every delivery that is not affirmatively live", () => {
    // mode_int 1 is TEST (the docs), and 0 is nothing the docs define.
    expect(thrivecartConnector.normalize!(body({ mode: "test", mode_int: 1 }), { connectionId: CONN })).toEqual([]);
    expect(thrivecartConnector.normalize!(body({ mode: "live", mode_int: 1 }), { connectionId: CONN })).toEqual([]);
    expect(thrivecartConnector.normalize!(body({ mode: "test", mode_int: 0 }), { connectionId: CONN })).toEqual([]);
    expect(thrivecartConnector.normalize!(body({ mode: undefined, mode_int: undefined }), { connectionId: CONN })).toEqual([]);
    // Form values arrive as strings; "2" is as live as 2.
    expect(thrivecartConnector.normalize!(body({ mode_int: "2" }), { connectionId: CONN })).toHaveLength(1);
    expect(thrivecartConnector.normalize!(body({ mode: undefined, mode_int: "2" }), { connectionId: CONN })).toHaveLength(1);
    expect(thrivecartConnector.normalize!(body({ mode: "live", mode_int: undefined }), { connectionId: CONN })).toHaveLength(1);
  });

  it("dates by when it happened, and never by a field the payload does not have", () => {
    // order[date_unix], then the text order_date, then the delivery moment.
    const [nested] = thrivecartConnector.normalize!(
      body({ order_timestamp: undefined, order: { id: "O-1", total: 9700, date_unix: 1_757_203_600 } }),
      { connectionId: CONN },
    );
    expect(nested.occurredAt.toISOString()).toBe("2025-09-07T00:06:40.000Z");
    const [dated] = thrivecartConnector.normalize!(body({ order_timestamp: undefined, order_date: "2026-09-07T14:30:00Z" }), { connectionId: CONN });
    expect(dated.occurredAt.toISOString()).toBe("2026-09-07T14:30:00.000Z");
    const delivered = new Date("2026-09-08T09:00:00.000Z");
    const [fallback] = thrivecartConnector.normalize!(body({ order_timestamp: undefined }), { connectionId: CONN, fallbackOccurredAt: delivered });
    expect(fallback.occurredAt.toISOString()).toBe("2026-09-08T09:00:00.000Z");
  });

  it("takes the currency from the top level, uppercases it, and leaves zero-decimal money alone", () => {
    const [lower] = thrivecartConnector.normalize!(body({ currency: "eur" }), { connectionId: CONN });
    expect(lower).toMatchObject({ value: 97, currency: "EUR" });
    const [nested] = thrivecartConnector.normalize!(body({ currency: undefined, order: { id: "O-1", total: 9700, currency: "gbp" } }), { connectionId: CONN });
    expect(nested).toMatchObject({ value: 97, currency: "GBP" });
    const [yen] = thrivecartConnector.normalize!(body({ currency: "JPY", order: { id: "O-1", total: 9700 } }), { connectionId: CONN });
    expect(yen).toMatchObject({ value: 9700, currency: "JPY" });
    const [none] = thrivecartConnector.normalize!(body({ order: { id: "O-1" } }), { connectionId: CONN });
    expect(none).toMatchObject({ value: null, currency: "USD" });
  });

  it("names the order however the payload does, and the buyer however it can", () => {
    const [top] = thrivecartConnector.normalize!(body({ order: { total: 9700 }, order_id: 1_514_394 }), { connectionId: CONN });
    expect(top.eventId).toBe("thrivecart:conn_1:1514394:order.success");
    const [abandoned] = thrivecartConnector.normalize!(
      body({ event: "cart.abandoned", order: undefined, order_id: undefined, event_id: "e9" }),
      { connectionId: CONN },
    );
    expect(abandoned.eventId).toBe("thrivecart:conn_1:e9:cart.abandoned");
    const [byIdentifier] = thrivecartConnector.normalize!(body({ customer: { id: 42 }, customer_identifier: "cust_42" }), { connectionId: CONN });
    expect(byIdentifier.subject).toBe("cust_42");
    // Nothing to hang an id on is nothing to store: a dedup key we cannot
    // reproduce would duplicate on every redelivery.
    expect(thrivecartConnector.normalize!(body({ order: undefined, order_id: undefined, event_id: undefined }), { connectionId: CONN })).toEqual([]);
  });
});

describe("thrivecart: the form-encoded delivery the account webhook actually sends", () => {
  it("decodes `{ _raw }` into the same event the JSON door produces", () => {
    const [o] = thrivecartConnector.normalize!({ _raw: FORM }, { connectionId: CONN });
    expect(o).toMatchObject({
      eventId: "thrivecart:conn_1:1514394:order.success",
      eventType: "order_created",
      subject: "jsmith@email.com",
      value: 100,
      currency: "USD",
    });
    expect(o.occurredAt.toISOString()).toBe("2025-09-06T23:06:40.000Z");
    expect(o.properties).not.toHaveProperty("thrivecart_secret");
    // PHP bracket keys become the nesting they describe, and a 0,1,2… run
    // becomes the array the JSON door would have sent.
    expect(o.properties).toMatchObject({
      customer: { id: "6702306", email: "jsmith@email.com" },
      order: { total: "10000", total_str: "100.00", charges: [{ name: "Webhook testing" }] },
    });
    expect(Array.isArray((o.properties as { order: { charges: unknown } }).order.charges)).toBe(true);
  });

  it("drops a form-encoded test order", () => {
    expect(thrivecartConnector.normalize!({ _raw: FORM.replace("mode=live&mode_int=2", "mode=test&mode_int=1") }, { connectionId: CONN })).toEqual([]);
  });
});
