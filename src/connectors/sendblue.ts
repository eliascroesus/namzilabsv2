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

/**
 * Poll cursor. Serialized as the plain high-water date string when no walk is
 * in flight (back-compat with every cursor stored to date), or as JSON mid-walk
 * — the same scheme Close and Instantly use.
 *
 * - `hw`      — newest fully-ingested message time from the LAST completed
 *               window; the floor (with overlap) of the current one. It advances
 *               ONLY when the window drains, which is the whole fix: advancing
 *               it early is what stranded everything below the newest 300.
 * - `cont`    — where to resume. This endpoint has no page token, only
 *               `limit`/`offset`, so the continuation is an OFFSET plus the
 *               oldest message time ingested so far (`lowWater`).
 * - `maxSeen` — newest time seen during the current walk; becomes `hw` on drain.
 *
 * **Why an offset is safe to resume from.** The list is newest-first, so
 * messages arriving between sweeps push older ones to HIGHER offsets: a stored
 * offset can only re-read, never skip, and `message_handle` dedup makes a
 * re-read free. Deletions shift the other way, so the resume starts one page
 * above the stored offset and discards anything at or newer than `lowWater` —
 * bounded re-read, no gap, no dependence on the provider holding offsets still.
 */
type SendblueCursor = {
  hw: string | null;
  cont: { offset: number; lowWater: string | null } | null;
  maxSeen: string | null;
};

function parseSendblueCursor(cursor: string | null): SendblueCursor {
  if (!cursor) return { hw: null, cont: null, maxSeen: null };
  if (cursor.startsWith("{")) {
    try {
      const p = JSON.parse(cursor) as Partial<SendblueCursor>;
      const cont =
        p.cont && typeof p.cont.offset === "number"
          ? { offset: p.cont.offset, lowWater: typeof p.cont.lowWater === "string" ? p.cont.lowWater : null }
          : null;
      return { hw: p.hw ?? null, cont, maxSeen: p.maxSeen ?? null };
    } catch {
      return { hw: null, cont: null, maxSeen: null };
    }
  }
  return { hw: cursor, cont: null, maxSeen: null };
}

function serializeSendblueCursor(c: SendblueCursor): string | null {
  if (c.cont) return JSON.stringify(c);
  return c.maxSeen ?? c.hw;
}

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
   * Reconciliation backstop: page the message history newest-first down to the
   * stored high-water mark minus a 5-minute overlap.
   *
   * THE BUG THIS FIXES. The old poll walked three pages and then returned the
   * NEWEST timestamp it had seen as the next cursor. The next sweep's floor
   * became that mark — so on any account with more than 300 messages above the
   * floor (a burst, a backlog, a sweep that was throttled), everything between
   * the 300th and the old floor was **never requested by anything again.** Not
   * an error, not a zero, not a slow sync: the rows were simply absent and
   * nothing said so. It is the same defect already fixed in Close ("Defect #2")
   * and in Instantly's raw-email walk; Sendblue had grown the multi-page walk
   * but not the continuation, which raised the threshold from 100 to 300
   * instead of removing it. `tests/stranding-contract.test.ts` pins it for all
   * three.
   *
   * The cursor is now the same `{hw, cont, maxSeen}` shape Close uses, with the
   * continuation carrying an OFFSET because this endpoint has no page token —
   * see {@link SendblueCursor} for why an offset is safe to resume from.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const auth = authHeaders(args.credentials);
    const cur = parseSendblueCursor(args.cursor);
    const hw = cur.hw ? Date.parse(cur.hw) || 0 : null;
    // A FIRST sweep has no high-water mark, and this endpoint pages by offset
    // over the whole account — so without a floor it walks all history on
    // connect. Bound it: the first sweep imports a recent window, and the
    // cursor carries it forward from there. (Deeper history needs the E.8
    // backfill lane; see the deferred triggers in the plan.)
    const floor = hw != null ? hw - OVERLAP_MS : Date.now() - FIRST_SYNC_DAYS * 86_400_000;
    const records: CanonicalEvent[] = [];
    // Seeded from the stored mark so a sweep that ingests nothing returns what
    // it was given rather than null — null means START OVER (PollResult).
    let maxSeen: string | null = cur.maxSeen ?? cur.hw;
    let minSeen: string | null = cur.cont?.lowWater ?? null;

    // Resume one page ABOVE where we stopped. New messages push older ones to
    // higher offsets, so a stored offset can only ever re-read (harmless —
    // message_handle dedups) and never skip; the extra page covers deletions,
    // which shift the other way. Items at or above `lowWater` were already
    // ingested on a previous sweep and are dropped without a second thought.
    const startOffset = cur.cont ? Math.max(0, cur.cont.offset - PAGE_LIMIT) : 0;
    const lowWaterMs = cur.cont?.lowWater ? Date.parse(cur.cont.lowWater) || null : null;

    let offset = startOffset;
    let exhausted = false;
    for (let page = 0; page < PAGES_PER_POLL; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset) });
      const data = await fetchJson<{ messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        `${API_BASE}/api/v2/messages?${params.toString()}`,
        { headers: auth },
      );
      const messages = Array.isArray(data) ? data : (data.messages ?? []);
      if (messages.length === 0) {
        exhausted = true;
        break;
      }

      let pageAllBelowFloor = messages.length > 0;
      for (const msg of messages) {
        const ts = messageDate(msg);
        // A message with none of the four date fields used to parse as t=0,
        // fall below every floor, and be dropped SILENTLY AND FOREVER. Undated
        // is not the same as ancient: keep it, and let it sit outside the
        // window bookkeeping.
        if (!ts) {
          records.push(toCanonical(msg, args.connectionId));
          pageAllBelowFloor = false;
          continue;
        }
        const t = Date.parse(ts) || 0;
        if (t >= floor) pageAllBelowFloor = false;
        if (t < floor) continue;
        // Already ingested on an earlier sweep of this same walk.
        if (lowWaterMs != null && t >= lowWaterMs) continue;
        records.push(toCanonical(msg, args.connectionId));
        if (maxSeen == null || t > (Date.parse(maxSeen) || 0)) maxSeen = ts;
        if (minSeen == null || t < (Date.parse(minSeen) || 0)) minSeen = ts;
      }
      offset += messages.length;
      if (pageAllBelowFloor || messages.length < PAGE_LIMIT) {
        exhausted = true;
        break;
      }
    }

    // Window drained: the high-water mark advances and the continuation clears.
    if (exhausted) return { records, nextCursor: serializeSendblueCursor({ hw: maxSeen ?? cur.hw, cont: null, maxSeen: null }) };

    // Page budget spent mid-window: persist where to resume (hw UNCHANGED, so
    // the floor cannot creep up past data we have not read yet).
    return {
      records,
      nextCursor: serializeSendblueCursor({ hw: cur.hw, cont: { offset, lowWater: minSeen }, maxSeen }),
      incomplete: true,
      importProgress: { reachedBack: new Date(minSeen ? Date.parse(minSeen) || floor : floor), targetBack: new Date(floor) },
    };
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

/**
 * Shared by the webhook path and the poll: both speak the message shape.
 *
 * ONE ROW PER MESSAGE, keyed on `message_handle` alone.
 *
 * The id used to embed the status-derived event type. Sendblue's lifecycle is
 * QUEUED → SENT → DELIVERED and each stage fires its own webhook, so the same
 * message produced up to THREE rows via webhooks and exactly one via the poll —
 * whichever status happened to be live when the poll ran. The row count
 * depended on how the data arrived rather than on what was true, and "messages
 * sent" counted a single text up to three times.
 *
 * Calendly's booked + canceled pair is the deliberate opposite and stays as it
 * is: those are two different facts about two different moments, and every path
 * produces both. A status transition is one fact changing, which is an UPDATE —
 * and `upsertEvents` already handles that correctly, ratcheting the generation
 * and clearing any tombstone.
 *
 * `status` and the per-stage timestamps live in `properties`, so "delivered
 * count" is a Filter away and nothing is lost by collapsing the rows.
 */
function toCanonical(body: Record<string, unknown>, connectionId: string): CanonicalEvent {
  const status = (str(body["status"]) ?? "").toUpperCase();
  // Inbound "receive" payloads carry no outbound status; outbound status
  // payloads always include a `status`.
  const isInbound = body["is_outbound"] === false || (status === "" && str(body["date_received"]) !== null);
  // Sendblue docs: dedupe on message_handle.
  const naturalId = str(body["message_handle"]) ?? str(body["handle"]) ?? str(body["message_id"]) ?? undefined;
  const eventId = naturalId ? `sendblue:${connectionId}:${naturalId}` : hashId(`sendblue:${connectionId}`, body);
  const subject =
    str(body["to_number"]) ?? str(body["from_number"]) ?? str(body["number"]) ?? str(body["phone"]) ?? null;
  const occurredAt = parseDate(messageDate(body)) ?? new Date();
  return {
    eventId,
    // Stable for the life of the message: which DIRECTION it went. The stage it
    // has reached is a property, because it changes.
    eventType: isInbound ? "sms_received" : "sms_outbound",
    subject,
    occurredAt,
    properties: { ...body, message_status: status || null, delivery_stage: deliveryStage(status, isInbound) },
  };
}

/**
 * The lifecycle stage as a plain word, so a Filter step can ask for it without
 * knowing Sendblue's uppercase vocabulary. Kept alongside the raw `status`
 * rather than replacing it.
 */
function deliveryStage(status: string, inbound: boolean): string {
  if (inbound) return "received";
  if (status === "DELIVERED") return "delivered";
  if (status === "SENT") return "sent";
  if (status === "QUEUED") return "queued";
  if (status === "ERROR") return "error";
  return "sent";
}
