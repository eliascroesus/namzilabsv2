import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, holdsWindowContinuation, str } from "./field-utils";
import { bearerClient, epochToDate, eventId, requireCredential, timestampedHmacVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * Retell AI. One call produces up to three countable facts — it started, it
 * ended, it was analysed — and Retell delivers each as its own webhook over
 * THE SAME call object, so they are keyed apart (`:completed`, `:analyzed`)
 * or one call would be counted three times under one id. Timestamps are epoch
 * MILLISECONDS. `call_cost` is what the customer PAYS Retell, so it is neither
 * the value nor kept in properties.
 *
 * Docs read 8 Sep 2026:
 * - https://docs.retellai.com/api-references/list-calls — POST /v3/list-calls, v3
 *   (the plan said `/v2/list-calls` with `lower_threshold`/`upper_threshold`;
 *   THE DOCS WIN — that page is gone, 404, and the SDK's `client.call.list`
 *   posts `/v3/list-calls`). `filter_criteria.start_timestamp` — "Filter by call
 *   start timestamp (epoch ms)" — takes a NumberFilter `{type,op,value}` with
 *   op one of eq/ne/gt/ge/lt/le, so the walk bounds with `ge` and the watermark
 *   is start_timestamp, the very field it filters. `limit` max 1000,
 *   `pagination_key` is an "opaque pagination cursor from a previous response",
 *   and the reply is `{ has_more, items, pagination_key }` — an object, not the
 *   bare array the plan assumed.
 * - https://docs.retellai.com/features/secure-webhook — "Verify Without SDK":
 *   `X-Retell-Signature: v={timestamp},d={hex_digest}`, "v is the Unix timestamp
 *   in milliseconds", "d is the HMAC-SHA256 hex digest of the raw request body
 *   concatenated with the timestamp", keyed on the API KEY, and "within 5
 *   minutes of the current time". So neither Standard Webhooks nor a bare HMAC
 *   over the body: those were the plan's two guesses, the docs settle it, and
 *   accepting an undocumented second shape would only widen what we accept.
 * - https://github.com/RetellAI/retell-typescript-sdk `src/lib/webhook_auth.ts`
 *   (the helper the docs point at) — `sign` returns `v=${timestamp},d=${hmac}`
 *   over `input + timestamp` with a 5-minute window either way. Its published
 *   test vector is frozen in tests/retell.test.ts as a cross-implementation
 *   check, the way Close's hex-key vector is.
 * - https://docs.retellai.com/features/webhook — `call_started`, `call_ended`,
 *   `call_analyzed`, `transcript_updated`, `transfer_*`; `call_ended` carries
 *   "All fields from the call object except `call_analysis`" and `call_analyzed`
 *   the full object with it. "When the call did not connect (like calls with
 *   `dial_failed`, `dial_no_answer`, `dial_busy` disconnection reason), it will
 *   not have its `call_started` webhook triggered" — hence `call_missed`: an
 *   unanswered dial is not a completed call. The webhook URL is set in the
 *   dashboard's webhooks tab account-wide, or per agent via `webhook_url`.
 *
 * WHY THERE IS NO `registerWebhook` HERE — re-checked 8 Sep 2026 against the
 * live docs, because every other instant connector we ship creates its own
 * subscription and Retell is the odd one out:
 * - Retell HAS NO WEBHOOK RESOURCE. docs.retellai.com/llms.txt (the published
 *   index of every page) lists exactly four webhook pages, all under
 *   `features/`, and NOT ONE endpoint under `api-references/` for creating,
 *   listing or deleting a webhook — the only api-reference with "webhook" in
 *   its name is the Monitor Call WebSocket. features/register-webhook is a
 *   DASHBOARD walkthrough: account-level webhooks are "Set up through the
 *   system settings' webhooks tab", agent-level ones "Set up through the
 *   dashboard's agent detail page", with a "Test button to send a sample
 *   request to your endpoint".
 * - The one API that can write a webhook URL is
 *   docs.retellai.com/api-references/update-agent — `PATCH
 *   /update-agent/{agent_id}`, whose `webhook_url` "If set, will binds webhook
 *   events for this agent to the specified url, and will ignore the account
 *   level webhook for this agent". That is not a subscription we could add
 *   alongside the customer's: it is a SINGLE-VALUED field, so writing it
 *   silently redirects every event of that agent away from wherever they had
 *   it pointed. It is also per-agent (a new agent is not covered) and it
 *   "Update[s] an existing agent's latest draft version" — a separate
 *   `publish-agent` ("Publish an existing draft version in place") is what
 *   moves a draft to the live traffic. Hijacking a config field, in a draft,
 *   is not registration, so `autoWebhook: false`.
 * - No secret exists to return or to supply. features/secure-webhook: "Only
 *   the API key that has a webhook badge next to it can be used to verify the
 *   webhook", and accounts/api-keys-overview: "we automatically designate one
 *   of your API keys for webhook authentication" — a key that "Is used to sign
 *   and verify webhook requests" and "Cannot be deleted". So the signing
 *   material is an API KEY WE ALREADY HOLD, which is what
 *   `webhookSecretFromCredentials` says out loud: the connect dialog stops
 *   asking for the same key twice, and the second field survives only as the
 *   override for a workspace whose badged key is a different one.
 * - https://docs.retellai.com/accounts/data-retention — "By default, data is
 *   kept indefinitely (no automatic deletion)", with a per-agent retention
 *   period that deletes calls permanently. Nothing forgets on a fixed schedule,
 *   so no `retention` block; the entry's historyNote says the account can.
 * - https://docs.retellai.com/deploy/concurrency — the only published limits are
 *   CALL concurrency and calls-per-second, not API requests; the entry's
 *   rateLimits figure says so and stays conservative until the prober measures.
 */
const API = "https://api.retellai.com";
/**
 * The overlap is 30 minutes, not the usual 5, and that is the whole reason a
 * call's later facts arrive at all: the walk filters on `start_timestamp`, but
 * a row CHANGES after that instant (it ends, then it is analysed). Settle the
 * mark five minutes past a call still in progress and its completion is never
 * read again. Thirty minutes covers a long call; the webhook path covers longer.
 */
const DEFAULTS = { pagesPerPoll: 2, maxPagesPerPoll: 10, firstSyncDays: 30, overlapMs: 30 * 60_000 };
const PAGE = 1000;

/** Dial outcomes Retell names as "the call did not connect" (features/webhook). */
const NOT_CONNECTED = new Set(["dial_failed", "dial_no_answer", "dial_busy"]);

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Retell"), "Retell");
const ms = (v: unknown) => epochToDate(v, "ms");

/**
 * The counterparty, not our own number: on an inbound call the customer is
 * `from_number`, on an outbound one `to_number`. A web call has neither.
 */
function counterparty(c: Record<string, unknown>): string | null {
  const from = str(c["from_number"]);
  const to = str(c["to_number"]);
  return c["direction"] === "inbound" ? (from ?? to) : (to ?? from);
}

/**
 * Everything worth storing about a call, minus what must not be stored:
 * `call_cost` (our customer's spend with Retell — never a business fact),
 * `access_token` (a live web-call join credential) and the two structured
 * transcripts, which repeat `transcript` verbatim on up to three events per
 * call. The analysis is surfaced flat — `call_successful`, `user_sentiment`,
 * `custom_analysis_data` — and deliberately NOT normalised into an eventType:
 * whether "successful" means booked, qualified or resolved is the customer's
 * own definition, so it stays a field to filter on.
 */
function propertiesOf(c: Record<string, unknown>): Record<string, unknown> {
  const { call_cost: _cost, access_token: _token, transcript_object: _obj, transcript_with_tool_calls: _tools, ...rest } = c;
  const analysis = asObject(c["call_analysis"]);
  return {
    ...rest,
    call_successful: analysis["call_successful"] ?? c["call_successful"] ?? null,
    user_sentiment: analysis["user_sentiment"] ?? null,
    custom_analysis_data: analysis["custom_analysis_data"] ?? null,
  };
}

/**
 * The facts a call object supports. `only` restricts them to the one a webhook
 * announced; without it (the poll) a row yields every fact it can evidence.
 * `fallback` dates a transfer, which is the one event whose moment appears in
 * no field of the payload.
 */
function events(c: Record<string, unknown>, connectionId: string, only?: string, fallback?: Date): CanonicalEvent[] {
  const id = str(c["call_id"]);
  if (!id) return [];
  const subject = counterparty(c);
  const start = ms(c["start_timestamp"]);
  const end = ms(c["end_timestamp"]);
  const props = propertiesOf(c);
  const base = eventId("retell", connectionId, id);
  const want = (e: string) => !only || only === e;
  const out: CanonicalEvent[] = [];

  /**
   * Retell fires no `call_started` for a dial that never connected, so the poll
   * must not invent one either — otherwise the same call counts differently
   * depending on which path saw it, which is exactly what the shared eventIds
   * exist to prevent. A `call_started` payload carries no outcome yet, so it
   * reads as connected, which it is: the webhook only fires once it is.
   */
  const connected = !NOT_CONNECTED.has(String(c["disconnection_reason"] ?? "")) && c["call_status"] !== "not_connected";
  if (want("call_started") && start && connected) {
    out.push({ eventId: base, eventType: "call_logged", subject, occurredAt: start, properties: props });
  }
  if (want("call_ended") && end) {
    const seconds = typeof c["duration_ms"] === "number" ? c["duration_ms"] / 1000 : null;
    out.push(
      connected
        ? { eventId: `${base}:completed`, eventType: "call_completed", subject, occurredAt: end, value: seconds, properties: props }
        : { eventId: `${base}:missed`, eventType: "call_missed", subject, occurredAt: end, value: null, properties: props },
    );
  }
  // The analysis lands after the call; `call_ended` never carries one, so a
  // poll emits this only for a row that actually has the object.
  const analysed = only === "call_analyzed" || (!only && Object.keys(asObject(c["call_analysis"])).length > 0);
  if (analysed && (end ?? start)) {
    out.push({ eventId: `${base}:analyzed`, eventType: "call_analyzed", subject, occurredAt: (end ?? start)!, properties: props });
  }
  // Only the BRIDGED transfer counts: started/cancelled/ended describe the same
  // handoff, and counting all four would quadruple one event. Nothing in the
  // payload says when it bridged, so the delivery moment is the honest answer
  // and the call's own start stays in properties.
  if (only === "transfer_bridged") {
    const at = fallback ?? end ?? start;
    if (at) out.push({ eventId: `${base}:transferred`, eventType: "call_transferred", subject, occurredAt: at, properties: props });
  }
  return out;
}

export const retellConnector: Connector = {
  source: "retell",
  authType: "apiKey",
  operations: ["calls.list"] as const,
  operationFor: () => "calls.list",
  importProgress: walkImportProgress,
  /**
   * `pagination_key` is documented only as "opaque", with no stated lifetime —
   * so a mid-walk cursor is treated as perishable and the connection is not
   * demoted to a wider sweep gap while one is held. A settled mark (the bare
   * date string) is not a continuation and does not pin anything.
   */
  holdsContinuation: holdsWindowContinuation,
  /**
   * The key that signs is a key we were just given. Retell designates one of
   * the workspace's API keys for webhooks and signs the HMAC with it, so the
   * customer pasting their API key into the connect dialog has, in the ordinary
   * one-key workspace, already handed us the signing secret. Asking a second
   * time was pure friction — and worse, LEAVING IT BLANK used to store a minted
   * `whsec_…` that no Retell delivery could ever match, with nowhere in Retell
   * to paste it back.
   *
   * `createConnection` reads this only when nothing was pasted into
   * `webhookSecret`, so the catalog's (optional) field still wins when a
   * workspace's webhook-badged key is not the one it reads calls with.
   */
  webhookSecretFromCredentials(credentials: Record<string, unknown>): string | null {
    return str(credentials["apiKey"]);
  },
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify(
      { rawBody, headers, secret },
      // `v={ms},d={hex}` over body+timestamp, keyed on the API key, ±5 minutes
      // (the kit's default tolerance is exactly the documented window).
      { header: "x-retell-signature", timestampKey: "v", signatureKey: "d", message: (t, body) => `${body}${t}` },
    );
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const event = str(body["event"]);
    if (!event) return [];
    return events(asObject(body["call"]), ctx.connectionId, event, ctx.fallbackOccurredAt);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    /**
     * The rows the walk actually read, deduped by call id — the fan-out reads
     * THESE and not `PollResult.records`, because a row the walk's `map` skips
     * (a dial that never started) still has an ended fact worth counting.
     */
    const byCall = new Map<string, Record<string, unknown>>();
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.post<{ items?: unknown[]; has_more?: boolean; pagination_key?: string }>("/v3/list-calls", {
          filter_criteria: { start_timestamp: { type: "number", op: "ge", value: since.getTime() } },
          sort_order: "ascending",
          limit: PAGE,
          ...(cont ? { pagination_key: cont } : {}),
        });
        const rows = (page.items ?? []).map(asObject);
        for (const r of rows) {
          const id = str(r["call_id"]);
          if (id) byCall.set(id, r);
        }
        return { rows, next: page.has_more && page.pagination_key ? page.pagination_key : null, rateLimit: client.rateLimit() };
      },
      changedAt: (c) => ms(c["start_timestamp"])?.toISOString() ?? null,
      map: (c) => events(c, args.connectionId, "call_started")[0] ?? null,
    });
    const records: CanonicalEvent[] = [];
    for (const c of byCall.values()) records.push(...events(c, args.connectionId));
    return { ...res, records };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    // Ascending by start_timestamp, so the LATEST calls are the last ones.
    return records.slice(-n);
  },
};
