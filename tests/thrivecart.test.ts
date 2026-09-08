import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { thrivecartConnector, THRIVECART_EVENTS } from "@/connectors/thrivecart";
import { catalogEntry, isStreamScoped } from "@/connectors/catalog";
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

/**
 * WHY THE CUSTOMER STILL PASTES SOMETHING — pinned so nobody re-litigates it
 * from memory, and so the one line of copy that has a JOB keeps doing it.
 *
 * ThriveCart's Event Subscription API does create subscriptions ("POST a JSON
 * blob to the subscribe endpoint: https://thrivecart.com/api/external/subscribe",
 * developers.thrivecart.com/documentation/event_subscription/intro/, read 8 Sep
 * 2026), but it documents no response body and no secret in one, and it gates
 * `target_url` on an app's registered URLs — an OAuth grant this connector has
 * no credential for. The value that authenticates a delivery is the account's
 * own "Secret word", which exists only inside ThriveCart's UI. So the field
 * stays, required, and the copy's job is to name the exact place it lives.
 *
 * The copy is asserted by its ANCHORS (the menu path, the field's name) rather
 * than verbatim: the sentence around them gets edited, the path must not drift.
 */
describe("thrivecart: no auto-registration, and copy that says so", () => {
  it("registers nothing, and never claims it did", () => {
    const e = catalogEntry("thrivecart")!;
    expect(e.autoWebhook).toBe(false);
    expect(thrivecartConnector.registerWebhook).toBeUndefined();
    expect(thrivecartConnector.unregisterWebhook).toBeUndefined();
    // Connection-scoped, so the blocker is the SECRET and not an unknown
    // resource: there is no per-form, per-product stream to register against,
    // and registering later at stream creation would meet the same wall.
    expect(isStreamScoped("thrivecart")).toBe(false);
    expect(e.webhookSetup ?? "").not.toMatch(/automatic|we create|created for you/i);
  });

  it("the dialog names the exact place in ThriveCart the value lives", () => {
    const e = catalogEntry("thrivecart")!;
    const [field, ...rest] = e.credentialFields;
    expect(rest).toEqual([]);
    expect(field.key).toBe("webhookSecret");
    // The label carries the path on its own: the connect dialog renders a
    // label and a masked box, and nothing else.
    for (const anchor of [/API & Webhooks/, /order validation/i]) expect(field.label, field.label).toMatch(anchor);
    const setup = e.webhookSetup ?? "";
    for (const anchor of [/Settings/, /API & Webhooks/, /order validation/i, /webhook/i]) expect(setup, setup).toMatch(anchor);
  });

  it("the module cites the create endpoint that cannot help, and fails closed in one line", () => {
    const src = readFileSync("src/connectors/thrivecart.ts", "utf8");
    expect(src).toContain("https://thrivecart.com/api/external/subscribe");
    expect(src.match(/if \(!secret\) return false;/g)).toHaveLength(1);
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
      // The two RECURRING events are keyed on the charge rather than the order,
      // because one subscription reuses one order_id for every payment it ever
      // makes. Their ids have their own describe block below; asserting the
      // order-keyed shape for them here is what hid the collapse in the first
      // place.
      if (!["rebill", "rebill_failed"].includes(ours)) {
        expect(ev.eventId, event).toBe(`thrivecart:conn_1:O-1:${event}`);
      }
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

describe("thrivecart: a subscription's payments are separate events", () => {
  /**
   * The shape ThriveCart's own docs print. On the account webhook the sale and
   * the rebill that follows it BOTH carry order_id=1514394; only the invoice
   * moves (000000004 → 000000004-2) and only recurring_payment_idx counts.
   * Keying on the order therefore collapsed a subscription's entire life onto
   * one event, and every payment after the first was dropped as a duplicate —
   * a silent loss of exactly the revenue a subscription exists to produce.
   */
  const rebill = (over: Record<string, unknown> = {}) =>
    body({
      event: "order.subscription_payment",
      order_id: "1514394",
      invoice_id: "000000004-2",
      recurring_payment_idx: 2,
      order: { id: undefined, total: 9700 },
      ...over,
    });

  it("keeps twelve months of one subscription as twelve events", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => {
      const [ev] = thrivecartConnector.normalize!(
        rebill({ invoice_id: `000000004-${n}`, recurring_payment_idx: n, order_timestamp: 1_757_200_000 + n * 2_592_000 }),
        { connectionId: CONN },
      );
      return ev.eventId;
    });
    expect(new Set(ids).size).toBe(12);
  });

  it("still dedups a REDELIVERY of the same payment", () => {
    const one = thrivecartConnector.normalize!(rebill(), { connectionId: CONN })[0];
    const again = thrivecartConnector.normalize!(rebill(), { connectionId: CONN })[0];
    expect(one.eventId).toBe(again.eventId);
  });

  it("separates the rebill from the sale that opened the subscription", () => {
    const [sale] = thrivecartConnector.normalize!(
      body({ event: "order.success", order_id: "1514394", invoice_id: "000000004", order: { id: undefined, total: 9700 } }),
      { connectionId: CONN },
    );
    const [second] = thrivecartConnector.normalize!(rebill(), { connectionId: CONN });
    expect(sale.eventId).not.toBe(second.eventId);
  });

  it("falls back to the payment index, then the timestamp, when no invoice is sent", () => {
    const byIdx = thrivecartConnector.normalize!(rebill({ invoice_id: undefined }), { connectionId: CONN })[0];
    const byIdx3 = thrivecartConnector.normalize!(
      rebill({ invoice_id: undefined, recurring_payment_idx: 3 }),
      { connectionId: CONN },
    )[0];
    expect(byIdx.eventId).not.toBe(byIdx3.eventId);

    const bare = (ts: number) =>
      thrivecartConnector.normalize!(
        rebill({ invoice_id: undefined, recurring_payment_idx: undefined, order_timestamp: ts }),
        { connectionId: CONN },
      )[0].eventId;
    expect(bare(1_757_200_000)).not.toBe(bare(1_759_792_000));
  });

  it("leaves a one-off order's id exactly where it was", () => {
    // Nothing about a non-recurring sale moves: the settled scheme keeps its
    // keys, so already-stored orders are not re-ingested as duplicates.
    const [ev] = thrivecartConnector.normalize!(body(), { connectionId: CONN });
    expect(ev.eventId).toBe("thrivecart:conn_1:O-1:order.success");
  });
});
