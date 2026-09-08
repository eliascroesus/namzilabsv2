import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { retellConnector } from "@/connectors/retell";
import { catalogEntry, isStreamScoped } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";
import { decryptCredentials } from "@/lib/credentials";
import { createTestDb } from "./helpers/testdb";
import type { DB } from "@/db/types";

afterEach(() => vi.unstubAllGlobals());

// `createConnection` writes straight to the database and, for a poll-capable
// source like Retell, dispatches a first sync through Inngest. Same three
// mocks as whop.test.ts / org-caps.test.ts; `db` is assigned inside the connect
// describe's own beforeEach so the pure connector tests never start PGlite.
let db: DB;
let closeDb: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const { createConnection, getSigningSecret } = await import("@/lib/connections");
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

const KEY = "key_retell";
/** 2026-09-07T09:00:00Z → 09:01:30Z, in the epoch MILLISECONDS Retell speaks. */
const START = 1_788_771_600_000;
const END = 1_788_771_690_000;
const call = (over: Record<string, unknown> = {}) => ({
  call_type: "phone_call",
  call_id: "call_1",
  agent_id: "ag_1",
  call_status: "ended",
  direction: "outbound",
  from_number: "+15550002",
  to_number: "+15550001",
  start_timestamp: START,
  end_timestamp: END,
  duration_ms: 90_000,
  disconnection_reason: "user_hangup",
  transcript: "Agent: hello there",
  transcript_object: [{ role: "agent", content: "hello there" }],
  transcript_with_tool_calls: [{ role: "agent", content: "hello there" }],
  access_token: "tok_live_join",
  call_cost: { combined_cost: 12, total_duration_seconds: 90 },
  ...over,
});
const analysis = { call_successful: true, user_sentiment: "Positive", call_summary: "Booked a demo.", custom_analysis_data: { qualified: true } };

/** `v={ms},d={hex}` — HMAC-SHA256 over body+timestamp, keyed on the API key. */
const sign = (body: string, ts: number, key = KEY) => `v=${ts},d=${createHmac("sha256", key).update(`${body}${ts}`).digest("hex")}`;

describe("retell: registration", () => {
  it("is in the catalog and the registry with dated provenance, and the budget key its poll claims", () => {
    expect(getConnector("retell")).toBe(retellConnector);
    const e = catalogEntry("retell")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    // Instant with no registration API: the customer pastes the key that signs.
    expect(e.instant && !e.autoWebhook).toBe(true);
    expect(e.credentialFields?.map((f) => f.key)).toContain("webhookSecret");
    expect(Object.keys(e.rateLimits ?? {})).toEqual([retellConnector.operationFor!({})]);
  });

  /**
   * Retell publishes NO webhook endpoint at all — docs.retellai.com/llms.txt
   * indexes four webhook pages, every one of them under `features/`, and none
   * under `api-references/`. The single API that can write a webhook URL is
   * `PATCH /update-agent/{agent_id}`, whose `webhook_url` "will ignore the
   * account level webhook for this agent": one field, per agent, in that
   * agent's "latest draft version". Writing it would REDIRECT the customer's
   * own deliveries rather than add a subscription beside them, which is why
   * this connector deliberately implements neither half of the pair.
   */
  it("registers nothing, because Retell has nothing to register against", () => {
    expect(retellConnector.registerWebhook).toBeUndefined();
    expect(retellConnector.unregisterWebhook).toBeUndefined();
    // And not because the webhook is per-resource: Retell's connection has no
    // flow-level stream fields, so a connect-time registration WOULD have had
    // everything it needed. The impossibility is the provider's.
    expect(isStreamScoped("retell")).toBe(false);
  });

  /**
   * The field STAYS, but only as an override: accounts/api-keys-overview says
   * a workspace "can have multiple API keys" and Retell picks ONE of them for
   * webhook authentication, so the badged key is not always the key the
   * customer reads calls with. What changes is that leaving it empty is now a
   * working connection rather than a silent 401 (see the connect tests below),
   * which is what lets the catalog label it optional.
   */
  it("keeps the signing-key box as an override, not a requirement", () => {
    const e = catalogEntry("retell")!;
    expect(e.credentialFields!.some((f) => f.key === "webhookSecret")).toBe(true);
    expect(typeof retellConnector.webhookSecretFromCredentials).toBe("function");
    expect(retellConnector.webhookSecretFromCredentials!({ apiKey: KEY })).toBe(KEY);
    // Nothing to name when the credential is absent: the minted secret stands.
    expect(retellConnector.webhookSecretFromCredentials!({})).toBeNull();
  });
});

/**
 * A CROSS-IMPLEMENTATION VECTOR, not a value this code recomputed.
 *
 * body, key, timestamp and digest are Retell's own published test vector
 * (retell-typescript-sdk, tests/webhook-auth.test.ts), which is what
 * `Retell.verify` — the helper docs/features/webhook tells integrators to use —
 * accepts. Only an implementation that hashes `raw_body + timestamp` with the
 * API KEY, hex, satisfies it; hashing the body alone, or `t.body` the Stripe
 * way, does not. The clock is moved to the vector rather than the vector to the
 * clock, because `v` is also the replay window.
 */
describe("retell: signature", () => {
  const VECTOR_BODY = '{"event":"call_ended"}';
  const VECTOR_KEY = "test-api-key";
  const VECTOR_TS = 1_700_000_000_000;
  const VECTOR_DIGEST = "07024cabe7dd8f6d1c6e4a8324ca92c812e6ad4a7ee506c04f7e462e3321823e";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(VECTOR_TS + 30_000));
  });
  afterEach(() => vi.useRealTimers());

  const verify = (rawBody: string, headers: Record<string, string>, secret: string | null) =>
    retellConnector.verifySignature({ rawBody, headers, secret });

  it("accepts the signature Retell actually sends", () => {
    expect(verify(VECTOR_BODY, { "x-retell-signature": `v=${VECTOR_TS},d=${VECTOR_DIGEST}` }, VECTOR_KEY)).toBe(true);
    expect(sign(VECTOR_BODY, VECTOR_TS, VECTOR_KEY)).toBe(`v=${VECTOR_TS},d=${VECTOR_DIGEST}`);
  });

  it("rejects a wrong key, a missing header, a tampered body, a missing secret and a stale timestamp", () => {
    const header = { "x-retell-signature": `v=${VECTOR_TS},d=${VECTOR_DIGEST}` };
    expect(verify(VECTOR_BODY, header, "wrong-api-key")).toBe(false);
    expect(verify(VECTOR_BODY, {}, VECTOR_KEY)).toBe(false);
    expect(verify(`${VECTOR_BODY} `, header, VECTOR_KEY)).toBe(false);
    expect(verify(VECTOR_BODY, header, null)).toBe(false);
    // Correctly signed an hour ago: authentic once, a replay now.
    const stale = VECTOR_TS - 3_600_000;
    expect(verify(VECTOR_BODY, { "x-retell-signature": sign(VECTOR_BODY, stale, VECTOR_KEY) }, VECTOR_KEY)).toBe(false);
  });

  it("does not accept the Standard-Webhooks shape the plan guessed at", () => {
    // docs/features/secure-webhook settles the scheme; a second accepted shape
    // would only widen what an attacker may present.
    const ts = String(Math.floor(Date.now() / 1000));
    const sw = `v1,${createHmac("sha256", VECTOR_KEY).update(`msg_1.${ts}.${VECTOR_BODY}`).digest("base64")}`;
    expect(verify(VECTOR_BODY, { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": sw }, VECTOR_KEY)).toBe(false);
  });
});

describe("retell: normalize", () => {
  const one = (payload: unknown, ctx: Record<string, unknown> = {}) => retellConnector.normalize!(payload, { connectionId: CONN, ...ctx });

  it("call_started is call_logged at the start, dated from epoch milliseconds", () => {
    const [ev] = one({ event: "call_started", call: call() });
    expect(ev).toMatchObject({ eventId: "retell:conn_1:call_1", eventType: "call_logged", subject: "+15550001" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-07T09:00:00.000Z");
    expect(ev.value ?? null).toBe(null);
  });

  it("an inbound call's subject is the caller, not our own number", () => {
    const [ev] = one({ event: "call_started", call: call({ direction: "inbound" }) });
    expect(ev.subject).toBe("+15550002");
  });

  it("call_ended is call_completed at the end, valued in SECONDS, keyed apart from the start", () => {
    const [ev] = one({ event: "call_ended", call: call() });
    expect(ev).toMatchObject({ eventId: "retell:conn_1:call_1:completed", eventType: "call_completed", value: 90 });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-07T09:01:30.000Z");
  });

  it("a dial that never connected is a missed call, never a completed one", () => {
    const [ev] = one({ event: "call_ended", call: call({ disconnection_reason: "dial_no_answer", duration_ms: 0 }) });
    expect(ev).toMatchObject({ eventId: "retell:conn_1:call_1:missed", eventType: "call_missed", value: null });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-07T09:01:30.000Z");
  });

  it("call_analyzed is its own event over the same call, with the outcome surfaced and never normalised into the type", () => {
    const [ev] = one({ event: "call_analyzed", call: call({ call_analysis: analysis }) });
    expect(ev).toMatchObject({ eventId: "retell:conn_1:call_1:analyzed", eventType: "call_analyzed", subject: "+15550001" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-07T09:01:30.000Z");
    expect(ev.properties).toMatchObject({ call_successful: true, user_sentiment: "Positive", custom_analysis_data: { qualified: true } });
  });

  it("a bridged transfer is dated by the delivery moment, the only moment the payload evidences", () => {
    const at = new Date("2026-09-07T09:00:45.000Z");
    const [ev] = one({ event: "transfer_bridged", call: call({ end_timestamp: undefined }), transfer_destination: { number: "+15550003" } }, { fallbackOccurredAt: at });
    expect(ev).toMatchObject({ eventId: "retell:conn_1:call_1:transferred", eventType: "call_transferred" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-07T09:00:45.000Z");
  });

  it("what Retell bills us, a live join token and the duplicated transcripts are not stored; the transcript is", () => {
    const [ev] = one({ event: "call_ended", call: call() });
    expect(ev.properties).toMatchObject({ transcript: "Agent: hello there", disconnection_reason: "user_hangup", agent_id: "ag_1" });
    expect(ev.properties).not.toHaveProperty("call_cost");
    expect(ev.properties).not.toHaveProperty("access_token");
    expect(ev.properties).not.toHaveProperty("transcript_object");
    expect(ev.properties).not.toHaveProperty("transcript_with_tool_calls");
  });

  it("events we do not count produce nothing", () => {
    expect(one({ event: "transcript_updated", call: call() })).toEqual([]);
    expect(one({ event: "transfer_started", call: call() })).toEqual([]);
    expect(one({ call: call() })).toEqual([]);
  });
});

describe("retell: poll", () => {
  const page = (items: unknown[], next?: string) => ({ items, has_more: Boolean(next), pagination_key: next });

  it("lists calls whose start_timestamp is at or after the mark, ascending, follows pagination_key, settles on the newest start", async () => {
    const second = call({ call_id: "call_2", start_timestamp: 1_788_772_800_000, end_timestamp: 1_788_772_860_000, duration_ms: 60_000, call_analysis: undefined });
    const calls = stubFetch([page([call({ call_analysis: analysis })], "pk_2"), page([second])]);
    const res = await retellConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY } });

    expect(calls).toHaveLength(2);
    const first = calls[0];
    expect(new URL(first.url).pathname).toBe("/v3/list-calls");
    expect(first.init.method).toBe("POST");
    expect((first.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(first.init.body)) as Record<string, unknown>;
    expect(body.sort_order).toBe("ascending");
    expect(body.limit).toBe(1000);
    expect(body.pagination_key).toBeUndefined();
    const filter = (body.filter_criteria as { start_timestamp: { type: string; op: string; value: number } }).start_timestamp;
    expect(filter.type).toBe("number");
    expect(filter.op).toBe("ge");
    // A first sync reaches back 30 days, and never further forward than now.
    expect(filter.value).toBeGreaterThan(Date.now() - 31 * 86_400_000);
    expect(filter.value).toBeLessThanOrEqual(Date.now());
    // The second request carries the continuation the first page handed back.
    expect(JSON.parse(String(calls[1].init.body)).pagination_key).toBe("pk_2");

    // One call fans out into every fact it evidences; the analysed one has three.
    expect(res.records.map((r) => r.eventId)).toEqual([
      "retell:conn_1:call_1",
      "retell:conn_1:call_1:completed",
      "retell:conn_1:call_1:analyzed",
      "retell:conn_1:call_2",
      "retell:conn_1:call_2:completed",
    ]);
    expect(res.records.map((r) => r.eventType)).toEqual(["call_logged", "call_completed", "call_analyzed", "call_logged", "call_completed"]);
    expect(res.records[1].value).toBe(90);
    expect(res.records[4].value).toBe(60);
    // The watermark is start_timestamp — the field the request bounded.
    expect(res.nextCursor).toBe("2026-09-07T09:20:00.000Z");
    expect(res.incomplete).toBeUndefined();
  });

  it("a call the walk cannot count as started still yields its ended fact", async () => {
    stubFetch([page([call({ disconnection_reason: "dial_busy", duration_ms: 0 })])]);
    const res = await retellConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: KEY } });
    expect(res.records.map((r) => r.eventType)).toEqual(["call_missed"]);
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-07T09:01:30.000Z");
  });

  it("resumes from a settled mark with overlap, and stops when the budget runs out mid-walk", async () => {
    const calls = stubFetch([page([call()], "pk_2")]);
    const res = await retellConnector.poll!({
      connectionId: CONN,
      cursor: "2026-09-07T09:00:00.000Z",
      credentials: { apiKey: KEY },
      budget: { maxCalls: 1 },
    });
    const filter = (JSON.parse(String(calls[0].init.body)).filter_criteria as { start_timestamp: { value: number } }).start_timestamp;
    // 30 minutes of overlap behind the mark, because a call's row changes after
    // the instant it started.
    expect(new Date(filter.value).toISOString()).toBe("2026-09-07T08:30:00.000Z");
    expect(calls).toHaveLength(1);
    expect(res.incomplete).toBe(true);
    // Mid-walk the cursor carries the provider's continuation, and says so.
    expect(JSON.parse(res.nextCursor!).cont).toBe("pk_2");
    expect(retellConnector.holdsContinuation!(res.nextCursor)).toBe(true);
    expect(retellConnector.holdsContinuation!("2026-09-07T09:00:00.000Z")).toBe(false);
  });
});

/**
 * THE SECOND BOX IS AN OVERRIDE NOW, NOT A CHORE.
 *
 * Retell mints no webhook secret: "Only the API key that has a webhook badge
 * next to it can be used to verify the webhook" (features/secure-webhook), and
 * accounts/api-keys-overview says Retell "automatically designate[s] one of
 * your API keys for webhook authentication". So the key that verifies is a key
 * the connect dialog already collected. Leaving the field blank used to store a
 * minted `whsec_…` — a secret with NOWHERE in Retell to paste it back into, so
 * every real delivery 401'd, silently, forever.
 */
describe("retell: the API key is the signing secret", () => {
  beforeEach(async () => {
    ({ db, close: closeDb } = await createTestDb());
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  afterEach(async () => {
    await closeDb();
  });

  const ORG = "org_retell";

  it("connecting with the API key alone stores a secret that verifies a real delivery", async () => {
    const conn = await createConnection({
      orgId: ORG,
      source: "retell",
      name: "Retell",
      authType: "apiKey",
      credentials: { apiKey: KEY },
    });

    // Sabotage: mint a random secret when the box is empty (what this did
    // before) and the stored value is one Retell has never heard of.
    expect(getSigningSecret(conn)).toBe(KEY);

    const body = JSON.stringify({ event: "call_ended", call: call() });
    const ts = Date.now();
    expect(
      retellConnector.verifySignature({
        rawBody: body,
        headers: { "x-retell-signature": sign(body, ts) },
        secret: getSigningSecret(conn),
      }),
    ).toBe(true);
  });

  it("a pasted key still wins — the workspace whose webhook badge sits on a different key", async () => {
    const BADGED = "key_retell_webhook";
    const conn = await createConnection({
      orgId: ORG,
      source: "retell",
      name: "Retell",
      authType: "apiKey",
      credentials: { apiKey: KEY, webhookSecret: BADGED },
    });

    expect(getSigningSecret(conn)).toBe(BADGED);
    // C21 — verification material never rides along inside the credentials blob.
    const stored = decryptCredentials(conn);
    expect(stored).not.toHaveProperty("webhookSecret");
    expect(stored.apiKey).toBe(KEY);
  });

  it("a source that names no signing credential is still minted a secret", async () => {
    // The hook is opt-in per connector: ThriveCart's own secret is a value only
    // ThriveCart can give, so nothing here may quietly press an API key into
    // service as one.
    const conn = await createConnection({ orgId: ORG, source: "thrivecart", name: "TC", authType: "secret", credentials: {} });
    expect(getSigningSecret(conn)).toMatch(/^whsec_/);
  });
});
