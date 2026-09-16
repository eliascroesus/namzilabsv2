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

/**
 * `2026-08-17T03:30:20Z` — SECONDS, NO MILLISECONDS, and this is the fix for a
 * connection that silently returned nothing for a day.
 *
 * `Date.prototype.toISOString()` always emits three fractional digits
 * (`…20.203Z`). Fathom's reference documents `created_after` with the example
 * `2025-01-01T00:00:00Z`, and its own `created_at` responses are shaped the
 * same way — no fractional part anywhere in their API surface.
 *
 * WHAT WE MEASURED AGAINST A REAL ACCOUNT. Nine meetings existed with
 * `created_at` between 2026-09-09 and 2026-09-15. Asking for
 * `created_after=2026-08-17T03:30:20.203Z` — a bound every one of them is
 * comfortably newer than — returned ZERO. The same request with no date filter
 * returned all nine.
 *
 * So the parameter was being READ and then excluding everything, which is the
 * signature of a value that parsed to nothing: a NULL bound in SQL makes
 * `created_at > NULL` match no rows at all, and the endpoint answers 200 with
 * an empty list rather than complaining. An IGNORED parameter would have
 * returned all nine instead; that is how we know it was parsed.
 *
 * This cannot be proven from outside their API without a key, so the walk below
 * ALSO carries a fallback that works whatever the real cause turns out to be.
 */
function fathomTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

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
    /**
     * WHEN TRUE, THE WALK STOPS SENDING `created_after` AND FILTERS HERE.
     *
     * Set by the control below, after it has PROVEN the parameter is dropping
     * rows that exist — never speculatively. Fathom's meeting counts are
     * small (a busy team records tens per week, not millions), so paging the
     * window and filtering in memory is affordable; a customer's metric
     * silently reading zero is not.
     *
     * The correct fix is the timestamp format above. This is the belt: if the
     * cause turns out to be something else about their filter, the connector
     * still syncs instead of pausing every ten minutes forever.
     */
    let filterLocally = false;

    const walk = () => windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await api.get<{ items?: unknown[]; next_cursor?: string | null }>("/meetings", {
          ...LIST_PARAMS,
          // Omitted entirely once the control has proven the filter drops real
          // rows — `undefined` is dropped from the query string by the client.
          created_after: filterLocally ? undefined : fathomTimestamp(since),
          cursor: cont ?? undefined,
        });
        /**
         * AN ABSENT `items` IS A FAULT, NOT AN EMPTY ACCOUNT — and conflating
         * the two is what made this connector undebuggable.
         *
         * The obvious spelling is `(page.items ?? []).map(...)`, which is what
         * this was and what twenty-six other connectors still do. It turns
         * "the provider sent a shape we do not parse" into "there is no data",
         * and those two produce an identical, silent, entirely believable
         * result: a green connection reporting zero records forever.
         *
         * That is exactly what a real key did on 15 Sep 2026 — zero rows, no
         * error, nothing in any log to say whether Fathom had answered with an
         * empty list or with something we failed to read. A day of work could
         * not tell those apart from the outside.
         *
         * So an absent array throws, and the message NAMES THE KEYS THAT DID
         * ARRIVE, because that one string is the whole diagnosis: it lands in
         * `last_error`, shows on the connection page, and says either "the
         * envelope moved" or "this is genuinely empty". An `items: []` is
         * untouched — a legitimately empty account is a normal answer and must
         * stay a quiet one.
         */
        if (!Array.isArray(page?.items)) {
          const keys = Object.keys(asObject(page)).join(", ") || "(an empty body)";
          throw new Error(
            `Fathom's /meetings did not return an "items" array — the response carried: ${keys}. ` +
              `Either the API's envelope changed or this key cannot read meetings. ` +
              `Run \`FATHOM_API_KEY=… pnpm tsx scripts/verify-fathom.ts\` to see which.`,
          );
        }
        const rows = page.items.map(asObject);
        return {
          // The same bound the request would have carried, applied here. A row
          // with no readable `created_at` is KEPT rather than dropped: the
          // window is an optimisation, and discarding a record because its
          // timestamp is unparseable would lose data the provider has.
          rows: filterLocally
            ? rows.filter((r) => {
                const at = Date.parse(str(r["created_at"]) ?? "");
                return Number.isFinite(at) ? at >= since.getTime() : true;
              })
            : rows,
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

    let result = await walk();

    /**
     * THE CONTROL — run only on the one occasion the answer is unknowable.
     *
     * A first sync that comes back empty has two causes that look identical
     * from here and need opposite fixes: this key genuinely sees no meetings,
     * or `created_after` is excluding everything. The Calendly and Close
     * probers exist because an accepted-and-ignored parameter is
     * indistinguishable from a working one in isolation — the only way to tell
     * them apart is to ask the same question WITHOUT it.
     *
     * A customer hit exactly this on 15 Sep 2026: an account with meetings
     * recorded that day, a key owned by the person who recorded them, and a
     * connection sitting green and empty with nothing anywhere able to say
     * which of the two it was.
     *
     * ONE extra request, and only when the cursor is null (a first sync) AND
     * nothing came back. A healthy connection never pays for it; an empty
     * account pays once and then has a cursor.
     *
     * IF THE UNFILTERED CALL IS ALSO EMPTY that is a real answer and a quiet
     * one — the key sees no meetings, which is what a user-scoped key does
     * when its holder recorded none and none were shared to their Team. The
     * walk's empty result stands and nothing is raised.
     *
     * IF IT RETURNS MEETINGS THAT ARE INSIDE THE WINDOW, the filter is
     * dropping real records — so the walk is re-run with the bound omitted and
     * the window applied here instead. That is a fallback, not the fix: the
     * fix is `fathomTimestamp` sending seconds rather than milliseconds. This
     * exists so a provider quirk can never again leave a connection green,
     * empty and silent.
     */
    if (result.records.length === 0 && !args.cursor) {
      // A failed control must never fail the sync: it is a diagnostic.
      const control = await api.get<{ items?: unknown[] }>("/meetings", LIST_PARAMS).catch(() => null);
      const seen = Array.isArray(control?.items) ? control.items.length : 0;
      if (seen > 0) {
        /**
         * Compared as INSTANTS, not as strings. The previous version sorted and
         * compared ISO text, which happens to work for same-shape UTC stamps
         * and silently stops the moment an offset like `+02:00` appears.
         */
        const sinceMs = Date.now() - DEFAULTS.firstSyncDays * 86_400_000;
        /**
         * THE DATES ARE THE DIAGNOSIS, and the first version of this message
         * left them out — which made it say "the filter is broken" without the
         * one fact that says HOW.
         *
         * An ignored parameter returns every row; a parsed one that excludes
         * returns none. We got none, so Fathom read the value and decided
         * nothing matched. That leaves exactly two explanations, and the
         * `created_at` of the rows it DID return tells them apart with no
         * further requests:
         *
         *   all older than what we asked for  -> the account's meetings really
         *                                        do predate the window; the
         *                                        first-sync span is too short.
         *   some newer than what we asked for -> Fathom is not filtering on the
         *                                        field we think, or not reading
         *                                        our format the way we mean it.
         *
         * Same response, no extra call. Timestamps only — never a title, a
         * transcript or an attendee.
         */
        const stamps = (control?.items ?? [])
          .map((r) => asObject(r))
          .map((r) => str(r["created_at"]) ?? null)
          .filter(Boolean) as string[];
        const createdList = [...stamps].sort();
        const newer = createdList.filter((c) => Date.parse(c) >= sinceMs).length;

        if (newer > 0) {
          /**
           * PROVEN: rows INSIDE the window came back once the filter was gone.
           * So `created_after` is dropping records that exist, and the sync is
           * broken for as long as we keep sending it.
           *
           * This used to throw here, which was right when nobody knew why —
           * the message named the cause and the connection paused loudly. Now
           * the cause is known, and pausing a customer's sync every ten minutes
           * over a provider's date filter is the wrong trade: we can do the
           * filtering ourselves.
           *
           * So the walk runs AGAIN with the bound omitted and the window
           * applied to the rows in memory. It costs the pages the filter would
           * have skipped, which for an account that records tens of meetings a
           * week is nothing, and it produces the same records.
           */
          filterLocally = true;
          console.warn(
            `[fathom] created_after excluded ${newer} meeting(s) that are inside the window ` +
              `(their created_at runs ${createdList[0]} … ${createdList[createdList.length - 1]}). ` +
              `Falling back to fetching unfiltered and applying the window locally.`,
          );
          result = await walk();
        }
        // `newer === 0` needs no action and is not a fault: every meeting the
        // account has genuinely predates the window, so an empty result is the
        // correct answer and the next sync widens nothing.
      }
    }
    return result;
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },

  operations: ["api.request"] as const,
  operationFor: () => "api.request",
};
