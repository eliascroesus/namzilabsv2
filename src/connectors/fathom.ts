import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, str } from "./field-utils";
import { eventId, headerKeyClient, isoOrNull, parseDate, requireCredential, standardWebhooksVerify, windowedWalk } from "./kit";

/**
 * Fathom — the AI notetaker: one record per meeting it recorded, with the
 * transcript, summary and action items available on the same row.
 *
 * EVERY FACT BELOW WAS READ OFF FATHOM'S OWN DEVELOPER DOCS on 13 Sep 2026:
 *  - Base URL + auth: developers.fathom.ai (quickstart) — REST at
 *    `https://api.fathom.ai/external/v1/`, key generated at
 *    Settings → API Access.
 *  - List meetings: developers.fathom.ai/api-reference/meetings/list-meetings
 *  - Webhooks: developers.fathom.ai/webhooks
 *
 * Connection-scoped, like Whop and Close: the API key IS the resource, so a Get
 * data step needs no per-flow choice. Fathom's keys are USER-scoped — their docs
 * say a key reaches only meetings recorded by the key-holder or shared with
 * their team — so what a connection sees is whatever that person can see, and
 * connecting a second teammate is a second connection rather than a setting.
 */
const API = "https://api.fathom.ai/external/v1";

/**
 * `X-Api-Key`, NOT `Authorization: Bearer`, and the distinction is load-bearing.
 * The reference lists both header names, but they are two different auth modes:
 * the API key goes in `X-Api-Key`, while `Authorization: Bearer` carries an
 * OAuth access token for public integrations. Sending a `fathom_` key as a
 * bearer token is the kind of thing that either 401s on day one or, worse,
 * works until they tighten it.
 */
const KEY_HEADER = "x-api-key";

/**
 * `/meetings` documents `created_after` and `created_before` and NO
 * `updated_after` — verified on the reference page. So this walks the CREATED
 * axis and leans on the overlap below, exactly as Whop's memberships does: a
 * meeting whose summary is regenerated later cannot be found by asking for new
 * ones, and the `new-meeting-content-ready` webhook is the path that catches it
 * promptly.
 */
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 24 * 60 * 60_000 };

/**
 * THE HEAVY FIELDS ARE LEFT OFF, and Fathom charges for them twice.
 *
 * IN BYTES: a transcript is the largest thing this API returns and every record
 * is stored, so pulling one per meeting would multiply the stored bytes for data
 * no metric counts. Meetings are counted, timed and attributed here; the
 * transcript belongs to whoever opens the meeting in Fathom.
 *
 * AND IN RATE LIMIT, which is the half that would actually break a sync.
 * Fathom's API overview (read 13 Sep 2026) puts a request to `/meetings` with
 * `include_summary` or `include_transcript` set to TRUE into its "heavy" bucket:
 * 30 calls per 60 seconds, "during periods of elevated activity this limit may
 * be adjusted down to 5 every 60 seconds". Left false, this walk stays on the
 * ordinary 60/minute allowance the catalog declares. Turning one of these on to
 * "just also grab the summary" would quietly cut the sweep's throughput by up to
 * twelve times.
 */
const LIST_PARAMS = { include_summary: false, include_transcript: false } as const;

function client(credentials?: Record<string, unknown> | null) {
  return headerKeyClient(API, KEY_HEADER, requireCredential(credentials, "apiKey", "Fathom"), "Fathom");
}

/**
 * One meeting, canonical.
 *
 * THE SUBJECT IS THE EXTERNAL INVITEE WHERE THERE IS ONE. A meeting's rows are
 * joined to a person downstream, and the useful person is the customer rather
 * than the rep who recorded it — so the first invitee outside the recorder's own
 * domain wins, and the recorder is the fallback for an internal meeting that has
 * no external party at all.
 */
function toCanonical(row: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const id = str(row["id"]) ?? str(row["recording_id"]);
  if (!id) return null;

  const recorder = asObject(row["recorded_by"]);
  const recorderEmail = str(recorder["email"]);
  const invitees = Array.isArray(row["calendar_invitees"]) ? row["calendar_invitees"] : [];
  const external = invitees
    .map((v) => asObject(v))
    .find((v) => v["is_external"] === true || (str(v["email"]) && str(v["email"]) !== recorderEmail));

  return {
    eventId: eventId("fathom", connectionId, id),
    eventType: "meeting",
    subject: str(external?.["email"]) ?? recorderEmail ?? null,
    /**
     * `scheduled_start_time` is when the meeting HAPPENED; `created_at` is when
     * Fathom finished processing the recording, which can be an hour later and
     * on the wrong side of midnight. A "meetings today" metric wants the former.
     */
    occurredAt:
      parseDate(str(row["scheduled_start_time"]), "scheduled_start_time") ??
      parseDate(str(row["created_at"]), "created_at") ??
      fallback ??
      new Date(),
    properties: row,
  };
}

export const fathomConnector: Connector = {
  source: "fathom",
  authType: "apiKey",

  /**
   * Standard Webhooks, byte for byte the scheme Whop uses: `webhook-id`,
   * `webhook-timestamp`, `webhook-signature` holding `v1,<base64>`, HMAC-SHA256
   * over `{id}.{timestamp}.{raw body}`, a `whsec_` secret and a five-minute
   * replay window. The kit helper already tries the secret both base64-decoded
   * and raw, which is the contradiction that cost Whop a full day of refused
   * deliveries — so this connector gets that for free rather than rediscovering
   * it.
   *
   * Fails CLOSED: Fathom returns the secret when the webhook is created, so an
   * unsigned delivery is a misconfiguration rather than a mode.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    return standardWebhooksVerify({ rawBody, headers, secret });
  },

  /**
   * `new-meeting-content-ready` carries the meeting itself, so there is nothing
   * to fetch on receipt — the payload is the same shape `/meetings` returns and
   * goes through the same mapper. One wrapper key is read through because their
   * examples show the meeting nested under `data`.
   */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const meeting = Object.keys(asObject(body["data"])).length > 0 ? asObject(body["data"]) : body;
    const ev = toCanonical(meeting, ctx.connectionId, ctx.fallbackOccurredAt);
    return ev ? [ev] : [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const api = client(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await api.get<{ items?: unknown[]; next_cursor?: string | null }>("/meetings", {
          ...LIST_PARAMS,
          created_after: since.toISOString(),
          cursor: cont ?? undefined,
        });
        return {
          rows: (page.items ?? []).map(asObject),
          next: page.next_cursor ?? null,
          rateLimit: api.rateLimit(),
        };
      },
      /**
       * NULL, DELIBERATELY — there is no update axis to walk. `/meetings` has no
       * `updated_after`, so claiming a changed-at here would let the walk
       * advance a high-water mark against a field it cannot filter on, and every
       * later sweep would skip rows it had never actually read.
       */
      changedAt: () => null,
      happenedAt: (r) => isoOrNull(r["scheduled_start_time"]) ?? isoOrNull(r["created_at"]),
      map: (r) => toCanonical(r, args.connectionId),
    });
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },

  operations: ["api.request"] as const,
  operationFor: () => "api.request",
};
