import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { stripeConnector, STRIPE_EVENT_TYPES } from "@/connectors/stripe";
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

const SECRET = "whsec_test_secret";
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (t: string, body: string) => createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
const event = (type: string, object: Record<string, unknown>, id = "evt_1", created = 1_757_200_000) => ({ id, object: "event", type, created, data: { object } });

describe("stripe: registration", () => {
  it("is in the catalog and the registry with dated provenance", () => {
    expect(getConnector("stripe")).toBe(stripeConnector);
    const e = catalogEntry("stripe")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["events.list"]);
  });
});

describe("stripe: signature", () => {
  it("accepts t=,v1= over `${t}.${body}`, with several v1 entries, and fails closed", () => {
    const body = JSON.stringify(event("charge.succeeded", {}));
    const t = String(nowSec());
    const ok = { rawBody: body, headers: { "stripe-signature": `t=${t},v1=deadbeef,v1=${sign(t, body)},v0=ignored` }, secret: SECRET };
    expect(stripeConnector.verifySignature(ok)).toBe(true);
    expect(stripeConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(stripeConnector.verifySignature({ ...ok, secret: "whsec_other" })).toBe(false);
    expect(stripeConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    const old = String(nowSec() - 3600);
    expect(stripeConnector.verifySignature({ ...ok, headers: { "stripe-signature": `t=${old},v1=${sign(old, body)}` } })).toBe(false);
  });
});

describe("stripe: normalize", () => {
  it("a charge becomes payment_succeeded in major units with the currency uppercased", () => {
    const [ev] = stripeConnector.normalize!(
      event("charge.succeeded", { id: "ch_1", amount: 1234, currency: "usd", created: 1_757_200_100, billing_details: { email: "a@b.io" }, customer: "cus_1" }),
      { connectionId: CONN },
    );
    expect(ev).toMatchObject({ eventId: "stripe:conn_1:evt_1", eventType: "payment_succeeded", subject: "a@b.io", value: 12.34, currency: "USD" });
    expect(ev.occurredAt.toISOString()).toBe(new Date(1_757_200_100 * 1000).toISOString());
  });
  it("a zero-decimal currency is not divided; an invoice dates by paid_at; a refund keeps a positive amount", () => {
    const [jpy] = stripeConnector.normalize!(event("charge.succeeded", { id: "ch_2", amount: 5000, currency: "jpy", created: 1 }), { connectionId: CONN });
    expect(jpy.value).toBe(5000);
    const [inv] = stripeConnector.normalize!(
      event("invoice.paid", { id: "in_1", amount_paid: 9900, currency: "eur", created: 1, customer_email: "c@d.io", status_transitions: { paid_at: 1_757_300_000 } }),
      { connectionId: CONN },
    );
    expect(inv.eventType).toBe("invoice_paid");
    expect(inv.occurredAt.toISOString()).toBe(new Date(1_757_300_000 * 1000).toISOString());
    const [ref] = stripeConnector.normalize!(event("refund.created", { id: "re_1", amount: 500, currency: "usd", created: 2, charge: "ch_1" }), { connectionId: CONN });
    expect(ref).toMatchObject({ eventType: "payment_refunded", value: 5, subject: "ch_1" });
  });
  it("a checkout carries its value only once paid", () => {
    const paid = { id: "cs_1", amount_total: 2500, currency: "usd", created: 3, payment_status: "paid", customer_details: { email: "buyer@x.io" } };
    const [p] = stripeConnector.normalize!(event("checkout.session.completed", paid), { connectionId: CONN });
    expect(p).toMatchObject({ eventType: "checkout_completed", subject: "buyer@x.io", value: 25, currency: "USD" });
    const [u] = stripeConnector.normalize!(event("checkout.session.completed", { ...paid, payment_status: "unpaid" }, "evt_9"), { connectionId: CONN });
    expect(u.value).toBeNull();
  });
  it("a subscription's value is the sum of its items; deletion dates by canceled_at; unknown types are dropped", () => {
    const sub = { id: "sub_1", customer: "cus_1", currency: "usd", created: 10, canceled_at: 20, items: { data: [{ quantity: 2, price: { unit_amount: 1000, currency: "usd", recurring: { interval: "month" } } }] } };
    const [created] = stripeConnector.normalize!(event("customer.subscription.created", sub), { connectionId: CONN });
    expect(created).toMatchObject({ eventType: "subscription_created", value: 20, currency: "USD", subject: "cus_1" });
    const [deleted] = stripeConnector.normalize!(event("customer.subscription.deleted", sub, "evt_2"), { connectionId: CONN });
    expect(deleted.eventType).toBe("subscription_canceled");
    expect(deleted.occurredAt.toISOString()).toBe(new Date(20 * 1000).toISOString());
    expect(stripeConnector.normalize!(event("payment_intent.succeeded", { id: "pi_1" }), { connectionId: CONN })).toEqual([]);
    expect(stripeConnector.normalize!(event("invoice.upcoming", { id: "in_2" }), { connectionId: CONN })).toEqual([]);
    expect(stripeConnector.normalize!(event("charge.refunded", { id: "ch_1" }), { connectionId: CONN })).toEqual([]);
  });
});

describe("stripe: poll", () => {
  it("walks /v1/events bounded by created[gte], follows starting_after, and settles on the newest created", async () => {
    const e1 = event("charge.succeeded", { id: "ch_a", amount: 100, currency: "usd", created: 1_757_200_300 }, "evt_a", 1_757_200_300);
    const e2 = event("charge.succeeded", { id: "ch_b", amount: 100, currency: "usd", created: 1_757_200_200 }, "evt_b", 1_757_200_200);
    const calls = stubFetch([{ data: [e1], has_more: true }, { data: [e2], has_more: false }]);
    const res = await stripeConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "rk_test" } });
    expect(res.records.map((r) => r.eventId)).toEqual(["stripe:conn_1:evt_a", "stripe:conn_1:evt_b"]);
    expect(res.nextCursor).toBe(new Date(1_757_200_300 * 1000).toISOString());
    expect(res.incomplete).toBeUndefined();
    const u1 = new URL(calls[0].url);
    expect(u1.pathname).toBe("/v1/events");
    expect(u1.searchParams.get("limit")).toBe("100");
    expect(u1.searchParams.getAll("types[]")).toEqual(Object.keys(STRIPE_EVENT_TYPES));
    expect(u1.searchParams.getAll("types[]").length).toBeLessThanOrEqual(20);
    expect(Number(u1.searchParams.get("created[gte]"))).toBeGreaterThan(0);
    expect(new URL(calls[1].url).searchParams.get("starting_after")).toBe("evt_a");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer rk_test");
  });
  it("declares its retention and reads the watermark from a walk cursor", () => {
    expect(stripeConnector.retention).toMatchObject({ days: 30, alarmAfterDays: 25 });
    expect(stripeConnector.retention!.watermarkOf("2026-09-01T00:00:00.000Z")).toBe("2026-09-01T00:00:00.000Z");
    expect(stripeConnector.retention!.watermarkOf(JSON.stringify({ hw: "2026-09-02T00:00:00.000Z", cont: "evt_x", maxSeen: null }))).toBe("2026-09-02T00:00:00.000Z");
    expect(stripeConnector.importProgress).toBeDefined();
  });
});
