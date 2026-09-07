import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { calcomConnector } from "@/connectors/calcom";
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

const SECRET = "cal_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const booking = (over: Record<string, unknown> = {}) => ({
  uid: "bk_1",
  status: "accepted",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  start: "2026-09-10T14:00:00.000Z",
  end: "2026-09-10T14:30:00.000Z",
  attendees: [{ email: "lead@x.io", name: "Lead" }],
  eventType: { id: 7, slug: "intro" },
  ...over,
});
/** A webhook delivery: booking fields under `payload`, with the webhook-era names (startTime/endTime), no booking createdAt. */
const delivery = (triggerEvent: string, payload: Record<string, unknown>, createdAt = "2026-09-01T10:00:05.000Z") => ({ triggerEvent, createdAt, payload });

describe("calcom: registration", () => {
  it("is in the catalog and the registry with dated provenance", () => {
    expect(getConnector("calcom")).toBe(calcomConnector);
    const e = catalogEntry("calcom")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.autoWebhook).toBe(true);
  });
});

describe("calcom: signature", () => {
  it("hex HMAC over the raw body in x-cal-signature-256; fails closed", () => {
    const body = JSON.stringify(delivery("BOOKING_CREATED", { uid: "bk_1" }));
    expect(calcomConnector.verifySignature({ rawBody: body, headers: { "x-cal-signature-256": sign(body) }, secret: SECRET })).toBe(true);
    expect(calcomConnector.verifySignature({ rawBody: body, headers: { "x-cal-signature-256": sign(body) }, secret: null })).toBe(false);
    expect(calcomConnector.verifySignature({ rawBody: body + " ", headers: { "x-cal-signature-256": sign(body) }, secret: SECRET })).toBe(false);
    expect(calcomConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
  });
});

describe("calcom: normalize", () => {
  it("BOOKING_CREATED is booked, dated by the delivery's createdAt (the booking's own arrives with the poll), keyed by uid", () => {
    const [ev] = calcomConnector.normalize!(delivery("BOOKING_CREATED", { uid: "bk_1", startTime: "2026-09-10T14:00:00Z", endTime: "2026-09-10T14:30:00Z", status: "ACCEPTED", attendees: [{ email: "lead@x.io" }] }), { connectionId: CONN });
    expect(ev).toMatchObject({ eventId: "calcom:conn_1:bk_1", eventType: "booked", subject: "lead@x.io" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:05.000Z");
    expect(ev.properties).toMatchObject({ startTime: "2026-09-10T14:00:00Z" });
  });
  it("cancelled, rescheduled, no-show carry their own ids; MEETING_ENDED is flat and dated by endTime; noise is dropped", () => {
    const [c] = calcomConnector.normalize!(delivery("BOOKING_CANCELLED", { uid: "bk_1", cancellationReason: "sick" }, "2026-09-02T09:00:00.000Z"), { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "calcom:conn_1:bk_1:canceled", eventType: "canceled" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    const [r] = calcomConnector.normalize!(delivery("BOOKING_RESCHEDULED", { uid: "bk_2", rescheduleUid: "bk_1" }, "2026-09-03T09:00:00.000Z"), { connectionId: CONN });
    expect(r).toMatchObject({ eventId: "calcom:conn_1:bk_2:rescheduled", eventType: "rescheduled" });
    const [n] = calcomConnector.normalize!(delivery("BOOKING_NO_SHOW_UPDATED", { uid: "bk_1", attendees: [{ email: "lead@x.io", noShow: true }] }, "2026-09-10T14:05:00.000Z"), { connectionId: CONN });
    expect(n).toMatchObject({ eventId: "calcom:conn_1:bk_1:no_show", eventType: "no_show" });
    const [m] = calcomConnector.normalize!({ triggerEvent: "MEETING_ENDED", createdAt: "2026-09-10T14:31:00.000Z", uid: "bk_1", endTime: "2026-09-10T14:30:00.000Z", attendees: [{ email: "lead@x.io" }] }, { connectionId: CONN });
    expect(m).toMatchObject({ eventId: "calcom:conn_1:bk_1:held", eventType: "meeting_held", subject: "lead@x.io" });
    expect(m.occurredAt.toISOString()).toBe("2026-09-10T14:30:00.000Z");
    expect(calcomConnector.normalize!(delivery("RECORDING_READY", { uid: "bk_1" }), { connectionId: CONN })).toEqual([]);
  });
});

describe("calcom: poll", () => {
  it("walks bookings by afterUpdatedAt with the pinned api version, follows the cursor, emits booked/canceled/rescheduled, settles on the newest updatedAt", async () => {
    const calls = stubFetch([
      { data: [booking()], pagination: { nextCursor: "c2", hasMore: true } },
      { data: [booking({ uid: "bk_9", status: "cancelled", updatedAt: "2026-09-02T09:00:00.000Z" }), booking({ uid: "bk_3", rescheduledFromUid: "bk_1", createdAt: "2026-09-03T09:00:00.000Z", updatedAt: "2026-09-03T09:00:00.000Z" })], pagination: { nextCursor: null, hasMore: false } },
    ]);
    const res = await calcomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "cal_key" } });
    expect(res.records.map((r) => `${r.eventType}@${r.occurredAt.toISOString()}`).sort()).toEqual([
      "booked@2026-09-01T10:00:00.000Z",
      "booked@2026-09-01T10:00:00.000Z",
      "booked@2026-09-03T09:00:00.000Z",
      "canceled@2026-09-02T09:00:00.000Z",
      "rescheduled@2026-09-03T09:00:00.000Z",
    ]);
    expect(res.nextCursor).toBe("2026-09-03T09:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v2/bookings");
    expect(u.searchParams.get("sortUpdatedAt")).toBe("asc");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("afterUpdatedAt")).toMatch(/^\d{4}-/);
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe("c2");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["cal-api-version"]).toBe(calcomConnector.apiVersion);
    expect(h.authorization).toBe("Bearer cal_key");
  });
  it("honours a self-hosted base URL", async () => {
    const calls = stubFetch([{ data: [], pagination: { hasMore: false } }]);
    await calcomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k", baseUrl: "https://cal.acme.io/api/v2" } });
    expect(calls[0].url.startsWith("https://cal.acme.io/api/v2/bookings?")).toBe(true);
  });
  it("registers and removes a webhook with our secret", async () => {
    const calls = stubFetch([{ status: "success", data: { id: 42 } }, {}]);
    const reg = await calcomConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "k" } });
    expect(reg.externalId).toBe("42");
    expect(reg.signingSecret).toMatch(/^whsec_/);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ subscriberUrl: "https://app/api/webhooks/conn_1", active: true, triggers: expect.arrayContaining(["BOOKING_CREATED", "MEETING_ENDED"]) });
    await calcomConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "k" }, externalId: "42" });
    expect(calls[1].init.method).toBe("DELETE");
    expect(new URL(calls[1].url).pathname).toBe("/v2/webhooks/42");
  });
});
