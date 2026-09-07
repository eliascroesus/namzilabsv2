import { describe, it, expect, vi, afterEach } from "vitest";
import { aircallConnector } from "@/connectors/aircall";
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

const call = (over: Record<string, unknown> = {}) => ({
  id: 771,
  direction: "inbound",
  status: "done",
  started_at: 1_757_200_000,
  answered_at: 1_757_200_012,
  ended_at: 1_757_200_312,
  duration: 312,
  missed_call_reason: null,
  user: { id: 9, email: "rep@x.io" },
  number: { digits: "+1555" },
  raw_digits: "+1444",
  tags: [],
  ...over,
});
const delivery = (event: string, data: Record<string, unknown>, token = "tok_abc") => JSON.stringify({ resource: "call", event, timestamp: 1_757_200_400, token, data });

describe("aircall: registration", () => {
  it("is in the catalog and the registry with dated provenance", () => {
    expect(getConnector("aircall")).toBe(aircallConnector);
    const e = catalogEntry("aircall")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.autoWebhook).toBe(true);
  });
});

describe("aircall: signature", () => {
  it("is the registration token in the body, compared in constant time; fails closed", () => {
    const body = delivery("call.created", call());
    expect(aircallConnector.verifySignature({ rawBody: body, headers: {}, secret: "tok_abc" })).toBe(true);
    expect(aircallConnector.verifySignature({ rawBody: body, headers: {}, secret: "tok_other" })).toBe(false);
    expect(aircallConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(false);
    expect(aircallConnector.verifySignature({ rawBody: "not json", headers: {}, secret: "tok_abc" })).toBe(false);
    expect(aircallConnector.verifySignature({ rawBody: JSON.stringify({ event: "call.created", data: {} }), headers: {}, secret: "tok_abc" })).toBe(false);
  });
});

describe("aircall: normalize", () => {
  it("created → call_logged at started_at; answered → call_connected at answered_at; ended → call_completed with talk time as the value", () => {
    const [a] = aircallConnector.normalize!(JSON.parse(delivery("call.created", call())), { connectionId: CONN });
    expect(a).toMatchObject({ eventId: "aircall:conn_1:771", eventType: "call_logged", subject: "rep@x.io" });
    expect(a.occurredAt.toISOString()).toBe(new Date(1_757_200_000 * 1000).toISOString());
    const [b] = aircallConnector.normalize!(JSON.parse(delivery("call.answered", call())), { connectionId: CONN });
    expect(b).toMatchObject({ eventId: "aircall:conn_1:771:connected", eventType: "call_connected" });
    const [c] = aircallConnector.normalize!(JSON.parse(delivery("call.ended", call())), { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "aircall:conn_1:771:completed", eventType: "call_completed", value: 300 });
    expect(c.properties).toMatchObject({ talk_seconds: 300, ring_seconds: 12 });
  });
  it("a missed call ends as call_missed with a zero value; tagged and voicemail are their own events; unknown events are dropped", () => {
    const [m] = aircallConnector.normalize!(JSON.parse(delivery("call.ended", call({ answered_at: null, missed_call_reason: "no_available_agent", duration: 20 }))), { connectionId: CONN });
    expect(m).toMatchObject({ eventType: "call_missed", value: 0 });
    const [t] = aircallConnector.normalize!(JSON.parse(delivery("call.tagged", call({ tags: [{ name: "Qualified" }] }))), { connectionId: CONN });
    expect(t).toMatchObject({ eventId: "aircall:conn_1:771:tagged", eventType: "call_tagged" });
    const [v] = aircallConnector.normalize!(JSON.parse(delivery("call.voicemail_left", call())), { connectionId: CONN });
    expect(v.eventType).toBe("voicemail_left");
    expect(aircallConnector.normalize!(JSON.parse(delivery("call.commented", call())), { connectionId: CONN })).toEqual([]);
  });
});

describe("aircall: poll", () => {
  it("lists calls between from/to with basic auth and emits the full lifecycle per call", async () => {
    const calls = stubFetch([{ calls: [call()], meta: { next_page_link: null } }]);
    const res = await aircallConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiId: "id", apiToken: "tok" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["call_completed", "call_connected", "call_logged"]);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/calls");
    expect(u.searchParams.get("order")).toBe("asc");
    expect(u.searchParams.get("per_page")).toBe("50");
    expect(Number(u.searchParams.get("from"))).toBeGreaterThan(0);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("id:tok").toString("base64")}`);
    expect(res.nextCursor).toBe(new Date(1_757_200_000 * 1000).toISOString());
  });
  it("follows next_page_link by page number", async () => {
    const calls = stubFetch([{ calls: [call()], meta: { next_page_link: "https://api.aircall.io/v1/calls?page=2" } }, { calls: [call({ id: 772, started_at: 1_757_200_500, answered_at: null, ended_at: 1_757_200_520 })], meta: { next_page_link: null } }]);
    const res = await aircallConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiId: "id", apiToken: "tok" } });
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
    expect(res.records.filter((r) => r.eventType === "call_missed")).toHaveLength(1);
    expect(res.nextCursor).toBe(new Date(1_757_200_500 * 1000).toISOString());
  });
  it("registers a webhook and stores Aircall's token as the signing secret, wrapped or flat", async () => {
    const calls = stubFetch([{ webhook: { webhook_id: "wh_1", token: "tok_new" } }]);
    const reg = await aircallConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiId: "id", apiToken: "tok" } });
    expect(reg).toEqual({ signingSecret: "tok_new", externalId: "wh_1" });
    expect(JSON.parse(String(calls[0].init.body)).events).toContain("call.ended");
    stubFetch([{ webhook_id: "wh_2", token: "tok_flat" }]);
    expect(await aircallConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiId: "id", apiToken: "tok" } })).toEqual({ signingSecret: "tok_flat", externalId: "wh_2" });
  });
});
