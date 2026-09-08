import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { mailchimpConnector, mailchimpBaseUrl, mailchimpMemberEvent } from "@/connectors/mailchimp";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";
const KEY = "0123456789abcdef0123456789abcde-us14";

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

const SECRET = "zI3tsLziqBWhlz6V4PRlGg41u0gdhu7LhYXX4wa0ARM";
const nowSec = () => Math.floor(Date.now() / 1000);
/** Mailchimp: HMAC-SHA256, HEX, over `${t}.${rawBody}` — a DOT, and the header pairs are comma-separated. */
const sign = (ts: string, body: string) => createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
const sigHeader = (ts: string, body: string) => ({ "x-mailchimp-signature": `t=${ts},v1=${sign(ts, body)}` });

/**
 * A member in Mailchimp's own shapes: the id is an MD5 of the email, and the
 * three timestamps are three different questions. `last_changed` is the decoy —
 * it is the watermark, never the date.
 */
const member = (over: Record<string, unknown> = {}) => ({
  id: "8a25ff1d98",
  email_address: "ada@example.com",
  unique_email_id: "uniq_1",
  contact_id: "ctc_1",
  full_name: "Ada Lovelace",
  status: "subscribed",
  timestamp_signup: "2026-08-30T09:00:00+00:00",
  timestamp_opt: "2026-09-01T10:00:00+00:00",
  last_changed: "2026-09-05T12:00:00+00:00",
  member_rating: 4,
  source: "Signup form",
  list_id: "list_a",
  ...over,
});

describe("mailchimp: the base URL is derived from the key", () => {
  it("reads the data centre off the suffix and refuses a key that carries none", () => {
    expect(mailchimpBaseUrl(KEY)).toBe("https://us14.api.mailchimp.com/3.0");
    expect(mailchimpBaseUrl("abc-us6")).toBe("https://us6.api.mailchimp.com/3.0");
    expect(mailchimpBaseUrl("ABC-US6")).toBe("https://us6.api.mailchimp.com/3.0");
    // No suffix, or one that is not a data centre, would silently address the
    // wrong shard (or `https://.api.mailchimp.com`), so it is refused loudly.
    expect(() => mailchimpBaseUrl("0123456789abcdef")).toThrow(/data-centre suffix/);
    expect(() => mailchimpBaseUrl("0123456789abcdef-")).toThrow(/data-centre suffix/);
    expect(() => mailchimpBaseUrl("0123456789abcdef-nonsense")).toThrow(/data-centre suffix/);
  });
});

describe("mailchimp: signature", () => {
  const body = "type=subscribe&fired_at=2026-09-08+10%3A00%3A00&data%5Bid%5D=8a25ff1d98";

  it("accepts a t=,v1= hex HMAC over `${t}.${body}` and rejects everything else", () => {
    const ts = String(nowSec());
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(ts, body), secret: SECRET })).toBe(true);

    // Wrong secret.
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(ts, body), secret: "other" })).toBe(false);
    // Header absent entirely.
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    // Body altered by a single byte — the raw bytes are what is signed, which is
    // why nothing here URL-decodes the form body before verifying.
    expect(mailchimpConnector.verifySignature({ rawBody: `${body}&x=1`, headers: sigHeader(ts, body), secret: SECRET })).toBe(false);
    // Signature computed over the body alone, with no `t.` prefix.
    const noPrefix = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: { "x-mailchimp-signature": `t=${ts},v1=${noPrefix}` }, secret: SECRET })).toBe(false);
    // Paddle's separators (`;` between pairs, `:` inside the message) must not
    // pass: one wrong character in either place accepts or rejects everything.
    const colon = createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: { "x-mailchimp-signature": `t=${ts},v1=${colon}` }, secret: SECRET })).toBe(false);
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: { "x-mailchimp-signature": `t=${ts};v1=${sign(ts, body)}` }, secret: SECRET })).toBe(false);
  });

  it("rejects a stale timestamp — the guide's own 5-minute replay window", () => {
    const stale = String(nowSec() - 6 * 60);
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(stale, body), secret: SECRET })).toBe(false);
    const fresh = String(nowSec() - 60);
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(fresh, body), secret: SECRET })).toBe(true);
  });

  it("FAILS CLOSED with no secret, however well-formed the delivery looks", () => {
    // THE SABOTAGE TEST. Signing is per-webhook and the secret is shown exactly
    // once, so a connection genuinely can hold none — and an unverifiable
    // delivery is never accepted. Flip `if (!secret) return false;` in
    // verifySignature to `return true;` and this is what goes red.
    const ts = String(nowSec());
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(ts, body), secret: null })).toBe(false);
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(ts, body), secret: undefined })).toBe(false);
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: sigHeader(ts, body), secret: "" })).toBe(false);
    // And with no secret AND no header, which is what an unsigned legacy
    // webhook's POST actually looks like.
    expect(mailchimpConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(false);
  });
});

describe("mailchimp: normalize is deliberately absent", () => {
  it("declares none: the delivery is stream-blind and `fired_at` carries no timezone", () => {
    // "2009-03-26 21:35:57" with no offset is not a date anyone can honestly
    // parse, and the audience is a flowField so the hook is a doorbell anyway.
    // Sabotage: add a normalize and this says so.
    expect(mailchimpConnector.normalize).toBeUndefined();
    // Same reason there is no auto-registration: every webhook path is under
    // /lists/{list_id}, and no list exists at connect time.
    expect(mailchimpConnector.registerWebhook).toBeUndefined();
  });
});

describe("mailchimp: the member mapping", () => {
  it("is subscriber_added dated by the OPT-IN, never by last_changed", () => {
    const ev = mailchimpMemberEvent("list_a", member(), CONN)!;
    expect(ev.eventType).toBe("subscriber_added");
    // Namespaced source:connection:list:member — the member id is an MD5 of the
    // email and repeats across audiences, so the list has to be in the key.
    expect(ev.eventId).toBe("mailchimp:conn_1:list_a:8a25ff1d98");
    expect(mailchimpMemberEvent("list_b", member(), CONN)!.eventId).toBe("mailchimp:conn_1:list_b:8a25ff1d98");
    expect(mailchimpMemberEvent("list_a", member(), "conn_2")!.eventId).toBe("mailchimp:conn_2:list_a:8a25ff1d98");
    expect(ev.subject).toBe("ada@example.com");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    // No money exists on a contact, so neither figure is invented.
    expect(ev.value).toBeNull();
    expect(ev.currency).toBeNull();
    expect(ev.properties).toMatchObject({ status: "subscribed", list_id: "list_a", member_rating: 4 });
  });

  it("falls back to timestamp_signup, and skips a row it cannot date at all", () => {
    const single = mailchimpMemberEvent("list_a", member({ timestamp_opt: "" }), CONN)!;
    expect(single.occurredAt.toISOString()).toBe("2026-08-30T09:00:00.000Z");
    // last_changed is present on EVERY row and is still not a fallback: it
    // marches forward on any edit, so a join dated by it would drift.
    expect(mailchimpMemberEvent("list_a", member({ timestamp_opt: "", timestamp_signup: "" }), CONN)).toBeNull();
    expect(mailchimpMemberEvent("list_a", member({ id: null, contact_id: null }), CONN)).toBeNull();
  });

  it("keeps an unsubscribed member's join date and does not invent an unsubscribe", () => {
    // The API gives `unsubscribe_reason` and no unsubscribe timestamp, so the
    // only honest event is still the join; status rides in properties.
    const ev = mailchimpMemberEvent(
      "list_a",
      member({ status: "unsubscribed", unsubscribe_reason: "N/A (Manual)", last_changed: "2026-09-07T08:00:00+00:00" }),
      CONN,
    )!;
    expect(ev.eventType).toBe("subscriber_added");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(ev.properties).toMatchObject({ status: "unsubscribed", unsubscribe_reason: "N/A (Manual)" });
  });
});

describe("mailchimp: poll (stream = one audience)", () => {
  it("bounds and sorts on the SAME field and settles the mark on last_changed", async () => {
    const calls = stubFetch([{ members: [member()], total_items: 1 }]);
    const res = await mailchimpConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY }, config: { listId: "list_a" }, streamHash: "h1" });

    expect(res.records.map((r) => r.eventType)).toEqual(["subscriber_added"]);
    // THE WATERMARK: last_changed, the field the request filters on — not the
    // earlier timestamp_opt the event is dated by.
    expect(res.nextCursor).toBe("2026-09-05T12:00:00.000Z");
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");

    const u = new URL(calls[0].url);
    expect(u.host).toBe("us14.api.mailchimp.com");
    expect(u.pathname).toBe("/3.0/lists/list_a/members");
    expect(u.searchParams.get("sort_field")).toBe("last_changed");
    expect(u.searchParams.get("sort_dir")).toBe("ASC");
    expect(u.searchParams.get("count")).toBe("1000");
    expect(u.searchParams.get("offset")).toBe("0");
    // The documented ISO spelling, offset and all — no millisecond `Z` form.
    expect(u.searchParams.get("since_last_changed")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  });

  it("re-reads from the stored mark less the overlap, not from the first-sync floor", async () => {
    const calls = stubFetch([{ members: [] }]);
    await mailchimpConnector.poll!({
      connectionId: CONN,
      cursor: "2026-09-05T12:00:00.000Z",
      credentials: { apiKey: KEY },
      config: { listId: "list_a" },
    });
    // One hour behind the mark: the offset walk sorts on a MUTABLE key, so the
    // window deliberately overlaps what was already read.
    expect(new URL(calls[0].url).searchParams.get("since_last_changed")).toBe("2026-09-05T11:00:00+00:00");
  });

  it("follows the offset to a short page and drains a burst larger than one page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) =>
      member({ id: `m${i}`, email_address: `m${i}@example.com`, last_changed: `2026-09-0${(i % 5) + 1}T00:00:00+00:00` }),
    );
    const last = member({ id: "m_last", email_address: "last@example.com", last_changed: "2026-09-06T09:00:00+00:00", timestamp_opt: "2026-09-06T08:00:00+00:00" });
    const calls = stubFetch([{ members: full }, { members: [last] }]);

    const res = await mailchimpConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY }, config: { listId: "list_a" } });
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("offset")).toBe("1000");
    expect(res.records).toHaveLength(1001);
    expect(res.nextCursor).toBe("2026-09-06T09:00:00.000Z");
    // The walk ran out of data, not budget.
    expect(res.incomplete).toBeUndefined();
    expect(res.providerCalls).toBe(2);
  });

  it("stops at the budget, hands back a resumable cursor, and picks the offset back up", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => member({ id: `m${i}`, last_changed: "2026-09-02T00:00:00+00:00" }));
    const first = stubFetch([{ members: full }]);
    const stopped = await mailchimpConnector.poll!({
      connectionId: CONN,
      cursor: null,
      credentials: { apiKey: KEY },
      config: { listId: "list_a" },
      budget: { maxCalls: 1 },
    });
    expect(first).toHaveLength(1);
    expect(stopped.incomplete).toBe(true);
    // Mid-walk, so the cursor is the JSON continuation grammar, not a bare mark.
    expect(stopped.nextCursor).toMatch(/^\{/);
    expect(JSON.parse(stopped.nextCursor!)).toMatchObject({ hw: null, cont: "1000" });

    const second = stubFetch([{ members: [member({ id: "m_tail", last_changed: "2026-09-03T00:00:00+00:00" })] }]);
    const done = await mailchimpConnector.poll!({
      connectionId: CONN,
      cursor: stopped.nextCursor,
      credentials: { apiKey: KEY },
      config: { listId: "list_a" },
    });
    expect(new URL(second[0].url).searchParams.get("offset")).toBe("1000");
    expect(done.nextCursor).toBe("2026-09-03T00:00:00.000Z");
    expect(done.incomplete).toBeUndefined();
  });

  it("never declares a retire window, because occurredAt and the window are different axes", async () => {
    // A member who joined two years ago and was edited today arrives INSIDE the
    // change window carrying a two-year-old date. Retiring on that window would
    // tombstone real history, so the poll declares neither boundary.
    stubFetch([{ members: [member({ timestamp_opt: "2024-01-05T10:00:00+00:00", last_changed: "2026-09-05T12:00:00+00:00" })] }]);
    const res = await mailchimpConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY }, config: { listId: "list_a" } });
    expect(res.records[0].occurredAt.toISOString()).toBe("2024-01-05T10:00:00.000Z");
    expect(res.retireOutsideWindow).toBeUndefined();
    expect(res.mirrorScope).toBeUndefined();
    // The walk reached the end of the result set, so there is no import note to
    // show either — a settled mark, not a coverage fraction.
    expect(res.importProgress).toBeUndefined();
  });

  it("without an audience there is nothing to read; listOptions names them", async () => {
    expect(await mailchimpConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY }, config: {} })).toEqual({ records: [], nextCursor: null });

    const calls = stubFetch([{ lists: [{ id: "list_a", name: "Newsletter" }, { id: "list_b", name: null }, { id: null, name: "orphan" }] }]);
    expect(await mailchimpConnector.listOptions!("listId", { connectionId: CONN, credentials: { apiKey: KEY } })).toEqual([
      { value: "list_a", label: "Newsletter" },
      { value: "list_b", label: "list_b" },
    ]);
    expect(new URL(calls[0].url).pathname).toBe("/3.0/lists");
    expect(await mailchimpConnector.listOptions!("somethingElse", { connectionId: CONN, credentials: { apiKey: KEY } })).toEqual([]);
  });

  it("a missing key names the field and the fix rather than fetching anything", async () => {
    await expect(mailchimpConnector.poll!({ connectionId: CONN, cursor: null, credentials: {}, config: { listId: "list_a" } })).rejects.toThrow(/no apiKey/);
  });

  it("testFetchLatest previews on one call", async () => {
    stubFetch([{ members: [member(), member({ id: "m2", email_address: "b@example.com" })] }]);
    const latest = await mailchimpConnector.testFetchLatest!(1, {
      connectionId: CONN,
      cursor: null,
      credentials: { apiKey: KEY },
      config: { listId: "list_a" },
    });
    expect(latest).toHaveLength(1);
    expect(latest[0].eventType).toBe("subscriber_added");
  });
});
