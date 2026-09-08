import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { helpscoutConnector, HELPSCOUT_EVENTS } from "@/connectors/helpscout";
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

const SECRET = "hs_secret";
const sign = (body: string) => createHmac("sha1", SECRET).update(body).digest("base64");
const TOKEN = { token_type: "bearer", access_token: "tok", expires_in: 172_800 };
const CREDS = { appId: "id", appSecret: "sec" };

const convo = (over: Record<string, unknown> = {}) => ({
  id: 101,
  number: 55,
  subject: "Help",
  status: "active",
  mailboxId: 13,
  createdAt: "2026-09-01T10:00:00Z",
  closedAt: null,
  userUpdatedAt: "2026-09-01T10:00:00Z",
  primaryCustomer: { id: 7, type: "customer", email: "cust@x.io" },
  assignee: null,
  _links: { self: { href: "…" } },
  ...over,
});
const embed = (threads: unknown[]) => ({ _embedded: { threads } });

describe("helpscout: registration", () => {
  it("is in the catalog and the registry with dated provenance, auto-registering its webhook", () => {
    expect(getConnector("helpscout")).toBe(helpscoutConnector);
    const e = catalogEntry("helpscout")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
    expect(e.autoWebhook).toBe(true);
    expect(e.credentialFields.map((f) => f.key)).toEqual(["appId", "appSecret"]);
    // One per-plan bucket, shared by the conversations and threads reads.
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["conversations.list"]);
    expect(helpscoutConnector.operations).toEqual(["conversations.list"]);
  });
});

describe("helpscout: signature", () => {
  it("base64 HMAC-SHA1 over the raw body in X-HelpScout-Signature; fails closed", () => {
    const body = JSON.stringify(convo());
    const ok = { rawBody: body, headers: { "x-helpscout-signature": sign(body), "x-helpscout-event": "convo.created" }, secret: SECRET };
    expect(helpscoutConnector.verifySignature(ok)).toBe(true);
    expect(helpscoutConnector.verifySignature({ ...ok, secret: null })).toBe(false);
    expect(helpscoutConnector.verifySignature({ ...ok, secret: "other" })).toBe(false);
    expect(helpscoutConnector.verifySignature({ ...ok, headers: {} })).toBe(false);
    expect(helpscoutConnector.verifySignature({ ...ok, rawBody: `${body} ` })).toBe(false);
    // SHA-256 over the same body is the near-miss the algorithm choice guards.
    const sha256 = createHmac("sha256", SECRET).update(body).digest("base64");
    expect(helpscoutConnector.verifySignature({ ...ok, headers: { "x-helpscout-signature": sha256 } })).toBe(false);
  });
});

describe("helpscout: normalize (the event is named by the X-HelpScout-Event header)", () => {
  const h = (event: string) => ({ connectionId: CONN, headers: { "x-helpscout-event": event } });

  it("convo.created is conversation_created at createdAt, with the customer as subject", () => {
    const [c] = helpscoutConnector.normalize!(convo(), h("convo.created"));
    expect(c).toMatchObject({ eventId: "helpscout:conn_1:101", eventType: "conversation_created", subject: "cust@x.io" });
    expect(c.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(c.value ?? null).toBeNull();
    expect(c.properties).toMatchObject({ status: "active", subject: "Help", mailboxId: 13 });
    expect(c.properties!["_links"]).toBeUndefined();
  });

  it("a reply delivery is dated by the newest thread of the named side", () => {
    const threads = [
      { id: 8, type: "customer", state: "published", createdAt: "2026-09-01T10:00:00Z", createdBy: { type: "customer", email: "cust@x.io" } },
      { id: 9, type: "customer", state: "published", createdAt: "2026-09-01T12:00:00Z", createdBy: { type: "customer", email: "cust@x.io" } },
      { id: 10, type: "message", state: "published", createdAt: "2026-09-01T12:30:00Z", createdBy: { type: "user", email: "agent@x.io" } },
    ];
    const [r] = helpscoutConnector.normalize!(convo(embed(threads)), h("convo.customer.reply.created"));
    expect(r).toMatchObject({ eventId: "helpscout:conn_1:101:thread:9", eventType: "customer_replied", subject: "cust@x.io" });
    expect(r.occurredAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(r.properties).toMatchObject({ conversation_id: "101", conversation_subject: "Help", mailbox_id: "13" });

    const [a] = helpscoutConnector.normalize!(convo(embed(threads)), h("convo.agent.reply.created"));
    expect(a).toMatchObject({ eventId: "helpscout:conn_1:101:thread:10", eventType: "agent_replied", subject: "agent@x.io" });
    expect(a.occurredAt.toISOString()).toBe("2026-09-01T12:30:00.000Z");
  });

  it("notes, line items and drafts are not replies", () => {
    const note = [{ id: 11, type: "note", state: "published", createdAt: "2026-09-01T13:00:00Z", createdBy: { type: "user", email: "agent@x.io" } }];
    expect(helpscoutConnector.normalize!(convo(embed(note)), h("convo.agent.reply.created"))).toEqual([]);
    const lineitem = [{ id: 12, type: "lineitem", state: "published", createdAt: "2026-09-01T13:00:00Z", createdBy: { type: "user", email: "agent@x.io" } }];
    expect(helpscoutConnector.normalize!(convo(embed(lineitem)), h("convo.agent.reply.created"))).toEqual([]);
    const draft = [{ id: 13, type: "message", state: "draft", createdAt: "2026-09-01T13:00:00Z", createdBy: { type: "user", email: "agent@x.io" } }];
    expect(helpscoutConnector.normalize!(convo(embed(draft)), h("convo.agent.reply.created"))).toEqual([]);
  });

  it("convo.status counts only a CLOSE, dated by closedAt; convo.assigned names the assignee", () => {
    const [z] = helpscoutConnector.normalize!(convo({ status: "closed", closedAt: "2026-09-02T08:00:00Z", userUpdatedAt: "2026-09-02T08:00:00Z" }), h("convo.status"));
    expect(z).toMatchObject({ eventId: "helpscout:conn_1:101:closed", eventType: "conversation_closed", subject: "cust@x.io" });
    expect(z.occurredAt.toISOString()).toBe("2026-09-02T08:00:00.000Z");
    expect(helpscoutConnector.normalize!(convo({ status: "active" }), h("convo.status"))).toEqual([]);
    expect(helpscoutConnector.normalize!(convo({ status: "pending" }), h("convo.status"))).toEqual([]);

    const [s] = helpscoutConnector.normalize!(convo({ assignee: { id: 99, type: "user", email: "agent@x.io" }, userUpdatedAt: "2026-09-01T10:05:00Z" }), h("convo.assigned"));
    expect(s).toMatchObject({ eventId: "helpscout:conn_1:101:assigned:agent@x.io", eventType: "conversation_assigned", subject: "agent@x.io" });
    expect(s.occurredAt.toISOString()).toBe("2026-09-01T10:05:00.000Z");
    // An unassignment carries no assignee, so there is no fact to date.
    expect(helpscoutConnector.normalize!(convo({ assignee: null }), h("convo.assigned"))).toEqual([]);
    // Anything we did not subscribe to is not our business.
    expect(helpscoutConnector.normalize!(convo(), h("convo.tags"))).toEqual([]);
    expect(helpscoutConnector.normalize!(convo(), { connectionId: CONN })).toEqual([]);
  });
});

describe("helpscout: poll", () => {
  const convoA = convo({
    id: 101,
    status: "closed",
    createdAt: "2026-09-01T10:00:00Z",
    closedAt: "2026-09-02T08:00:00Z",
    userUpdatedAt: "2026-09-02T08:00:00Z",
  });
  const threadsA = {
    _embedded: {
      threads: [
        // The OPENING message: same moment as the conversation, already counted
        // as conversation_created, so never a reply.
        { id: 8, type: "customer", state: "published", createdAt: "2026-09-01T10:00:00Z", createdBy: { type: "customer", email: "cust@x.io" } },
        { id: 10, type: "message", state: "published", createdAt: "2026-09-01T10:20:00Z", createdBy: { type: "user", email: "agent@x.io" } },
        { id: 9, type: "customer", state: "published", createdAt: "2026-09-01T10:40:00Z", createdBy: { type: "customer", email: "cust@x.io" } },
        { id: 11, type: "note", state: "published", createdAt: "2026-09-01T10:45:00Z", createdBy: { type: "user", email: "agent@x.io" } },
      ],
    },
  };
  const convoB = convo({
    id: 102,
    subject: "Second",
    status: "active",
    createdAt: "2026-09-03T09:00:00Z",
    userUpdatedAt: "2026-09-03T09:30:00Z",
    customerWaitingSince: { time: "2026-09-03T09:45:00Z", friendly: "20 hours ago" },
    primaryCustomer: { id: 8, type: "customer", email: "two@x.io" },
  });
  const page = (conversations: unknown[], totalPages: number) => ({ _embedded: { conversations }, page: { number: 1, size: 25, totalElements: 2, totalPages } });

  it("exchanges the app credentials, walks conversations by modifiedSince, reads each one's threads and fans the page out", async () => {
    const calls = stubFetch([TOKEN, page([convoA], 2), threadsA, page([convoB], 2), { _embedded: { threads: [] } }]);
    const res = await helpscoutConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS });

    expect(res.records.map((r) => r.eventId)).toEqual([
      "helpscout:conn_1:101",
      "helpscout:conn_1:101:closed",
      "helpscout:conn_1:101:thread:10",
      "helpscout:conn_1:101:thread:9",
      "helpscout:conn_1:102",
    ]);
    expect(res.records.map((r) => r.eventType)).toEqual(["conversation_created", "conversation_closed", "agent_replied", "customer_replied", "conversation_created"]);
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(res.records[1].occurredAt.toISOString()).toBe("2026-09-02T08:00:00.000Z");
    expect(res.records[2].occurredAt.toISOString()).toBe("2026-09-01T10:20:00.000Z");
    expect(res.records[3].occurredAt.toISOString()).toBe("2026-09-01T10:40:00.000Z");
    expect(res.records[4].occurredAt.toISOString()).toBe("2026-09-03T09:00:00.000Z");
    // The newest modification Help Scout exposes — here customerWaitingSince,
    // which is later than either conversation's userUpdatedAt.
    expect(res.nextCursor).toBe("2026-09-03T09:45:00.000Z");
    expect(res.incomplete).toBeUndefined();
    // The token exchange plus two list pages plus two threads reads.
    expect(res.providerCalls).toBe(5);

    const token = new URL(calls[0].url);
    expect(token.pathname).toBe("/v2/oauth2/token");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(String(calls[0].init.body)).toBe("grant_type=client_credentials&client_id=id&client_secret=sec");

    const list = new URL(calls[1].url);
    expect(list.pathname).toBe("/v2/conversations");
    expect(list.searchParams.get("status")).toBe("all");
    expect(list.searchParams.get("sortField")).toBe("modifiedAt");
    expect(list.searchParams.get("sortOrder")).toBe("asc");
    expect(list.searchParams.get("page")).toBe("1");
    expect(list.searchParams.get("modifiedSince")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok");

    expect(new URL(calls[2].url).pathname).toBe("/v2/conversations/101/threads");
    expect(new URL(calls[3].url).searchParams.get("page")).toBe("2");
    expect(new URL(calls[4].url).pathname).toBe("/v2/conversations/102/threads");
  });

  it("bounds the next window on the settled mark, less the overlap", async () => {
    const calls = stubFetch([TOKEN, page([], 1)]);
    const res = await helpscoutConnector.poll!({ connectionId: CONN, cursor: "2026-09-05T00:00:00.000Z", credentials: CREDS });
    expect(new URL(calls[1].url).searchParams.get("modifiedSince")).toBe("2026-09-04T23:55:00Z");
    // Nothing came back, so the mark stands where it was.
    expect(res.nextCursor).toBe("2026-09-05T00:00:00.000Z");
    expect(res.records).toEqual([]);
    expect(res.providerCalls).toBe(2);
  });

  it("spends the budget in CALLS, not pages: one page costs a list read plus a threads read each", async () => {
    const calls = stubFetch([TOKEN, page([convoA], 2), threadsA, page([convoB], 2), { _embedded: { threads: [] } }]);
    // 26 calls buys exactly one page (1 list + 25 threads), so the walk stops
    // mid-window and hands back a continuation instead of a settled mark.
    const res = await helpscoutConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 26 } });
    expect(calls.filter((c) => new URL(c.url).pathname === "/v2/conversations")).toHaveLength(1);
    expect(res.incomplete).toBe(true);
    expect(JSON.parse(res.nextCursor!)).toMatchObject({ hw: null, cont: "2", maxSeen: "2026-09-02T08:00:00.000Z" });
    expect(res.providerCalls).toBe(3);
    expect(res.importProgress).toBeDefined();
    expect(helpscoutConnector.importProgress!(res.nextCursor)).not.toBeNull();
  });

  it("registers the webhook with our own secret and reads the id out of the Resource-ID header", async () => {
    const calls = stubFetch([TOKEN, {}], { "resource-id": "77" });
    const reg = await helpscoutConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: CREDS });
    expect(reg.externalId).toBe("77");
    expect(reg.signingSecret).toMatch(/^[A-Za-z0-9_-]{32}$/); // 40 characters or less, per the docs
    expect(new URL(calls[1].url).pathname).toBe("/v2/webhooks");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      url: "https://app/api/webhooks/conn_1",
      events: [...HELPSCOUT_EVENTS],
      secret: reg.signingSecret,
      payloadVersion: "V2",
      label: "Namzilabs",
    });
  });

  it("a webhook that is already gone is a successful teardown", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const first = n++ === 0;
        return {
          ok: first,
          status: first ? 200 : 404,
          statusText: first ? "OK" : "Not Found",
          headers: { get: () => null },
          json: async () => TOKEN,
          text: async () => (first ? JSON.stringify(TOKEN) : "gone"),
        } as unknown as Response;
      }),
    );
    await expect(helpscoutConnector.unregisterWebhook!({ connectionId: CONN, credentials: CREDS, externalId: "77" })).resolves.toBeUndefined();
  });
});
