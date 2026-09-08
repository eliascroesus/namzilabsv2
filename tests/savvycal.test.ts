import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { savvycalConnector } from "@/connectors/savvycal";
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

const SECRET = "sc_secret";
/** Elixir's `Base.encode16()` — what SavvyCal's own sample produces — is UPPERCASE. */
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex").toUpperCase()}`;

const ev = (over: Record<string, unknown> = {}) => ({
  id: "event_1",
  state: "confirmed",
  created_at: "2026-09-01T10:00:00Z",
  start_at: "2026-09-10T14:00:00Z",
  end_at: "2026-09-10T14:30:00Z",
  canceled_at: null,
  rescheduled_at: null,
  cancel_reason: null,
  attendees: [
    { email: "host@x.io", is_organizer: true },
    { email: "lead@x.io", is_organizer: false },
  ],
  payment: { amount_total: 5000, state: "paid", url: "https://dashboard.stripe.com/x" },
  ...over,
});
const hook = (type: string, payload: Record<string, unknown>) => ({
  type,
  id: "payload_1",
  occurred_at: "2026-09-05T12:00:00Z",
  payload,
  version: "2024-01-15",
});

describe("savvycal: registration", () => {
  it("is in the catalog and the registry with dated provenance and one declared endpoint", () => {
    expect(getConnector("savvycal")).toBe(savvycalConnector);
    const e = catalogEntry("savvycal")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
    expect(e.instant && !e.autoWebhook).toBe(true);
    expect(e.credentialFields.map((f) => f.key)).toEqual(["apiKey", "webhookSecret"]);
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["events.list"]);
  });
});

describe("savvycal: signature", () => {
  const body = JSON.stringify(hook("event.created", ev()));

  it("accepts sha256=<hex> over the raw body in either case, and fails closed", () => {
    const ok = { rawBody: body, headers: { "x-savvycal-signature": sign(body) }, secret: SECRET };
    expect(savvycalConnector.verifySignature(ok)).toBe(true);
    // The docs' sample is uppercase; a lowercase hex signature must verify too.
    expect(savvycalConnector.verifySignature({ ...ok, headers: { "x-savvycal-signature": sign(body).toLowerCase() } })).toBe(true);
    expect(savvycalConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(savvycalConnector.verifySignature({ ...ok, secret: "sc_other" })).toBe(false);
    expect(savvycalConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    expect(savvycalConnector.verifySignature({ ...ok, rawBody: `${body} ` })).toBe(false);
  });
});

describe("savvycal: normalize", () => {
  it("event.created is booked at created_at, with paid revenue in major units", () => {
    const [b] = savvycalConnector.normalize!(hook("event.created", ev()), { connectionId: CONN });
    expect(b).toMatchObject({ eventId: "savvycal:conn_1:event_1", eventType: "booked", subject: "lead@x.io", value: 50 });
    expect(b.currency).toBeNull();
    expect(b.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(b.properties).toMatchObject({ start_at: "2026-09-10T14:00:00Z", state: "confirmed" });
  });

  it("the money waits until checkout completes; the booking is counted either way", () => {
    const [u] = savvycalConnector.normalize!(
      hook("event.created", ev({ payment: { amount_total: 5000, state: "awaiting_checkout", url: null } })),
      { connectionId: CONN },
    );
    expect(u.eventType).toBe("booked");
    expect(u.value).toBeNull();
  });

  it("event.approved is a booking; event.requested and an unapproved payload are not", () => {
    expect(savvycalConnector.normalize!(hook("event.approved", ev()), { connectionId: CONN })[0]).toMatchObject({
      eventId: "savvycal:conn_1:event_1",
      eventType: "booked",
    });
    expect(savvycalConnector.normalize!(hook("event.requested", ev({ state: "awaiting_approval" })), { connectionId: CONN })).toEqual([]);
    expect(savvycalConnector.normalize!(hook("event.created", ev({ state: "awaiting_approval" })), { connectionId: CONN })).toEqual([]);
    expect(savvycalConnector.normalize!(hook("event.declined", ev({ state: "declined" })), { connectionId: CONN })).toEqual([]);
    expect(savvycalConnector.normalize!(hook("event.checkout.pending", ev()), { connectionId: CONN })).toEqual([]);
  });

  it("a cancellation is dated by canceled_at and carries no value", () => {
    const [c] = savvycalConnector.normalize!(
      hook("event.canceled", ev({ state: "canceled", canceled_at: "2026-09-02T09:00:00Z", cancel_reason: "Conflict" })),
      { connectionId: CONN },
    );
    expect(c).toMatchObject({ eventId: "savvycal:conn_1:event_1:canceled", eventType: "canceled", subject: "lead@x.io" });
    expect(c.value).toBeNull();
    expect(c.occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
  });

  it("a reschedule is dated by rescheduled_at, and falls back to the envelope's occurred_at", () => {
    const [r] = savvycalConnector.normalize!(
      hook("event.rescheduled", ev({ rescheduled_at: "2026-09-03T08:15:00Z", original_start_at: "2026-09-09T14:00:00Z" })),
      { connectionId: CONN },
    );
    expect(r).toMatchObject({ eventId: "savvycal:conn_1:event_1:rescheduled", eventType: "rescheduled" });
    expect(r.occurredAt.toISOString()).toBe("2026-09-03T08:15:00.000Z");
    const [noStamp] = savvycalConnector.normalize!(hook("event.rescheduled", ev()), { connectionId: CONN });
    expect(noStamp.occurredAt.toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("the scheduler is the subject when SavvyCal names one", () => {
    const [b] = savvycalConnector.normalize!(
      hook("event.created", ev({ scheduler: { email: "booker@x.io", is_organizer: false } })),
      { connectionId: CONN },
    );
    expect(b.subject).toBe("booker@x.io");
  });
});

describe("savvycal: poll", () => {
  const NOW = Date.parse("2026-09-20T00:00:00Z");

  it("lists /v1/events by start date, follows metadata.after, and fans a canceled row into two events", async () => {
    const canceled = ev({
      id: "event_2",
      state: "canceled",
      created_at: "2026-09-02T10:00:00Z",
      start_at: "2026-09-12T09:00:00Z",
      canceled_at: "2026-09-03T10:00:00Z",
      payment: null,
    });
    const calls = stubFetch([
      { entries: [ev()], metadata: { after: "cur_1", before: null, limit: 100 } },
      { entries: [canceled], metadata: { after: null, before: null, limit: 100 } },
    ]);
    const res = await savvycalConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: { apiKey: "pt_secret_x" },
      budget: { maxCalls: 3, nowMs: () => NOW },
    });

    expect(res.records.map((r) => r.eventId)).toEqual([
      "savvycal:conn_1:event_1",
      "savvycal:conn_1:event_2",
      "savvycal:conn_1:event_2:canceled",
    ]);
    expect(res.records.map((r) => r.eventType)).toEqual(["booked", "booked", "canceled"]);
    expect(res.records[0].value).toBe(50);
    expect(res.records[1].value).toBeNull();
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(res.records[2].occurredAt.toISOString()).toBe("2026-09-03T10:00:00.000Z");
    // The mark is the newest start_at — the field `from` bounds — and the walk settled.
    expect(res.nextCursor).toBe("2026-09-12T09:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
    expect(res.providerCalls).toBe(2);

    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/events");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("state")).toBe("all");
    expect(u.searchParams.get("attendance")).toBe("any");
    expect(u.searchParams.get("period")).toBe("fixed");
    expect(u.searchParams.get("direction")).toBe("asc");
    expect(u.searchParams.get("from")).toBe("2026-06-22");
    expect(u.searchParams.get("after")).toBeNull();
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("cur_1");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer pt_secret_x");
  });

  it("clamps the mark to now, so a meeting booked for next month cannot strand tomorrow's", async () => {
    const SOON = Date.parse("2026-09-11T00:00:00Z");
    const calls = stubFetch([{ entries: [ev({ start_at: "2026-10-30T09:00:00Z" })], metadata: { after: null } }]);
    const res = await savvycalConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: { apiKey: "pt_secret_x" },
      budget: { maxCalls: 2, nowMs: () => SOON },
    });
    expect(res.records.map((r) => r.eventType)).toEqual(["booked"]);
    expect(res.nextCursor).toBe("2026-09-11T00:00:00.000Z");
    expect(new URL(calls[0].url).searchParams.get("from")).toBe("2026-06-13");
  });

  it("an approval-gated request is not booked, but still advances the mark", async () => {
    stubFetch([
      {
        entries: [ev({ id: "event_3", state: "awaiting_approval", start_at: "2026-09-15T11:00:00Z", payment: null })],
        metadata: { after: null },
      },
    ]);
    const res = await savvycalConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: { apiKey: "pt_secret_x" },
      budget: { maxCalls: 2, nowMs: () => NOW },
    });
    expect(res.records).toEqual([]);
    expect(res.nextCursor).toBe("2026-09-15T11:00:00.000Z");
  });

  it("resumes from a stored mark and reports coverage while a first sync is still walking", async () => {
    const calls = stubFetch([{ entries: [ev()], metadata: { after: "cur_1" } }]);
    const res = await savvycalConnector.poll!({
      connectionId: CONN,
      cursor: "2026-09-05T00:00:00.000Z",
      credentials: { apiKey: "pt_secret_x" },
      budget: { maxCalls: 1, nowMs: () => NOW },
    });
    // Overlap is five minutes behind the mark, and `from` is a plain date.
    expect(new URL(calls[0].url).searchParams.get("from")).toBe("2026-09-04");
    expect(res.incomplete).toBe(true);
    // A stored continuation, so the next poll resumes rather than restarting.
    expect(JSON.parse(res.nextCursor!)).toMatchObject({ cont: "cur_1", hw: "2026-09-05T00:00:00.000Z" });
    // Coverage is a FIRST-sync question; behind a settled mark there is none.
    expect(savvycalConnector.importProgress!(res.nextCursor, NOW)).toBeNull();
  });
});
