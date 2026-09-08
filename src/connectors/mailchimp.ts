import type { Connector, CanonicalEvent, VerifyArgs, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, isoOrNull, requireCredential, timestampedHmacVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * Mailchimp Marketing API v3.0.
 *
 * THE BASE URL IS DERIVED FROM THE KEY, not asked for. Mailchimp shards accounts
 * across data centres and puts the shard in the key itself, so a second form
 * field for it could only ever be a way to get it wrong. One paste, and the
 * suffix after the final dash becomes the host.
 *
 * WHAT IS COUNTED, and why it is the only thing here. Three endpoints looked
 * like candidates and two were rejected on the docs:
 *  - `/reports/{campaign_id}/email-activity` has genuinely dated opens and
 *    clicks and a `since` filter, but it is scoped to ONE campaign and offers no
 *    `sort_field` at all. A campaign is a burst that dies in a week, so it makes
 *    a terrible stream, and offset pagination over an unordered, undocumented
 *    result order is not a watermark — it is a hope.
 *  - `/campaigns` filters `since_send_time` and sorts `send_time`, which is a
 *    clean pair, but a business sends a handful of campaigns a month. It is a
 *    good SECOND stream and a thin only one; the reasoning is left here because
 *    adding it later is a flowField option and an `operationFor`, nothing more.
 *  - `/lists/{list_id}/members` filters `since_last_changed` and sorts
 *    `last_changed` — the same field, which is the whole of Rule 2 — and
 *    subscriber growth is the number an email tool exists to move. That is what
 *    this connector reads.
 *
 * THE TWO AXES ARE DELIBERATELY DIFFERENT, and the difference is the point. The
 * WATERMARK is `last_changed`, because that is what the request bounds. The
 * EVENT DATE is `timestamp_opt` — the moment the contact confirmed their opt-in —
 * because that is when the countable thing happened. A member who joined two
 * years ago and was edited this morning therefore arrives inside today's window
 * carrying a two-year-old date, which is correct, and is why this connector
 * declares no `retireOutsideWindow`: the window is on one axis and `occurredAt`
 * is on the other, so retiring by it would tombstone real history (types.ts says
 * so in as many words).
 *
 * NO MONEY ANYWHERE. A member carries no amount and no currency, so `value` and
 * `currency` are null on every event this connector produces. There is no minor-
 * versus-major-unit question to get wrong because there is no unit.
 *
 * Docs read 8 Sep 2026, one fact each:
 * - https://mailchimp.com/developer/marketing/docs/fundamentals/ — "The root url
 *   for the API is https://<dc>.api.mailchimp.com/3.0/"; the dc "is also appended
 *   to your API key in the form key-dc; if your API key is
 *   0123456789abcdef0123456789abcde-us6, then the data center subdomain is us6".
 *   Auth: "You can either use HTTP Basic Authentication or Bearer
 *   Authentication" — Basic as `--user 'anystring:TOKEN'`, Bearer as
 *   `Authorization: Bearer <TOKEN>`. BOTH are blessed; Bearer is used here.
 *   Limits: "The Marketing API has a limit of 10 simultaneous connections.
 *   You'll receive a 429 error if you reach the limit." A CONCURRENCY ceiling,
 *   not a rate — see the note above `operations` for what that means for budget.
 * - https://mailchimp.com/developer/marketing/docs/methods-parameters/ — "We use
 *   offset and count in the URL query string to paginate"; "The maximum value for
 *   count is 1000; the default value is 10. If not included, offset defaults to
 *   0." Also "a 120-second timeout on API calls".
 * - https://api.mailchimp.com/schema/3.0/Swagger.json?expand (the API's own
 *   OpenAPI description, v3.0.91) — GET /lists/{list_id}/members takes
 *   `since_last_changed` ("Restrict results to subscribers whose information
 *   changed after the set timeframe. Uses ISO 8601 time format:
 *   2015-10-21T15:41:36+00:00"), `sort_field` (enum timestamp_opt |
 *   timestamp_signup | last_changed), `sort_dir` (enum ASC | DESC), `count`
 *   (max 1000) and `offset`. A member row carries `id` ("The MD5 hash of the
 *   lowercase version of the list member's email address"), `email_address`,
 *   `status` (subscribed | unsubscribed | cleaned | pending | transactional |
 *   archived), `timestamp_signup` ("The date and time the subscriber signed up
 *   for the list in ISO 8601 format"), `timestamp_opt` ("The date and time the
 *   subscriber confirmed their opt-in status in ISO 8601 format"),
 *   `last_changed` ("The date and time the member's info was last changed in
 *   ISO 8601 format") and `unsubscribe_reason` — but NO unsubscribe timestamp,
 *   which is why nothing here dates an unsubscribe.
 * - https://mailchimp.com/developer/marketing/api/list-members/list-members-info/
 *   — the same endpoint's reference page (GET /lists/{list_id}/members).
 * - https://mailchimp.com/developer/marketing/api/lists/get-lists-info/ — GET
 *   /lists returns `lists[]` of { id, name, date_created, … }; that is the
 *   audience picker.
 * - https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/
 *   — "The body of the webhook request is sent as application/x-www-form-
 *   urlencoded data"; the payload is { type, fired_at, data }, `fired_at`
 *   rendered "2009-03-26 21:35:57". Signing: "When you enable HMAC signing on a
 *   webhook, Mailchimp includes a signature in every delivery"; "Mailchimp
 *   computes HMAC-SHA256(key=signing_secret, message="{timestamp}.{raw_body}")
 *   where {timestamp} is a Unix timestamp (seconds)"; "Mailchimp sends the
 *   result in the X-Mailchimp-Signature header in the format
 *   t={timestamp},v1={hex_signature}"; "Reject any delivery … where the
 *   timestamp is more than 5 minutes old". THE BRIEF SAID MAILCHIMP WEBHOOKS
 *   ARE UNSIGNED. They are not, any more; the docs win and this verifies.
 * - https://mailchimp.com/developer/marketing/api/list-webhooks/add-webhook/ —
 *   POST /lists/{list_id}/webhooks { url, events, sources }; the response
 *   carries `signing_enabled` ("Whether outbound deliveries are HMAC-signed",
 *   read-only) and `signing_secret` ("Returned exactly once at creation … if
 *   lost, delete and recreate the webhook to obtain a new secret").
 * - https://mailchimp.com/developer/marketing/api/campaigns/list-campaigns/ and
 *   https://mailchimp.com/developer/marketing/api/email-activity-reports/list-email-activity/
 *   — the two roads not taken, above.
 */

/** `<dc>.api.mailchimp.com/3.0`, per fundamentals; the dc is the key's own suffix. */
export function mailchimpBaseUrl(apiKey: string): string {
  const dc = apiKey.slice(apiKey.lastIndexOf("-") + 1).trim();
  // Two letters and digits ("us6", "us14"). Guessed wrong, every request 401s
  // against somebody else's shard, so this refuses rather than tries.
  if (!apiKey.includes("-") || !/^[a-z]{2}\d+$/i.test(dc)) {
    throw new Error("Mailchimp: that API key has no data-centre suffix — it should end in something like `-us14`. Open the connection and paste the whole key.");
  }
  return `https://${dc.toLowerCase()}.api.mailchimp.com/3.0`;
}

const api = (c?: Record<string, unknown> | null) => {
  const key = requireCredential(c, "apiKey", "Mailchimp");
  return bearerClient(mailchimpBaseUrl(key), key, "Mailchimp");
};

/** The documented page maximum. Fewer, larger pages is the only lever a 10-connection ceiling leaves. */
const PAGE = 1000;

/**
 * `firstSyncDays` is a year, and it is a bound on `last_changed` rather than on
 * when anybody joined. That is not a hole: a member's `last_changed` is by
 * definition no earlier than the moment they were added, so a floor of D days
 * reads EVERY member who joined inside the last D days — the population this
 * connector counts — plus the older ones who have since been edited.
 *
 * `overlapMs` is an hour rather than the house five minutes, and that buys
 * something specific here. The page walk is offset-based over a sort key that
 * MUTATES (`last_changed`), so a row edited mid-walk moves to the end of the
 * sorted set and shifts its successors back one position — the classic offset
 * skip, which Attio's identical-looking walk cannot suffer because `created_at`
 * never moves. A wide re-read behind the mark is the cheap half of the answer;
 * a full re-sync is the other half. See `uncertainties` in the shipping notes.
 */
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 365, overlapMs: 60 * 60_000 };

/**
 * The exact shape the docs use: `2015-10-21T15:41:36+00:00`.
 *
 * `toISOString()` would hand over `…:36.000Z` instead. Probably fine, and
 * "probably fine" on the parameter that bounds every request is how a walk ends
 * up silently unbounded — so the documented spelling is produced literally.
 */
const mcTime = (d: Date): string => `${d.toISOString().slice(0, 19)}+00:00`;

/**
 * One audience member as the one countable fact they represent: they joined.
 *
 * DATED BY `timestamp_opt`, the moment the contact confirmed their opt-in,
 * falling back to `timestamp_signup` (the moment they signed up) for a
 * single-opt-in audience where only one of the two is filled in. A row with
 * NEITHER is skipped rather than stamped with the read time — an import-dated
 * subscriber is a subscriber counted on the wrong day, forever.
 *
 * `last_changed` is deliberately NOT a fallback, even though every row has one.
 * It is the watermark, not a date: it moves whenever anything about the contact
 * is edited, so dating a join by it would march that join forward every time
 * somebody added a tag.
 *
 * EVERY status is emitted, unsubscribed included, because "this person joined on
 * the 3rd" stays true after they leave. `status` rides in properties so a step
 * can filter to `subscribed` for a net-active count — and so that an unsubscribe
 * is never invented as an event of its own, which this API gives no way to date
 * (there is `unsubscribe_reason`, and no unsubscribe timestamp).
 */
export function mailchimpMemberEvent(listId: string, m: Record<string, unknown>, connectionId: string): CanonicalEvent | null {
  // The member id is the MD5 of the lowercased email — the SAME hash in every
  // audience of every account — so the list is what keeps one person's two
  // memberships from colliding on one row.
  const id = str(m["id"]) ?? str(m["contact_id"]);
  const occurredAt = parseDate(str(m["timestamp_opt"]), "mailchimp.timestamp_opt") ?? parseDate(str(m["timestamp_signup"]), "mailchimp.timestamp_signup");
  if (!id || !occurredAt) return null;
  return {
    eventId: eventId("mailchimp", connectionId, listId, id),
    eventType: "subscriber_added",
    subject: str(m["email_address"]) ?? str(m["full_name"]),
    occurredAt,
    // A contact has no amount and no currency. Null is the honest answer; a 0
    // here would read as a real zero on a dashboard.
    value: null,
    currency: null,
    properties: { ...m, list_id: str(m["list_id"]) ?? listId },
  };
}

export const mailchimpConnector: Connector = {
  source: "mailchimp",
  authType: "apiKey",
  importProgress: walkImportProgress,
  /**
   * NO `operations` and no `rateLimits`, deliberately — the one place where
   * declaring nothing is the accurate declaration.
   *
   * Mailchimp publishes "a limit of 10 simultaneous connections" and no
   * requests-per-minute figure at all ("Currently there are no options to raise
   * the limit on a per-customer basis"). The catalog's `rateLimits` can only
   * express a rate, so any number written there would be one this agent made up
   * and the next reader would trust. Left off, the conservative default budget
   * governs, and the CONCURRENCY ceiling is satisfied by construction: the walk
   * below is sequential, so one poll is one open connection.
   */

  /**
   * `X-Mailchimp-Signature: t=<unix seconds>,v1=<hex sha256>` over
   * `{t}.{raw body}`, keyed on the webhook's one-time `signing_secret`.
   *
   * A DOT between the timestamp and the body (Paddle's is a colon) and a COMMA
   * between the header's pairs (Paddle's is a semicolon) — both wrong by one
   * character rejects every real delivery, so both are spelled out here rather
   * than defaulted.
   *
   * FAILS CLOSED. Signing is a per-webhook property (`signing_enabled`) and the
   * secret is shown exactly once, so a connection can genuinely hold none — for
   * a webhook made before signing existed, or one whose secret was dismissed.
   * With no secret there is nothing an unsigned POST could be checked against,
   * and the poll is the ingest path regardless: the only thing a rejected
   * delivery costs is freshness.
   *
   * The house 5-minute tolerance is also what Mailchimp's own guide asks for
   * ("more than 5 minutes old"), so the default stands.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify(
      { rawBody, headers, secret },
      {
        header: "x-mailchimp-signature",
        pairSeparator: ",",
        timestampKey: "t",
        signatureKey: "v1",
        message: (ts, body) => `${ts}.${body}`,
      },
    );
  },

  /**
   * NO `normalize`, for two independent reasons and either would be enough.
   *
   * First, this source is stream-scoped on the audience, so the inbound route
   * answers `isStreamScoped` and rings a doorbell without storing anything —
   * a `normalize` here would have no production caller, which is exactly the
   * Sheets divergence types.ts warns about.
   *
   * Second, and worse: Mailchimp's delivery dates itself with `fired_at`
   * rendered as "2009-03-26 21:35:57" — no offset, no zone, nothing in the
   * guide that says which one. A date parsed from that is a guess with a
   * timezone-sized error bar, and this connector does not ship guesses. The
   * poll reads `timestamp_opt`, which is documented ISO 8601.
   */

  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "listId") return [];
    const res = await api(args.credentials).get<{ lists?: unknown[] }>("/lists", { count: PAGE });
    return (res.lists ?? [])
      .map(asObject)
      .map((l) => ({ value: str(l["id"]) ?? "", label: str(l["name"]) ?? str(l["id"]) ?? "Audience" }))
      .filter((o) => o.value);
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const listId = str(args.config?.["listId"]);
    if (!listId) return { records: [], nextCursor: null };
    const client = api(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const offset = cont ? Number(cont) || 0 : 0;
        const page = await client.get<{ members?: unknown[] }>(`/lists/${encodeURIComponent(listId)}/members`, {
          // THE WATERMARK IS THE BOUND. `since_last_changed` filters on
          // last_changed and `sort_field` orders by the same field, so the
          // cursor can only ever advance along the axis the request narrows.
          // (Sorting by timestamp_opt while filtering last_changed is the Close
          // bug in a Mailchimp costume: a walk that looks bounded and is not.)
          since_last_changed: mcTime(since),
          sort_field: "last_changed",
          sort_dir: "ASC",
          count: PAGE,
          offset,
        });
        const rows = (page.members ?? []).map(asObject);
        // offset/count: a short page is the end of the result set.
        return { rows, next: rows.length === PAGE ? String(offset + PAGE) : null, rateLimit: client.rateLimit() };
      },
      changedAt: (m) => isoOrNull(m["last_changed"]),
      // The coverage axis is when they JOINED, which is what the import note
      // measures; the walk's own clamp handles a long-dormant member edited
      // today, so "covering 700 of 365 days" cannot appear.
      happenedAt: (m) => isoOrNull(m["timestamp_opt"]) ?? isoOrNull(m["timestamp_signup"]),
      map: (m) => mailchimpMemberEvent(listId, m, args.connectionId),
    });
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },

  /**
   * NO `registerWebhook`, and not for want of an endpoint. Mailchimp's is
   * POST /lists/{list_id}/webhooks and it returns the `signing_secret` once —
   * everything auto-registration needs, except a resource. Every webhook path
   * lives under /lists/{list_id}, and the audience is a flowField picked inside
   * a step, so at connect time there is no list to create one against. This is
   * Typeform's situation exactly; registering at STREAM creation is the version
   * that would work, with one wrinkle Typeform does not have — a connection
   * holds ONE signing secret and Mailchimp MINTS a different one per webhook,
   * so N audiences would need N secrets and only the first could ever verify.
   * Until that is built, the secret is pasted and the entry says how.
   */
};
