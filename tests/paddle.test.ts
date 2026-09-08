import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { paddleConnector, PADDLE_EVENT_TYPES } from "@/connectors/paddle";
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

/** The same stub, refusing with one status — for the teardown that must swallow a 404. */
function stubStatus(status: number, statusText: string) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return {
        ok: false,
        status,
        statusText,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => `{"error":{"code":"entity_not_found"}}`,
      } as unknown as Response;
    }),
  );
  return calls;
}

const SECRET = "pdl_ntfset_secret";
const nowSec = () => Math.floor(Date.now() / 1000);
/** Paddle: HMAC-SHA256, HEX, over `${ts}:${rawBody}` — colon, not Stripe's dot. */
const sign = (ts: string, body: string) => createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");

const tx = (over: Record<string, unknown> = {}) => ({
  id: "txn_1",
  status: "completed",
  customer_id: "ctm_1",
  currency_code: "USD",
  // The record was opened days before the sale: the decoy axis.
  created_at: "2026-08-25T09:00:00.000Z",
  billed_at: "2026-09-01T10:00:00.000Z",
  details: {
    totals: { subtotal: "10000", tax: "2000", total: "12000", fee: "600", earnings: "9400", grand_total: "12000", currency_code: "USD" },
  },
  ...over,
});

const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer_id: "ctm_1",
  currency_code: "USD",
  created_at: "2026-08-30T08:00:00.000Z",
  // Dating traps: both are in the FUTURE and must never become occurredAt.
  next_billed_at: "2026-10-01T00:00:00.000Z",
  current_billing_period: { starts_at: "2026-09-01T00:00:00.000Z", ends_at: "2026-10-01T00:00:00.000Z" },
  items: [{ quantity: 1, price: { id: "pri_1", unit_price: { amount: "2000", currency_code: "USD" } } }],
  ...over,
});

const envelope = (event_type: string, data: Record<string, unknown>, event_id = "evt_1", occurred_at = "2026-09-01T10:00:01.000Z") => ({
  event_id,
  event_type,
  occurred_at,
  notification_id: "ntf_1",
  data,
});

describe("paddle: registration", () => {
  it("is in the catalog and the registry with dated provenance, a webhook it registers itself, and one budgeted operation", () => {
    expect(getConnector("paddle")).toBe(paddleConnector);
    const e = catalogEntry("paddle")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toEqual({ color: "#FDDD35", short: "Pa" });
    expect(e.instant && e.poll && e.autoWebhook).toBe(true);
    // Both directions, the way tests/budget-operations.test.ts checks them.
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["transactions.list"]);
    expect(paddleConnector.operations).toEqual(["transactions.list"]);
    // The environment is asked for, never guessed: a sandbox key against the
    // live base URL is a forbidden error.
    expect(e.credentialFields.map((f) => f.key)).toEqual(["apiKey", "sandbox"]);
    // Every key this connector can store is either labelled here or already
    // labelled by another source (payment_succeeded, payment_refunded and the
    // subscription trio are Stripe's).
    expect(e.eventTypeLabels).toEqual({ subscription_activated: "Subscription activated", adjustment_created: "Adjustment" });
  });
});

describe("paddle: signature", () => {
  const body = JSON.stringify(envelope("transaction.completed", tx()));

  it("accepts ts=…;h1=… hex over `${ts}:${body}` and fails closed on every other input", () => {
    const ts = String(nowSec());
    const ok = { rawBody: body, headers: { "paddle-signature": `ts=${ts};h1=${sign(ts, body)}` }, secret: SECRET };
    expect(paddleConnector.verifySignature(ok)).toBe(true);
    expect(paddleConnector.verifySignature({ ...ok, secret: "pdl_ntfset_other" })).toBe(false);
    expect(paddleConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(paddleConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    expect(paddleConnector.verifySignature({ ...ok, rawBody: body + " " })).toBe(false);
  });

  it("rejects an authentic delivery replayed outside the tolerance window", () => {
    const old = String(nowSec() - 3600);
    expect(
      paddleConnector.verifySignature({ rawBody: body, headers: { "paddle-signature": `ts=${old};h1=${sign(old, body)}` }, secret: SECRET }),
    ).toBe(false);
  });

  it("the separator is a SEMICOLON and the signed string a COLON — Stripe's spelling is not accepted", () => {
    const ts = String(nowSec());
    // Comma-separated pairs (Stripe's header shape) parse as one key `ts` whose
    // value swallows the h1, so no signature is found.
    expect(
      paddleConnector.verifySignature({ rawBody: body, headers: { "paddle-signature": `ts=${ts},h1=${sign(ts, body)}` }, secret: SECRET }),
    ).toBe(false);
    // A dot between timestamp and body (Stripe's message) is a different digest.
    const dotted = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    expect(paddleConnector.verifySignature({ rawBody: body, headers: { "paddle-signature": `ts=${ts};h1=${dotted}` }, secret: SECRET })).toBe(
      false,
    );
  });
});

describe("paddle: normalize", () => {
  it("transaction.completed is payment_succeeded at billed_at, keyed on the TRANSACTION, with total as the value", () => {
    const [p] = paddleConnector.normalize!(envelope("transaction.completed", tx()), { connectionId: CONN });
    expect(p).toMatchObject({ eventId: "paddle:conn_1:txn:txn_1", eventType: "payment_succeeded", subject: "ctm_1", value: 120, currency: "USD" });
    expect(p.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(p.properties).toMatchObject({ subtotal_major: 100, tax_major: 20, fee_major: 6, earnings_major: 94, grand_total_major: 120 });
  });

  it("transaction.paid is the SAME row as transaction.completed — one sale cannot be counted twice", () => {
    const paid = paddleConnector.normalize!(envelope("transaction.paid", tx({ status: "paid" }), "evt_4"), { connectionId: CONN })[0];
    const completed = paddleConnector.normalize!(envelope("transaction.completed", tx(), "evt_5"), { connectionId: CONN })[0];
    expect(paid.eventId).toBe("paddle:conn_1:txn:txn_1");
    expect(paid.eventId).toBe(completed.eventId);
    expect(paid.eventType).toBe("payment_succeeded");
    expect(paid.occurredAt.toISOString()).toBe(completed.occurredAt.toISOString());
  });

  it("a zero-decimal currency is not divided", () => {
    const jpy = tx({ currency_code: "JPY", details: { totals: { total: "5000", fee: "250", earnings: "4750", currency_code: "JPY" } } });
    const [p] = paddleConnector.normalize!(envelope("transaction.completed", jpy), { connectionId: CONN });
    expect(p).toMatchObject({ value: 5000, currency: "JPY" });
    expect(p.properties).toMatchObject({ earnings_major: 4750 });
  });

  it("an adjustment is a refund only when the action is money leaving; it is dated and keyed by the adjustment itself", () => {
    const adjustment = (action: string, id = "adj_1") => ({
      id,
      action,
      status: "approved",
      transaction_id: "txn_1",
      customer_id: "ctm_1",
      currency_code: "USD",
      totals: { subtotal: "1000", tax: "200", total: "1200", fee: "60", earnings: "1140", currency_code: "USD" },
      created_at: "2026-09-02T00:00:00.000Z",
    });
    const [r] = paddleConnector.normalize!(envelope("adjustment.created", adjustment("refund"), "evt_2"), { connectionId: CONN });
    expect(r).toMatchObject({ eventId: "paddle:conn_1:adj:adj_1", eventType: "payment_refunded", subject: "ctm_1", value: 12, currency: "USD" });
    expect(r.occurredAt.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    const [c] = paddleConnector.normalize!(envelope("adjustment.created", adjustment("chargeback", "adj_2"), "evt_6"), { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "paddle:conn_1:adj:adj_2", eventType: "payment_refunded" });
    // A credit is not cash out, and a won dispute is money coming back.
    const [credit] = paddleConnector.normalize!(envelope("adjustment.created", adjustment("credit", "adj_3"), "evt_7"), { connectionId: CONN });
    expect(credit).toMatchObject({ eventType: "adjustment_created", value: 12 });
    const [won] = paddleConnector.normalize!(envelope("adjustment.created", adjustment("chargeback_reverse", "adj_4"), "evt_8"), {
      connectionId: CONN,
    });
    expect(won.eventType).toBe("adjustment_created");
  });

  it("subscriptions are dated by the state change, never by next_billed_at, and priced from their items", () => {
    const created = paddleConnector.normalize!(envelope("subscription.created", sub(), "evt_3"), { connectionId: CONN })[0];
    expect(created).toMatchObject({ eventId: "paddle:conn_1:evt_3", eventType: "subscription_created", subject: "ctm_1", value: 20, currency: "USD" });
    expect(created.occurredAt.toISOString()).toBe("2026-08-30T08:00:00.000Z");

    const activated = paddleConnector.normalize!(envelope("subscription.activated", sub(), "evt_9", "2026-09-05T12:00:00.000Z"), {
      connectionId: CONN,
    })[0];
    expect(activated.eventType).toBe("subscription_activated");
    expect(activated.occurredAt.toISOString()).toBe("2026-09-05T12:00:00.000Z");

    const updated = paddleConnector.normalize!(
      envelope("subscription.updated", sub({ items: [{ quantity: 3, price: { unit_price: { amount: "2000", currency_code: "USD" } } }] }), "evt_10", "2026-09-06T12:00:00.000Z"),
      { connectionId: CONN },
    )[0];
    expect(updated).toMatchObject({ eventType: "subscription_updated", value: 60 });
    expect(updated.occurredAt.toISOString()).toBe("2026-09-06T12:00:00.000Z");
    expect(updated.properties).toMatchObject({ next_billed_at: "2026-10-01T00:00:00.000Z" });

    const canceled = paddleConnector.normalize!(
      envelope("subscription.canceled", sub({ status: "canceled", canceled_at: "2026-09-03T00:00:00.000Z", next_billed_at: null }), "evt_11"),
      { connectionId: CONN },
    )[0];
    expect(canceled).toMatchObject({ eventId: "paddle:conn_1:evt_11", eventType: "subscription_canceled", value: 20 });
    expect(canceled.occurredAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("drops every event type it does not map, and anything without an envelope", () => {
    expect(paddleConnector.normalize!(envelope("transaction.created", tx(), "evt_12"), { connectionId: CONN })).toEqual([]);
    expect(paddleConnector.normalize!(envelope("transaction.updated", tx(), "evt_13"), { connectionId: CONN })).toEqual([]);
    expect(paddleConnector.normalize!(envelope("customer.created", { id: "ctm_1" }, "evt_14"), { connectionId: CONN })).toEqual([]);
    expect(paddleConnector.normalize!({}, { connectionId: CONN })).toEqual([]);
    expect(Object.keys(PADDLE_EVENT_TYPES)).toContain("adjustment.created");
  });
});

describe("paddle: poll", () => {
  it("walks /transactions bounded by billed_at[GTE], follows `after`, and settles on the newest billed_at", async () => {
    const calls = stubFetch([
      { data: [tx()], meta: { pagination: { per_page: 30, has_more: true, next: "https://api.paddle.com/transactions?after=txn_1" } } },
      { data: [], meta: { pagination: { per_page: 30, has_more: false, next: null } } },
    ]);
    const res = await paddleConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pdl" } });

    expect(res.records.map((r) => r.eventId)).toEqual(["paddle:conn_1:txn:txn_1"]);
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(res.records[0]).toMatchObject({ eventType: "payment_succeeded", value: 120, currency: "USD" });
    // The mark is the field the request bounds, not created_at.
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
    expect(res.providerCalls).toBe(2);

    const u = new URL(calls[0].url);
    expect(u.origin).toBe("https://api.paddle.com");
    expect(u.pathname).toBe("/transactions");
    expect(u.searchParams.get("order_by")).toBe("billed_at[ASC]");
    expect(u.searchParams.get("per_page")).toBe("30");
    expect(u.searchParams.get("status")).toBe("completed,paid");
    expect(u.searchParams.get("billed_at[GTE]")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(u.searchParams.get("after")).toBeNull();
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer pdl");
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("txn_1");
  });

  it("resumes from a stored mark, and a sandbox connection talks to the sandbox base URL", async () => {
    const calls = stubFetch([{ data: [tx({ id: "txn_2", billed_at: "2026-09-04T10:00:00.000Z" })], meta: { pagination: { has_more: false } } }]);
    const res = await paddleConnector.poll!({
      connectionId: CONN,
      cursor: "2026-09-01T10:00:00.000Z",
      credentials: { apiKey: "pdl_sdbx", sandbox: "yes" },
    });
    expect(res.nextCursor).toBe("2026-09-04T10:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.origin).toBe("https://sandbox-api.paddle.com");
    // The mark, minus the five-minute overlap — a late edit is re-read, never skipped.
    expect(u.searchParams.get("billed_at[GTE]")).toBe("2026-09-01T09:55:00.000Z");
  });

  it("the polled row and the webhook's transaction.completed are ONE record", async () => {
    stubFetch([{ data: [tx()], meta: { pagination: { has_more: false } } }]);
    const polled = await paddleConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pdl" } });
    const [delivered] = paddleConnector.normalize!(envelope("transaction.completed", tx()), { connectionId: CONN });
    expect(polled.records[0].eventId).toBe(delivered.eventId);
    expect(polled.records[0].occurredAt.toISOString()).toBe(delivered.occurredAt.toISOString());
    expect(polled.records[0].value).toBe(delivered.value);
  });

  it("registers a notification destination for exactly the events it maps, and returns the endpoint secret", async () => {
    const calls = stubFetch([{ data: { id: "ntfset_1", endpoint_secret_key: "pdl_ntfset_x", type: "url" } }]);
    const res = await paddleConnector.registerWebhook!({
      connectionId: CONN,
      webhookUrl: "https://app.namzilabs.com/api/webhooks/conn_1",
      credentials: { apiKey: "pdl" },
    });
    expect(res).toEqual({ signingSecret: "pdl_ntfset_x", externalId: "ntfset_1" });
    expect(new URL(calls[0].url).pathname).toBe("/notification-settings");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ destination: "https://app.namzilabs.com/api/webhooks/conn_1", type: "url", description: "Namzilabs" });
    expect(body["subscribed_events"]).toEqual(Object.keys(PADDLE_EVENT_TYPES));
  });

  it("teardown deletes the destination, and an already-deleted one IS success", async () => {
    const ok = stubFetch([{ data: {} }]);
    await paddleConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "pdl" }, externalId: "ntfset_1" });
    expect(new URL(ok[0].url).pathname).toBe("/notification-settings/ntfset_1");
    expect(ok[0].init.method).toBe("DELETE");

    vi.unstubAllGlobals();
    stubStatus(404, "Not Found");
    await expect(
      paddleConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "pdl" }, externalId: "ntfset_gone" }),
    ).resolves.toBeUndefined();
  });
});
