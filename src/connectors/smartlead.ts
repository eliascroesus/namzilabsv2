import type { Connector, CanonicalEvent, VerifyArgs, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { eventId, hmacHeaderVerify, isoOrNull, providerClient, requireCredential, windowedWalk, ymd, type Params } from "./kit";

/**
 * Smartlead. One lead-statistics ROW per lead and sequence step, carrying the
 * moment it was sent, opened, clicked and replied to — so one row fans out
 * into up to four dated events, the way Typeform's response fans into two.
 * The API key travels in the QUERY STRING, so every error message and URL
 * this module can produce is scrubbed of it before it leaves.
 *
 * Docs read 8 Sep 2026:
 * - api.smartlead.ai/authentication — base `https://server.smartlead.ai/api/v1`;
 *   the key is the `api_key` query parameter on every request.
 * - api.smartlead.ai/reference/lead-statistics — GET /campaigns/{campaign_id}/
 *   leads-statistics with `limit` ("max 100"), `offset`, and `event_time_gt`
 *   ("Replied/Sent at date in YYYY-MM-DD format") which filters "by when the
 *   last event for the lead was received". THE WATERMARK IS THEREFORE THE ROW'S
 *   NEWEST EVENT TIME — the same axis the request bounds. Envelope `{ ok, data }`.
 * - api.smartlead.ai/api-reference/campaigns/get-all — GET /campaigns/ "returns a
 *   direct array of campaigns, not wrapped in a success object": { id, name, status, … }.
 * - api.smartlead.ai/guides/webhook-integration — `X-Smartlead-Signature` =
 *   `'sha256=' + hmac.new(signing_secret, payload_body, hashlib.sha256).hexdigest()`;
 *   no timestamp in the scheme (idempotency is `X-Request-Id`). Payload examples
 *   for EMAIL_SENT / EMAIL_OPEN / EMAIL_LINK_CLICK / EMAIL_REPLY carry
 *   time_sent / time_opened / time_clicked / time_replied, `campaign_id`,
 *   `to_email` and `sequence_number` — and NO stats id, which is why identity
 *   falls back to the lead + sequence step below.
 *   THE PLAN SAID THIS HEADER WAS UNCONFIRMED and accepted three candidates;
 *   the page names one, so one is accepted.
 * - api.smartlead.ai/api-reference/webhooks/events — the event vocabulary:
 *   EMAIL_SENT, FIRST_EMAIL_SENT, EMAIL_OPEN, EMAIL_LINK_CLICK, EMAIL_REPLY,
 *   EMAIL_BOUNCE, LEAD_UNSUBSCRIBED, LEAD_CATEGORY_UPDATED (category +
 *   lead_data.category.sentiment_type + history[].time + lastReply.time),
 *   CAMPAIGN_STATUS_CHANGED, UNTRACKED_REPLIES, MANUAL_STEP_REACHED,
 *   EMAIL_ACCOUNT_DISCONNECTED, LINKEDIN_DISCONNECTED.
 * - api.smartlead.ai/core/webhooks — names five of those differently
 *   (EMAIL_OPENED / EMAIL_CLICKED / EMAIL_REPLIED / EMAIL_BOUNCED /
 *   EMAIL_UNSUBSCRIBED) and gives them one ISO `timestamp`. Two vendor pages,
 *   two spellings of one fact, so both spellings map and `timestamp` is the
 *   last dated fallback.
 * - api.smartlead.ai/api-reference/webhooks/create — THE REGISTRATION API EXISTS
 *   AND IS STILL NO USE HERE. POST /api/v1/webhook/create takes webhook_url,
 *   association_type ("Scope of the webhook. Valid values: user, client,
 *   campaign"), email_campaign_id, name, event_type_map, category_id_map,
 *   client_id, event_type, category_id, webhook_type and force_create, and
 *   answers 200 with `ok`, `id`, `webhook_url`. NO SECRET IN EITHER DIRECTION:
 *   none of the eleven request parameters is one we could supply, and the
 *   response mints none. .../webhooks/get — GET /api/v1/webhook/{webhook_id}
 *   returns id, email_campaign_id, name, webhook_url, event_type_map,
 *   category_id_map, created_at, updated_at, so there is nothing to read back
 *   afterwards either; .../webhooks/update — PUT /api/v1/webhook/update/
 *   {webhook_id} takes name, webhook_url, event_types and categories, so there
 *   is nothing to set afterwards either. Registering from connect would
 *   therefore create a LIVE subscription this connection could never
 *   authenticate — `verifySignature` would 401 every delivery we ourselves
 *   caused — which is why `autoWebhook` stays false. (The delete half is
 *   published, .../webhooks/delete — DELETE /api/v1/webhook/delete with the id,
 *   404 "Resource not found" when it is already gone. It is the secret that is
 *   missing, not the endpoints.)
 * - helpcenter.smartlead.ai/en/articles/185-assigning-webhooks-to-campaigns-clients-or-users
 *   — a USER-level hook is "applied to all unmapped campaigns. This means that
 *   campaigns not mapped with any webhook will be linked to this webhook", so
 *   one user-level registration WOULD cover campaigns created after connect,
 *   and the per-campaign scoping is not what blocks auto-registration. Only the
 *   secret is. Worth remembering if Smartlead ever publishes one.
 * - And note what a delivery buys this source at all: `campaignId` is a
 *   flowField with no readFilter, so `isStreamScoped("smartlead")` is true and
 *   the inbound route (src/app/api/webhooks/[connectionId]/route.ts) verifies,
 *   rings the connection's doorbell and returns 202 WITHOUT storing the
 *   payload. The poll is the sole ingest path; a signed delivery only decides
 *   WHEN the campaign is re-read. That is why the secret is optional, and why
 *   the events this module maps in `normalize` but the statistics row cannot
 *   date — a bounce, an unsubscribe, a category change — are not counted on
 *   this connection today: no reachable path writes them.
 * - api.smartlead.ai/guides/rate-limits — "Standard | 60 [per minute]",
 *   Pro 120, and "Rate limits apply to your API key across all endpoints
 *   combined" — hence ONE bucket in the catalog ("*"), not one per endpoint.
 *
 * WHAT IS NOT PUBLISHED: the leads-statistics ROW SHAPE. The reference page
 * shows `"data": []` and no sample row, so each fact reads two candidate keys —
 * the field name reported for this endpoint (sent_time, open_time, click_time,
 * reply_time) and the vendor's own webhook name for the same fact (time_sent,
 * time_opened, time_clicked, time_replied). A row that answers to neither is
 * NOT dated with `now`: it produces no events at all, and `scripts/verify-
 * smartlead.ts` prints the real field names against a live account.
 *
 * A bounce, an unsubscribe and a category change reach no counter at all: no
 * documented statistics field dates them (and an undated fact is not an event),
 * and the webhook that carries them is a doorbell for a stream-scoped source,
 * so its payload is never stored. There is deliberately no `normalize` to map
 * them with — see the note where it used to sit. The catalog's syncNote says
 * this out loud rather than promising the webhook makes up the difference.
 */
const API = "https://server.smartlead.ai/api/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };
/** "max 100" (reference/lead-statistics). */
const PAGE = 100;
const DAY_MS = 86_400_000;

/**
 * One statistics row's dated facts, in the order they happen. Two candidate
 * keys each: the name reported for this endpoint, then the vendor's own
 * webhook name for the same fact — the row shape itself is unpublished.
 */
const ROW_FACTS: ReadonlyArray<{ ours: string; fields: readonly string[] }> = [
  { ours: "email_sent", fields: ["sent_time", "time_sent"] },
  { ours: "email_opened", fields: ["open_time", "time_opened"] },
  { ours: "email_clicked", fields: ["click_time", "time_clicked"] },
  { ours: "reply", fields: ["reply_time", "time_replied"] },
];

/*
 * THE WEBHOOK EVENT MAP LIVED HERE, and went with `normalize`.
 *
 * It translated Smartlead's delivery names (EMAIL_SENT, EMAIL_OPEN,
 * EMAIL_BOUNCE, LEAD_UNSUBSCRIBED and the five renamed spellings of each) into
 * our vocabulary. Nothing reads a delivery on this source — the route rings the
 * doorbell and drops the body — so the map described a translation that never
 * happened, and kept `bounced` and `unsubscribed` looking supported in the
 * source while no code path could ever write one.
 *
 * The poll's own vocabulary is `ROW_FACTS` above, which is the real one.
 */

const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : str(v));
const leadEmail = (o: Record<string, unknown>): string | null => str(o["lead_email"]) ?? str(o["to_email"]);

/** The first of `fields` that holds a date, as a Date; null when none does. */
function firstDate(o: Record<string, unknown>, fields: readonly string[]): Date | null {
  for (const f of fields) {
    const at = parseDate(str(o[f]), f);
    if (at) return at;
  }
  return null;
}

/**
 * What this row or delivery is ABOUT: Smartlead's own statistics id where there
 * is one, else the lead and the sequence step it describes — the webhook
 * payloads carry no stats id at all, and one lead's step-2 open must not share
 * a key with its step-3 open.
 */
function factKey(o: Record<string, unknown>): string | null {
  const stats = idOf(o["stats_id"]) ?? idOf(o["email_stats_id"]);
  if (stats) return stats;
  const email = leadEmail(o);
  const seq = idOf(o["sequence_number"]);
  if (email) return seq ? `${email}:${seq}` : email;
  return idOf(o["lead_id"]) ?? idOf(o["message_id"]);
}

/**
 * One statistics row → its dated facts. The id is namespaced by campaign AND
 * by the fact, so the same row's send and reply are two events and a re-read
 * of the row produces the same two.
 */
function rowEvents(row: Record<string, unknown>, campaignId: string, connectionId: string): CanonicalEvent[] {
  const key = factKey(row);
  if (!key) return [];
  const email = leadEmail(row);
  const props = { ...row, campaign_id: campaignId };
  const out: CanonicalEvent[] = [];
  for (const { ours, fields } of ROW_FACTS) {
    const at = firstDate(row, fields);
    if (!at) continue;
    out.push({ eventId: eventId("smartlead", connectionId, campaignId, key, ours), eventType: ours, subject: email, occurredAt: at, properties: props });
  }
  return out;
}

/** The row's newest event time — the field `event_time_gt` bounds, and therefore the watermark. */
function rowChangedAt(row: Record<string, unknown>): string | null {
  let newest: string | null = null;
  for (const { fields } of ROW_FACTS) {
    for (const f of fields) {
      const iso = isoOrNull(row[f]);
      if (iso && (newest === null || iso > newest)) newest = iso;
    }
  }
  return newest;
}

/** `{ ok, data: [...] }`, and a bare array for the campaign list. */
function rowsOf(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.map(asObject);
  const data = asObject(payload)["data"];
  return Array.isArray(data) ? data.map(asObject) : [];
}

/**
 * A client whose key rides the query string. Every failure is scrubbed of the
 * key before it is thrown: `HttpError` puts the full URL in its message and on
 * `.url`, and this is the one provider here whose URL IS a credential.
 */
function client(credentials?: Record<string, unknown> | null) {
  const key = requireCredential(credentials, "apiKey", "Smartlead");
  const base = providerClient({ baseUrl: API, headers: {}, provider: "Smartlead" });
  const scrub = (e: unknown): unknown => {
    if (e instanceof Error) {
      e.message = e.message.split(key).join("…");
      const withUrl = e as { url?: string };
      if (typeof withUrl.url === "string") withUrl.url = withUrl.url.split(key).join("…");
    }
    return e;
  };
  return {
    async get<T>(path: string, params: Params = {}): Promise<T> {
      try {
        return await base.get<T>(path, { ...params, api_key: key });
      } catch (e) {
        throw scrub(e);
      }
    },
    rateLimit: () => base.rateLimit(),
  };
}

export const smartleadConnector: Connector = {
  source: "smartlead",
  authType: "apiKey",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-smartlead-signature", encoding: "hex", prefix: "sha256=" });
  },
  // NO `normalize`, and its absence is the honest statement of what this
  // source can do — the same call attio.ts makes for the same reason.
  //
  // `campaignId` is a STREAM (the statistics endpoint is per-campaign, so
  // there is no shared read to filter), which makes the webhook route treat
  // every Smartlead delivery as a DOORBELL: it verifies, promotes cadence,
  // asks for a sync and returns 202 without storing the body. Nothing then
  // calls `normalize`. A mapper written against that dead path is not
  // harmless: it keyed a send on `stats_id` when a row carried one and on
  // `to_email:sequence_number` when a delivery did not, so the day somebody
  // made the path reachable, every send, open, click and reply would have
  // been written once by the delivery and once by the next poll of the same
  // row, and the campaign's counts — and every rate built on them — would
  // have read exactly double. Code that is wrong on the day it is revived is
  // worse than code that is absent, because absence forces the identity
  // question to be answered rather than inherited.
  //
  // So bounces, unsubscribes and lead-category changes are not counted on
  // this connection, which is what the catalog's syncNote already says. To
  // count them, they must come from the POLL — a statistics field that dates
  // them — not from the doorbell.
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "campaignId") return [];
    const res = await client(args.credentials).get<unknown>("/campaigns");
    return rowsOf(res)
      .map((c) => ({ value: idOf(c["id"]) ?? "", label: str(c["name"]) ?? idOf(c["id"]) ?? "Untitled campaign" }))
      .filter((o) => o.value);
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const campaignId = str(args.config?.["campaignId"]);
    if (!campaignId) return { records: [], nextCursor: null };
    const api = client(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const offset = cont ? Number(cont) || 0 : 0;
        const page = await api.get<unknown>(`/campaigns/${encodeURIComponent(campaignId)}/leads-statistics`, {
          limit: PAGE,
          offset,
          // A DATE, and exclusive ("event_time_gt"). Asking from the day BEFORE
          // the floor is the only way an event later on the floor's own day
          // cannot be skipped; the extra day is re-read and dedupes on eventId.
          event_time_gt: ymd(new Date(since.getTime() - DAY_MS)),
        });
        const rows = rowsOf(page);
        return { rows, next: rows.length === PAGE ? String(offset + rows.length) : null, rateLimit: api.rateLimit() };
      },
      changedAt: rowChangedAt,
      map: (r) => rowEvents(r, campaignId, args.connectionId)[0] ?? null,
    });
    // The walk carries one event per row (it dedupes and marks by row); the
    // row's other dated facts are fanned out here, from the same properties.
    const fanned: CanonicalEvent[] = [];
    for (const r of res.records) fanned.push(...rowEvents(r.properties ?? {}, campaignId, args.connectionId));
    return { ...res, records: fanned };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
