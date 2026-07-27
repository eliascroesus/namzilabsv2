import { describe, it, expect, vi, afterEach } from "vitest";
import { instantlyConnector, looksLikeInstantlyV1Key } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";
import { catalogEntry, syncGuarantee } from "@/connectors/catalog";

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

const T = (mins: number) => new Date(Date.parse("2026-07-01T12:00:00Z") + mins * 60_000).toISOString();

const CFG = (over: Record<string, unknown> = {}) => ({ campaignId: "camp-1", ...over });

describe("Instantly is campaign-scoped and analytics-first", () => {
  const daily = (date: string, sent: number) => ({ date, sent, campaign_id: "camp-1" });

  it("is declared: derived-mirror class, per-campaign flowFields, a budget for every operation", () => {
    const entry = catalogEntry("instantly")!;
    expect(entry.poll).toBe(true);
    expect(syncGuarantee("instantly")).toBe("derived-mirror");
    // Stream-scoped: the resource is chosen per flow, never workspace-wide.
    expect(entry.flowFields?.map((f) => f.key)).toEqual(["campaignId", "streamType", "days"]);
    // Every endpoint it can call has its own enforced budget.
    for (const op of instantlyConnector.operations ?? []) {
      expect(entry.rateLimits?.[op]?.requestsPerMinute).toBe(20);
    }
  });

  it("routes each streamType to its own endpoint budget", () => {
    const op = (t?: string) => instantlyConnector.operationFor!(t ? { streamType: t } : undefined);
    expect(op("analytics_daily")).toBe("campaigns.analytics.daily");
    expect(op("analytics_totals")).toBe("campaigns.analytics");
    expect(op("raw_emails")).toBe("emails.list");
    expect(op()).toBe("campaigns.analytics.daily"); // daily is the default
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
    const [fromWebhook] = sendblueConnector.normalize(payload, { connectionId: "c1" });
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
