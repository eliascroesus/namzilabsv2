import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { customerioConnector } from "@/connectors/customerio";
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

const SECRET = "cio_signing_key";
const AT = 1_788_688_800; // unix SECONDS = 2026-09-06T10:00:00Z; "the timestamp at which the event being reported took place"
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (ts: string, body: string) => createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");

const delivery = (object_type: string, metric: string, over: Record<string, unknown> = {}) => ({
  event_id: "01H",
  object_type,
  metric,
  timestamp: AT,
  data: { customer_id: "c1", identifiers: { id: "42", email: "u@x.io", cio_id: "d9c1" }, delivery_id: "d1", campaign_id: 7, subject: "Hi" },
  ...over,
});

describe("customerio: registration", () => {
  it("is in the catalog and the registry, webhook-only, with dated provenance and a pasted signing key", () => {
    expect(getConnector("customerio")).toBe(customerioConnector);
    const e = catalogEntry("customerio")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.docs?.url).toMatch(/^https:\/\//);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toMatchObject({ short: "Ci" });
    // The whole shape of this source: deliveries arrive, nothing is ever fetched.
    expect(e.instant).toBe(true);
    expect(e.poll).toBe(false);
    expect(e.sync).toBe("webhook-only");
    expect(e.autoWebhook).toBe(false);
    expect(customerioConnector.poll).toBeUndefined();
    expect(customerioConnector.listOptions).toBeUndefined();
    expect(e.flowFields).toBeUndefined();
    // instant + !autoWebhook ⇒ the customer pastes the key, so the field and
    // the sentence telling them where to find it both have to exist.
    expect(e.credentialFields.map((f) => f.key)).toEqual(["webhookSecret"]);
    expect(e.webhookSetup).toContain("Reporting webhooks");
    expect(e.syncNote).toMatch(/pixel/i);
    // One account-wide bucket, and nothing claims against it: no poll exists.
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["*"]);
    expect(customerioConnector.operations).toBeUndefined();
  });
});

describe("customerio: signature", () => {
  it("hex HMAC-SHA256 over `v0:{X-CIO-Timestamp}:{raw body}`, fresh timestamp only, and fails closed", () => {
    const body = JSON.stringify(delivery("email", "delivered"));
    const ts = String(nowSec());
    const ok = { rawBody: body, headers: { "x-cio-signature": sign(ts, body), "x-cio-timestamp": ts }, secret: SECRET };
    expect(customerioConnector.verifySignature(ok)).toBe(true);
    // No secret is never an accept — the one rule that has no exception.
    expect(customerioConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(customerioConnector.verifySignature({ ...ok, secret: "cio_other_key" })).toBe(false);
    expect(customerioConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    // The signature header alone is not enough: without the timestamp there is
    // nothing to build the signed string from, and no replay window.
    expect(customerioConnector.verifySignature({ ...ok, headers: { "x-cio-signature": sign(ts, body) } })).toBe(false);
    // Tampered body: the same signature over one more byte.
    expect(customerioConnector.verifySignature({ ...ok, rawBody: `${body} ` })).toBe(false);
    // A correctly signed delivery from an hour ago is a replay, not a delivery.
    const old = String(nowSec() - 3600);
    expect(
      customerioConnector.verifySignature({ rawBody: body, headers: { "x-cio-signature": sign(old, body), "x-cio-timestamp": old }, secret: SECRET }),
    ).toBe(false);
    // The timestamp is INSIDE the signed string, so signing v0:a: and sending b
    // cannot pass — this is what stops a captured signature being re-dated.
    expect(
      customerioConnector.verifySignature({ rawBody: body, headers: { "x-cio-signature": sign(old, body), "x-cio-timestamp": ts }, secret: SECRET }),
    ).toBe(false);
  });
});

describe("customerio: normalize", () => {
  it("maps object_type + metric to a channel-prefixed type at the reported timestamp", () => {
    const cases: Array<[string, string, string]> = [
      ["email", "sent", "email_sent"],
      ["email", "delivered", "email_delivered"],
      ["email", "opened", "email_opened"],
      ["email", "clicked", "email_clicked"],
      ["email", "converted", "email_converted"],
      ["sms", "replied", "sms_replied"],
      ["sms", "delivered", "sms_delivered"],
      ["push", "opened", "push_opened"],
      // `in-app` is the one hyphenated object_type; event types stay snake_case.
      ["in-app", "clicked", "in_app_clicked"],
    ];
    for (const [object, metric, ours] of cases) {
      const [ev] = customerioConnector.normalize!(delivery(object, metric, { event_id: `${object}_${metric}` }), { connectionId: CONN });
      expect(ev, `${object}.${metric}`).toMatchObject({
        eventId: `customerio:conn_1:${object}_${metric}`,
        eventType: ours,
        subject: "u@x.io",
      });
      expect(ev.occurredAt.toISOString()).toBe("2026-09-06T10:00:00.000Z");
      expect(ev.properties).toMatchObject({ channel: ours.slice(0, ours.lastIndexOf("_")), data: { delivery_id: "d1", campaign_id: 7 } });
    }
  });

  it("customer-level and failure metrics carry no channel prefix — a bounce is a bounce on any channel", () => {
    const cases: Array<[string, string, string]> = [
      ["customer", "subscribed", "subscribed"],
      ["customer", "unsubscribed", "unsubscribed"],
      ["email", "unsubscribed", "unsubscribed"],
      ["email", "bounced", "bounced"],
      ["sms", "bounced", "bounced"],
      ["email", "spammed", "spammed"],
      ["push", "dropped", "dropped"],
      ["slack", "failed", "failed"],
      ["webhook", "undeliverable", "undeliverable"],
    ];
    for (const [object, metric, ours] of cases) {
      const [ev] = customerioConnector.normalize!(delivery(object, metric, { event_id: `${object}_${metric}` }), { connectionId: CONN });
      expect(ev, `${object}.${metric}`).toMatchObject({ eventId: `customerio:conn_1:${object}_${metric}`, eventType: ours });
      expect(ev.occurredAt.toISOString()).toBe("2026-09-06T10:00:00.000Z");
    }
  });

  it("names the person by identifiers.email, then the customer-level fallbacks", () => {
    const noEmail = (data: Record<string, unknown>) =>
      customerioConnector.normalize!({ event_id: "e", object_type: "customer", metric: "subscribed", timestamp: AT, data }, { connectionId: CONN })[0];
    expect(noEmail({ identifiers: { email: "u@x.io", id: "42" }, customer_id: "c1" }).subject).toBe("u@x.io");
    expect(noEmail({ identifiers: { id: "42" }, email_address: "legacy@x.io", customer_id: "c1" }).subject).toBe("legacy@x.io");
    expect(noEmail({ identifiers: { id: "42" }, recipient: "to@x.io", customer_id: "c1" }).subject).toBe("to@x.io");
    expect(noEmail({ identifiers: { id: "42" }, customer_id: "c1" }).subject).toBe("c1");
    expect(noEmail({ identifiers: { id: "42" } }).subject).toBe("42");
  });

  it("drops the internal pipeline stages and anything outside the documented vocabulary", () => {
    // `drafted` and `attempted` are Customer.io deciding to build a message and
    // handing it to a provider — nothing happened to a customer yet.
    expect(customerioConnector.normalize!(delivery("email", "drafted"), { connectionId: CONN })).toEqual([]);
    expect(customerioConnector.normalize!(delivery("email", "attempted"), { connectionId: CONN })).toEqual([]);
    expect(customerioConnector.normalize!(delivery("email", "teleported"), { connectionId: CONN })).toEqual([]);
    expect(customerioConnector.normalize!(delivery("email", "delivered", { event_id: undefined }), { connectionId: CONN })).toEqual([]);
    expect(customerioConnector.normalize!(delivery("email", "delivered", { object_type: undefined }), { connectionId: CONN })).toEqual([]);
    expect(customerioConnector.normalize!({}, { connectionId: CONN })).toEqual([]);
  });

  it("falls back to the delivery moment the CALLER supplies when the payload has no timestamp", () => {
    const fallback = new Date("2026-09-08T09:00:00.000Z");
    const [ev] = customerioConnector.normalize!(delivery("email", "delivered", { timestamp: undefined }), { connectionId: CONN, fallbackOccurredAt: fallback });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-08T09:00:00.000Z");
  });
});

describe("customerio: no read path", () => {
  it("never talks to the provider — there is no poll, so nothing can be fetched", async () => {
    const calls = stubFetch([{ activities: [] }]);
    customerioConnector.normalize!(delivery("email", "delivered"), { connectionId: CONN });
    customerioConnector.verifySignature({ rawBody: "{}", headers: {}, secret: SECRET });
    expect(calls).toHaveLength(0);
    // The four optional read-path hooks a polling connector would carry.
    expect(customerioConnector.poll).toBeUndefined();
    expect(customerioConnector.testFetchLatest).toBeUndefined();
    expect(customerioConnector.registerWebhook).toBeUndefined();
    expect(customerioConnector.retention).toBeUndefined();
  });
});
