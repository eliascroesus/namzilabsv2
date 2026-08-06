import { describe, it, expect, vi, afterEach } from "vitest";
import { instantlyConnector, looksLikeInstantlyV1Key } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";
import { catalogEntry, syncGuarantee } from "@/connectors/catalog";
import { pollOperation } from "@/lib/provider-gateway/operations";

/**
 * D.4 poll backstops for the formerly webhook-only sources, plus D.6
 * (Sendblue webhook subscription verify/re-register). Provider contracts are
 * encoded here as the assumed behavior; confirm once against the live APIs.
 */

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * THE FIXTURES ARE ANCHORED TO THE RUN, not to a date.
 *
 * This used to read `Date.parse("2026-07-01T12:00:00Z")`, and the connectors
 * bound their first sync to the last 30 days — so the fixtures aged out of the
 * window the code asks for and the suite began failing on a DATE, exactly 30
 * days later, for a reason with nothing to do with the behaviour under test. It
 * cost a verification pass to rule out as a real regression.
 *
 * A base captured once at module load keeps every relative offset stable within
 * a run while never drifting out of any window. Faking the clock would work too
 * and is what `tests/close-poll.test.ts` does — but that file touches no
 * database, and here a faked JS `Date` would disagree with PGlite's own `now()`
 * inside the sync lease.
 */
const BASE = Date.now();
const T = (mins: number) => new Date(BASE + mins * 60_000).toISOString();

const CFG = (over: Record<string, unknown> = {}) => ({ campaignId: "camp-1", ...over });

describe("Instantly is campaign-scoped and analytics-first", () => {
  const daily = (date: string, sent: number) => ({ date, sent, campaign_id: "camp-1" });

  it("is declared: derived-mirror class, per-campaign flowFields, the workspace-wide budget", () => {
    const entry = catalogEntry("instantly")!;
    expect(entry.poll).toBe(true);
    expect(syncGuarantee("instantly")).toBe("derived-mirror");
    // Stream-scoped: the resource is chosen per flow, never workspace-wide.
    expect(entry.flowFields?.map((f) => f.key)).toEqual(["campaignId", "streamType", "days"]);
    // ONE bucket, deliberately. Instantly publishes a single workspace-wide
    // 6,000/min limit shared across every endpoint and key, so the catalog
    // declares it on "*" and the connector emits no per-endpoint operations —
    // four invented 20/min buckets used to throttle this source to 0.3% of
    // its documented capacity.
    expect(instantlyConnector.operations).toBeUndefined();
    expect(instantlyConnector.operationFor).toBeUndefined();
    expect(entry.rateLimits?.["*"]?.requestsPerMinute).toBe(6_000);
  });

  it("every streamType lands on the one workspace bucket the provider actually has", () => {
    for (const config of [{ streamType: "analytics_daily" }, { streamType: "analytics_totals" }, { streamType: "raw_emails" }, undefined]) {
      expect(pollOperation("instantly", config)).toBe("*");
    }
  });

  it("daily analytics: one row per day, date-bounded, declaring its window as a mirror scope", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      seen.push(String(u));
      return jsonResponse({ items: [daily("2026-06-29", 10), daily("2026-06-30", 20)] });
    }));

    const res = await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ days: 7 }),
    });

    expect(seen[0]).toContain("/campaigns/analytics/daily");
    expect(seen[0]).toContain("campaign_id=camp-1");
    expect(seen[0]).toContain("start_date=");
    expect(seen[0]).toContain("exclude_total_leads_count=true");

    expect(res.records.map((r) => r.eventId)).toEqual([
      "instantly:c1:camp-1:daily:2026-06-29",
      "instantly:c1:camp-1:daily:2026-06-30",
    ]);
    // The window it declares is what bounds the mirror retire upstream.
    expect(res.mirrorScope).toBeDefined();
    const spanDays = Math.round((res.mirrorScope!.to.getTime() - res.mirrorScope!.from.getTime()) / 86_400_000);
    expect(spanDays).toBe(7);
  });

  it("campaign totals: a single row that restates in place and does not march forward", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [{ campaign_id: "camp-1", sent: 500, created_at: "2026-01-01T00:00:00Z" }] })));
    const a = await instantlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ streamType: "analytics_totals" }) });
    const b = await instantlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ streamType: "analytics_totals" }) });

    expect(a.records).toHaveLength(1);
    expect(a.records[0].eventId).toBe("instantly:c1:camp-1:totals");
    // Stable id AND stable timestamp: two sweeps produce the same row, not a new one.
    expect(b.records[0].eventId).toBe(a.records[0].eventId);
    expect(b.records[0].occurredAt.toISOString()).toBe(a.records[0].occurredAt.toISOString());
    // A single restated row needs no window — nothing to retire.
    expect(a.mirrorScope).toBeUndefined();
  });

  /**
   * THE LIVE BUG THIS BLOCK EXISTS FOR.
   *
   * `/campaigns/analytics` IGNORES `campaign_id` — verified against the live API
   * on 2026-08-02: the filtered request returned 49 rows and the identical
   * unfiltered request returned the same 49. It answers with one row per
   * campaign in the workspace, whatever you ask for.
   *
   * The connector took `rows[0]` and then spread `campaign_id: <requested>` over
   * it. On a 52-campaign workspace that meant every "Campaign totals" stream
   * stored the FIRST campaign's numbers under whichever campaign the user chose,
   * and the overwrite made the row claim to be the right one. Wrong numbers
   * wearing the right label — nothing about the stored row looked wrong.
   *
   * The fixture puts the requested campaign SECOND on purpose. A fixture with
   * one row, or with the right row first, passes against the broken code.
   */
  // Identified by `id`, not `campaign_id`, for two reasons: it exercises the
  // fallback in `rowCampaignId` (a per-campaign totals row's own id IS the
  // campaign), and it makes the no-overwrite assertion below able to fail —
  // stamping `campaign_id` onto a row keyed by `campaign_id` is a no-op, so a
  // fixture using that key cannot detect the overwrite at all.
  const totalsFor = (id: string, sent: number) => ({ id, sent, created_at: "2026-01-01T00:00:00Z" });

  it("campaign totals: picks the requested campaign out of a response containing every campaign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ items: [totalsFor("camp-OTHER", 999), totalsFor("camp-1", 500), totalsFor("camp-3", 7)] })),
    );
    const res = await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ streamType: "analytics_totals" }),
    });

    expect(res.records).toHaveLength(1);
    expect(res.records[0].properties?.sent, "stored another campaign's totals").toBe(500);
    // BYTE-FOR-BYTE what the provider sent — no added key, no overwritten one.
    // Spreading `campaign_id: <requested>` over the row is the step that turned
    // a wrong row into an unnoticeable one, and only an exact comparison can
    // see a field being added.
    expect(res.records[0].properties).toEqual({ id: "camp-1", sent: 500, created_at: "2026-01-01T00:00:00Z" });
  });

  it("campaign totals: stores NOTHING when the response holds no row for this campaign", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [totalsFor("camp-OTHER", 999), totalsFor("camp-3", 7)] })));
    const res = await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ streamType: "analytics_totals" }),
    });
    // An empty stream is visible — the nightly invariant scan reports it. A
    // plausible total belonging to somebody else is not.
    expect(res.records).toHaveLength(0);
  });

  it("daily analytics: keeps only the requested campaign's days out of a multi-campaign response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          items: [
            { date: "2026-06-29", sent: 111, campaign_id: "camp-OTHER" },
            { date: "2026-06-29", sent: 10, campaign_id: "camp-1" },
            { date: "2026-06-30", sent: 222, campaign_id: "camp-OTHER" },
          ],
        }),
      ),
    );
    const res = await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ days: 7 }),
    });
    expect(res.records).toHaveLength(1);
    expect(res.records[0].properties?.sent).toBe(10);
    expect(res.records[0].eventId).toBe("instantly:c1:camp-1:daily:2026-06-29");
  });

  /**
   * The case scoping-by-field cannot reach: rows that name no campaign at all.
   *
   * One row per DAY is the endpoint's shape, so a repeated date proves the
   * response spans several campaigns. Every row for that day would collide on
   * one `eventId` and the last written would win, arbitrarily — the totals bug
   * again, in a stream that looks like it is working.
   */
  it("daily analytics: stores nothing when unlabelled rows repeat a date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ items: [{ date: "2026-06-29", sent: 111 }, { date: "2026-06-29", sent: 10 }] }),
      ),
    );
    const res = await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ days: 7 }),
    });
    expect(res.records).toHaveLength(0);
  });

  it("daily analytics: unlabelled rows with distinct dates are still stored", async () => {
    // The benign reading of the same shape — one campaign's days, no id echoed.
    // Refusing these too would empty a working stream on a provider that simply
    // does not repeat the campaign on every row.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ items: [{ date: "2026-06-29", sent: 10 }, { date: "2026-06-30", sent: 20 }] }),
      ),
    );
    const res = await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ days: 7 }),
    });
    expect(res.records).toHaveLength(2);
  });

  it("raw emails stay campaign-scoped and date-bounded — never a workspace dump", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      seen.push(String(u));
      return jsonResponse({ items: [], next_starting_after: null });
    }));
    await instantlyConnector.poll!({
      connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG({ streamType: "raw_emails" }),
    });
    expect(seen[0]).toContain("/emails?");
    expect(seen[0]).toContain("campaign_id=camp-1");
  });

  it("a stream with no campaign chosen makes no provider call at all", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const res = await instantlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: {} });
    expect(res.records).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the campaign picker lists real campaigns", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      expect(String(u)).toContain("/campaigns");
      return jsonResponse({ items: [{ id: "camp-1", name: "Q3 outbound" }, { id: "camp-2", name: "Q4" }] });
    }));
    const opts = await instantlyConnector.listOptions!("campaignId", { connectionId: "c1", credentials: { apiKey: "k" } });
    expect(opts).toEqual([
      { value: "camp-1", label: "Q3 outbound" },
      { value: "camp-2", label: "Q4" },
    ]);
  });

  it("the preview reads analytics, not the emails list", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      seen.push(String(u));
      return jsonResponse({ items: [daily("2026-06-30", 20)] });
    }));
    const rows = await instantlyConnector.testFetchLatest!(3, { connectionId: "c1", cursor: null, credentials: { apiKey: "k" }, config: CFG() });
    expect(rows).toHaveLength(1);
    expect(seen.every((u) => !u.includes("/emails"))).toBe(true);
  });

  it("401 surfaces a v2-reconnect message, naming the v1 deprecation for v1-looking keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    const v1 = (await instantlyConnector
      .poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "short" }, config: CFG() })
      .catch((e) => e as Error)) as Error;
    expect(String(v1.message)).toContain("Jan 19, 2026");
    expect(String(v1.message)).toContain("v2 API key");
  });

  it("key-era heuristic: long base64(uuid:secret) is v2; short opaque tokens are v1-suspect", () => {
    expect(looksLikeInstantlyV1Key(Buffer.from("2f1c0b3e-1111-2222-3333-444455556666:supersecretvalue").toString("base64"))).toBe(false);
    expect(looksLikeInstantlyV1Key("abc123")).toBe(true);
  });
});

describe("Sendblue messages poll + webhook health", () => {
  const msg = (handle: string, mins: number, over: Record<string, unknown> = {}) => ({
    message_handle: handle,
    status: "DELIVERED",
    is_outbound: true,
    to_number: "+15551234567",
    date_sent: T(mins),
    ...over,
  });

  it("is declared as a poll source (incremental class — the warning strip goes away)", () => {
    expect(catalogEntry("sendblue")!.poll).toBe(true);
    expect(syncGuarantee("sendblue")).toBe("incremental");
  });

  it("polls message history with sb auth headers, dedups on message_handle, honors the floor", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
        expect(url.pathname).toBe("/api/v2/messages");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        // One page of history: two fresh, one ancient (below the floor).
        return jsonResponse(offset === 0 ? { messages: [msg("h2", 30), msg("h1", 20, { status: "SENT" }), msg("h0", -600)] } : { messages: [] });
      }),
    );
    const res = await sendblueConnector.poll!({
      connectionId: "c1",
      cursor: T(0),
      credentials: { apiKey: "kid", apiSecret: "ksec" },
    });
    expect(seenHeaders[0]["sb-api-key-id"]).toBe("kid");
    expect(seenHeaders[0]["sb-api-secret-key"]).toBe("ksec");
    // Keyed on the handle alone — the status is a property, so a message that
    // moves QUEUED → SENT → DELIVERED stays one row.
    expect(res.records.map((r) => r.eventId)).toEqual(["sendblue:c1:h2", "sendblue:c1:h1"]);
    expect(res.nextCursor).toBe(T(30)); // newest seen
  });

  it("poll and webhook produce the SAME event id for the same message state (reconciliation dedups)", async () => {
    const payload = msg("h9", 5);
    const [fromWebhook] = sendblueConnector.normalize!(payload, { connectionId: "c1" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ messages: [payload] })));
    const { records } = await sendblueConnector.poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "a", apiSecret: "b" } });
    expect(records[0].eventId).toBe(fromWebhook.eventId);
  });

  it("verifyWebhookSubscription: present → healthy; missing → re-registers via POST /api/account/webhooks", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    let hooks: Array<{ url: string }> = [{ url: "https://app.example/api/webhooks/OTHER" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        expect(url).toContain("/api/account/webhooks");
        if ((init?.method ?? "GET").toUpperCase() === "POST") {
          posts.push({ url, body: JSON.parse(String(init?.body)) });
          hooks = [...hooks, { url: (JSON.parse(String(init?.body)) as { url: string }).url }];
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ webhooks: hooks });
      }),
    );
    const args = { connectionId: "c1", webhookUrl: "https://app.example/api/webhooks/c1", credentials: { apiKey: "a", apiSecret: "b" } };

    const first = await sendblueConnector.verifyWebhookSubscription!(args);
    expect(first).toEqual({ healthy: true, reregistered: true });
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ url: "https://app.example/api/webhooks/c1" });

    const second = await sendblueConnector.verifyWebhookSubscription!(args);
    expect(second).toEqual({ healthy: true, reregistered: false });
    expect(posts).toHaveLength(1); // no duplicate registration
  });

  it("verifyWebhookSubscription reports failure without throwing (sweep never blocked)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 500)));
    const res = await sendblueConnector.verifyWebhookSubscription!({
      connectionId: "c1",
      webhookUrl: "https://app.example/api/webhooks/c1",
      credentials: { apiKey: "a", apiSecret: "b" },
    });
    expect(res.healthy).toBe(false);
    expect(res.reregistered).toBe(false);
    expect(res.detail).toContain("500");
  });
});

/**
 * A WALK THAT GAVE UP MUST NOT MOVE THE MARK IT DID NOT REACH.
 *
 * `serializeWindowCursor` falls through to `maxSeen ?? hw` the moment `cont` is
 * null, which is right for a walk that DRAINED and wrong for one that stopped.
 * The 400 handler cleared `cont` to unwedge the stream and took the promotion
 * with it: `/emails` is newest-first, so a partial walk holds the newest pages
 * and the unread remainder is older than everything in it. Promoting `maxSeen`
 * puts that remainder below the next window's floor, where nothing requests it
 * again — the stream unwedges by silently discarding what it had not reached.
 *
 * Close had the same defect and its serializer guarded only the first sync
 * (`!hw && floor`), so a steady-state connection was unprotected. Both now
 * decide at the call site, where "drained" and "gave up" are distinguishable.
 */
describe("Instantly: a dead continuation restarts the window without advancing it", () => {
  const email = (id: string, iso: string) => ({
    id,
    ue_type: 1,
    to_address_email_list: "a@b.com",
    timestamp_created: iso,
  });

  it("keeps the high-water mark where it was, and reports the sweep unfinished", async () => {
    const hw = "2026-06-01T00:00:00.000Z";
    const newest = "2026-06-20T00:00:00.000Z";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        // Page one lands and sets maxSeen; the continuation is then rejected.
        if (call === 1) return jsonResponse({ items: [email("e1", newest)], next_starting_after: "cont-2" });
        return jsonResponse({ error: "invalid starting_after" }, 400);
      }),
    );

    const res = await instantlyConnector.poll!({
      connectionId: "c1",
      cursor: JSON.stringify({ hw, cont: null, maxSeen: null }),
      credentials: { apiKey: "k" },
      config: CFG({ streamType: "raw_emails", days: 90 }),
    });

    // What landed is kept — only the mark is held back.
    expect(res.records.map((r) => r.eventId)).toEqual(["instantly:c1:email:e1"]);
    expect(res.nextCursor).toBe(hw);
    expect(res.nextCursor).not.toBe(newest);
    // There is outstanding work: the window is going to be re-walked.
    expect(res.incomplete).toBe(true);
  });

  it("still promotes the mark when the walk actually drained", async () => {
    const hw = "2026-06-01T00:00:00.000Z";
    const newest = "2026-06-20T00:00:00.000Z";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ items: [email("e1", newest)], next_starting_after: null })),
    );

    const res = await instantlyConnector.poll!({
      connectionId: "c1",
      cursor: JSON.stringify({ hw, cont: null, maxSeen: null }),
      credentials: { apiKey: "k" },
      config: CFG({ streamType: "raw_emails", days: 90 }),
    });
    expect(res.nextCursor).toBe(newest);
    expect(res.incomplete).toBeFalsy();
  });

  /**
   * An empty page carrying a continuation is a provider with more to give, not a
   * finished walk. Treating it as drained is the shape that cost this codebase
   * the Calendly past-side window and the truncated `pollAll` walk; here it would
   * promote the mark over an unread remainder.
   */
  it("walks past an empty page instead of calling it the end", async () => {
    const hw = "2026-06-01T00:00:00.000Z";
    const older = "2026-06-10T00:00:00.000Z";
    const newest = "2026-06-20T00:00:00.000Z";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return jsonResponse({ items: [email("e1", newest)], next_starting_after: "p2" });
        if (call === 2) return jsonResponse({ items: [], next_starting_after: "p3" });
        return jsonResponse({ items: [email("e2", older)], next_starting_after: null });
      }),
    );

    const res = await instantlyConnector.poll!({
      connectionId: "c1",
      cursor: JSON.stringify({ hw, cont: null, maxSeen: null }),
      credentials: { apiKey: "k" },
      config: CFG({ streamType: "raw_emails", days: 90 }),
    });

    expect(res.records.map((r) => r.eventId).sort()).toEqual(["instantly:c1:email:e1", "instantly:c1:email:e2"]);
    expect(res.nextCursor).toBe(newest);
  });
});
