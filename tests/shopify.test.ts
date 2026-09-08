import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { shopifyConnector, shopifyOrderEvents, SHOPIFY_TOPICS } from "@/connectors/shopify";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

const CONN = "conn_1";
const SECRET = "shpss_clientsecret";

/**
 * An order as the REST Admin API returns it, trimmed to the fields that decide
 * anything. Shape and values follow the live example on
 * shopify.dev/docs/api/admin-rest/latest/resources/order (read 8 Sep 2026):
 * `"total_price": "409.94"` — A DECIMAL STRING IN MAJOR UNITS, which is the one
 * fact that would be a 100x revenue error if it were read as minor units.
 */
const order = (over: Record<string, unknown> = {}) => ({
  id: 450789469,
  email: "bob@customer.io",
  created_at: "2026-03-04T05:06:07-04:00",
  processed_at: "2026-03-04T06:00:00-04:00",
  updated_at: "2026-03-05T00:00:00-04:00",
  cancelled_at: null,
  currency: "USD",
  total_price: "409.94",
  total_price_set: {
    shop_money: { amount: "409.94", currency_code: "USD" },
    presentment_money: { amount: "512.43", currency_code: "CAD" },
  },
  financial_status: "paid",
  name: "#1001",
  ...over,
});

const headers = (topic: string) => ({ "x-shopify-topic": topic });

describe("shopify: registration", () => {
  it("is in the catalog and the registry, with dated provenance", () => {
    expect(getConnector("shopify")).toBe(shopifyConnector);
    const e = catalogEntry("shopify")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.brand?.color).toMatch(/^#/);
    expect(e.connect).toBe("apiKey");
  });

  it("asks for the three things Shopify actually splits the job across", () => {
    // Unlike Stripe, the second secret here is unavoidable: Shopify signs with
    // the APP'S CLIENT SECRET and its webhook-create response carries no secret
    // of its own, so there is nothing for us to mint.
    const keys = catalogEntry("shopify")!.credentialFields!.map((f) => f.key).sort();
    expect(keys).toEqual(["accessToken", "apiSecretKey", "shopDomain"]);
  });
});

describe("shopify: signature", () => {
  const body = JSON.stringify(order());
  const sign = (b: string, s = SECRET) => createHmac("sha256", s).update(b).digest("base64");

  it("accepts a base64 HMAC-SHA256 of the raw body, which is what Shopify sends", () => {
    // shopify.dev/docs/apps/build/webhooks/subscribe/https (read 8 Sep 2026):
    // the header is "generated using your app's client secret and the raw
    // request body", base64-encoded.
    const h = { "x-shopify-hmac-sha256": sign(body) };
    expect(shopifyConnector.verifySignature({ rawBody: body, headers: h, secret: SECRET })).toBe(true);
  });

  it("rejects a HEX digest of the same body — the encoding is load-bearing", () => {
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(
      shopifyConnector.verifySignature({ rawBody: body, headers: { "x-shopify-hmac-sha256": hex }, secret: SECRET }),
    ).toBe(false);
  });

  it("rejects a body edited after signing, and a signature from another secret", () => {
    const h = { "x-shopify-hmac-sha256": sign(body) };
    expect(shopifyConnector.verifySignature({ rawBody: body + " ", headers: h, secret: SECRET })).toBe(false);
    expect(
      shopifyConnector.verifySignature({ rawBody: body, headers: { "x-shopify-hmac-sha256": sign(body, "other") }, secret: SECRET }),
    ).toBe(false);
  });

  it("FAILS CLOSED with no secret and with no signature header", () => {
    expect(shopifyConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(false);
    expect(shopifyConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("shopify: money is a decimal string, not minor units", () => {
  it("reads 409.94 as 409.94 — not 40994, and not 4.0994", () => {
    const [ev] = shopifyOrderEvents(order(), CONN);
    expect(ev.value).toBe(409.94);
    expect(ev.currency).toBe("USD");
  });

  it("takes the SHOP's money, not the buyer's presentment currency", () => {
    // Both are on the payload. Shop money is the merchant's own books and the
    // axis their Shopify reports use; mixing the two would sum CAD into USD.
    const [ev] = shopifyOrderEvents(order(), CONN);
    expect(ev.value).not.toBe(512.43);
  });

  it("falls back to the flat total when no money set is present", () => {
    const [ev] = shopifyOrderEvents(order({ total_price_set: undefined }), CONN);
    expect(ev).toMatchObject({ value: 409.94, currency: "USD" });
  });
});

describe("shopify: one order, one event per fact that happened", () => {
  it("a paid order is a creation AND a payment, dated differently", () => {
    const evs = shopifyOrderEvents(order(), CONN);
    const byType = Object.fromEntries(evs.map((e) => [e.eventType, e]));
    expect(Object.keys(byType).sort()).toEqual(["order_created", "payment_succeeded"]);
    // Placed at 05:06 local (-04:00) and processed at 06:00 — two moments, and
    // on a store taking bank transfers they are different DAYS.
    expect(byType.order_created.occurredAt.toISOString()).toBe("2026-03-04T09:06:07.000Z");
    expect(byType.payment_succeeded.occurredAt.toISOString()).toBe("2026-03-04T10:00:00.000Z");
  });

  it("an unpaid order is a creation and nothing else", () => {
    const evs = shopifyOrderEvents(order({ financial_status: "pending" }), CONN);
    expect(evs.map((e) => e.eventType)).toEqual(["order_created"]);
  });

  it("a refunded order still counts the payment that happened before it", () => {
    // `refunded` and `partially_refunded` both mean money DID arrive. Dropping
    // the payment would erase revenue that was genuinely collected.
    for (const status of ["paid", "partially_refunded", "refunded"]) {
      const types = shopifyOrderEvents(order({ financial_status: status }), CONN).map((e) => e.eventType);
      expect(types, status).toContain("payment_succeeded");
    }
  });

  it("a cancellation is its own event, dated when it was cancelled", () => {
    const evs = shopifyOrderEvents(order({ cancelled_at: "2026-03-09T12:00:00-04:00" }), CONN);
    const cancel = evs.find((e) => e.eventType === "order_cancelled")!;
    expect(cancel.occurredAt.toISOString()).toBe("2026-03-09T16:00:00.000Z");
  });

  it("values a refund from the money that actually moved, and null when none did", () => {
    const withRefund = (transactions: unknown[]) =>
      shopifyOrderEvents(
        order({ refunds: [{ id: 9, created_at: "2026-03-10T00:00:00Z", processed_at: "2026-03-10T00:00:00Z", transactions }] }),
        CONN,
      ).find((e) => e.eventType === "payment_refunded");

    const paid = withRefund([{ kind: "refund", status: "success", amount: "10.00", currency: "USD" }]);
    expect(paid?.value).toBe(10);

    // A pending refund is money that has NOT moved. Null, never zero — a refund
    // worth nothing and a refund we could not read must not look the same.
    const pending = withRefund([{ kind: "refund", status: "pending", amount: "10.00", currency: "USD" }]);
    expect(pending?.value).toBeNull();
  });

  it("identifies a guest checkout by its contact email, then by the order name", () => {
    expect(shopifyOrderEvents(order({ email: null }), CONN)[0].subject).toBe("#1001");
    expect(shopifyOrderEvents(order({ email: null, contact_email: "guest@x.io" }), CONN)[0].subject).toBe("guest@x.io");
  });

  it("drops a row with no id or no creation date rather than inventing one", () => {
    expect(shopifyOrderEvents(order({ id: null }), CONN)).toEqual([]);
    expect(shopifyOrderEvents(order({ created_at: null }), CONN)).toEqual([]);
  });
});

describe("shopify: the unsigned topic header decides nothing that matters", () => {
  /**
   * `X-Shopify-Topic` is NOT covered by the HMAC, so a captured body could be
   * replayed under a different topic. That is only safe because every order
   * topic runs the same fan-out and the SIGNED payload decides what is
   * countable — these tests are what keeps it that way.
   */
  it("orders/create and orders/paid produce identical events from one body", () => {
    const body = order();
    const a = shopifyConnector.normalize!(body, { connectionId: CONN, headers: headers("orders/create") });
    const b = shopifyConnector.normalize!(body, { connectionId: CONN, headers: headers("orders/paid") });
    expect(a.map((e) => e.eventId)).toEqual(b.map((e) => e.eventId));
    expect(a.map((e) => e.eventType)).toEqual(b.map((e) => e.eventType));
  });

  it("relabelling an UNPAID order as orders/paid does not invent a payment", () => {
    const body = order({ financial_status: "pending" });
    const evs = shopifyConnector.normalize!(body, { connectionId: CONN, headers: headers("orders/paid") });
    expect(evs.map((e) => e.eventType)).toEqual(["order_created"]);
  });

  it("a delivery with no topic maps to nothing rather than being guessed at", () => {
    expect(shopifyConnector.normalize!(order(), { connectionId: CONN, headers: {} })).toEqual([]);
    expect(shopifyConnector.normalize!(order(), { connectionId: CONN, headers: headers("themes/publish") })).toEqual([]);
  });

  it("every topic we subscribe to is one normalize can actually map", () => {
    // A subscription whose deliveries map to nothing is a promise of data that
    // never arrives — the trap the Smartlead entry was written about.
    const mappable = SHOPIFY_TOPICS.filter((t) => {
      const payload = t.startsWith("orders/")
        ? order()
        : t === "refunds/create"
          ? { id: 9, created_at: "2026-03-10T00:00:00Z", transactions: [{ kind: "refund", status: "success", amount: "1.00" }] }
          : t === "checkouts/create"
            ? { id: 7, created_at: "2026-03-10T00:00:00Z", total_price: "5.00", currency: "USD" }
            : { id: 8, created_at: "2026-03-10T00:00:00Z", email: "c@x.io" };
      return shopifyConnector.normalize!(payload, { connectionId: CONN, headers: headers(t) }).length > 0;
    });
    expect(mappable).toEqual([...SHOPIFY_TOPICS]);
  });
});

describe("shopify: the webhook and the poll agree on identity", () => {
  it("the same order through both doors is one event, not two", () => {
    // The Paddle lesson: a delivery and the reconciliation sweep that follows
    // it must land on one row, or every order counts twice.
    const body = order();
    const fromHook = shopifyConnector.normalize!(body, { connectionId: CONN, headers: headers("orders/create") });
    const fromPoll = shopifyOrderEvents(body, CONN);
    expect(fromHook.map((e) => e.eventId)).toEqual(fromPoll.map((e) => e.eventId));
  });

  it("namespaces every id by source, connection and fact", () => {
    const evs = shopifyOrderEvents(order(), CONN);
    expect(evs[0].eventId).toBe("shopify:conn_1:order:450789469:order_created");
    expect(evs[1].eventId).toBe("shopify:conn_1:order:450789469:payment_succeeded");
  });
});
