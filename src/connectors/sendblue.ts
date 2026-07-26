import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  VerifyWebhookArgs,
  VerifyWebhookResult,
} from "./types";
import { safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { fetchJson } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

/**
 * Sendblue API host. Their API lives on the .co domain (the .com is marketing).
 * CONFIRM ONCE against a live account before first production sweep — one
 * authenticated GET /api/v2/messages with real keys settles it; a wrong host
 * fails loudly (DNS/404) on the first poll and is recorded on the connection.
 */
const API_BASE = "https://api.sendblue.co";

/** Pages walked per poll; offset pagination, newest-first. */
/** How far back an initial, cursor-less sweep reaches. */
const FIRST_SYNC_DAYS = 30;
const PAGES_PER_POLL = 3;
const PAGE_LIMIT = 100;
/** Re-read cushion below the high-water mark; message_handle dedup absorbs it. */
const OVERLAP_MS = 5 * 60_000;

/** Candidate headers Sendblue may place the configured signing secret in. */
const SECRET_HEADERS = [
  "sendblue-signing-secret",
  "sb-signing-secret",
  "sb-secret",
  "x-sendblue-secret",
  "x-sendblue-signing-secret",
  "signing-secret",
];

/**
 * Sendblue (iMessage/SMS). Webhook-primary with a poll backstop over the
 * message-history list, deduped on `message_handle` (per Sendblue's docs).
 * The sweep also verifies the provider-side webhook subscription via
 * /api/account/webhooks and re-registers it when missing (D.6).
 * Status lifecycle: QUEUED -> SENT -> DELIVERED.
 */
export const sendblueConnector: Connector = {
  source: "sendblue",
  authType: "secret",

  verifySignature({ headers, secret }: VerifyArgs): boolean {
    if (!secret) return true; // No secret configured => accept.
    for (const h of SECRET_HEADERS) {
      const value = headers[h];
      if (value && safeEqual(value, secret)) return true;
    }
    return false;
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    return [toCanonical(asObject(rawPayload), ctx.connectionId)];
  },

  /**
   * Reconciliation backstop: page the message history newest-first (offset
   * pagination) down to the stored high-water mark minus a 5-minute overlap.
   * Offsets shift as new messages arrive, but the overlap + message_handle
   * dedup absorb the drift; the mark advances to the newest message seen.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const auth = authHeaders(args.credentials);
    const hw = args.cursor ? Date.parse(args.cursor) || 0 : null;
    // A FIRST sweep has no high-water mark, and this endpoint pages by offset
    // over the whole account — so without a floor it walks all history on
    // connect. Bound it: the first sweep imports a recent window, and the
    // cursor carries it forward from there. (Deeper history needs the E.8
    // backfill lane; see the deferred triggers in the plan.)
    const floor = hw != null ? hw - OVERLAP_MS : Date.now() - FIRST_SYNC_DAYS * 86_400_000;
    const records: CanonicalEvent[] = [];
    let maxSeen: string | null = args.cursor ?? null;

    for (let page = 0; page < PAGES_PER_POLL; page++) {
      const messages = await listMessages(auth, PAGE_LIMIT, page * PAGE_LIMIT);
      if (messages.length === 0) break;

      let pageAllBelowFloor = true;
      let anyDated = false;
      for (const msg of messages) {
        const ts = messageDate(msg);
        if (ts) anyDated = true;
        const t = ts ? Date.parse(ts) || 0 : 0;
        if (t >= floor) pageAllBelowFloor = false;
        if (t < floor) continue;
        records.push(toCanonical(msg, args.connectionId));
        if (ts && (maxSeen == null || (Date.parse(ts) || 0) > (Date.parse(maxSeen) || 0))) maxSeen = ts;
      }
      // Messages came back and not one carried a timestamp we recognise. The
      // floor then silently rejects every single one, and the sweep reports
      // "0 loaded" for a busy account — the same lie as an unparsed envelope,
      // one layer down. Say which keys arrived so the fix is one line.
      if (!anyDated) {
        throw new Error(
          `sendblue: ${messages.length} message(s) returned but none carried a readable date ` +
            `(looked for ${DATE_KEYS.join(", ")}; the first message has: ${keyList(messages[0])}). ` +
            `The date field has been renamed — messageDate() needs the new key.`,
        );
      }
      if (pageAllBelowFloor || messages.length < PAGE_LIMIT) break;
    }
    return { records, nextCursor: maxSeen };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const auth = authHeaders(args.credentials);
    const messages = await listMessages(auth, Math.min(n, PAGE_LIMIT), 0);
    return messages.slice(0, n).map((m) => toCanonical(m, args.connectionId));
  },

  /**
   * D.6: make sure Sendblue still has a webhook pointed at our inbound URL;
   * re-create it when missing. Run by the sweep, so a subscription lost to a
   * provider-side reset heals within one sweep interval.
   */
  async verifyWebhookSubscription(args: VerifyWebhookArgs): Promise<VerifyWebhookResult> {
    const auth = authHeaders(args.credentials);
    try {
      const data = await fetchJson<{ webhooks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        `${API_BASE}/api/account/webhooks`,
        { headers: auth },
      );
      const hooks = Array.isArray(data) ? data : (data.webhooks ?? []);
      const present = hooks.some((h) => str(h["url"]) === args.webhookUrl);
      if (present) return { healthy: true, reregistered: false };

      await fetchJson(`${API_BASE}/api/account/webhooks`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ url: args.webhookUrl }),
      });
      return { healthy: true, reregistered: true };
    } catch (e) {
      return { healthy: false, reregistered: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

function authHeaders(credentials?: Record<string, unknown> | null): Record<string, string> {
  const id = str(credentials?.["apiKey"]);
  const secret = str(credentials?.["apiSecret"]);
  if (!id || !secret) throw new Error("sendblue: missing API key id/secret");
  return { "sb-api-key-id": id, "sb-api-secret-key": secret };
}

/** Timestamp keys Sendblue has been seen to use, in preference order. */
const DATE_KEYS = ["date_sent", "date_received", "date_updated", "created_at", "sent_at", "timestamp"] as const;

function messageDate(msg: Record<string, unknown>): string | null {
  for (const k of DATE_KEYS) {
    const v = str(msg[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Where the message array sits in Sendblue's response.
 *
 * Their v2 API documents a `{status, message, data}` envelope, but this endpoint
 * has also been described as returning a bare array and as `{messages: […]}`.
 * Reading one fixed key is what let this connector report "0 loaded" against an
 * account with hundreds of messages: the HTTP call succeeded, the key we happened
 * to read was absent, and `?? []` turned "I did not understand the response" into
 * "the account is empty" — indistinguishable to the user, and wrong.
 *
 * Checking every plausible position costs nothing and removes the guess. What
 * matters more is the last line: if the array is in NONE of them, that is an
 * error, not a zero.
 */
const LIST_PATHS: readonly (readonly string[])[] = [
  ["messages"],
  ["data"],
  ["data", "messages"],
  ["results"],
  ["data", "results"],
  ["items"],
  ["data", "items"],
];

function extractMessages(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  for (const path of LIST_PATHS) {
    let cur: unknown = payload;
    for (const key of path) cur = asObject(cur)[key];
    if (Array.isArray(cur)) return cur as Array<Record<string, unknown>>;
  }
  throw new Error(
    `sendblue: could not find the message list in the response ` +
      `(top-level keys: ${keyList(payload)}; looked at ${LIST_PATHS.map((p) => p.join(".")).join(", ")}). ` +
      `Reporting this as an error rather than as zero messages, because it is not the same thing.`,
  );
}

/** One page of message history, parsed. Shared by the poll and the preview. */
async function listMessages(auth: Record<string, string>, limit: number, offset: number): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const data = await fetchJson<unknown>(`${API_BASE}/api/v2/messages?${params.toString()}`, { headers: auth });
  return extractMessages(data);
}

function keyList(v: unknown): string {
  if (v == null) return "none (null)";
  if (Array.isArray(v)) return `array of ${v.length}`;
  if (typeof v !== "object") return typeof v;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.length > 0 ? keys.join(", ") : "none (empty object)";
}

/** Shared by the webhook path and the poll: both speak the message shape. */
function toCanonical(body: Record<string, unknown>, connectionId: string): CanonicalEvent {
  const status = (str(body["status"]) ?? "").toUpperCase();
  // Inbound "receive" payloads carry no outbound status; outbound status
  // payloads always include a `status`.
  const isInbound = body["is_outbound"] === false || (status === "" && str(body["date_received"]) !== null);
  const eventType = statusToType(status, isInbound);
  // Sendblue docs: dedupe on message_handle.
  const naturalId = str(body["message_handle"]) ?? str(body["handle"]) ?? str(body["message_id"]) ?? undefined;
  const eventId = naturalId
    ? `sendblue:${connectionId}:${eventType}:${naturalId}`
    : hashId(`sendblue:${connectionId}`, body);
  const subject =
    str(body["to_number"]) ?? str(body["from_number"]) ?? str(body["number"]) ?? str(body["phone"]) ?? null;
  const occurredAt = parseDate(messageDate(body)) ?? new Date();
  return { eventId, eventType, subject, occurredAt, properties: body };
}

function statusToType(status: string, inbound: boolean): string {
  if (inbound) return "sms_received";
  if (status === "DELIVERED") return "sms_delivered";
  if (status === "SENT") return "sms_sent";
  if (status === "QUEUED") return "sms_queued";
  if (status === "ERROR") return "sms_error";
  return "sms_sent";
}
