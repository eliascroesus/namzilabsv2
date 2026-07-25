import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { fetchJson, HttpError } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

const API = "https://api.instantly.ai/api/v2";

/**
 * Page walk budget per poll. The emails list endpoint has a published budget of
 * 20 requests/minute (declared in the catalog's rateLimits and enforced by the
 * provider-gateway later): 3 pages per 10-minute sweep sits far under it.
 */
const PAGES_PER_POLL = 3;
const PAGE_LIMIT = 50;
/** Re-read cushion below the high-water mark; event_id dedup makes it free. */
const OVERLAP_MS = 5 * 60_000;

const EVENT_TYPE_MAP: Record<string, string> = {
  email_sent: "email_sent",
  email_opened: "email_opened",
  email_link_clicked: "email_clicked",
  reply_received: "reply",
  email_bounced: "bounced",
  lead_unsubscribed: "unsubscribed",
  campaign_completed: "campaign_completed",
  lead_neutral: "lead_neutral",
  account_error: "account_error",
};

/**
 * v1 API keys stopped working on 2026-01-19 and v2 keys are incompatible.
 * v2 keys are long base64 blobs (base64 of "uuid:secret"); v1 keys were short
 * opaque tokens. Heuristic only — the authoritative signal is the 401 — but it
 * lets the error message say the RIGHT thing: reconnect with a v2 key.
 */
export function looksLikeInstantlyV1Key(key: string): boolean {
  if (key.length >= 50) return false;
  try {
    return !Buffer.from(key, "base64").toString("utf8").includes(":");
  } catch {
    return true;
  }
}

const RECONNECT_HINT =
  "Instantly rejected this API key. v1 keys were deprecated on Jan 19, 2026 and no longer work — open the connection and reconnect with a v2 API key (Instantly settings → Integrations → API).";

/**
 * Instantly (v2). Webhook-primary source. Instantly's docs recommend adding
 * idempotency + verification on the receiver: we verify an optional HMAC-SHA256
 * signature over the body via `x-instantly-signature` when a secret is set.
 */
export const instantlyConnector: Connector = {
  source: "instantly",
  authType: "apiKey",

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return true; // No secret configured => accept (verification optional).
    const provided = headers["x-instantly-signature"];
    if (!provided) return false;
    const normalized = provided.startsWith("sha256=") ? provided.slice("sha256=".length) : provided;
    return safeEqual(normalized, hmacSha256Hex(secret, rawBody));
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const eventType = str(body["event_type"]) ?? "instantly.event";
    const naturalId = str(body["email_id"]) ?? undefined;
    const eventId = naturalId
      ? `instantly:${ctx.connectionId}:${eventType}:${naturalId}`
      : hashId(`instantly:${ctx.connectionId}`, body);
    return [
      {
        eventId,
        eventType: EVENT_TYPE_MAP[eventType] ?? eventType,
        subject: str(body["lead_email"]) ?? null,
        occurredAt: parseDate(str(body["timestamp"]) ?? str(body["timestamp_created"])) ?? new Date(),
        properties: body,
      },
    ];
  },

  /**
   * Reconciliation backstop over GET /api/v2/emails (newest-first, paginated by
   * `starting_after`). Same window discipline as Close: walk the window above
   * the stored high-water mark to its end; a deeper window persists its
   * continuation in the cursor and resumes next sweep (nothing stranded); the
   * mark advances only once drained; a 5-minute overlap keeps boundary ties.
   * Covers sent emails and replies — open/click activity stays webhook-only
   * granularity.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const key = str(args.credentials?.["apiKey"]);
    if (!key) throw new Error("instantly: missing API key");
    const cur = parseWindowCursor(args.cursor);
    const floor = cur.hw != null ? (Date.parse(cur.hw) || 0) - OVERLAP_MS : null;
    const records: CanonicalEvent[] = [];

    for (let page = 0; page < PAGES_PER_POLL; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cur.cont) params.set("starting_after", cur.cont);

      let data: { items?: Array<Record<string, unknown>>; next_starting_after?: string | null };
      try {
        data = await fetchJson(`${API}/emails?${params.toString()}`, {
          headers: { authorization: `Bearer ${key}` },
        });
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          throw new Error(looksLikeInstantlyV1Key(key) ? RECONNECT_HINT : "Instantly rejected this API key — open the connection and reconnect.");
        }
        // A dead continuation must not wedge the stream: restart the window next sweep.
        if (cur.cont && e instanceof HttpError && e.status === 400) {
          return { records, nextCursor: serializeWindowCursor({ ...cur, cont: null }) };
        }
        throw e;
      }

      const items = data.items ?? [];
      let pageAllBelowFloor = items.length > 0;
      for (const email of items) {
        const ts = str(email["timestamp_created"]) ?? str(email["timestamp_email"]) ?? null;
        const t = ts ? Date.parse(ts) || 0 : 0;
        if (floor == null || t >= floor) pageAllBelowFloor = false;
        if (floor != null && t < floor) continue; // older than the window
        records.push(mapEmail(email, args.connectionId));
        cur.maxSeen = laterIso(cur.maxSeen, ts);
      }

      const next = data.next_starting_after ?? null;
      // Drained: no more pages, an empty page, or (newest-first) a page fully
      // below the window floor — the mark advances to the newest ingested.
      if (!next || items.length === 0 || pageAllBelowFloor) {
        return { records, nextCursor: serializeWindowCursor({ hw: cur.maxSeen ?? cur.hw, cont: null, maxSeen: null }) };
      }
      cur.cont = next;
    }

    // Page budget spent mid-window: resume exactly here next sweep, mark unchanged.
    return { records, nextCursor: serializeWindowCursor(cur) };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const key = str(args.credentials?.["apiKey"]);
    if (!key) throw new Error("instantly: missing API key");
    const data = await fetchJson<{ items?: Array<Record<string, unknown>> }>(
      `${API}/emails?${new URLSearchParams({ limit: String(Math.min(n, PAGE_LIMIT)) }).toString()}`,
      { headers: { authorization: `Bearer ${key}` } },
    );
    return (data.items ?? []).map((email) => mapEmail(email, args.connectionId));
  },
};

/** Map one v2 email object to a canonical event. ue_type: 1 = sent, 2 = reply. */
function mapEmail(email: Record<string, unknown>, connectionId: string): CanonicalEvent {
  const ueType = Number(email["ue_type"] ?? 0);
  const eventType = ueType === 2 ? "reply" : ueType === 1 ? "email_sent" : "email";
  const to = str(email["to_address_email_list"]);
  return {
    eventId: `instantly:${connectionId}:email:${str(email["id"])}`,
    eventType,
    subject: (ueType === 2 ? str(email["from_address_email"]) : to?.split(",")[0]?.trim()) ?? null,
    occurredAt: parseDate(str(email["timestamp_created"]) ?? str(email["timestamp_email"])) ?? new Date(),
    properties: email,
  };
}

/** Shared hw/cont/maxSeen window cursor (same scheme as the Close connector). */
type WindowCursor = { hw: string | null; cont: string | null; maxSeen: string | null };

function parseWindowCursor(cursor: string | null): WindowCursor {
  if (!cursor) return { hw: null, cont: null, maxSeen: null };
  if (cursor.startsWith("{")) {
    try {
      const parsed = JSON.parse(cursor) as Partial<WindowCursor>;
      return { hw: parsed.hw ?? null, cont: parsed.cont ?? null, maxSeen: parsed.maxSeen ?? null };
    } catch {
      return { hw: null, cont: null, maxSeen: null };
    }
  }
  return { hw: cursor, cont: null, maxSeen: null };
}

function serializeWindowCursor(c: WindowCursor): string | null {
  if (c.cont) return JSON.stringify(c);
  return c.maxSeen ?? c.hw;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return (Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a;
}

