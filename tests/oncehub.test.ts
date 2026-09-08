import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { oncehubConnector } from "@/connectors/oncehub";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";

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

const SECRET = "d7686b8c83f04913929079aeae40189e";
const nowSec = () => String(Math.floor(Date.now() / 1000));
const sign = (t: string, body: string) => createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
const header = (t: string, body: string) => `t=${t},s=${sign(t, body)}`;

/** The booking shape from the signature doc's own sample delivery. */
const booking = (over: Record<string, unknown> = {}) => ({
  object: "booking",
  id: "BKNG-YNMGHKQ24XV5",
  tracking_id: "D36E0002",
  subject: "15-minute meeting",
  status: "scheduled",
  in_trash: false,
  creation_time: "2026-09-01T10:00:02Z",
  starting_time: "2026-09-10T14:00:00Z",
  last_updated_time: "2026-09-01T10:00:02Z",
  duration_minutes: 15,
  owner: { id: "USR-YX0J4ANZTV", object: "user", email: "rep@x.io" },
  form_submission: { name: "Carrie", email: "lead@x.io", guests: [], custom_fields: [] },
  ...over,
});

const envelope = (type: string, data: Record<string, unknown>, id = "EVNT-1") => ({
  id,
  object: "event",
  creation_time: "2026-09-03T08:30:00Z",
  type,
  api_version: "v2",
  data,
});

describe("oncehub: registration", () => {
  it("is in the catalog and the registry, connection-scoped, with dated provenance", () => {
    expect(getConnector("oncehub")).toBe(oncehubConnector);
    const e = catalogEntry("oncehub")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.docs?.url).toMatch(/^https:\/\/help\.oncehub\.com\//);
    expect(e.verified).toEqual({ live: null });
    expect(e.flowFields).toBeUndefined();
    // autoWebhook is the whole reason failing closed is safe: a subscription
    // created through the API is v2, and only v2 deliveries are signed.
    expect(e.autoWebhook).toBe(true);
    expect(typeof oncehubConnector.registerWebhook).toBe("function");
    expect(Object.keys(e.rateLimits ?? {})).toEqual([...(oncehubConnector.operations ?? [])]);
  });
});

describe("oncehub: signature", () => {
  const body = JSON.stringify(envelope("booking.scheduled", booking()));

  it("accepts t=,s= hex HMAC-SHA256 over `${t}.${rawBody}`", () => {
    const t = nowSec();
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: { "oncehub-signature": header(t, body) }, secret: SECRET })).toBe(true);
  });
  it("rejects a wrong secret, a missing header, a tampered body, a stale timestamp — and fails closed with no secret", () => {
    const t = nowSec();
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: { "oncehub-signature": header(t, body) }, secret: "not-the-secret" })).toBe(false);
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(oncehubConnector.verifySignature({ rawBody: `${body} `, headers: { "oncehub-signature": header(t, body) }, secret: SECRET })).toBe(false);
    // An hour old: the header's own timestamp is what makes replay detectable.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: { "oncehub-signature": header(old, body) }, secret: SECRET })).toBe(false);
    // An unsigned v1 delivery has no secret stored: rejected, by design.
    expect(oncehubConnector.verifySignature({ rawBody: body, headers: { "oncehub-signature": header(t, body) }, secret: null })).toBe(false);
  });
});

describe("oncehub: normalize", () => {
  const one = (type: string, over: Record<string, unknown> = {}, id?: string) =>
    oncehubConnector.normalize!(envelope(type, booking(over), id), { connectionId: CONN })[0];

  it("booking.scheduled is `booked`, dated by the booking's creation_time, with the form email as subject", () => {
    const ev = one("booking.scheduled");
    expect(ev).toMatchObject({ eventId: "oncehub:conn_1:BKNG-YNMGHKQ24XV5", eventType: "booked", subject: "lead@x.io" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:02.000Z");
    // The slot is a fact about the future; it stays in properties.
    expect(ev.properties).toMatchObject({ starting_time: "2026-09-10T14:00:00Z", owner: { email: "rep@x.io" } });
  });

  it("booking.canceled is `canceled` at the EVENT's creation_time, not the booking's", () => {
    const ev = one("booking.canceled", { status: "canceled" }, "EVNT-2");
    expect(ev).toMatchObject({ eventId: "oncehub:conn_1:BKNG-YNMGHKQ24XV5:canceled", eventType: "canceled" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-03T08:30:00.000Z");
  });

  it("a cancel that only INVITES a reschedule is still a cancellation", () => {
    const ev = one("booking.canceled_reschedule_requested", { status: "canceled" }, "EVNT-3");
    expect(ev).toMatchObject({ eventId: "oncehub:conn_1:BKNG-YNMGHKQ24XV5:canceled", eventType: "canceled" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-03T08:30:00.000Z");
  });

  it("both reschedule flavours are `rescheduled` at the event's creation_time", () => {
    for (const type of ["booking.rescheduled", "booking.canceled_then_rescheduled"]) {
      const ev = one(type, { status: "rescheduled" }, "EVNT-4");
      expect(ev).toMatchObject({ eventId: "oncehub:conn_1:BKNG-YNMGHKQ24XV5:rescheduled", eventType: "rescheduled" });
      expect(ev.occurredAt.toISOString()).toBe("2026-09-03T08:30:00.000Z");
    }
  });

  it("booking.completed is `meeting_held` at starting_time — the meeting happened at its slot, not when the webhook fired", () => {
    const ev = one("booking.completed", { status: "completed" }, "EVNT-5");
    expect(ev).toMatchObject({ eventId: "oncehub:conn_1:BKNG-YNMGHKQ24XV5:held", eventType: "meeting_held" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-10T14:00:00.000Z");
  });

  it("booking.no_show is `no_show` at starting_time", () => {
    const ev = one("booking.no_show", { status: "no_show" }, "EVNT-6");
    expect(ev).toMatchObject({ eventId: "oncehub:conn_1:BKNG-YNMGHKQ24XV5:no_show", eventType: "no_show" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-10T14:00:00.000Z");
  });

  it("a Stripe-collected charge is minor → major units on `booked` only", () => {
    const paid = { payment_information: { amount_charged: 5000, currency: "usd", transaction_id: "ch_1" } };
    expect(one("booking.scheduled", paid)).toMatchObject({ value: 50, currency: "USD" });
    // Zero-decimal currencies are not divided.
    expect(one("booking.scheduled", { payment_information: { amount_charged: 5000, currency: "JPY" } })).toMatchObject({ value: 5000, currency: "JPY" });
    // The same booking's cancellation carries no money, or the pair double-counts.
    expect(one("booking.canceled", { ...paid, status: "canceled" }, "EVNT-7")).toMatchObject({ value: null, currency: null });
  });

  it("a reassignment and the chatbot conversation family are not counted", () => {
    expect(oncehubConnector.normalize!(envelope("booking.reassigned", booking()), { connectionId: CONN })).toEqual([]);
    expect(oncehubConnector.normalize!(envelope("conversation.started", {}), { connectionId: CONN })).toEqual([]);
  });
});

describe("oncehub: poll", () => {
  it("lists /v2/bookings behind the API-Key header, bounded on last_updated_time, and settles on the newest one", async () => {
    const calls = stubFetch([
      {
        object: "list",
        data: [booking(), booking({ id: "BKNG-2", status: "canceled", creation_time: "2026-09-02T09:00:00Z", last_updated_time: "2026-09-04T11:30:00Z" })],
        has_more: false,
      },
    ]);
    const res = await oncehubConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });

    expect(res.records.map((r) => r.eventId)).toEqual([
      "oncehub:conn_1:BKNG-YNMGHKQ24XV5",
      "oncehub:conn_1:BKNG-2",
      "oncehub:conn_1:BKNG-2:canceled",
    ]);
    expect(res.records.map((r) => r.eventType)).toEqual(["booked", "booked", "canceled"]);
    // booked is dated by creation_time; the cancellation by last_updated_time.
    expect(res.records[1].occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    expect(res.records[2].occurredAt.toISOString()).toBe("2026-09-04T11:30:00.000Z");
    // The mark is the newest value of the field the request BOUNDED on.
    expect(res.nextCursor).toBe("2026-09-04T11:30:00.000Z");
    expect(res.providerCalls).toBe(1);

    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.oncehub.com/v2/bookings");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("expand")).toBe("owner");
    expect(u.searchParams.get("last_updated_time.gt")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(u.searchParams.has("creation_time.gt")).toBe(false);
    expect(u.searchParams.has("after")).toBe(false);
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("K");
  });

  it("follows has_more with `after` = the last row's id, and the settled mark spans both pages", async () => {
    const calls = stubFetch([
      { object: "list", data: [booking({ id: "BKNG-A", last_updated_time: "2026-09-05T00:00:00Z" })], has_more: true },
      { object: "list", data: [booking({ id: "BKNG-B", last_updated_time: "2026-09-04T00:00:00Z" })], has_more: false },
    ]);
    const res = await oncehubConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("BKNG-A");
    expect(res.records.map((r) => r.eventId)).toEqual(["oncehub:conn_1:BKNG-A", "oncehub:conn_1:BKNG-B"]);
    expect(res.nextCursor).toBe("2026-09-05T00:00:00.000Z");
    expect(res.providerCalls).toBe(2);
  });

  it("a stored mark bounds the next request, minus the overlap", async () => {
    const calls = stubFetch([{ object: "list", data: [], has_more: false }]);
    await oncehubConnector.poll!({ connectionId: CONN, cursor: "2026-09-04T12:00:00.000Z", credentials: { apiKey: "K" } });
    expect(new URL(calls[0].url).searchParams.get("last_updated_time.gt")).toBe("2026-09-04T11:55:00.000Z");
  });

  it("a booking still awaiting approval is not booked yet, but its mark still advances", async () => {
    stubFetch([
      {
        object: "list",
        data: [booking({ id: "BKNG-R", status: "requested", last_updated_time: "2026-09-06T07:00:00Z" })],
        has_more: false,
      },
    ]);
    const res = await oncehubConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });
    expect(res.records).toEqual([]);
    expect(res.nextCursor).toBe("2026-09-06T07:00:00.000Z");
  });

  it("held and no-showed bookings are dated by their slot, and a paid booking's charge lands on `booked`", async () => {
    stubFetch([
      {
        object: "list",
        data: [
          booking({ id: "BKNG-H", status: "completed", payment_information: { amount_charged: 12_500, currency: "EUR" } }),
          booking({ id: "BKNG-N", status: "no_show", starting_time: "2026-09-09T08:00:00Z" }),
        ],
        has_more: false,
      },
    ]);
    const res = await oncehubConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });
    const byId = new Map(res.records.map((r) => [r.eventId, r]));
    expect(byId.get("oncehub:conn_1:BKNG-H")).toMatchObject({ eventType: "booked", value: 125, currency: "EUR" });
    expect(byId.get("oncehub:conn_1:BKNG-H:held")!.occurredAt.toISOString()).toBe("2026-09-10T14:00:00.000Z");
    expect(byId.get("oncehub:conn_1:BKNG-N:no_show")!.occurredAt.toISOString()).toBe("2026-09-09T08:00:00.000Z");
  });
});

describe("oncehub: webhook subscription", () => {
  it("creates a v2 subscription named for the connection and keeps the secret it mints", async () => {
    const calls = stubFetch([{ object: "webhook", id: "WHK-7JD9LBVZTQ", api_version: "v2", secret: SECRET }]);
    const res = await oncehubConnector.registerWebhook!({
      connectionId: CONN,
      webhookUrl: "https://app.namzilabs.com/api/webhooks/oncehub/conn_1",
      credentials: { apiKey: "K" },
    });

    expect(res).toEqual({ signingSecret: SECRET, externalId: "WHK-7JD9LBVZTQ" });
    expect(calls[0].url).toBe("https://api.oncehub.com/v2/webhooks");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.url).toBe("https://app.namzilabs.com/api/webhooks/oncehub/conn_1");
    expect(body.name).toBe("Namzilabs conn_1");
    expect(body.events).toEqual([
      "booking.scheduled",
      "booking.rescheduled",
      "booking.canceled_then_rescheduled",
      "booking.canceled_reschedule_requested",
      "booking.canceled",
      "booking.completed",
      "booking.no_show",
    ]);
  });

  it("tears the subscription down by id", async () => {
    const calls = stubFetch([{}]);
    await oncehubConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "K" }, externalId: "WHK-7JD9LBVZTQ" });
    expect(calls[0].url).toBe("https://api.oncehub.com/v2/webhooks/WHK-7JD9LBVZTQ");
    expect(calls[0].init.method).toBe("DELETE");
  });
});
