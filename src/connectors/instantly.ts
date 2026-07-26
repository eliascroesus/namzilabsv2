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
/** Rolling analytics window, and the ceiling a user can widen it to. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
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

  /**
   * Every endpoint this connector claims budget against. The catalog declares a
   * published limit per key, and the budget layer enforces each separately —
   * so this list and the catalog's `rateLimits` must agree. A declared limit
   * with no operation emitting it is dead config; a provider-gateway test fails
   * on that mismatch in either direction.
   */
  operations: ["emails.list", "campaigns.list", "campaigns.analytics", "campaigns.analytics.daily"] as const,

  /** Which endpoint a poll of this stream will hit — resolved before the call. */
  operationFor(config?: Record<string, unknown>): string {
    switch (streamTypeOf(config)) {
      case "analytics_daily":
        return "campaigns.analytics.daily";
      case "analytics_totals":
        return "campaigns.analytics";
      default:
        return "emails.list";
    }
  },

  /** The campaign picker in the Get data step. */
  async listOptions(key, args) {
    if (key !== "campaignId") return [];
    const campaigns = await getJson<{ items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      `${API}/campaigns?limit=100`,
      args.credentials,
    );
    const items = Array.isArray(campaigns) ? campaigns : (campaigns.items ?? []);
    return items
      .map((c) => ({ value: str(c["id"]) ?? "", label: str(c["name"]) ?? str(c["id"]) ?? "Untitled campaign" }))
      .filter((o) => o.value);
  },

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
   * Analytics-first. Which endpoint depends on the stream's `streamType`:
   *
   * - `analytics_daily` (default): per-day totals for ONE campaign over a
   *   rolling window, declared as a `mirrorScope` so restated days self-correct
   *   while history behind the window is never touched.
   * - `analytics_totals`: one row per campaign, restated in place forever.
   * - `raw_emails`: the individual-email walk, ALWAYS campaign-scoped and
   *   date-bounded. Never a whole-workspace dump — a workspace-wide walk is
   *   what made a 37.9K-email account unable to finish a first sync.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    switch (streamTypeOf(args.config)) {
      case "analytics_daily":
        return pollDailyAnalytics(args);
      case "analytics_totals":
        return pollCampaignTotals(args);
      default:
        return pollRawEmails(args);
    }
  },

  /**
   * The connect-time preview. Reads ANALYTICS, not /emails — a preview must
   * never be the expensive call, and on a large workspace the emails list is
   * exactly the request that cannot finish.
   */
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const campaignId = str(args.config?.["campaignId"]);
    if (!campaignId) return [];
    const { records } = await pollDailyAnalytics({ ...args, config: { ...args.config, days: Math.min(n, 30) } });
    return records.slice(0, n);
  },
};

type StreamType = "analytics_daily" | "analytics_totals" | "raw_emails";

function streamTypeOf(config?: Record<string, unknown> | null): StreamType {
  const v = str(config?.["streamType"]);
  return v === "analytics_totals" || v === "raw_emails" ? v : "analytics_daily";
}

async function getJson<T>(url: string, credentials?: Record<string, unknown> | null): Promise<T> {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("instantly: missing API key");
  try {
    return await fetchJson<T>(url, { headers: { authorization: `Bearer ${key}` } });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      throw new Error(looksLikeInstantlyV1Key(key) ? RECONNECT_HINT : "Instantly rejected this API key — open the connection and reconnect.");
    }
    throw e;
  }
}

const asRows = (data: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  const o = asObject(data);
  for (const k of ["items", "data", "results"]) {
    if (Array.isArray(o[k])) return o[k] as Array<Record<string, unknown>>;
  }
  return Object.keys(o).length > 0 ? [o] : [];
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * ONE CALL PER CAMPAIGN, by decision.
 *
 * We do not know whether the daily endpoint accepts several campaign ids in one
 * request, and guessing wrong in the cheap direction would silently pull the
 * wrong campaign's numbers. So each stream asks for its own campaign — correct
 * whichever way the API behaves, at the cost of one call per campaign.
 *
 * The probe below records what the response actually looks like so the question
 * can be settled from production logs instead of another guess: if rows come
 * back carrying campaign ids we did NOT ask for, the endpoint is ignoring the
 * filter (a correctness problem worth knowing about immediately); if every row
 * carries the requested id, batching is plausible and can be measured later.
 */
function probeCampaignScoping(rows: Array<Record<string, unknown>>, requested: string): void {
  const ids = new Set(rows.map((r) => str(r["campaign_id"]) ?? str(r["campaign"]) ?? "").filter(Boolean));
  if (ids.size === 0) return; // endpoint doesn't echo the campaign — nothing to learn
  const foreign = [...ids].filter((id) => id !== requested);
  if (foreign.length > 0) {
    console.warn(`[instantly-probe] daily analytics returned ${foreign.length} unrequested campaign id(s) for ${requested} — the campaign_id filter may be ignored`);
  } else if (ids.size === 1) {
    console.info(`[instantly-probe] daily analytics echoes exactly the requested campaign (${requested}) — per-campaign calls confirmed; batching unverified`);
  }
}

/** Per-day totals for one campaign over a rolling window (derived-mirror). */
async function pollDailyAnalytics(args: PollArgs): Promise<PollResult> {
  const campaignId = str(args.config?.["campaignId"]);
  if (!campaignId) return { records: [], nextCursor: null };
  const days = Math.min(Math.max(Number(args.config?.["days"] ?? DEFAULT_WINDOW_DAYS) || DEFAULT_WINDOW_DAYS, 1), MAX_WINDOW_DAYS);

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const params = new URLSearchParams({
    campaign_id: campaignId,
    start_date: ymd(from),
    end_date: ymd(to),
    exclude_total_leads_count: "true",
  });
  const rows = asRows(await getJson(`${API}/campaigns/analytics/daily?${params.toString()}`, args.credentials));
  probeCampaignScoping(rows, campaignId);

  const records: CanonicalEvent[] = [];
  for (const row of rows) {
    const date = str(row["date"]) ?? str(row["day"]);
    const at = date ? parseDate(date) : null;
    if (!at) continue;
    records.push({
      eventId: `instantly:${args.connectionId}:${campaignId}:daily:${ymd(at)}`,
      eventType: "campaign_day",
      subject: `${campaignId} ${ymd(at)}`,
      occurredAt: at,
      properties: { ...row, campaign_id: campaignId },
    });
  }

  // The read enumerates this window completely, so a day that stops being
  // reported inside it is genuinely gone — but nothing behind `from` is.
  return { records, nextCursor: null, mirrorScope: { from, to } };
}

/** One restated row per campaign (derived-mirror, no window to bound). */
async function pollCampaignTotals(args: PollArgs): Promise<PollResult> {
  const campaignId = str(args.config?.["campaignId"]);
  if (!campaignId) return { records: [], nextCursor: null };
  const params = new URLSearchParams({ campaign_id: campaignId, exclude_total_leads_count: "true" });
  const rows = asRows(await getJson(`${API}/campaigns/analytics?${params.toString()}`, args.credentials));
  const row = rows[0];
  if (!row) return { records: [], nextCursor: null };
  return {
    records: [
      {
        eventId: `instantly:${args.connectionId}:${campaignId}:totals`,
        eventType: "campaign_totals",
        subject: campaignId,
        // A campaign total did not "happen" at a time. Use the campaign's own
        // creation date when the API supplies one; otherwise first-seen, which
        // preserveOccurredAt below pins so it neither shows 1970 nor marches
        // forward on every sweep.
        occurredAt: parseDate(str(row["created_at"]) ?? str(row["campaign_created_at"])) ?? new Date(),
        properties: { ...row, campaign_id: campaignId },
      },
    ],
    nextCursor: null,
    preserveOccurredAt: true,
  };
}

/**
 * Individual emails for ONE campaign, date-bounded. Same window discipline as
 * before (drain the window, persist a continuation, advance the mark only once
 * drained) — but scoped, so it can never become a workspace-wide walk.
 *
 * DEFERRED DEPENDENCY: this is a Records-class stream. Before it is offered for
 * an account with real history it needs the E.8 backfill lane (checkpointed,
 * resumable, low-priority) — see the deferred-triggers section of the plan.
 */
async function pollRawEmails(args: PollArgs): Promise<PollResult> {
  const campaignId = str(args.config?.["campaignId"]);
  if (!campaignId) return { records: [], nextCursor: null };
  const days = Math.min(Math.max(Number(args.config?.["days"] ?? DEFAULT_WINDOW_DAYS) || DEFAULT_WINDOW_DAYS, 1), MAX_WINDOW_DAYS);
  const cur = parseWindowCursor(args.cursor);
  const bound = new Date(Date.now() - days * 86_400_000).getTime();
  const floor = Math.max(cur.hw != null ? (Date.parse(cur.hw) || 0) - OVERLAP_MS : 0, bound);
  const records: CanonicalEvent[] = [];

  for (let page = 0; page < PAGES_PER_POLL; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), campaign_id: campaignId });
    if (cur.cont) params.set("starting_after", cur.cont);

    let data: { items?: Array<Record<string, unknown>>; next_starting_after?: string | null };
    try {
      data = await getJson(`${API}/emails?${params.toString()}`, args.credentials);
    } catch (e) {
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
      if (t >= floor) pageAllBelowFloor = false;
      if (t < floor) continue;
      records.push(mapEmail(email, args.connectionId));
      cur.maxSeen = laterIso(cur.maxSeen, ts);
    }

    const next = data.next_starting_after ?? null;
    if (!next || items.length === 0 || pageAllBelowFloor) {
      return { records, nextCursor: serializeWindowCursor({ hw: cur.maxSeen ?? cur.hw, cont: null, maxSeen: null }) };
    }
    cur.cont = next;
  }
  return { records, nextCursor: serializeWindowCursor(cur) };
}

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

