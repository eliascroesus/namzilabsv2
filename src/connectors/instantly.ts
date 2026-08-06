import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { fetchJson, HttpError } from "@/lib/http-client";
import { asObject, holdsWindowContinuation, parseDate, str } from "./field-utils";

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
   * Only the `raw_emails` walk ever holds one. Both analytics streams return
   * `nextCursor: null` on every poll, so this is false for them by construction
   * rather than by a special case.
   */
  holdsContinuation: holdsWindowContinuation,

  /**
   * DELIBERATELY no `operationFor` and no `operations`: Instantly publishes
   * exactly one limit — 6,000/min for the whole workspace, shared across every
   * endpoint, both API versions and all keys — so every claim must land in the
   * one `"*"` bucket the catalog declares. Per-endpoint keys here would split
   * a single provider-side budget into several ledger buckets, each enforced
   * alone, which models a limit the provider does not have. What is lost is
   * per-endpoint attribution in the ledger's audit trail; what is gained is
   * that the enforced shape matches the charged shape.
   */

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
    // Fails CLOSED, for the same reason as Sendblue: injected rows land at
    // generation 0 and are unreachable by every sweep. This IS reachable now —
    // the route verifies BEFORE the stream-scoped doorbell bail, so this check
    // is what stands between an anonymous POST and a quota-spending sweep.
    if (!secret) return false;
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
        occurredAt: parseDate(str(body["timestamp"]) ?? str(body["timestamp_created"]), "timestamp") ?? new Date(),
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
/**
 * Which campaign a row is actually ABOUT — the provider's answer, never ours.
 *
 * `campaign_id` first, then `campaign`, then `id`: a row from
 * `/campaigns/analytics` is one campaign's totals, so its own `id` is that
 * campaign. Returns null when the row claims no identity at all, which is a
 * different answer from "a different campaign" and is treated differently below.
 */
function rowCampaignId(row: Record<string, unknown>): string | null {
  return str(row["campaign_id"]) ?? str(row["campaign"]) ?? str(row["id"]) ?? null;
}

/**
 * VERIFIED LIVE, 2026-08-02: `campaign_id` DOES NOTHING on
 * `/campaigns/analytics`. A request carrying it returned 49 rows; the identical
 * request without it returned the same 49. The endpoint answers with one row per
 * campaign in the workspace, whatever you ask for.
 *
 * The connector took `rows[0]` and then spread `campaign_id: <requested>` over
 * it. On a 52-campaign workspace that meant **every** "Campaign totals" stream
 * stored the first campaign's numbers under whichever campaign the user picked —
 * wrong numbers wearing the right label, which is the worst shape a bug can take
 * here because nothing about the row looks wrong.
 *
 * So scoping is done HERE, against what the provider actually returned. The
 * request parameter is still sent — it costs nothing and may start working — but
 * nothing depends on it.
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
  const all = asRows(await getJson(`${API}/campaigns/analytics/daily?${params.toString()}`, args.credentials));
  probeCampaignScoping(all, campaignId);

  /**
   * SCOPE TO THE REQUESTED CAMPAIGN, TWO WAYS, because one of them can be
   * unavailable.
   *
   * The sibling endpoint `/campaigns/analytics` was found to ignore
   * `campaign_id` entirely, so this one cannot be assumed to honour it either.
   *
   * 1. If the rows say which campaign they belong to, keep only ours.
   * 2. If they say nothing, fall back to a property that does not need them to:
   *    this endpoint returns one row per DAY, so a repeated date means the
   *    response covers more than one campaign. That cannot be scoped after the
   *    fact — every row for a given day would collide on one `eventId` and the
   *    last one written would win, arbitrarily.
   *
   * Case 2 stores nothing and says so. The alternative is the totals bug in a
   * new place: a plausible daily number belonging to a campaign nobody chose.
   */
  const identified = all.filter((r) => rowCampaignId(r) !== null);
  let rows = identified.length > 0 ? all.filter((r) => rowCampaignId(r) === campaignId) : all;
  if (identified.length === 0) {
    const dates = all.map((r) => str(r["date"]) ?? str(r["day"])).filter(Boolean);
    if (new Set(dates).size !== dates.length) {
      console.warn(
        `[instantly-probe] daily analytics: ${all.length} row(s) carry no campaign id and repeat dates, so the ` +
          `response covers several campaigns and cannot be scoped to ${campaignId}. Storing nothing.`,
      );
      rows = [];
    }
  }

  const records: CanonicalEvent[] = [];
  for (const row of rows) {
    const date = str(row["date"]) ?? str(row["day"]);
    const at = date ? parseDate(date, "date") : null;
    if (!at) continue;
    records.push({
      eventId: `instantly:${args.connectionId}:${campaignId}:daily:${ymd(at)}`,
      eventType: "campaign_day",
      subject: `${campaignId} ${ymd(at)}`,
      occurredAt: at,
      // As sent. Stamping the requested id over the row is what made the totals
      // bug invisible; a row selected BY that field gains nothing from it.
      properties: { ...row },
    });
  }

  /**
   * The read enumerates this window completely, so a day that stops being
   * reported inside it is genuinely gone — but nothing behind `from` is.
   *
   * NOT DECLARED WHEN THE READ PRODUCED NOTHING, and this one was live.
   *
   * `mirrorScope` licenses `retireAbsent` to tombstone every stored row inside
   * the window that the read did not produce, and with an empty record set that
   * is EVERY row inside the window — `retireAbsent` drops its `notInArray`
   * clause when there is nothing present to exclude. A verification run on a
   * real workspace returned zero daily rows for two campaigns out of three, so
   * every sweep was tombstoning those campaigns' last 30 days and the next
   * response that carried rows resurrected them. A number that empties and
   * refills with nothing on screen to say why.
   *
   * An empty response here is not the same claim as an empty spreadsheet. A
   * whole-resource mirror has READ the whole resource, so nothing coming back
   * means nothing is there — that is the mirror contract and `mirror-window`
   * pins it. This endpoint reports days that had activity; a campaign that was
   * quiet returns nothing at all, which is indistinguishable from a campaign
   * whose days were withdrawn. Between "retire real rows on a quiet campaign"
   * and "keep rows the provider stopped mentioning", only the second is
   * recoverable.
   *
   * It also covers the ambiguous branch above, where `rows` is deliberately
   * emptied because the response could not be scoped: having decided to store
   * nothing, the connector must not simultaneously claim to have enumerated the
   * window.
   */
  return { records, nextCursor: null, ...(records.length > 0 ? { mirrorScope: { from, to } } : {}) };
}

/** One restated row per campaign (derived-mirror, no window to bound). */
async function pollCampaignTotals(args: PollArgs): Promise<PollResult> {
  const campaignId = str(args.config?.["campaignId"]);
  if (!campaignId) return { records: [], nextCursor: null };
  const params = new URLSearchParams({ campaign_id: campaignId, exclude_total_leads_count: "true" });
  const rows = asRows(await getJson(`${API}/campaigns/analytics?${params.toString()}`, args.credentials));

  /**
   * THE ROW FOR THE CAMPAIGN THAT WAS ASKED FOR — not `rows[0]`.
   *
   * `rows[0]` was the bug: the endpoint ignores `campaign_id` and returns one
   * row per campaign, so the first row is whichever campaign the workspace
   * happens to list first. See the note above `probeCampaignScoping`.
   */
  const row = rows.find((r) => rowCampaignId(r) === campaignId);
  if (!row) {
    // Empty and LOUD, rather than a plausible number belonging to somebody
    // else. An empty stream is visible — the nightly invariant scan reports it —
    // and a wrong total is not.
    if (rows.length > 0) {
      const identified = rows.filter((r) => rowCampaignId(r) !== null).length;
      console.warn(
        `[instantly-probe] campaign totals: ${rows.length} row(s) returned, none of them campaign ${campaignId} ` +
          `(${identified} carried a campaign id). Storing nothing — the alternative is another campaign's numbers ` +
          `under this campaign's name.`,
      );
    }
    return { records: [], nextCursor: null };
  }
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
        occurredAt: parseDate(str(row["created_at"]) ?? str(row["campaign_created_at"]), "created_at") ?? new Date(),
        // The row EXACTLY as the provider sent it. It used to be spread with
        // `campaign_id: campaignId`, which stamped the requested id over
        // whatever campaign the row was really about — the step that turned a
        // wrong row into an unnoticeable one. The row is now selected by that
        // field, so overwriting it could only ever hide a mismatch.
        properties: { ...row },
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
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SETTLED LIVE, 2026-08-02 — THERE IS NO DATE PARAMETER. Do not probe again.
 *
 * `scripts/verify-instantly.ts` (I5) sent twelve names — `start_date`,
 * `end_date`, `from_date`, `to_date`, `created_after`, `created_before`,
 * `after`, `before`, `since`, `timestamp_created_gte`,
 * `timestamp_created_after`, `updated_after` — each against an unbounded
 * control. **All twelve were ACCEPTED and returned an identical id set.** Every
 * one is discarded, which is exactly what Close did with `date_created__gte`.
 *
 * Two consequences, and both are load-bearing rather than stylistic:
 *
 * 1. **The client-side floor loop below STAYS.** It is not a stopgap for a
 *    server bound nobody got round to; it is the only bound that exists.
 * 2. **The newest-first dependence STAYS with it.** `pageAllBelowFloor` ends the
 *    walk when a whole page falls under the floor, which is only correct while
 *    the oldest records arrive last. That assumption is declared and asserted in
 *    both directions in `tests/connector-contract.test.ts`, and I2 confirmed it
 *    live on both `timestamp_created` and `timestamp_email` across 50 dated
 *    rows, none absent and none unparseable. It cannot be removed by finding a
 *    better parameter, because there is not one.
 *
 * Also observed: **`limit` has no cap at 50.** `limit=51` was accepted and
 * returned 51 rows. `PAGE_LIMIT` is our own pacing choice against a 20 req/min
 * budget, not a provider maximum — raising it is a rate-limit decision rather
 * than a correctness one.
 * ════════════════════════════════════════════════════════════════════════════
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
      /**
       * A dead continuation must not wedge the stream — and must not ADVANCE THE
       * MARK on its way out, which is what this did.
       *
       * `serializeWindowCursor` falls through to `maxSeen ?? hw` the moment
       * `cont` is null, so `{...cur, cont: null}` promoted the newest record of a
       * PARTIAL walk to the next window's floor. The list is newest-first, so the
       * partial walk holds the newest pages and the unread remainder is older
       * than everything in it: promoting `maxSeen` puts that remainder below the
       * floor, where nothing requests it ever again. The stream unwedges and
       * silently drops whatever it had not reached.
       *
       * So the mark stays exactly where it was and `maxSeen` is discarded. The
       * next sweep re-walks the same window from the same floor, which is the
       * only safe reading of "we did not finish".
       *
       * `incomplete` because there IS outstanding work: the window is going to be
       * re-walked, and a connection mid-import that reports nothing reads as idle,
       * tiers its cadence down, and slows the very pages it is waiting on.
       */
      if (cur.cont && e instanceof HttpError && e.status === 400) {
        return {
          records,
          nextCursor: serializeWindowCursor({ hw: cur.hw, cont: null, maxSeen: null }),
          incomplete: true,
        };
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
    /**
     * DRAINED MEANS THE PROVIDER SAID SO, or the walk paged past the floor.
     *
     * `items.length === 0` used to count as drained too, and it is neither. An
     * empty page carrying a continuation is a provider that has more to give —
     * the same shape that cost this codebase the Calendly past-side window and
     * the truncated `pollAll` walk, both of which ended on an empty page and then
     * tombstoned everything the walk had not reached. Here the cost is the same
     * one: promoting `maxSeen` to the floor while the older remainder is unread.
     *
     * `pageAllBelowFloor` starts as `items.length > 0`, so an empty page can no
     * longer satisfy it either — the walk continues on the continuation, and the
     * page budget bounds it.
     */
    if (!next || pageAllBelowFloor) {
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
    occurredAt: parseDate(str(email["timestamp_created"]) ?? str(email["timestamp_email"]), "timestamp_created") ?? new Date(),
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

