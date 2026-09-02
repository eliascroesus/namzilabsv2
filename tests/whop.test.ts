import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { whopConnector } from "@/connectors/whop";
import { catalogEntry, syncGuarantee } from "@/connectors/catalog";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { getConnector } from "@/connectors/registry";
import { decryptCredentials } from "@/lib/credentials";
import { createTestDb } from "./helpers/testdb";
import type { DB } from "@/db/types";

/**
 * Whop — payments and memberships. Every behaviour pinned here was read off
 * Whop's own documentation while the connector was written; the two places
 * their docs contradict themselves are pinned as TOLERANCE rather than as a
 * guess (see the signature tests).
 */

afterEach(() => vi.unstubAllGlobals());

const CONN = "conn_1";
const CREDS = { apiKey: "key_live_x", companyId: "biz_abc" };

// C21 — `createConnection` touches the database directly and, for a
// poll-capable source like Whop, dispatches a first sync through Inngest.
// Same three mocks as org-caps.test.ts / connections.test.ts; `db` is
// assigned inside the "pasted webhook secret" describe's own beforeEach so
// the rest of this file's tests (pure connector unit tests) pay nothing for
// PGlite.
let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const { createConnection, getSigningSecret } = await import("@/lib/connections");

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

const payment = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "paid",
  substatus: "succeeded",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:00:00.000Z",
  paid_at: "2026-08-01T10:05:00.000Z",
  currency: "usd",
  total: 6.9,
  user: { id: "user_1", email: "buyer@example.com", username: "buyer" },
  product: { id: "prod_1", title: "Pickaxe Analytics" },
  ...over,
});

const membership = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "active",
  created_at: "2026-08-02T09:00:00.000Z",
  updated_at: "2026-08-02T09:00:00.000Z",
  user: { id: "user_2", email: "member@example.com", username: "member" },
  product: { id: "prod_1", title: "Pickaxe Analytics" },
  ...over,
});

/** Standard Webhooks: base64 HMAC-SHA256 over `{id}.{timestamp}.{body}`. */
const sign = (key: Buffer | string, id: string, ts: string, body: string) =>
  createHmac("sha256", key).update(`${id}.${ts}.${body}`, "utf8").digest("base64");

describe("Whop webhook signature (Standard Webhooks)", () => {
  const body = JSON.stringify({ data: payment("pay_1") });
  const id = "msg_123";
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = (sig: string) => ({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig });

  /**
   * THE CONTRADICTION, PINNED. Whop's webhooks guide says "The key is your
   * `ws_...` secret" — the string itself — while the spec it follows
   * base64-decodes the secret after stripping its prefix, and their API
   * reference prints the secret as `whsec_abc123def456`. We cannot settle
   * that from the docs, so BOTH are accepted: one extra HMAC, and neither
   * reading can reject a customer's entire delivery stream.
   */
  it("accepts the signature under EITHER documented reading of the key", () => {
    const raw = "ws_c2VjcmV0LWtleQ==";
    expect(whopConnector.verifySignature({ rawBody: body, headers: headers(`v1,${sign(raw, id, ts, body)}`), secret: raw })).toBe(true);

    const decoded = Buffer.from("c2VjcmV0LWtleQ==", "base64");
    expect(whopConnector.verifySignature({ rawBody: body, headers: headers(`v1,${sign(decoded, id, ts, body)}`), secret: raw })).toBe(true);
  });

  it("accepts one valid signature among several (secret rotation)", () => {
    const secret = "whsec_YWJj";
    const good = sign(secret, id, ts, body);
    const sig = `v1,${sign("other", id, ts, body)} v1,${good}`;
    expect(whopConnector.verifySignature({ rawBody: body, headers: headers(sig), secret })).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, and a missing header", () => {
    const secret = "whsec_YWJj";
    const sig = `v1,${sign(secret, id, ts, body)}`;
    expect(whopConnector.verifySignature({ rawBody: `${body} `, headers: headers(sig), secret })).toBe(false);
    expect(whopConnector.verifySignature({ rawBody: body, headers: headers(sig), secret: "whsec_ZGlmZg" })).toBe(false);
    expect(whopConnector.verifySignature({ rawBody: body, headers: { "webhook-id": id }, secret })).toBe(false);
  });

  it("rejects a stale delivery — the five-minute replay window Whop states", () => {
    const secret = "whsec_YWJj";
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = `v1,${sign(secret, id, old, body)}`;
    expect(
      whopConnector.verifySignature({ rawBody: body, headers: { "webhook-id": id, "webhook-timestamp": old, "webhook-signature": sig }, secret }),
    ).toBe(false);
  });

  it("fails CLOSED with no secret — Whop hands one out when the webhook is created", () => {
    // Sabotage: return true here and anyone who learns the URL can post
    // revenue into a customer's dashboard.
    expect(whopConnector.verifySignature({ rawBody: body, headers: headers("v1,x"), secret: null })).toBe(false);
  });
});

describe("Whop normalize — a delivery and a poll are ONE record", () => {
  it("keys on the resource id, so a webhook and a later poll upsert one row", () => {
    const fromHook = whopConnector.normalize!({ type: "payment.succeeded", data: payment("pay_9") }, { connectionId: CONN })[0];
    expect(fromHook.eventId).toBe(`whop:${CONN}:pay_9`);
    // Sabotage: key on the delivery id and the same payment lands twice —
    // once from the webhook, once from the poll — double-counting revenue.
    expect(fromHook.eventType).toBe("payment");
    expect(fromHook.value).toBe(6.9);
    expect(fromHook.currency).toBe("USD");
    expect(fromHook.subject).toBe("buyer@example.com");
    // The delivery's own name is kept beside the resource, never instead of
    // the record type — so a refund updating this row cannot move it.
    expect((fromHook.properties as Record<string, unknown>).webhook_event).toBe("payment.succeeded");
  });

  it("reads the resource whether or not the envelope wraps it in `data`", () => {
    // Whop documents no delivery envelope; both shapes resolve to one record.
    const wrapped = whopConnector.normalize!({ data: membership("mem_1") }, { connectionId: CONN });
    const bare = whopConnector.normalize!(membership("mem_1"), { connectionId: CONN });
    expect(wrapped[0].eventId).toBe(bare[0].eventId);
    expect(bare[0].eventType).toBe("membership");
    // A membership carries no money — a zero here would average into revenue.
    expect(bare[0].value).toBeNull();
  });

  it("ignores a payload with no resource id rather than inventing one", () => {
    expect(whopConnector.normalize!({ type: "payment.succeeded" }, { connectionId: CONN })).toEqual([]);
    expect(whopConnector.normalize!({ data: { id: "unknown_1" } }, { connectionId: CONN })).toEqual([]);
  });
});

describe("Whop poll", () => {
  /** Serves payments then memberships, recording the URLs it was asked for. */
  function serve(pages: Record<string, unknown[]>, opts: { nextAfter?: string } = {}) {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        const kind = url.includes("/payments") ? "payments" : "memberships";
        const rows = pages[kind] ?? [];
        const more = opts.nextAfter != null && kind === "payments" && !url.includes("&after=");
        return jsonResponse({
          data: rows,
          page_info: { has_next_page: more, end_cursor: more ? opts.nextAfter : null },
        });
      }),
    );
    return urls;
  }

  it("reads both collections, on the axis each one actually supports", async () => {
    const urls = serve({ payments: [payment("pay_1")], memberships: [membership("mem_1")] });
    const res = await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS });

    expect(res.records.map((r) => r.eventType).sort()).toEqual(["membership", "payment"]);
    expect(res.providerCalls).toBe(2);
    // Every request is company-scoped: Whop documents company_id as required
    // for API-key auth on memberships.
    expect(urls.every((u) => u.includes("company_id=biz_abc"))).toBe(true);
  });

  it("walks payments on updated_at and memberships on created_at", async () => {
    // Sabotage: use created_after for payments and a refund three weeks later
    // never reaches us — the row keeps its original amount for good.
    const cursor = JSON.stringify({ payHw: "2026-08-01T00:00:00.000Z", memHw: "2026-08-01T00:00:00.000Z" });
    const urls = serve({ payments: [], memberships: [] });
    await whopConnector.poll!({ connectionId: CONN, cursor, credentials: CREDS });

    const pay = urls.find((u) => u.includes("/payments"))!;
    const mem = urls.find((u) => u.includes("/memberships"))!;
    expect(pay).toContain("updated_after=");
    expect(mem).toContain("created_after=");
    // Memberships have no update axis, so their window overlaps by a week to
    // catch a status change; payments need only clock-skew slack.
    expect(decodeURIComponent(mem)).toContain("2026-07-25");
    expect(decodeURIComponent(pay)).toContain("2026-07-31T23:55");
  });

  it("does NOT advance the mark while a walk is unfinished", async () => {
    // The stranding bug this codebase has fixed twice: promote the mark
    // mid-walk and the unread remainder is invisible forever.
    serve({ payments: [payment("pay_1")], memberships: [] }, { nextAfter: "cur_2" });
    const res = await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 1 } });

    const c = JSON.parse(res.nextCursor!) as { payHw?: string; payCont?: string };
    expect(c.payCont).toBe("cur_2");
    expect(c.payHw).toBeUndefined();
    expect(res.incomplete).toBe(true);
    // And a held continuation keeps the connection on base cadence.
    expect(whopConnector.holdsContinuation!(res.nextCursor)).toBe(true);
  });

  it("advances the mark once the walk ends, and stops holding a continuation", async () => {
    const before = Date.now();
    serve({ payments: [payment("pay_1", { updated_at: "2026-08-03T12:00:00.000Z" })], memberships: [] });
    const res = await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS });
    const c = JSON.parse(res.nextCursor!) as { payHw?: string; payCont?: string | null };
    // The mark is WHEN THE WALK RAN, not the newest row it saw — see the
    // walk-start test above for why that difference is load-bearing.
    expect(Date.parse(c.payHw!)).toBeGreaterThanOrEqual(before);
    expect(c.payCont).toBeNull();
    expect(whopConnector.holdsContinuation!(res.nextCursor)).toBe(false);
  });

  it("bounds the FIRST sweep instead of paging from the beginning of time", async () => {
    // Sabotage: send no date bound on a virgin cursor and the first request
    // starts at the company's oldest record — Close pins the same constant
    // and its docblock names the failure: "an unbounded request every time,
    // wearing a bound".
    const urls = serve({ payments: [], memberships: [] });
    await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS });
    const pay = decodeURIComponent(urls.find((u) => u.includes("/payments"))!);
    expect(pay).toContain("updated_after=");
    const from = Date.parse(pay.split("updated_after=")[1].split("&")[0]);
    const days = (Date.now() - from) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it("marks WHEN THE WALK STARTED, not the newest row it saw", async () => {
    /**
     * The critical finding. Whop cannot order by update time, so a payment
     * refunded during a walk keeps its old created_at position and may sit
     * behind a page already read. Marking "newest row seen" puts the next
     * window past that refund permanently — the row keeps its pre-refund
     * amount forever. Marking "when the walk began" cannot: the refund's
     * updated_at is at or after that instant.
     */
    const before = Date.now();
    serve({ payments: [payment("pay_old", { updated_at: "2020-01-01T00:00:00.000Z" })], memberships: [] });
    const res = await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS });
    const c = JSON.parse(res.nextCursor!) as { payHw: string };
    // Sabotage: use the row's own updated_at and this is 2020 — every later
    // mutation of an older payment is then unreachable.
    expect(Date.parse(c.payHw)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(c.payHw)).toBeLessThanOrEqual(Date.now());
  });

  it("a corrupt mark falls back to the first-sync window instead of going unbounded", async () => {
    // Sabotage: let Date.parse(NaN) fall through to "no bound" and one bad
    // write makes every future sweep re-walk all of history.
    const urls = serve({ payments: [], memberships: [] });
    await whopConnector.poll!({ connectionId: CONN, cursor: JSON.stringify({ payHw: "garbage" }), credentials: CREDS });
    const pay = decodeURIComponent(urls.find((u) => u.includes("/payments"))!);
    const days = (Date.now() - Date.parse(pay.split("updated_after=")[1].split("&")[0])) / 86_400_000;
    expect(days).toBeGreaterThan(89);
  });

  it("carries the `hw` key the import banner reads — only once BOTH walks drain", async () => {
    /**
     * `cursorSaysImporting` (sync/import-status.ts) treats a JSON cursor with
     * no `hw` as "still on its first window". Our marks are per collection,
     * so without this key a finished Whop connection said "Still importing
     * history — these numbers can still grow." forever, on the Integrations
     * page and in the step panel. The helper is private, so its exact rule is
     * asserted here against the cursor we actually emit.
     */
    const importing = (cursor: string | null) => {
      if (!cursor || !cursor.startsWith("{")) return false;
      return !(JSON.parse(cursor) as { hw?: unknown }).hw;
    };

    serve({ payments: [payment("pay_1")], memberships: [] }, { nextAfter: "cur_2" });
    const midWalk = await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, budget: { maxCalls: 1 } });
    expect(importing(midWalk.nextCursor)).toBe(true);

    serve({ payments: [payment("pay_1")], memberships: [membership("mem_1")] });
    const drained = await whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS });
    // Sabotage: never set `hw` and this stays true — the banner never clears.
    expect(importing(drained.nextCursor)).toBe(false);
  });

  it("refuses to run without the company id instead of reading nothing", async () => {
    serve({ payments: [], memberships: [] });
    // Sabotage: drop the guard and the step reports "0 loaded" for an account
    // full of payments — a confident zero, the failure class this codebase
    // keeps unpicking.
    await expect(whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } })).rejects.toThrow(/company id/i);
  });

  /**
   * THE REAL ERROR BODIES, captured from Whop's live sandbox API — not
   * invented. Whop answers a permission failure with HTTP **400**, so a
   * connector that only maps 401/403 shows the most likely setup mistake as
   * a bare "HTTP 400" with no hint, on a provider whose entire connect story
   * is ticking the right permission boxes.
   */
  it("turns Whop's 400-shaped permission refusal into an instruction, naming the missing scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { type: "bad_request", message: "Unauthorized: Actor is missing all required permissions: company:basic:read" } },
          400,
        ),
      ),
    );
    // Sabotage: map only 401/403 and this throws "HTTP 400" instead.
    await expect(whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS })).rejects.toThrow(
      /company:basic:read[\s\S]*reconnect/i,
    );
  });

  it("turns the collection-level refusal into the same instruction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { type: "bad_request", message: "You are not authorized - ensure that you have access to this resource" } }, 400),
      ),
    );
    await expect(whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS })).rejects.toThrow(/payment and member read permissions/i);
  });

  it("names the Company ID when Whop cannot find it", async () => {
    // Verified live: /payments answers 404 "This Bot was not found" for a
    // company the key does not own. Without this the step just reports zero.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { type: "not_found", message: "This Bot was not found" } }, 404)));
    await expect(whopConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS })).rejects.toThrow(/Company ID/i);
  });
});

describe("Whop is wired into the product", () => {
  it("is registered, catalogued, and claims budget against a declared operation", () => {
    expect(getConnector("whop")).toBe(whopConnector);
    const entry = catalogEntry("whop")!;
    expect(entry.connect).toBe("apiKey");
    expect(entry.poll).toBe(true);
    expect(syncGuarantee("whop")).toBe("incremental");
    // The operation key the ledger claims against must be one the catalog
    // declares, or the poll silently falls back to the default budget.
    const op = pollOperation("whop", {});
    expect(op).toBe("api.request");
    expect(entry.rateLimits?.[op]?.requestsPerMinute).toBe(600);
  });

  it("asks for both credentials it cannot work without, plus an optional webhook secret", () => {
    const keys = (catalogEntry("whop")!.credentialFields ?? []).map((f) => f.key);
    // Sabotage: drop "webhookSecret" from the catalog entry and the connect
    // form (which submits every non-empty `cred_<key>` generically) has
    // nowhere to put a pasted secret — see C21.
    expect(keys).toEqual(["apiKey", "companyId", "webhookSecret"]);
  });
});

describe("C21 — a pasted webhook secret becomes the connection's signing secret", () => {
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  afterEach(async () => {
    await close();
  });

  const ORG = "org_whop_secret";
  const PASTED = "whsec_cGFzdGVkLXNlY3JldA=="; // a secret shaped like Whop's own, not ours

  it("a connection created with a pasted secret verifies a Standard-Webhooks signature made with it", async () => {
    const conn = await createConnection({
      orgId: ORG,
      source: "whop",
      name: "Whop",
      authType: "apiKey",
      credentials: { apiKey: "key_live_x", companyId: "biz_abc", webhookSecret: PASTED },
    });

    // Sabotage: keep minting a fresh secret regardless of what was pasted —
    // getSigningSecret would return something the customer never put into
    // Whop, so no real delivery could ever verify.
    const stored = getSigningSecret(conn);
    expect(stored).toBe(PASTED);

    const body = JSON.stringify({ data: { id: "pay_1" } });
    const id = "msg_1";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${sign(PASTED, id, ts, body)}`;
    expect(
      whopConnector.verifySignature({
        rawBody: body,
        headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig },
        secret: stored,
      }),
    ).toBe(true);
  });

  it("never stores the pasted secret in credentials_encrypted", async () => {
    const conn = await createConnection({
      orgId: ORG,
      source: "whop",
      name: "Whop",
      authType: "apiKey",
      credentials: { apiKey: "key_live_x", companyId: "biz_abc", webhookSecret: PASTED },
    });

    // Sabotage: encrypt input.credentials as-is (skip the strip) and this key
    // sits right next to the API key it was never supposed to be stored with.
    const stored = decryptCredentials(conn);
    expect(stored).not.toHaveProperty("webhookSecret");
    expect(stored.apiKey).toBe("key_live_x");
    expect(stored.companyId).toBe("biz_abc");
  });

  it("leaves a non-instant source's stray webhookSecret exactly where it was", async () => {
    // gsheets is not `instant` — only an instant source's webhook route ever
    // reads a signing secret, so the strip must not touch this key here.
    const conn = await createConnection({
      orgId: ORG,
      source: "gsheets",
      name: "Sheet",
      authType: "oauth2",
      credentials: { accessToken: "tok", webhookSecret: "leftover" },
    });

    const stored = decryptCredentials(conn);
    expect(stored.webhookSecret).toBe("leftover");
    // And nothing tried to press it into service as a signing secret either.
    expect(getSigningSecret(conn)).toBeNull();
  });
});
