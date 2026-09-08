import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { justcallConnector } from "@/connectors/justcall";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";
/** A fixed clock, so the request's `from_datetime` is asserted as a real string. */
const NOW = Date.parse("2026-09-08T12:00:00Z");

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

const CREDS = { apiKey: "k", apiSecret: "s" };

/** A JustCall v2.1 call: talk time in `conversation_time`, the instant split across call_date + call_time (UTC). */
const call = (over: Record<string, unknown> = {}) => ({
  id: 9001,
  call_sid: "CA9001",
  agent_email: "rep@x.io",
  agent_name: "Rep One",
  contact_name: "Lead",
  contact_number: "15550001",
  call_date: "2026-09-01",
  call_time: "10:00:00",
  call_user_date: "2026-09-01",
  call_user_time: "5:30:00",
  call_info: { direction: "Outgoing", type: "Answered", disposition: "Sales: Lead", missed_call_reason: null, notes: "sent pricing" },
  call_duration: { conversation_time: 150, total_duration: 170, hold_time: 20, ring_time: 20, handle_time: 180, wrap_up_time: 10 },
  ...over,
});

const missedCall = () =>
  call({
    id: 9002,
    call_time: "11:30:00",
    call_info: { direction: "Incoming", type: "Missed", missed_call_reason: "Call was not picked by any agent" },
    call_duration: { conversation_time: 0, total_duration: 0, ring_time: 15 },
  });

/** The v2.1 list envelope, as `contacts_list_v21` documents it. */
const listPage = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  status: "success",
  count: rows.length,
  current_page: 1,
  per_page: 100,
  data: rows,
  next_page_link: null,
  prev_page_link: null,
  ...over,
});

describe("justcall: registration", () => {
  it("is in the catalog and the registry with dated provenance, poll-only", () => {
    expect(getConnector("justcall")).toBe(justcallConnector);
    const e = catalogEntry("justcall")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.instant).toBe(false);
    expect(e.poll).toBe(true);
    expect(e.autoWebhook).toBe(false);
    // instant: false means no delivery is ever accepted, so a webhook secret
    // would be a field nothing could ever use.
    expect(e.credentialFields.map((f) => f.key)).toEqual(["apiKey", "apiSecret"]);
    expect(e.webhookSetup).toBeUndefined();
    expect(Object.keys(e.rateLimits ?? {})).toEqual([...(justcallConnector.operations ?? [])]);
  });
});

describe("justcall: signature", () => {
  /**
   * The provider's own worked example, digest included
   * (developer.justcall.io/docs/dynamic-webhook-signatures, read 8 Sep 2026) —
   * proof that the scheme below is JustCall's and not this test's invention.
   */
  const SECRET = "ea39089c40790e9dc7a080ec95e849b8fa0fa5fb";
  const HOOK = "https://webhook.site/3bcea770-370a-4b09-8b66-426f687e08a4";
  const TS = "2024-03-21 17:08:22";
  const body = JSON.stringify({ request_id: "01HSGZRD0PHRCCHM46JRCRYMC4", webhook_url: HOOK, url_id: "65fc65d6d8b63be90aeee515", type: "call.completed", data: {} });
  const sign = (url: string, type: string, ts: string) => createHmac("sha256", SECRET).update(`${SECRET}|${encodeURIComponent(url)}|${type}|${ts}`).digest("hex");

  it("reproduces JustCall's published digest — the scheme signs the SUBSCRIPTION URL", () => {
    expect(sign(HOOK, "call.completed", TS)).toBe("56761bae5b27a784a3ddd2af828bc5def7176bc0a8650199b04c737bd39bbecf");
  });

  it("refuses every delivery, signed or not: the URL it signs is not something a receiver is told", () => {
    const headers = { "x-justcall-signature": sign(HOOK, "call.completed", TS), "x-justcall-signature-version": "v1", "x-justcall-request-timestamp": TS };
    // A perfectly-signed delivery is still refused, because the only copy of
    // webhook_url we hold came from the body being verified.
    expect(justcallConnector.verifySignature({ rawBody: body, headers, secret: SECRET })).toBe(false);
    expect(justcallConnector.verifySignature({ rawBody: body, headers, secret: null })).toBe(false);
    expect(justcallConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(justcallConnector.verifySignature({ rawBody: `${body} `, headers, secret: SECRET })).toBe(false);
    expect(justcallConnector.verifySignature({ rawBody: body, headers, secret: "wrong" })).toBe(false);
  });

  it("declares no inbound mapper, so nothing unreachable can drift from the poll", () => {
    expect(justcallConnector.normalize).toBeUndefined();
  });
});

describe("justcall: normalize (the poll is the only path, so the mapping is asserted through it)", () => {
  /** Maps whatever `stubFetch` is currently serving. */
  const mapped = () => justcallConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 1, nowMs: () => NOW } });

  it("an answered call is logged, connected and completed at call_date+call_time, with conversation_time as the value", async () => {
    stubFetch([listPage([call()])]);
    const res = await mapped();
    expect(res.records.map((r) => r.eventType)).toEqual(["call_logged", "call_connected", "call_completed"]);
    expect(res.records.map((r) => r.eventId)).toEqual(["justcall:conn_1:9001", "justcall:conn_1:9001:connected", "justcall:conn_1:9001:completed"]);
    for (const r of res.records) {
      expect(r.subject).toBe("rep@x.io");
      expect(r.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    }
    const completed = res.records[2];
    // conversation_time, NOT total_duration (which adds hold) and not handle_time (which adds wrap-up).
    expect(completed.value).toBe(150);
    expect(completed.properties).toMatchObject({
      direction: "Outgoing",
      call_type: "Answered",
      disposition: "Sales: Lead",
      talk_seconds: 150,
      ring_seconds: 20,
      hold_seconds: 20,
      total_seconds: 170,
      call_user_time: "5:30:00",
    });
  });

  it("a missed call is logged and completed as call_missed with a zero value, and is never marked connected", async () => {
    stubFetch([listPage([missedCall()])]);
    const res = await mapped();
    expect(res.records.map((r) => r.eventType)).toEqual(["call_logged", "call_missed"]);
    expect(res.records.map((r) => r.eventId)).toEqual(["justcall:conn_1:9002", "justcall:conn_1:9002:completed"]);
    expect(res.records[1].value).toBe(0);
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T11:30:00.000Z");
    expect(res.records[1].properties).toMatchObject({ direction: "Incoming", missed_call_reason: "Call was not picked by any agent" });
  });

  it("a call still in progress yields no outcome yet — only call_logged and, once talking, call_connected", async () => {
    const live = call({ id: 9003, call_info: { direction: "Incoming", type: "In Progress" }, call_duration: { conversation_time: 42, ring_time: 3 } });
    stubFetch([listPage([live])]);
    const res = await mapped();
    expect(res.records.map((r) => r.eventType)).toEqual(["call_logged", "call_connected"]);
    expect(res.records.map((r) => r.eventId)).toEqual(["justcall:conn_1:9003", "justcall:conn_1:9003:connected"]);
  });

  it("an unpadded hour still parses, and a call with no agent falls back to the contact number", async () => {
    const odd = call({ id: 9004, call_time: "8:05:03", agent_email: null, contact_number: 15550009 });
    stubFetch([listPage([odd])]);
    const res = await mapped();
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T08:05:03.000Z");
    expect(res.records[0].subject).toBe("15550009");
  });
});

describe("justcall: poll", () => {
  it("GETs /calls oldest-first with the key:secret header and a lower bound widened past every time zone", async () => {
    const calls = stubFetch([listPage([call(), missedCall()], { count: 2 })]);
    const res = await justcallConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 1, nowMs: () => NOW } });
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.justcall.io/v2.1/calls");
    // 90 days behind the clock (the retention wall), then 12 hours further so
    // the account-timezone filter cannot land ahead of the mark.
    expect(u.searchParams.get("from_datetime")).toBe("2026-06-10 00:00:00");
    // No upper bound: in an unknown zone it could only hide the newest calls.
    expect(u.searchParams.get("to_datetime")).toBeNull();
    expect(u.searchParams.get("per_page")).toBe("100");
    expect(u.searchParams.get("sort")).toBe("datetime");
    expect(u.searchParams.get("order")).toBe("asc");
    // No page index is assumed on the first request — JustCall's own list
    // endpoints document page 0 as the first page.
    expect(u.searchParams.get("page")).toBeNull();
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("k:s");
    expect(res.records.map((r) => `${r.eventType}:${r.eventId}`).sort()).toEqual([
      "call_completed:justcall:conn_1:9001:completed",
      "call_connected:justcall:conn_1:9001:connected",
      "call_logged:justcall:conn_1:9001",
      "call_logged:justcall:conn_1:9002",
      "call_missed:justcall:conn_1:9002:completed",
    ]);
    // The mark is the newest call_date+call_time seen — the same axis the
    // request bounds, never call_user_date.
    expect(res.nextCursor).toBe("2026-09-01T11:30:00.000Z");
    expect(res.providerCalls).toBe(1);
  });

  it("resumes from the stored mark with an overlap, and reports the tighter of JustCall's two budgets", async () => {
    // X-Rate-Limit-Reset is an ABSOLUTE epoch, so the clock is pinned to turn
    // it back into the delay `ObservedRateLimit` is defined in.
    vi.useFakeTimers({ now: NOW });
    try {
      const calls = stubFetch([listPage([call()])], {
        "x-rate-limit-limit": "1800",
        "x-rate-limit-remaining": "1200",
        "x-rate-limit-reset": String(NOW / 1000 + 900),
        "x-rate-limit-burst-limit": "30",
        "x-rate-limit-burst-remaining": "4",
        "x-rate-limit-burst-reset": String(NOW / 1000 + 30),
      });
      const res = await justcallConnector.poll!({ connectionId: CONN, cursor: "2026-09-01T10:00:00.000Z", credentials: CREDS, budget: { maxCalls: 1, nowMs: () => NOW } });
      // mark − 5 min overlap − 12 h timezone margin.
      expect(new URL(calls[0].url).searchParams.get("from_datetime")).toBe("2026-08-31 21:55:00");
      // The burst window is the tighter of the two, so it is the one reported.
      expect(res.rateLimit).toEqual({ limit: 30, remaining: 4, resetSeconds: 30 });
      expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows next_page_link by its page index only, so the window bound is re-sent on every page", async () => {
    const later = call({ id: 9005, call_date: "2026-09-02", call_time: "09:15:00" });
    const calls = stubFetch([
      listPage([call()], { next_page_link: "https://api.justcall.io/v2.1/calls?page=2&per_page=100" }),
      listPage([later], { current_page: 2, next_page_link: null }),
    ]);
    const res = await justcallConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 5, nowMs: () => NOW } });
    expect(calls).toHaveLength(2);
    const second = new URL(calls[1].url);
    expect(second.searchParams.get("page")).toBe("2");
    expect(second.searchParams.get("from_datetime")).toBe("2026-06-10 00:00:00");
    expect(second.searchParams.get("order")).toBe("asc");
    expect(res.records.map((r) => r.eventId)).toContain("justcall:conn_1:9005");
    expect(res.nextCursor).toBe("2026-09-02T09:15:00.000Z");
    expect(res.providerCalls).toBe(2);
    expect(res.incomplete).toBeUndefined();
  });

  it("a burst larger than one poll's budget keeps its continuation and stays incomplete", async () => {
    const calls = stubFetch([listPage([call()], { next_page_link: "https://api.justcall.io/v2.1/calls?page=2&per_page=100" })]);
    const res = await justcallConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 1, nowMs: () => NOW } });
    expect(calls).toHaveLength(1);
    expect(res.incomplete).toBe(true);
    expect(JSON.parse(res.nextCursor!)).toMatchObject({ hw: null, cont: "2", maxSeen: "2026-09-01T10:00:00.000Z" });
    // The next poll picks the continuation back up rather than restarting.
    const again = stubFetch([listPage([call({ id: 9006, call_date: "2026-09-03", call_time: "07:00:00" })], { current_page: 2 })]);
    const res2 = await justcallConnector.poll!({ connectionId: CONN, cursor: res.nextCursor, credentials: CREDS, budget: { maxCalls: 1, nowMs: () => NOW } });
    expect(new URL(again[0].url).searchParams.get("page")).toBe("2");
    expect(res2.nextCursor).toBe("2026-09-03T07:00:00.000Z");
  });

  it("a connection missing its secret says which field to fix rather than calling JustCall unauthenticated", async () => {
    stubFetch([listPage([])]);
    await expect(justcallConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } })).rejects.toThrow(/apiSecret/);
  });
});
