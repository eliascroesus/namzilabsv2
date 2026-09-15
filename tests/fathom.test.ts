import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { fathomConnector } from "@/connectors/fathom";
import { catalogEntry } from "@/connectors/catalog";

/**
 * FATHOM — asserted against the contract on developers.fathom.ai, read 13 Sep
 * 2026, not against the scaffold's placeholders.
 *
 * The generated file arrived asserting an `x-signature` hex HMAC over a `/events`
 * endpoint returning `data`, with `email` and `created_at` on the row. Fathom
 * does none of those things, and every one of those assertions would have passed
 * against a stub while failing against the provider — the exact shape of the
 * Whop `company_id` bug, where a fake server that accepts anything let a wrong
 * parameter sit green in the suite for days.
 */

afterEach(() => vi.unstubAllGlobals());

const CONN = "conn_1";
/** Fathom mints `whsec_<base64>`; the kit verifier tries the decoded bytes and the raw string. */
const SECRET = "whsec_c2VjcmV0LWtleS1mb3ItdGVzdHM=";

/** A Standard Webhooks delivery: HMAC-SHA256 over `{id}.{timestamp}.{body}`, base64. */
function deliver(body: string, at = new Date()) {
  const id = "msg_1";
  const ts = String(Math.floor(at.getTime() / 1000));
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`, "utf8").digest("base64");
  return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
}

/** One meeting in the shape `/meetings` returns. */
const meeting = (over: Record<string, unknown> = {}) => ({
  id: "mtg_1",
  scheduled_start_time: "2026-09-01T10:00:00Z",
  created_at: "2026-09-01T11:30:00Z",
  recorded_by: { email: "rep@acme.com" },
  calendar_invitees: [
    { email: "rep@acme.com", is_external: false },
    { email: "buyer@customer.io", is_external: true },
  ],
  ...over,
});

describe("Fathom: signature", () => {
  it("accepts a Standard Webhooks delivery and fails closed otherwise", () => {
    const body = JSON.stringify({ id: "mtg_1" });
    const headers = deliver(body);
    expect(fathomConnector.verifySignature({ rawBody: body, headers, secret: SECRET })).toBe(true);
    expect(fathomConnector.verifySignature({ rawBody: body, headers, secret: null })).toBe(false);
    expect(fathomConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    // A tampered body must not verify against the signature of the original.
    expect(fathomConnector.verifySignature({ rawBody: `${body} `, headers, secret: SECRET })).toBe(false);
  });

  it("refuses a delivery outside the replay window", () => {
    // Fathom documents a five-minute tolerance; an hour old is a replay.
    const body = JSON.stringify({ id: "mtg_1" });
    const stale = deliver(body, new Date(Date.now() - 60 * 60_000));
    expect(fathomConnector.verifySignature({ rawBody: body, headers: stale, secret: SECRET })).toBe(false);
  });
});

describe("Fathom: normalize", () => {
  it("dates a meeting by when it HAPPENED, not when Fathom finished processing it", () => {
    /**
     * `created_at` is 90 minutes after `scheduled_start_time` here, which is the
     * ordinary gap while a recording is processed. Taking it would put a
     * late-evening meeting on the following day for any "meetings today" metric.
     */
    const [ev] = fathomConnector.normalize!({ data: meeting() }, { connectionId: CONN });
    expect(ev.eventId).toBe("fathom:conn_1:mtg_1");
    expect(ev.eventType).toBe("meeting");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  it("attributes the meeting to the external attendee, not the rep who recorded it", () => {
    // The row is joined to a person downstream, and the useful person is the
    // customer. The recorder is on every one of their own meetings.
    const [ev] = fathomConnector.normalize!({ data: meeting() }, { connectionId: CONN });
    expect(ev.subject).toBe("buyer@customer.io");
  });

  it("falls back to the recorder when a meeting has no external party", () => {
    const internal = meeting({ calendar_invitees: [{ email: "rep@acme.com", is_external: false }] });
    const [ev] = fathomConnector.normalize!({ data: internal }, { connectionId: CONN });
    expect(ev.subject).toBe("rep@acme.com");
  });

  it("reads a payload that is not wrapped, too", () => {
    const [ev] = fathomConnector.normalize!(meeting(), { connectionId: CONN });
    expect(ev.eventId).toBe("fathom:conn_1:mtg_1");
  });
});

describe("Fathom: poll", () => {
  /** Capture every URL the walk requests, answering with one page of meetings. */
  function serve(rows: Array<Record<string, unknown>>) {
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        urls.push(String(url));
        headers.push(init?.headers ?? {});
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => ({ items: rows, next_cursor: null, limit: 50 }),
          text: async () => "",
        };
      }),
    );
    return { urls, headers };
  }

  it("walks /meetings on created_after and maps what it finds", async () => {
    const rows = [meeting({ id: "mtg_1", scheduled_start_time: "2026-09-01T10:00:00Z" }), meeting({ id: "mtg_2", scheduled_start_time: "2026-09-02T10:00:00Z" })];
    const { urls } = serve(rows);
    const res = await fathomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } });

    expect(res.records).toHaveLength(2);
    expect(urls[0]).toContain("/meetings");
    expect(urls[0]).toContain("created_after=");
    // `updated_after` does not exist on this endpoint — asking for it would be
    // silently ignored and the walk would believe it had filtered.
    expect(urls[0]).not.toContain("updated_after");
  });

  /** Answer with an arbitrary body, to test what the walk does with a shape it did not expect. */
  function serveBody(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => body,
        text: async () => "",
      })),
    );
  }

  it("an EMPTY items array is a quiet zero — a legitimately empty account", async () => {
    serveBody({ items: [], next_cursor: null });
    const res = await fathomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } });
    expect(res.records).toHaveLength(0);
  });

  it("a MISSING items array throws, naming the keys that did arrive", async () => {
    /**
     * THE DISTINCTION THAT MADE THIS CONNECTOR UNDEBUGGABLE. `page.items ?? []`
     * turns "the provider sent a shape we do not parse" into "there is no
     * data" — an identical, silent, believable zero. A real key produced
     * exactly that on 15 Sep 2026 and nothing anywhere could say which of the
     * two had happened.
     *
     * The keys go in the message because that string IS the diagnosis: it
     * reaches `last_error` and the connection page, and it says either "the
     * envelope moved" or "look at the key".
     */
    serveBody({ meetings: [], page: 1 });
    await expect(
      fathomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } }),
    ).rejects.toThrow(/did not return an "items" array.*meetings, page/s);
  });

  it("never asks for transcripts, which would move it to Fathom's heavy rate bucket", async () => {
    /**
     * THE ASSERTION THAT PROTECTS THE SYNC. `include_summary` or
     * `include_transcript` set true puts the request in a 30-per-60s bucket that
     * Fathom may reduce to 5, against the 60/min the catalog declares and the
     * budget layer spends against. Someone adding "just the summary" would not
     * see a failure — they would see a sync that mysteriously stops keeping up.
     */
    const { urls } = serve([meeting()]);
    await fathomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } });
    expect(urls[0]).not.toContain("include_transcript=true");
    expect(urls[0]).not.toContain("include_summary=true");
  });

  it("authenticates with X-Api-Key rather than a bearer token", async () => {
    /**
     * Fathom's reference lists both header names, but they are two auth MODES:
     * `X-Api-Key` carries an API key, `Authorization: Bearer` carries an OAuth
     * access token. A key sent as a bearer token is the sort of thing that works
     * until the provider tightens it.
     */
    const { headers } = serve([meeting()]);
    await fathomConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } });
    const sent = Object.fromEntries(Object.entries(headers[0]).map(([k, v]) => [k.toLowerCase(), v]));
    expect(sent["x-api-key"]).toBe("k");
    expect(sent["authorization"]).toBeUndefined();
  });

  it("names the missing credential rather than failing on a 401", async () => {
    await expect(fathomConnector.poll!({ connectionId: CONN, cursor: null, credentials: {} })).rejects.toThrow(/Fathom/);
  });
});

describe("Fathom: catalog", () => {
  it("is registered with provenance", () => {
    const e = catalogEntry("fathom")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    // 60/min is the per-USER limit from the API overview, not the heavy bucket.
    expect(e.rateLimits?.["api.request"]?.requestsPerMinute).toBe(60);
  });
});
