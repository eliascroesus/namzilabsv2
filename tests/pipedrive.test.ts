import { describe, it, expect, vi, afterEach } from "vitest";
import { pipedriveConnector } from "@/connectors/pipedrive";
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

const deal = (over: Record<string, unknown> = {}) => ({
  id: 5,
  title: "Acme",
  value: 1200,
  currency: "USD",
  status: "open",
  stage_id: 3,
  pipeline_id: 1,
  person_id: 77,
  add_time: "2026-09-01T10:00:00Z",
  update_time: "2026-09-02T11:00:00Z",
  stage_change_time: "2026-09-02T11:00:00Z",
  won_time: null,
  lost_time: null,
  expected_close_date: "2026-12-31",
  ...over,
});
const basic = (pw: string) => `Basic ${Buffer.from(`namzilabs:${pw}`).toString("base64")}`;

describe("pipedrive: registration", () => {
  it("is in the catalog and the registry with dated provenance", () => {
    expect(getConnector("pipedrive")).toBe(pipedriveConnector);
    const e = catalogEntry("pipedrive")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.autoWebhook).toBe(true);
  });
});

describe("pipedrive: signature", () => {
  it("is the basic-auth credential we registered; fails closed", () => {
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: { authorization: basic("pw1") }, secret: "pw1" })).toBe(true);
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: { authorization: basic("pw2") }, secret: "pw1" })).toBe(false);
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: {}, secret: "pw1" })).toBe(false);
    expect(pipedriveConnector.verifySignature({ rawBody: "{}", headers: { authorization: basic("pw1") }, secret: null })).toBe(false);
  });
});

describe("pipedrive: normalize", () => {
  it("a created deal is opportunity_created at add_time; a stage change is deal_stage_changed at stage_change_time with the previous stage", () => {
    const [c] = pipedriveConnector.normalize!({ meta: { action: "create", entity: "deal", entity_id: 5, timestamp: "2026-09-01T10:00:01Z" }, data: deal(), previous: null }, { connectionId: CONN });
    expect(c).toMatchObject({ eventId: "pipedrive:conn_1:deal:5", eventType: "opportunity_created", value: 1200, currency: "USD", subject: "77" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    const [s] = pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5, timestamp: "2026-09-02T11:00:01Z" }, data: deal(), previous: { stage_id: 2 } }, { connectionId: CONN });
    expect(s).toMatchObject({ eventId: "pipedrive:conn_1:deal:5:stage:3", eventType: "deal_stage_changed" });
    expect(s.occurredAt.toISOString()).toBe("2026-09-02T11:00:00.000Z");
    expect(s.properties).toMatchObject({ previous_stage_id: 2 });
  });
  it("won and lost date by won_time / lost_time, never by expected_close_date; an unrelated change is dropped; a person is lead_created", () => {
    const [w] = pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5 }, data: deal({ status: "won", won_time: "2026-09-03T12:00:00Z" }), previous: { status: "open" } }, { connectionId: CONN });
    expect(w).toMatchObject({ eventId: "pipedrive:conn_1:deal:5:won", eventType: "deal_won", value: 1200 });
    expect(w.occurredAt.toISOString()).toBe("2026-09-03T12:00:00.000Z");
    const [l] = pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5 }, data: deal({ status: "lost", lost_time: "2026-09-04T12:00:00Z", lost_reason: "price" }), previous: { status: "open" } }, { connectionId: CONN });
    expect(l).toMatchObject({ eventType: "deal_lost" });
    expect(pipedriveConnector.normalize!({ meta: { action: "change", entity: "deal", entity_id: 5 }, data: deal(), previous: { title: "Old" } }, { connectionId: CONN })).toEqual([]);
    const [p] = pipedriveConnector.normalize!({ meta: { action: "create", entity: "person", entity_id: 77 }, data: { id: 77, add_time: "2026-09-01T09:00:00Z", emails: [{ value: "p@x.io", primary: true }] } }, { connectionId: CONN });
    expect(p).toMatchObject({ eventId: "pipedrive:conn_1:person:77", eventType: "lead_created", subject: "p@x.io" });
  });
});

describe("pipedrive: poll", () => {
  it("walks v2 deals by updated_since with the token header, emits created plus the current stage/outcome, settles on update_time", async () => {
    const calls = stubFetch([{ data: [deal({ status: "won", won_time: "2026-09-03T12:00:00Z" })], additional_data: { next_cursor: null } }]);
    const res = await pipedriveConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiToken: "t0k" } });
    expect(res.records.map((r) => r.eventType).sort()).toEqual(["deal_stage_changed", "deal_won", "opportunity_created"]);
    const u = new URL(calls[0].url);
    expect(u.origin).toBe("https://api.pipedrive.com");
    expect(u.pathname).toBe("/api/v2/deals");
    expect(u.searchParams.get("sort_by")).toBe("update_time");
    expect(u.searchParams.get("sort_direction")).toBe("asc");
    expect(u.searchParams.get("updated_since")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((calls[0].init.headers as Record<string, string>)["x-api-token"]).toBe("t0k");
    expect(res.nextCursor).toBe("2026-09-02T11:00:00.000Z");
  });
  it("uses the company domain when given, and follows the cursor", async () => {
    const calls = stubFetch([{ data: [deal()], additional_data: { next_cursor: "abc" } }, { data: [], additional_data: { next_cursor: null } }]);
    await pipedriveConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiToken: "t", companyDomain: "acme" } });
    expect(new URL(calls[0].url).origin).toBe("https://acme.pipedrive.com");
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe("abc");
  });
  it("registers a v2 deal webhook with basic auth and returns the password as the signing secret", async () => {
    const calls = stubFetch([{ data: { id: 31 } }]);
    const reg = await pipedriveConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiToken: "t" } });
    expect(reg.externalId).toBe("31");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ subscription_url: "https://app/api/webhooks/conn_1", event_action: "*", event_object: "deal", version: "2.0", http_auth_user: "namzilabs" });
    expect(body.http_auth_password).toBe(reg.signingSecret);
    expect(new URL(calls[0].url).pathname).toBe("/v1/webhooks");
  });
});
