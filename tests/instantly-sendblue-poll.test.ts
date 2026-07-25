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

describe("Instantly v2 emails poll", () => {
  const email = (id: string, mins: number, ueType = 1) => ({
    id,
    ue_type: ueType,
    timestamp_created: T(mins),
    from_address_email: "sender@x.com",
    to_address_email_list: "lead@y.com, cc@y.com",
  });

  it("is declared: poll + incremental class + published 20/min budget for emails.list", () => {
    const entry = catalogEntry("instantly")!;
    expect(entry.poll).toBe(true);
    expect(syncGuarantee("instantly")).toBe("incremental");
    expect(entry.rateLimits).toEqual({ "emails.list": { requestsPerMinute: 20 } });
  });

  it("walks pages via starting_after, maps sent/reply, advances the mark when drained", async () => {
    const pages: Record<string, unknown> = {
      first: { items: [email("e3", 30), email("e2", 20, 2)], next_starting_after: "P2" },
      P2: { items: [email("e1", 10)], next_starting_after: null },
    };
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        urls.push(String(input));
        return jsonResponse(pages[url.searchParams.get("starting_after") ?? "first"]);
      }),
    );
    const res = await instantlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "k".repeat(60) } });
    expect(res.records.map((r) => r.eventId)).toEqual([
      "instantly:c1:email:e3",
      "instantly:c1:email:e2",
      "instantly:c1:email:e1",
    ]);
    expect(res.records.map((r) => r.eventType)).toEqual(["email_sent", "reply", "email_sent"]);
    expect(res.records[1].subject).toBe("sender@x.com"); // reply → from
    expect(res.records[0].subject).toBe("lead@y.com"); // sent → first recipient
    expect(res.nextCursor).toBe(T(30)); // drained → newest timestamp
    expect(urls[0]).toContain("/api/v2/emails");
  });

  it("persists a continuation mid-window and resumes without stranding anything", async () => {
    // 5 pages of 1; budget is 3 pages per poll.
    const mk = (n: number) => ({ items: [email(`e${n}`, n)], next_starting_after: n > 1 ? `P${n - 1}` : null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const key = url.searchParams.get("starting_after");
        return jsonResponse(mk(key ? Number(key.slice(1)) : 5));
      }),
    );
    const args = { connectionId: "c1", credentials: { apiKey: "k".repeat(60) } };
    const first = await instantlyConnector.poll!({ ...args, cursor: null });
    expect(first.records).toHaveLength(3);
    expect(first.nextCursor!.startsWith("{")).toBe(true); // mid-walk continuation

    const second = await instantlyConnector.poll!({ ...args, cursor: first.nextCursor });
    const all = new Set([...first.records, ...second.records].map((r) => r.eventId));
    expect(all.size).toBe(5); // union covers every email exactly once
    expect(second.nextCursor).toBe(T(5)); // drained → mark at the newest seen
  });

  it("stops early once a page is entirely below the window floor (incremental cheapness)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        calls.push(String(input));
        // Everything is far older than the stored high-water mark.
        return jsonResponse({ items: [email("old", -600)], next_starting_after: "MORE" });
      }),
    );
    const res = await instantlyConnector.poll!({ connectionId: "c1", cursor: T(0), credentials: { apiKey: "k".repeat(60) } });
    expect(res.records).toHaveLength(0);
    expect(calls).toHaveLength(1); // did not keep walking
    expect(res.nextCursor).toBe(T(0)); // mark never regresses
  });

  it("401 surfaces a v2-reconnect message, naming the v1 deprecation for v1-looking keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    // Short opaque token → v1-suspect wording.
    const v1 = (await instantlyConnector
      .poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: "abc123" } })
      .catch((e) => e as Error)) as Error;
    expect(String(v1.message)).toContain("Jan 19, 2026");
    expect(String(v1.message)).toContain("v2 API key");

    // Long v2-shaped key → plain reconnect wording (no misleading v1 claim).
    const v2 = (await instantlyConnector
      .poll!({ connectionId: "c1", cursor: null, credentials: { apiKey: Buffer.from(`${"u".repeat(36)}:secretsecret`).toString("base64") } })
      .catch((e) => e as Error)) as Error;
    expect(String(v2.message)).toContain("reconnect");
    expect(String(v2.message)).not.toContain("Jan 19");
  });

  it("key-era heuristic: long base64(uuid:secret) is v2; short opaque tokens are v1-suspect", () => {
    expect(looksLikeInstantlyV1Key(Buffer.from(`${"u".repeat(36)}:secret`).toString("base64"))).toBe(false);
    expect(looksLikeInstantlyV1Key("abc123shortkey")).toBe(true);
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
    expect(res.records.map((r) => r.eventId)).toEqual([
      "sendblue:c1:sms_delivered:h2",
      "sendblue:c1:sms_sent:h1",
    ]);
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
