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
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(page * PAGE_LIMIT) });
      const data = await fetchJson<{ messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        `${API_BASE}/api/v2/messages?${params.toString()}`,
        { headers: auth },
      );
      const messages = Array.isArray(data) ? data : (data.messages ?? []);
      if (messages.length === 0) break;

      let pageAllBelowFloor = true;
      for (const msg of messages) {
        const ts = messageDate(msg);
        const t = ts ? Date.parse(ts) || 0 : 0;
        if (floor == null || t >= floor) pageAllBelowFloor = false;
        if (floor != null && t < floor) continue;
        records.push(toCanonical(msg, args.connectionId));
        if (ts && (maxSeen == null || (Date.parse(ts) || 0) > (Date.parse(maxSeen) || 0))) maxSeen = ts;
      }
      if (pageAllBelowFloor || messages.length < PAGE_LIMIT) break;
    }
    return { records, nextCursor: maxSeen };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const auth = authHeaders(args.credentials);
    const params = new URLSearchParams({ limit: String(Math.min(n, PAGE_LIMIT)), offset: "0" });
    const data = await fetchJson<{ messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      `${API_BASE}/api/v2/messages?${params.toString()}`,
      { headers: auth },
    );
    const messages = Array.isArray(data) ? data : (data.messages ?? []);
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

function messageDate(msg: Record<string, unknown>): string | null {
  return str(msg["date_sent"]) ?? str(msg["date_received"]) ?? str(msg["date_updated"]) ?? str(msg["created_at"]) ?? null;
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
