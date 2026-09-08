import { randomBytes } from "node:crypto";
import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  PollArgs,
  PollResult,
  ListOptionsArgs,
  SourceOption,
  RegisterWebhookArgs,
  RegisterWebhookResult,
  UnregisterWebhookArgs,
} from "./types";
import { asObject, holdsWindowContinuation, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { timestampFreshness } from "@/lib/signatures";
import { epochToDate, eventId, headerKeyClient, hmacHeaderVerify, requireCredential, walkImportProgress, windowedWalk } from "./kit";

/**
 * Klaviyo (email/SMS marketing). One private API key, one required `revision`
 * header, and a JSON:API event log that is filterable and sortable on the SAME
 * field — which is the whole reason this connector is straightforward: a
 * Klaviyo event is immutable and carries exactly one time, `attributes.datetime`,
 * so the moment it HAPPENED, the field the request FILTERS on and the field the
 * watermark advances on are all one axis. There is no second date to get wrong.
 *
 * STREAM-SCOPED ON THE METRIC, and that is a correctness decision rather than a
 * taste one. `GET /api/events` unscoped returns EVERY event in the account —
 * every "Received Email" and "Opened Email" for every recipient — at 200 rows a
 * page. A working Klaviyo account emits those by the hundred thousand a day, so
 * an unscoped walk would never catch up, and what it did ingest would bury the
 * handful of rows anybody actually counts. The account picks a metric ("Placed
 * Order"), the request narrows with `equals(metric_id,…)`, and each metric is
 * its own stream with its own cursor.
 *
 * MONEY IS DECIMAL, NOT MINOR UNITS. `$value` is "the total numeric (not a
 * string), monetary value of the event… in your Klaviyo account's currency" and
 * the Create Event schema's own example is `9.99`. Nothing here divides by 100;
 * doing so would understate every Klaviyo revenue number by exactly 100x.
 *
 * Docs read 8 Sep 2026, one fact each:
 * - https://developers.klaviyo.com/en/docs/authenticate_ — `Authorization:
 *   Klaviyo-API-Key your-private-api-key`; private keys begin `pk_`; base URL
 *   `https://a.klaviyo.com/api/{endpoint}/`; keys are made under Settings →
 *   API keys → Private API Keys → "Create Private API Key".
 * - https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy —
 *   "Revisions are formatted as ISO 8601 dates (representing release dates) and
 *   passed using the HTTP request header, `revision`"; a revision lives 2 years
 *   (1 stable + 1 deprecated). The revision below is pinned, not floating.
 * - https://developers.klaviyo.com/en/reference/get_events — `GET /api/events`;
 *   "Requests can be sorted by the following fields: `datetime`, `timestamp`";
 *   allowed filter operators are `datetime : greater-or-equal, greater-than,
 *   less-or-equal, less-than` and `metric_id : equals`; `include` allows
 *   `attributions | metric | profile`; "Returns a maximum of 200 events per
 *   page"; *Rate limits*: Burst `350/s`, Steady `3500/m`; scope `events:read`.
 * - https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/get_events.json —
 *   the authoritative row shape: `attributes` is exactly { timestamp ("Event
 *   timestamp in seconds"), event_properties, datetime ("Event timestamp in
 *   ISO8601 format", example `2022-11-08T01:23:45+00:00`), uuid }, all nullable;
 *   the metric and the profile are RELATIONSHIPS carrying ids only, which is why
 *   the metric NAME has to be asked for with `include=metric`. `CollectionLinks`
 *   is { self (required), prev, next } — so an absent `links.next` is the end.
 * - https://developers.klaviyo.com/en/docs/filtering_ — "Datetimes are expressed
 *   as unquoted ISO-8601 RFC-3339 formatted strings. For example,
 *   `2012-04-21T11:30:00-04:00`"; comma between clauses "can be used to perform
 *   an implicit `AND`". The documented example is literally the request below:
 *   `filter=equals(metric_id,"UxxK4u"),greater-or-equal(datetime,2023-02-07)`.
 * - https://developers.klaviyo.com/en/reference/api_overview#pagination — cursor
 *   pagination via `?page[cursor]`; the top-level `links` object carries a full
 *   `next` URL (`…/api/profiles/?page[cursor]=bmV4dDo6aWQ6Ok43dW1iVw`).
 * - https://developers.klaviyo.com/en/reference/events_api_overview — "The
 *   following values are ignored when used to update event properties: `0`
 *   (number data type), `null` or `None`, `""`" — so a zero-value order carries
 *   NO `$value` at all, and an absent value must read as unknown, never as 0.
 * - https://developers.klaviyo.com/en/v1-2/docs/guide-to-integrating-a-ticket-based-or-registration-based-platform —
 *   "$value is a special property that allows Klaviyo to track revenue; this
 *   should be the total numeric (not a string), monetary value of the event it's
 *   associated with, in your Klaviyo account's currency".
 * - https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/create_event.json —
 *   on WRITE an event has `value` ("A numeric, monetary value… For example, the
 *   dollar amount of a purchase", example `9.99`) and `value_currency` ("The ISO
 *   4217 currency code"). Decimal, major units.
 * - https://developers.klaviyo.com/en/reference/get_metrics — `GET /api/metrics`,
 *   "Returns a maximum of 200 results per page"; Burst `10/s`, Steady `150/m`;
 *   scope `metrics:read`. There is no `sort` parameter, hence the client-side
 *   ordering in `listOptions`.
 * - https://developers.klaviyo.com/en/docs/working_with_system_webhooks — headers
 *   `Klaviyo-Signature` ("The HMAC-SHA256 signature"), `Klaviyo-Timestamp`
 *   ("When the webhook request was sent", sent as an HTTP-date:
 *   `Thu, 04 Jan 2024 18:05:25 GMT`) and `Klaviyo-Webhook-Id`; the verification
 *   sample is `hmac.new(hmac_secret, message_body, sha256)` followed by
 *   `.update(message_timestamp.encode())` then `.hexdigest()` — i.e. the signed
 *   message is BODY THEN TIMESTAMP, concatenated with no separator, hex.
 *   `meta.klaviyo_webhook_id` "must match the `Klaviyo-Webhook-Id` request
 *   header. If these values do not match, this indicates potential malicious
 *   activity and you should not process the webhook."
 * - https://developers.klaviyo.com/en/reference/webhooks_api_overview — "only
 *   Advanced KDP customers and Klaviyo app partners can access and manage
 *   webhooks"; topics are "Email events… SMS events… Push notification events…
 *   Review events… Consent events"; "Each Klaviyo account can have a maximum of
 *   10 webhooks"; "There is no limit on the number of topics that a single
 *   webhook can utilize"; "It can take up to 3 minutes for a webhook to start
 *   forwarding events".
 * - https://developers.klaviyo.com/en/reference/create_webhook — `POST
 *   /api/webhooks`, body `data.attributes` { name, endpoint_url ("Must be
 *   https"), secret_key ("A secret key, that will be used for webhook request
 *   signing"), description } + `relationships["webhook-topics"]`; the 201
 *   response returns id/name/endpoint_url/enabled/created_at/updated_at and
 *   NOT the secret. Burst `1/s`, Steady `15/m`; scope `webhooks:write`.
 * - https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/get_webhook_topics.json —
 *   `GET /api/webhook-topics` → `data[].id` (e.g. `event:klaviyo.sent_sms`).
 *   Topics are per-ACCOUNT, so they are read rather than hard-coded.
 * - https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable/apis/delete_webhook.json —
 *   `DELETE /api/webhooks/{id}` → 204.
 * - https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling —
 *   every response carries `RateLimit-Limit` / `RateLimit-Remaining` /
 *   `RateLimit-Reset` (seconds); a 429 replaces them with `Retry-After`. Burst
 *   is a "1-second window", steady a "1-minute window"; the catalog declares the
 *   steady figure, which is the one a per-minute budget can express.
 * - https://help.klaviyo.com/hc/en-us/articles/17760478970907 (read 8 Sep 2026) —
 *   the UI path for the same feature: "Advanced KDP > Data managment > Webhooks",
 *   where the customer types the "Secret key" themselves.
 */
const API = "https://a.klaviyo.com";

/**
 * The pinned API revision. NOT a floating "latest": Klaviyo's whole versioning
 * scheme is that a request states which dated contract it was written against,
 * and the shapes parsed below are that contract's. `2026-07-15` is the value
 * Klaviyo's own docs default every endpoint to and the one its official Node
 * SDK (klaviyo-api 23.0.0, `apis.js`: `const revision = "2026-07-15"`) pins.
 * Klaviyo supports a revision for two years, so this has until mid-2028.
 */
const REVISION = "2026-07-15";

/**
 * `page[size]` is deliberately NOT sent. The endpoint's own description says
 * "Returns a maximum of 200 events per page" while the parameter's schema says
 * "1 to 1000, Defaults to 200" — the two disagree, the default is the smaller
 * and safer of them, and an omitted parameter cannot be rejected. Pagination is
 * driven by `links.next`, never by counting rows against an assumed page size.
 */
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };

/**
 * How many pages of `/api/metrics` the picker will walk. 200 per page, so 600
 * metrics — well past what any account shows a human in a dropdown, and a hard
 * stop rather than an unbounded loop against a 150/min endpoint.
 */
const METRIC_PAGES = 3;

const api = (c?: Record<string, unknown> | null) =>
  headerKeyClient(API, "authorization", `Klaviyo-API-Key ${requireCredential(c, "apiKey", "Klaviyo")}`, "Klaviyo", {
    // Required on EVERY request, not just writes — an omitted `revision` is a
    // 400, so it belongs on the client rather than at each call site.
    revision: REVISION,
    accept: "application/vnd.api+json",
  });

/**
 * A Date as the filter grammar's "unquoted ISO-8601 RFC-3339" string, to the
 * second and with an explicit `+00:00`. `toISOString()` would hand over
 * milliseconds and a `Z`; both are legal RFC-3339, neither is the shape Klaviyo
 * documents, and a filter that 400s is a walk that never runs.
 */
const rfc3339 = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, "+00:00");

/** The `page[cursor]` out of a `links.next` URL; null ends the walk. */
function cursorOf(next: string | null): string | null {
  if (!next) return null;
  try {
    return new URL(next).searchParams.get("page[cursor]");
  } catch {
    return null;
  }
}

/**
 * A metric name as a stored eventType: "Placed Order" → `placed_order`.
 *
 * Klaviyo has no fixed event vocabulary — a metric is whatever an integration
 * or an API caller named it — so there is nothing to map onto the house words
 * without guessing which of an account's metrics means "a payment". The slug is
 * the honest answer: distinct per metric, stable (Klaviyo's Metrics API is
 * read-only, with no endpoint that renames one), and `eventTypeLabel`'s
 * humanizer already covers unbounded vocabularies like this.
 */
export function klaviyoEventType(metricName: string | null): string {
  const slug = (metricName ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "klaviyo_event";
}

/** One row of a page, carried with the two `included` facts that belong to it. */
export type KlaviyoRow = { event: Record<string, unknown>; metric: string | null; email: string | null };

/**
 * `$value` as a number. Klaviyo documents it as numeric, but an event created
 * by a sloppy integration can carry the string "9.99"; both mean 9.99 and
 * neither is divided. Anything else is `null` — UNKNOWN, which is not the same
 * as zero, and the API makes that distinction load-bearing: event properties set
 * to `0` are "ignored… as if they were never set", so an absent `$value` is the
 * only way a zero-value order can look.
 */
function moneyValue(props: Record<string, unknown>): number | null {
  const raw = props["$value"];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * One Klaviyo event as one canonical event.
 *
 * Dated by `attributes.datetime` — the moment the event happened, and the same
 * field the request bounds with `greater-or-equal(datetime,…)`. `timestamp` is
 * the fallback and NOT a different axis: the schema calls it "Event timestamp in
 * seconds" against datetime's "Event timestamp in ISO8601", one instant in two
 * encodings. There is no third date on a Klaviyo event and nothing here ever
 * reaches for `new Date()`: a row we cannot date is a row we do not store.
 */
export function klaviyoEvent(row: KlaviyoRow, connectionId: string): CanonicalEvent | null {
  const id = str(row.event["id"]);
  if (!id) return null;
  const attrs = asObject(row.event["attributes"]);
  const occurredAt = parseDate(str(attrs["datetime"]), "klaviyo.datetime") ?? epochToDate(attrs["timestamp"], "s");
  if (!occurredAt) return null;
  const props = asObject(attrs["event_properties"]);
  const rel = asObject(row.event["relationships"]);
  const profileId = str(asObject(asObject(rel["profile"])["data"])["id"]);
  // ISO 4217 when the event carries one. Klaviyo's READ schema does not list a
  // currency field, so this is only ever the value literally present — never
  // the account default, which we cannot see and must not invent.
  const currency = str(props["$value_currency"])?.toUpperCase() ?? null;
  return {
    // A Klaviyo event id is unique account-wide, and two metrics can never
    // share one — so unlike a spreadsheet row number there is nothing here for
    // the stream hash to disambiguate.
    eventId: eventId("klaviyo", connectionId, id),
    eventType: klaviyoEventType(row.metric),
    subject: row.email ?? profileId,
    occurredAt,
    value: moneyValue(props),
    currency,
    properties: {
      // event_properties stays NESTED rather than spread: its keys are the
      // customer's own and would otherwise collide with the four below.
      event_properties: props,
      metric: row.metric,
      metric_id: str(asObject(asObject(rel["metric"])["data"])["id"]),
      profile_id: profileId,
      email: row.email,
      datetime: str(attrs["datetime"]),
      timestamp: attrs["timestamp"] ?? null,
      uuid: str(attrs["uuid"]),
    },
  };
}

type EventsPage = { data?: unknown[]; included?: unknown[]; links?: { next?: string | null } };

/** The `included` compound document, split into the two lookups a row needs. */
function includedMaps(included: unknown[] | undefined): { metrics: Map<string, string>; emails: Map<string, string> } {
  const metrics = new Map<string, string>();
  const emails = new Map<string, string>();
  for (const raw of included ?? []) {
    const r = asObject(raw);
    const id = str(r["id"]);
    if (!id) continue;
    const attrs = asObject(r["attributes"]);
    if (r["type"] === "metric") {
      const name = str(attrs["name"]);
      if (name) metrics.set(id, name);
    } else if (r["type"] === "profile") {
      const email = str(attrs["email"]);
      if (email) emails.set(id, email);
    }
  }
  return { metrics, emails };
}

export const klaviyoConnector: Connector = {
  source: "klaviyo",
  authType: "apiKey",
  operations: ["events.list", "metrics.list"] as const,
  operationFor: () => "events.list",
  listOperationFor: (key) => (key === "metric" ? "metrics.list" : undefined),
  importProgress: walkImportProgress,
  holdsContinuation: holdsWindowContinuation,
  /**
   * NO `retention` declared. Klaviyo publishes no wall on how far back
   * `/api/events` reaches — the only dated limit in the Events API's
   * Limitations table is on the event time an account may WRITE ("Between 1990
   * and 'now'+1 year") — so a watermark that has fallen behind is still
   * perfectly fetchable and an alarm would be crying wolf.
   */
  /**
   * Body THEN timestamp, hex, `Klaviyo-Signature`. The order is not
   * interchangeable and it is not the shape any other connector here uses:
   * Klaviyo's own sample seeds the HMAC with the body and then `.update()`s the
   * timestamp onto it, with no separator, so `${ts}${body}` — the Stripe/Paddle
   * instinct — fails every real delivery.
   */
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const ts = headers["klaviyo-timestamp"];
    if (!ts) return false;
    // "stale" only. `Klaviyo-Timestamp` is an HTTP-date, which Date.parse reads,
    // but an unrecognised format must not reject a delivery whose HMAC already
    // covers that same string — see `timestampFreshness`.
    if (timestampFreshness(ts) === "stale") return false;
    /**
     * The documented cross-check, applied only when both halves are present: a
     * mismatch is what Klaviyo names as "potential malicious activity", while an
     * absent header or an unexpected body shape is not evidence of anything and
     * cannot be forged into a mismatch — the HMAC already binds the body.
     */
    const claimed = headers["klaviyo-webhook-id"];
    if (claimed) {
      let bodyWebhookId: string | null = null;
      try {
        bodyWebhookId = str(asObject(asObject(JSON.parse(rawBody))["meta"])["klaviyo_webhook_id"]);
      } catch {
        bodyWebhookId = null;
      }
      if (bodyWebhookId && bodyWebhookId !== claimed) return false;
    }
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "klaviyo-signature", encoding: "hex", message: (body) => `${body}${ts}` });
  },
  /**
   * NO `normalize`, deliberately, and not because the delivery is unusable —
   * Klaviyo's is the one thing Attio's is not, "Payload with the same structure
   * as a Get Event API call", so mapping it would be three lines of reuse.
   *
   * It would be three UNREACHABLE lines. This source is stream-scoped, so the
   * webhook route answers `isStreamScoped` and rings the connection's doorbell
   * before anything is stored; a `normalize` here could never run, and a
   * connector carrying one that quietly disagrees with the poll is exactly the
   * failure `Connector.normalize` documents against Google Sheets. The poll does
   * the reading, with the stream attribution the delivery has no way to supply
   * (a batch may mix topics, and a topic is not a stream).
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "metric") return [];
    const client = api(args.credentials);
    const out: SourceOption[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < METRIC_PAGES; page++) {
      const res: EventsPage = await client.get<EventsPage>("/api/metrics", { "page[cursor]": cursor ?? undefined });
      for (const raw of res.data ?? []) {
        const m = asObject(raw);
        const id = str(m["id"]);
        if (!id) continue;
        const attrs = asObject(m["attributes"]);
        const name = str(attrs["name"]) ?? id;
        // An account routinely holds several metrics with ONE name — "Placed
        // Order" from Shopify and "Placed Order" from a custom integration are
        // different metric_ids and different numbers. The integration name is
        // untyped in the schema, so it is appended only when actually there.
        const integration = str(asObject(attrs["integration"])["name"]);
        out.push({ value: id, label: integration ? `${name} (${integration})` : name });
      }
      cursor = cursorOf(str(asObject(res.links)["next"]));
      if (!cursor) break;
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const metric = str(args.config?.["metric"]);
    if (!metric) return { records: [], nextCursor: null };
    const client = api(args.credentials);
    return windowedWalk<KlaviyoRow>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<EventsPage>("/api/events", {
          // The docs' own worked example, to the character: an implicit AND of
          // `equals(metric_id,…)` and a `datetime` bound.
          filter: `equals(metric_id,"${metric}"),greater-or-equal(datetime,${rfc3339(since)})`,
          // ASCENDING, which is what a bare `datetime` means ("by `datetime` in
          // ascending order (oldest to newest)"). Oldest-first is what lets the
          // walk stop anywhere: every row before the stopping point is already
          // ingested, so the mark can settle at the newest row seen and the next
          // poll resumes there without stranding anything.
          sort: "datetime",
          // The metric NAME (this row's eventType) and the profile's email (its
          // subject) are relationships, not attributes. Both ride along in the
          // same request — a compound document, not a second call — and the
          // sparse fieldsets keep it to the two fields actually used.
          include: "metric,profile",
          "fields[metric]": "name",
          "fields[profile]": "email",
          "page[cursor]": cont ?? undefined,
        });
        const { metrics, emails } = includedMaps(page.included);
        const rows: KlaviyoRow[] = (page.data ?? []).map(asObject).map((event) => {
          const rel = asObject(event["relationships"]);
          const metricId = str(asObject(asObject(rel["metric"])["data"])["id"]);
          const profileId = str(asObject(asObject(rel["profile"])["data"])["id"]);
          return {
            event,
            metric: metricId ? (metrics.get(metricId) ?? null) : null,
            email: profileId ? (emails.get(profileId) ?? null) : null,
          };
        });
        return { rows, next: cursorOf(str(asObject(page.links)["next"])), rateLimit: client.rateLimit() };
      },
      /**
       * THE WATERMARK IS THE BOUND. The request filters `datetime`, so
       * `datetime` is what may advance the mark. The `timestamp` fallback is the
       * same instant re-encoded (seconds, per the schema) rather than a second
       * axis — without it, a row whose `datetime` came back null would leave the
       * mark un-advanced and be re-read on every sweep, forever.
       */
      changedAt: (r) => {
        const attrs = asObject(r.event["attributes"]);
        const iso = parseDate(str(attrs["datetime"]), "klaviyo.datetime") ?? epochToDate(attrs["timestamp"], "s");
        return iso ? iso.toISOString() : null;
      },
      // No `happenedAt` override: on a Klaviyo event the two are one field.
      map: (r) => klaviyoEvent(r, args.connectionId),
      /**
       * NO `expiredContinuation`. Klaviyo documents no lifetime for a
       * `page[cursor]` (it is a keyset token — the docs' own example decodes to
       * `next::id::N7umbW`), and the only status a dead one could plausibly
       * return is 400, which is far more likely to mean a malformed filter. A
       * connector that swallowed 400 would turn a broken request into a walk
       * that reports "incomplete" forever and never says why.
       */
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  /**
   * WE mint the secret, because Klaviyo never hands one back: `secret_key` is a
   * required field on the CREATE request and is absent from the 201 response.
   * That is the good case — the key is known to us by construction, with nothing
   * for a customer to copy anywhere.
   *
   * Gated, though: the Webhooks API is Advanced KDP only, so an ordinary
   * account's connect attempt is refused here. The entry declares
   * `webhookOptional`, which makes that refusal a logged warning rather than a
   * broken connection — the poll is the primary path and is untouched by it.
   */
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const client = api(args.credentials);
    // Topics are per-account ("dynamic and based on the metrics available in
    // your account"), so they are READ rather than hard-coded — a subscription
    // to a topic the account does not have is a create that fails. All of them:
    // the doorbell is connection-scoped and cannot know which metric a flow will
    // be scoped to later, and Klaviyo sets no limit on topics per webhook.
    const topics = await client.get<{ data?: unknown[] }>("/api/webhook-topics");
    const ids = (topics.data ?? []).map(asObject).map((t) => str(t["id"])).filter((id): id is string => Boolean(id));
    if (ids.length === 0) throw new Error("Klaviyo returned no webhook topics for this account — there is nothing to subscribe to.");
    // 32 base64url characters, comfortably over the documented 16-character
    // minimum, used as UTF-8 bytes on both sides (which is what Klaviyo's own
    // `hmac.new(hmac_secret, …)` sample does with it).
    const secret = randomBytes(24).toString("base64url");
    const res = await client.post<{ data?: { id?: string } }>("/api/webhooks", {
      data: {
        type: "webhook",
        attributes: {
          name: "Namzilabs",
          description: "Namzilabs sync doorbell",
          endpoint_url: args.webhookUrl,
          secret_key: secret,
        },
        relationships: { "webhook-topics": { data: ids.map((id) => ({ type: "webhook-topic", id })) } },
      },
    });
    return { signingSecret: secret, externalId: str(res.data?.id) ?? undefined };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/api/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return; // already gone is success
      throw e;
    }
  },
};
