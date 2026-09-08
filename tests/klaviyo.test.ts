import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { klaviyoConnector, klaviyoEvent, klaviyoEventType } from "@/connectors/klaviyo";
import { catalogEntry, isStreamScoped } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

const CONN = "conn_1";
const SECRET = "a-secret-of-at-least-16-chars";

/**
 * One row of `GET /api/events`, in the JSON:API shape the endpoint returns
 * (developers.klaviyo.com/en/reference/get_events, read 8 Sep 2026). `metric`
 * and `email` are the two facts the walk lifts out of the `included` compound
 * document and carries alongside the event.
 */
const row = (over: Record<string, unknown> = {}, metric: string | null = "Placed Order", email: string | null = "buyer@x.io") => ({
  event: {
    id: "ev_1",
    attributes: {
      datetime: "2026-03-04T05:06:07+00:00",
      timestamp: 1_772_600_767,
      uuid: "u-1",
      event_properties: { $value: 24.99, $value_currency: "usd", OrderId: "#1001" },
      ...over,
    },
    relationships: {
      metric: { data: { type: "metric", id: "m_1" } },
      profile: { data: { type: "profile", id: "p_1" } },
    },
  },
  metric,
  email,
});

describe("klaviyo: registration", () => {
  it("is in the catalog and the registry, with dated provenance", () => {
    expect(getConnector("klaviyo")).toBe(klaviyoConnector);
    const e = catalogEntry("klaviyo")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.brand?.color).toMatch(/^#/);
    expect(e.connect).toBe("apiKey");
  });

  it("asks for ONE credential, because we mint the webhook secret ourselves", () => {
    // Klaviyo's create-webhook call takes a `secret_key` WE supply, so there is
    // nothing to copy back out of their UI — the Stripe lesson, applied.
    expect(catalogEntry("klaviyo")!.credentialFields!.map((f) => f.key)).toEqual(["apiKey"]);
  });

  it("is stream-scoped on the metric, which makes its webhook a doorbell", () => {
    expect(isStreamScoped("klaviyo")).toBe(true);
    // And so it must carry no `normalize`: on a stream-scoped source the route
    // rings and drops the body, so a mapper here could never run and would
    // silently disagree with the poll.
    expect(klaviyoConnector.normalize).toBeUndefined();
  });
});

describe("klaviyo: signature", () => {
  const body = JSON.stringify({ data: { id: "ev_1" } });
  const ts = new Date().toUTCString();
  /**
   * BODY FIRST, THEN TIMESTAMP, hex. Klaviyo's own sample seeds the HMAC with
   * the body and then updates it with the timestamp:
   *
   *   computed_signature = hmac.new(hmac_secret, message_body, hashlib.sha256)
   *   computed_signature.update(message_timestamp.encode())
   *
   * (developers.klaviyo.com/en/docs/working_with_system_webhooks, read 8 Sep
   * 2026.) The Stripe/Paddle instinct — `${ts}${body}`, with a separator — is
   * a different string and fails every real delivery.
   */
  const sign = (b: string, t: string, s = SECRET) => createHmac("sha256", s).update(`${b}${t}`).digest("hex");
  const hdrs = (b: string, t: string, extra: Record<string, string> = {}) => ({
    "klaviyo-signature": sign(b, t),
    "klaviyo-timestamp": t,
    ...extra,
  });

  it("accepts the documented body-then-timestamp hex digest", () => {
    expect(klaviyoConnector.verifySignature({ rawBody: body, headers: hdrs(body, ts), secret: SECRET })).toBe(true);
  });

  it("rejects the timestamp-then-body order, which is the easy mistake", () => {
    const wrong = createHmac("sha256", SECRET).update(`${ts}${body}`).digest("hex");
    expect(
      klaviyoConnector.verifySignature({
        rawBody: body,
        headers: { "klaviyo-signature": wrong, "klaviyo-timestamp": ts },
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a base64 digest of the right message — the encoding is hex", () => {
    const b64 = createHmac("sha256", SECRET).update(`${body}${ts}`).digest("base64");
    expect(
      klaviyoConnector.verifySignature({
        rawBody: body,
        headers: { "klaviyo-signature": b64, "klaviyo-timestamp": ts },
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("FAILS CLOSED with no secret, no signature, and no timestamp", () => {
    expect(klaviyoConnector.verifySignature({ rawBody: body, headers: hdrs(body, ts), secret: null })).toBe(false);
    expect(klaviyoConnector.verifySignature({ rawBody: body, headers: { "klaviyo-timestamp": ts }, secret: SECRET })).toBe(false);
    expect(
      klaviyoConnector.verifySignature({ rawBody: body, headers: { "klaviyo-signature": sign(body, ts) }, secret: SECRET }),
    ).toBe(false);
  });

  it("refuses a replay signed hours ago, even though its HMAC is perfect", () => {
    const old = new Date(Date.now() - 6 * 3_600_000).toUTCString();
    expect(klaviyoConnector.verifySignature({ rawBody: body, headers: hdrs(body, old), secret: SECRET })).toBe(false);
  });

  it("refuses a delivery whose webhook id header contradicts its signed body", () => {
    // Klaviyo names this cross-check itself as a sign of "potential malicious
    // activity". It only bites when both halves are present — the HMAC already
    // binds the body, so an absent header is not evidence of anything.
    const signed = JSON.stringify({ meta: { klaviyo_webhook_id: "wh_real" } });
    const t = new Date().toUTCString();
    expect(
      klaviyoConnector.verifySignature({
        rawBody: signed,
        headers: { ...hdrs(signed, t), "klaviyo-webhook-id": "wh_other" },
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      klaviyoConnector.verifySignature({
        rawBody: signed,
        headers: { ...hdrs(signed, t), "klaviyo-webhook-id": "wh_real" },
        secret: SECRET,
      }),
    ).toBe(true);
  });
});

describe("klaviyo: an event is dated and valued from the fields that carry those facts", () => {
  it("dates by `datetime`, the same field the request filters on", () => {
    const ev = klaviyoEvent(row(), CONN)!;
    expect(ev.occurredAt.toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  it("falls back to the epoch `timestamp`, which is the same instant in another encoding", () => {
    const ev = klaviyoEvent(row({ datetime: null }), CONN)!;
    expect(ev.occurredAt.getTime()).toBe(1_772_600_767_000);
  });

  it("drops a row it cannot date rather than stamping it with now", () => {
    expect(klaviyoEvent(row({ datetime: null, timestamp: null }), CONN)).toBeNull();
  });

  it("reads $value as money without dividing, and uppercases the currency", () => {
    const ev = klaviyoEvent(row(), CONN)!;
    expect(ev.value).toBe(24.99);
    expect(ev.currency).toBe("USD");
  });

  it("accepts a stringified $value from a sloppy integration", () => {
    expect(klaviyoEvent(row({ event_properties: { $value: "9.99" } }), CONN)!.value).toBe(9.99);
  });

  it("leaves value NULL when there is none — unknown is not zero", () => {
    // Klaviyo ignores event properties set to 0 "as if they were never set", so
    // an absent $value is the only way a zero-value order can look. Storing 0
    // would put a fabricated number into a revenue sum.
    const ev = klaviyoEvent(row({ event_properties: { OrderId: "#1" } }), CONN)!;
    expect(ev.value).toBeNull();
    expect(ev.currency).toBeNull();
  });

  it("never invents a currency the payload did not carry", () => {
    const ev = klaviyoEvent(row({ event_properties: { $value: 5 } }), CONN)!;
    expect(ev.value).toBe(5);
    expect(ev.currency).toBeNull();
  });

  it("identifies the person by email, falling back to the profile id", () => {
    expect(klaviyoEvent(row(), CONN)!.subject).toBe("buyer@x.io");
    expect(klaviyoEvent(row({}, "Placed Order", null), CONN)!.subject).toBe("p_1");
  });

  it("keeps the customer's own properties nested, so they cannot collide with ours", () => {
    const ev = klaviyoEvent(row({ event_properties: { metric: "not-ours", email: "not-ours" } }), CONN)!;
    expect(ev.properties!.metric).toBe("Placed Order");
    expect(ev.properties!.email).toBe("buyer@x.io");
    expect((ev.properties!.event_properties as Record<string, unknown>).metric).toBe("not-ours");
  });

  it("namespaces the id by source and connection, and nothing else", () => {
    // A Klaviyo event id is unique account-wide, so unlike a spreadsheet row
    // there is nothing for a stream to disambiguate.
    expect(klaviyoEvent(row(), CONN)!.eventId).toBe("klaviyo:conn_1:ev_1");
  });
});

describe("klaviyo: the metric name becomes the event type", () => {
  it("slugs a metric name into a stable type", () => {
    expect(klaviyoEventType("Placed Order")).toBe("placed_order");
    expect(klaviyoEventType("Ordered Product!")).toBe("ordered_product");
    expect(klaviyoEventType("  Active on Site  ")).toBe("active_on_site");
  });

  it("never produces an empty type", () => {
    expect(klaviyoEventType(null)).toBe("klaviyo_event");
    expect(klaviyoEventType("!!!")).toBe("klaviyo_event");
  });

  it("is stable for one metric across rows, which is what dedup and filters need", () => {
    expect(klaviyoEvent(row(), CONN)!.eventType).toBe("placed_order");
    expect(klaviyoEvent(row({ id: "ev_2" }, "Placed Order"), CONN)!.eventType).toBe("placed_order");
  });
});
