import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { woocommerceConnector, storeApiBase, WOOCOMMERCE_TOPICS } from "@/connectors/woocommerce";

afterEach(() => vi.unstubAllGlobals());

const CONN = "conn_1";
const STORE = "https://shop.example.com";
const CREDS = { storeUrl: STORE, consumerKey: "ck_live", consumerSecret: "cs_live" };

/** A fetch stub answering a queue of JSON bodies in order, recording every request. */
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

/** The same stub, refusing everything with one status — for the teardown that must swallow a 404. */
function stubStatus(status: number, statusText: string) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: false,
        status,
        statusText,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => `{"code":"woocommerce_rest_webhook_invalid_id"}`,
      } as unknown as Response;
    }),
  );
  return calls;
}

/** One fetch that succeeds, then every later one refuses — the half-registered case. */
function stubThenFail(first: unknown, status = 403) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (n++ === 0) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => first,
          text: async () => JSON.stringify(first),
        } as unknown as Response;
      }
      return {
        ok: false,
        status,
        statusText: "Forbidden",
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => `{"code":"woocommerce_rest_cannot_create"}`,
      } as unknown as Response;
    }),
  );
  return calls;
}

const SECRET = "wc_secret_abc";
/** WooCommerce: base64 of the RAW HMAC-SHA256 over the delivered body. */
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");

/**
 * A WooCommerce order as the API actually emits it: every timestamp NAIVE (no
 * `Z`), every money figure a decimal STRING already in major units, and the
 * local/GMT twins deliberately an hour apart so a test that reads the wrong one
 * cannot pass by coincidence.
 */
const order = (over: Record<string, unknown> = {}) => ({
  id: 727,
  number: "727",
  status: "processing",
  currency: "USD",
  // The local twins are the DECOY: a store an hour behind GMT.
  date_created: "2026-09-01T09:28:02",
  date_created_gmt: "2026-09-01T10:28:02",
  date_modified: "2026-09-02T07:00:00",
  date_modified_gmt: "2026-09-02T08:00:00",
  date_paid: "2026-09-01T09:30:00",
  date_paid_gmt: "2026-09-01T10:30:00",
  date_completed: null,
  date_completed_gmt: null,
  discount_total: "5.00",
  shipping_total: "4.35",
  total_tax: "2.00",
  total: "29.35",
  customer_id: 0,
  billing: { first_name: "Ada", email: "ada@example.com" },
  ...over,
});

describe("woocommerce: store URL", () => {
  it("builds the wc/v3 base from whatever the customer pasted", () => {
    expect(storeApiBase(STORE)).toBe("https://shop.example.com/wp-json/wc/v3");
    expect(storeApiBase(`${STORE}/`)).toBe("https://shop.example.com/wp-json/wc/v3");
    // People paste the URL they were reading the docs at.
    expect(storeApiBase(`${STORE}/wp-json`)).toBe("https://shop.example.com/wp-json/wc/v3");
    expect(storeApiBase(`${STORE}/wp-json/wc/v3`)).toBe("https://shop.example.com/wp-json/wc/v3");
    // A subdirectory install keeps its path.
    expect(storeApiBase("https://example.com/shop/")).toBe("https://example.com/shop/wp-json/wc/v3");
  });

  it("refuses a store that is not https — the consumer secret rides in an Authorization header", () => {
    expect(() => storeApiBase("http://shop.example.com")).toThrow(/https/i);
    expect(() => storeApiBase("shop.example.com")).toThrow(/https:\/\//);
  });
});

describe("woocommerce: signature", () => {
  const body = JSON.stringify(order());

  it("accepts base64 HMAC-SHA256 over the raw body and fails closed on every other input", () => {
    const ok = { rawBody: body, headers: { "x-wc-webhook-signature": sign(body) }, secret: SECRET };
    expect(woocommerceConnector.verifySignature(ok)).toBe(true);
    // THE FAIL-CLOSED PIN: no secret is never an acceptance.
    expect(woocommerceConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(woocommerceConnector.verifySignature({ ...ok, secret: undefined })).toBe(false);
    expect(woocommerceConnector.verifySignature({ ...ok, secret: "" })).toBe(false);
    expect(woocommerceConnector.verifySignature({ ...ok, secret: "wc_secret_other" })).toBe(false);
    // No header at all — WooCommerce's own activation ping is exactly this.
    expect(woocommerceConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    expect(woocommerceConnector.verifySignature({ rawBody: "webhook_id=12", headers: {}, secret: SECRET })).toBe(false);
    // One byte of body drift is a different digest.
    expect(woocommerceConnector.verifySignature({ ...ok, rawBody: `${body} ` })).toBe(false);
  });

  it("the digest is BASE64 of the raw hash — the hex spelling is not accepted", () => {
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(woocommerceConnector.verifySignature({ rawBody: body, headers: { "x-wc-webhook-signature": hex }, secret: SECRET })).toBe(false);
  });

  it("has no timestamp to go stale — an authentic delivery stays verifiable, and dedup is what makes that safe", () => {
    // Unlike Paddle or Standard Webhooks, X-WC-Webhook-Signature carries no
    // timestamp, so there is nothing to reject a replay on. Pinned so that
    // adding a freshness check later is a deliberate act, not a surprise.
    const ok = { rawBody: body, headers: { "x-wc-webhook-signature": sign(body) }, secret: SECRET };
    expect(woocommerceConnector.verifySignature(ok)).toBe(true);
    expect(woocommerceConnector.normalize!(order(), { connectionId: CONN })[0].eventId).toBe(
      woocommerceConnector.normalize!(order(), { connectionId: CONN })[0].eventId,
    );
  });
});

describe("woocommerce: normalize", () => {
  it("an order is placed at date_created_gmt and paid at date_paid_gmt — two rows, one order, GMT not local", () => {
    const evs = woocommerceConnector.normalize!(order(), { connectionId: CONN });
    expect(evs.map((e) => e.eventType)).toEqual(["order_created", "payment_succeeded"]);

    const [placed, paid] = evs;
    expect(placed).toMatchObject({
      eventId: "woocommerce:conn_1:order:727",
      eventType: "order_created",
      // A guest checkout (customer_id 0) is identified by the billing email.
      subject: "ada@example.com",
      // A DECIMAL string in major units: 29.35, never 2935 and never 0.2935.
      value: 29.35,
      currency: "USD",
    });
    // The GMT twin, read as GMT. The local field says 09:28:02 and must not win,
    // and the naive string must not be read in the container's timezone.
    expect(placed.occurredAt.toISOString()).toBe("2026-09-01T10:28:02.000Z");

    expect(paid).toMatchObject({ eventId: "woocommerce:conn_1:order:727:paid", eventType: "payment_succeeded", value: 29.35, currency: "USD" });
    expect(paid.occurredAt.toISOString()).toBe("2026-09-01T10:30:00.000Z");
  });

  it("an unpaid order is one row, and acquiring a payment adds the second without moving the first", () => {
    const pending = woocommerceConnector.normalize!(order({ status: "pending", date_paid: null, date_paid_gmt: null }), { connectionId: CONN });
    expect(pending).toHaveLength(1);
    expect(pending[0].eventType).toBe("order_created");

    // The same order, days later, once the bank transfer cleared.
    const cleared = woocommerceConnector.normalize!(
      order({ status: "processing", date_paid_gmt: "2026-09-05T11:00:00", date_modified_gmt: "2026-09-05T11:00:00" }),
      { connectionId: CONN },
    );
    expect(cleared[0].eventId).toBe(pending[0].eventId);
    expect(cleared[0].occurredAt.toISOString()).toBe(pending[0].occurredAt.toISOString());
    expect(cleared[1].occurredAt.toISOString()).toBe("2026-09-05T11:00:00.000Z");
  });

  it("a logged-in customer is identified by their id, and a store with neither falls back to the order", () => {
    const byId = woocommerceConnector.normalize!(order({ customer_id: 42, billing: {} }), { connectionId: CONN });
    expect(byId[0].subject).toBe("42");
    const bare = woocommerceConnector.normalize!(order({ customer_id: 0, billing: {} }), { connectionId: CONN });
    expect(bare[0].subject).toBe("727");
  });

  it("a started block checkout is not an order", () => {
    // checkout-draft rows appear the moment a customer opens the checkout page.
    expect(woocommerceConnector.normalize!(order({ status: "checkout-draft" }), { connectionId: CONN })).toEqual([]);
    expect(woocommerceConnector.normalize!(order({ status: "auto-draft" }), { connectionId: CONN })).toEqual([]);
    expect(woocommerceConnector.normalize!(order({ status: "trash" }), { connectionId: CONN })).toEqual([]);
    // A status the store invented is still an order — an allow-list would drop it.
    const custom = woocommerceConnector.normalize!(order({ status: "awaiting-shipment" }), { connectionId: CONN });
    expect(custom[0].eventType).toBe("order_created");
  });

  it("refuses to invent a date: the deletion payload, the activation ping and anything undated produce nothing", () => {
    // order.deleted carries only the id — no date, no total, nothing to count.
    expect(woocommerceConnector.normalize!({ id: 727 }, { connectionId: CONN, fallbackOccurredAt: new Date("2026-09-07T00:00:00Z") })).toEqual([]);
    // The ping body, if it ever got past verification.
    expect(woocommerceConnector.normalize!({ webhook_id: 12 }, { connectionId: CONN })).toEqual([]);
    expect(woocommerceConnector.normalize!({}, { connectionId: CONN })).toEqual([]);
    expect(woocommerceConnector.normalize!(order({ date_created_gmt: null }), { connectionId: CONN })).toEqual([]);
  });

  it("keeps the order verbatim in properties, money strings and all", () => {
    const [placed] = woocommerceConnector.normalize!(order(), { connectionId: CONN });
    expect(placed.properties).toMatchObject({ total: "29.35", total_tax: "2.00", shipping_total: "4.35", discount_total: "5.00", number: "727" });
  });
});

describe("woocommerce: poll", () => {
  const FIXED = Date.parse("2026-09-10T12:00:00.000Z");
  const clock = { nowMs: () => FIXED };

  it("walks /orders bounded and sorted on the SAME field, in GMT, over Basic auth", async () => {
    const calls = stubFetch([[order()], []], { "x-wp-totalpages": "3" });
    const res = await woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 4, ...clock } });

    const u = new URL(calls[0].url);
    expect(u.origin).toBe("https://shop.example.com");
    expect(u.pathname).toBe("/wp-json/wc/v3/orders");
    // THE WATERMARK RULE: filter and sort are both `modified`.
    expect(u.searchParams.get("orderby")).toBe("modified");
    expect(u.searchParams.get("order")).toBe("asc");
    expect(u.searchParams.get("modified_after")).toBeTruthy();
    expect(u.searchParams.get("after")).toBeNull();
    // Without this the bounds are compared against the store's LOCAL columns.
    expect(u.searchParams.get("dates_are_gmt")).toBe("true");
    expect(u.searchParams.get("per_page")).toBe("50");
    expect(u.searchParams.get("page")).toBe("1");
    // Basic, never the query-string key/secret form.
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("ck_live:cs_live").toString("base64")}`);
    expect(u.searchParams.get("consumer_key")).toBeNull();
    expect(u.searchParams.get("consumer_secret")).toBeNull();

    expect(res.records.map((r) => r.eventId)).toEqual(["woocommerce:conn_1:order:727", "woocommerce:conn_1:order:727:paid"]);
    // The mark is date_modified_gmt — the field the request bounds.
    expect(res.nextCursor).toBe("2026-09-02T08:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
  });

  it("the time bounds are NAIVE — a trailing Z would make WordPress shift them into the store's timezone", async () => {
    const calls = stubFetch([[]], {});
    await woocommerceConnector.poll!({
      connectionId: CONN,
      cursor: "2026-09-02T08:00:00.000Z",
      credentials: CREDS,
      budget: { maxCalls: 1, ...clock },
    });
    const p = new URL(calls[0].url).searchParams;
    // The stored mark minus the five-minute overlap, seconds precision, no Z.
    expect(p.get("modified_after")).toBe("2026-09-02T07:55:00");
    // Frozen at the walk's start; see parseCont.
    expect(p.get("modified_before")).toBe("2026-09-10T12:00:00");
    for (const key of ["modified_after", "modified_before"]) {
      expect(p.get(key)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(p.get(key)!.endsWith("Z")).toBe(false);
    }
  });

  it("a burst larger than one page is fully drained, and the upper bound stays frozen across pages", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      order({ id: 1000 + i, date_modified_gmt: `2026-09-0${1 + Math.floor(i / 25)}T0${i % 9}:00:00` }),
    );
    const calls = stubFetch([page1, [order({ id: 2000, date_modified_gmt: "2026-09-04T08:00:00" })]], { "x-wp-totalpages": "2" });

    const res = await woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 5, ...clock } });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
    // The result set cannot shift under a page walk if its far end is pinned.
    expect(new URL(calls[1].url).searchParams.get("modified_before")).toBe("2026-09-10T12:00:00");
    // 50 orders + 1, each paid, so two events apiece.
    expect(res.records).toHaveLength(102);
    expect(res.nextCursor).toBe("2026-09-04T08:00:00.000Z");
    expect(res.providerCalls).toBe(2);
  });

  it("stops at X-WP-TotalPages instead of spending a request to discover the end", async () => {
    // A full page, but the header says it was the last one.
    const full = Array.from({ length: 50 }, (_, i) => order({ id: 3000 + i, date_paid_gmt: null }));
    const calls = stubFetch([full], { "x-wp-totalpages": "1" });
    const res = await woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 5, ...clock } });
    expect(calls).toHaveLength(1);
    expect(res.records).toHaveLength(50);
    expect(res.incomplete).toBeUndefined();
  });

  it("a page budget of one leaves the walk mid-window with its page and bound in the cursor", async () => {
    const full = Array.from({ length: 50 }, (_, i) => order({ id: 4000 + i, date_paid_gmt: null }));
    stubFetch([full], { "x-wp-totalpages": "9" });
    const res = await woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 1, ...clock } });

    expect(res.incomplete).toBe(true);
    const cursor = JSON.parse(res.nextCursor!) as { cont: string; hw: string | null };
    expect(cursor.hw).toBeNull();
    expect(cursor.cont).toBe(`2|${new Date(FIXED).toISOString()}`);

    // Round trip: the next poll resumes on page 2 of the SAME frozen window,
    // even though the wall clock has moved on.
    vi.unstubAllGlobals();
    const calls = stubFetch([[]], {});
    await woocommerceConnector.poll!({
      connectionId: CONN,
      cursor: res.nextCursor,
      credentials: CREDS,
      budget: { maxCalls: 1, nowMs: () => FIXED + 3_600_000 },
    });
    const p = new URL(calls[0].url).searchParams;
    expect(p.get("page")).toBe("2");
    expect(p.get("modified_before")).toBe("2026-09-10T12:00:00");
  });

  it("a draft row still advances the mark, so the walk never re-reads it forever", async () => {
    stubFetch([[order({ id: 5000, status: "checkout-draft", date_modified_gmt: "2026-09-03T09:00:00" })], []], {});
    const res = await woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 3, ...clock } });
    expect(res.records).toEqual([]);
    expect(res.nextCursor).toBe("2026-09-03T09:00:00.000Z");
  });

  it("the polled order and the delivered one are the SAME rows", async () => {
    stubFetch([[order()], []], {});
    const polled = await woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 3, ...clock } });
    const delivered = woocommerceConnector.normalize!(order(), { connectionId: CONN });
    expect(polled.records.map((r) => r.eventId)).toEqual(delivered.map((r) => r.eventId));
    expect(polled.records.map((r) => r.occurredAt.toISOString())).toEqual(delivered.map((r) => r.occurredAt.toISOString()));
    expect(polled.records.map((r) => r.value)).toEqual(delivered.map((r) => r.value));
  });

  it("names the missing credential rather than failing somewhere in the URL builder", async () => {
    await expect(woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: { storeUrl: STORE } })).rejects.toThrow(
      /consumerKey/,
    );
    await expect(woocommerceConnector.poll!({ connectionId: CONN, cursor: null, credentials: null })).rejects.toThrow(/storeUrl/);
  });

  it("the preview reads the NEWEST orders, not the oldest page of the walk", async () => {
    const calls = stubFetch([[order({ id: 9001 }), order({ id: 9002 })]], {});
    const latest = await woocommerceConnector.testFetchLatest!(2, { connectionId: CONN, cursor: null, credentials: CREDS });
    const p = new URL(calls[0].url).searchParams;
    expect(p.get("order")).toBe("desc");
    expect(p.get("orderby")).toBe("modified");
    expect(p.get("per_page")).toBe("2");
    expect(latest).toHaveLength(2);
  });
});

describe("woocommerce: webhooks", () => {
  it("creates one subscription per topic with a secret WE mint, and joins the ids for teardown", async () => {
    const calls = stubFetch([{ id: 11 }, { id: 12 }]);
    const res = await woocommerceConnector.registerWebhook!({
      connectionId: CONN,
      webhookUrl: "https://app.namzilabs.com/api/webhooks/conn_1",
      credentials: CREDS,
    });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).pathname).toBe("/wp-json/wc/v3/webhooks");
    expect(calls[0].init.method).toBe("POST");

    const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as Record<string, unknown>);
    expect(bodies.map((b) => b["topic"])).toEqual([...WOOCOMMERCE_TOPICS]);
    for (const b of bodies) {
      expect(b["delivery_url"]).toBe("https://app.namzilabs.com/api/webhooks/conn_1");
      expect(b["status"]).toBe("active");
      // Never left to WooCommerce's default, which is an MD5 of a user id.
      expect(typeof b["secret"]).toBe("string");
      expect(b["secret"]).toBe(res.signingSecret);
    }
    // base64url only: WooCommerce runs the secret through wp_specialchars_decode
    // before keying the HMAC, and that alphabet cannot spell an HTML entity.
    expect(res.signingSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.externalId).toBe("11,12");

    // The minted secret verifies a real delivery signed with it.
    const body = JSON.stringify(order());
    expect(
      woocommerceConnector.verifySignature({
        rawBody: body,
        headers: { "x-wc-webhook-signature": sign(body, res.signingSecret!) },
        secret: res.signingSecret,
      }),
    ).toBe(true);
  });

  it("a half-registered connection is torn down rather than left delivering with an unstored secret", async () => {
    const calls = stubThenFail({ id: 11 });
    await expect(
      woocommerceConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app.namzilabs.com/api/webhooks/conn_1", credentials: CREDS }),
    ).rejects.toThrow();
    // create order.created, fail on order.updated, then delete the first.
    expect(calls).toHaveLength(3);
    expect(new URL(calls[2].url).pathname).toBe("/wp-json/wc/v3/webhooks/11");
    expect(calls[2].init.method).toBe("DELETE");
  });

  it("teardown deletes every id with force=true — without it WooCommerce answers 501", async () => {
    const calls = stubFetch([{ id: 11 }, { id: 12 }]);
    await woocommerceConnector.unregisterWebhook!({ connectionId: CONN, credentials: CREDS, externalId: "11,12" });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/wp-json/wc/v3/webhooks/11", "/wp-json/wc/v3/webhooks/12"]);
    for (const c of calls) {
      expect(c.init.method).toBe("DELETE");
      expect(new URL(c.url).searchParams.get("force")).toBe("true");
    }
  });

  it("an already-deleted webhook IS success", async () => {
    stubStatus(404, "Not Found");
    await expect(
      woocommerceConnector.unregisterWebhook!({ connectionId: CONN, credentials: CREDS, externalId: "11,12" }),
    ).resolves.toBeUndefined();
  });
});
