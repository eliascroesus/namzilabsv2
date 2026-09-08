import { describe, it, expect, vi, afterEach } from "vitest";
import { lemlistConnector, LEMLIST_TYPES } from "@/connectors/lemlist";
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

const activity = (over: Record<string, unknown> = {}) => ({
  _id: "act_1",
  type: "emailsReplied",
  createdAt: "2026-09-02T09:00:00.000Z",
  leadId: "lea_1",
  leadEmail: "lead@x.io",
  campaignId: "cmp_1",
  campaignName: "Q3",
  sequenceStep: 2,
  stepId: "stp_1",
  isFirst: false,
  ...over,
});

describe("lemlist: registration", () => {
  it("is in the catalog and the registry with dated provenance and one budgeted operation", () => {
    expect(getConnector("lemlist")).toBe(lemlistConnector);
    const e = catalogEntry("lemlist")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toBeDefined();
    expect(e.instant).toBe(true);
    expect(e.autoWebhook).toBe(true);
    // Both directions of the budget contract: the declared keys are exactly
    // the operations the connector can claim against.
    expect(Object.keys(e.rateLimits ?? {})).toEqual(["activities.list"]);
    expect(lemlistConnector.operations).toEqual(["activities.list"]);
  });
});

describe("lemlist: signature", () => {
  /**
   * lemlist signs nothing: the secret WE minted at registration is echoed in
   * the delivery body ("Sent back to your endpoint as a `secret` field in the
   * JSON body of every webhook call"). So there is no header, no HMAC and no
   * timestamp to go stale — the whole scheme is a constant-time comparison of
   * that field, and it must fail closed in every other case.
   */
  it("is the shared secret echoed in the body, constant-time; fails closed", () => {
    const signed = JSON.stringify({ ...activity(), secret: "s1" });
    expect(lemlistConnector.verifySignature({ rawBody: signed, headers: {}, secret: "s1" })).toBe(true);
    // Wrong secret, no secret in the body, no secret configured, unparseable body.
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify({ ...activity(), secret: "s2" }), headers: {}, secret: "s1" })).toBe(false);
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify(activity()), headers: {}, secret: "s1" })).toBe(false);
    expect(lemlistConnector.verifySignature({ rawBody: signed, headers: {}, secret: null })).toBe(false);
    expect(lemlistConnector.verifySignature({ rawBody: "not json", headers: {}, secret: "s1" })).toBe(false);
    // A header carrying the token is NOT the documented scheme and buys nothing.
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify(activity()), headers: { "x-lemlist-signature": "s1" }, secret: "s1" })).toBe(false);
  });
});

describe("lemlist: normalize", () => {
  it("maps every email activity type to the outreach vocabulary, dated at createdAt", () => {
    const cases: Array<[string, string]> = [
      ["emailsSent", "email_sent"],
      ["emailsOpened", "email_opened"],
      ["emailsClicked", "email_clicked"],
      ["emailsReplied", "reply"],
      ["emailsBounced", "bounced"],
      ["emailsFailed", "bounced"],
      ["emailsInterested", "lead_interested"],
      ["emailsUnsubscribed", "unsubscribed"],
    ];
    expect(Object.keys(LEMLIST_TYPES)).toEqual(cases.map(([type]) => type));
    for (const [type, ours] of cases) {
      const [ev] = lemlistConnector.normalize!({ ...activity({ type }), secret: "x" }, { connectionId: CONN });
      expect(ev, type).toMatchObject({ eventId: "lemlist:conn_1:act_1", eventType: ours, subject: "lead@x.io" });
      expect(ev.occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
      // The secret is a credential that arrived in the payload: verified, then dropped.
      expect(ev.properties).not.toHaveProperty("secret");
      expect(ev.properties).toMatchObject({ type, campaignName: "Q3", campaignId: "cmp_1", sequenceStep: 2, stepId: "stp_1", isFirst: false });
    }
  });

  it("drops the other-channel siblings and the lead-state groups, which would double-count one send", () => {
    for (const type of ["linkedinVisitDone", "linkedinSent", "whatsappMessageSent", "smsSent", "interested", "contacted", "hooked", "meetingBooked"]) {
      expect(lemlistConnector.normalize!(activity({ type }), { connectionId: CONN }), type).toEqual([]);
    }
    // An activity with nothing to date it by, and one with no id, are not events.
    expect(lemlistConnector.normalize!(activity({ createdAt: null }), { connectionId: CONN })).toEqual([]);
    expect(lemlistConnector.normalize!(activity({ _id: null }), { connectionId: CONN })).toEqual([]);
  });
});

describe("lemlist: poll", () => {
  it("lists v2 activities between minDate and maxDate over Basic auth with an empty username, and settles on the newest createdAt", async () => {
    const calls = stubFetch(
      [[activity(), activity({ _id: "act_0", type: "emailsSent", createdAt: "2026-09-01T09:00:00.000Z" })]],
      { "x-ratelimit-limit": "20", "x-ratelimit-remaining": "17", "x-ratelimit-reset": "Tue, 08 Sep 2026 10:00:02 GMT" },
    );
    const res = await lemlistConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });

    expect(res.records.map((r) => r.eventId)).toEqual(["lemlist:conn_1:act_1", "lemlist:conn_1:act_0"]);
    expect(res.records.map((r) => r.eventType)).toEqual(["reply", "email_sent"]);
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    // Settled (a bare mark, not a JSON continuation) on the newest createdAt —
    // the same field minDate bounds the request with.
    expect(res.nextCursor).toBe("2026-09-02T09:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
    expect(res.providerCalls).toBe(1);
    // X-RateLimit-Reset is a human-readable DATE, so `remaining` is observed
    // and the reset stays null rather than being invented as seconds.
    expect(res.rateLimit).toEqual({ limit: 20, remaining: 17, resetSeconds: null });

    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/api/activities");
    expect(u.searchParams.get("version")).toBe("v2");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("offset")).toBe("0");
    expect(u.searchParams.get("minDate")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // maxDate must be strictly greater than minDate, and pins the top of the
    // window so offset paging cannot shift under an unspecified sort order.
    const maxDate = u.searchParams.get("maxDate")!;
    expect(Date.parse(maxDate)).toBeGreaterThan(Date.parse(u.searchParams.get("minDate")!));
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(":K").toString("base64")}`);
  });

  it("pages by incrementing offset by the limit, and stops on the first short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) =>
      activity({ _id: `act_p1_${i}`, type: "emailsSent", createdAt: `2026-09-01T00:${String(i % 60).padStart(2, "0")}:00.000Z` }),
    );
    const calls = stubFetch([full, [activity({ _id: "act_last" })]]);
    const res = await lemlistConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "K" } });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("offset")).toBe("0");
    expect(new URL(calls[1].url).searchParams.get("offset")).toBe("100");
    // Same window on both pages: minDate/maxDate are pinned for the walk.
    expect(new URL(calls[1].url).searchParams.get("maxDate")).toBe(new URL(calls[0].url).searchParams.get("maxDate"));
    expect(res.records).toHaveLength(101);
    expect(res.providerCalls).toBe(2);
    expect(res.nextCursor).toBe("2026-09-02T09:00:00.000Z");
  });

  it("resumes from a stored mark, and a budget of one page hands back a continuation instead of advancing it", async () => {
    const full = Array.from({ length: 100 }, (_, i) => activity({ _id: `act_${i}`, type: "emailsSent", createdAt: "2026-09-03T10:00:00.000Z" }));
    const calls = stubFetch([full]);
    const res = await lemlistConnector.poll!({
      connectionId: CONN,
      cursor: "2026-09-02T09:00:00.000Z",
      credentials: { apiKey: "K" },
      budget: { maxCalls: 1 },
    });

    // 5 minutes of overlap below the mark, so a late-landing activity is re-read.
    expect(new URL(calls[0].url).searchParams.get("minDate")).toBe("2026-09-02T08:55:00.000Z");
    expect(res.incomplete).toBe(true);
    const cur = JSON.parse(res.nextCursor!);
    expect(cur).toMatchObject({ hw: "2026-09-02T09:00:00.000Z", cont: "100", maxSeen: "2026-09-03T10:00:00.000Z" });
    // The mark only moves once the window has drained: an unfinished walk must
    // not promote maxSeen over rows it never read.
    expect(lemlistConnector.importProgress!(res.nextCursor)).toBeNull();
  });

  it("registers one untyped hook carrying a secret we minted, and treats a 404 on teardown as success", async () => {
    const calls = stubFetch([{ _id: "hoo_1", targetUrl: "https://app/api/webhooks/conn_1", createdAt: "2026-09-08T00:00:00.000Z" }]);
    const reg = await lemlistConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "K" } });

    expect(reg.externalId).toBe("hoo_1");
    expect(reg.signingSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(new URL(calls[0].url).pathname).toBe("/api/hooks");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ targetUrl: "https://app/api/webhooks/conn_1", secret: reg.signingSecret });
    // No `type`: one hook takes every event and normalize does the selection.
    expect(body).not.toHaveProperty("type");
    // The minted secret is exactly what a delivery must echo back.
    expect(lemlistConnector.verifySignature({ rawBody: JSON.stringify({ ...activity(), secret: reg.signingSecret }), headers: {}, secret: reg.signingSecret! })).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found", headers: { get: () => null }, json: async () => ({}), text: async () => "Webhook not found" }) as unknown as Response),
    );
    await expect(lemlistConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "K" }, externalId: "hoo_1" })).resolves.toBeUndefined();
  });
});
