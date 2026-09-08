import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { asObject, str } from "./field-utils";
import { timestampFreshness } from "@/lib/signatures";
import { epochToDate, eventId, hmacHeaderVerify } from "./kit";

/**
 * Customer.io reporting webhooks. Each delivery is ALREADY an event —
 * (object_type, metric, timestamp) — so there is nothing to reshape beyond
 * naming it in our vocabulary and dropping the stages that are not business
 * facts.
 *
 * WEBHOOK-ONLY, and the reason is sharper than "there is no list endpoint":
 * there IS one (`GET /v1/activities`), it just has no time filter. Its only
 * parameters are a pagination token, an activity type, a name, a person and a
 * limit — nothing bounds a window, so there is no field the provider filters
 * on, and therefore no honest watermark to advance. A walk over it would be an
 * unbounded rescan of the whole account on every sweep, which is exactly the
 * failure `windowedWalk`'s cursor grammar exists to prevent. So no poll: what
 * arrived by webhook is what we have.
 *
 * Docs read 8 Sep 2026:
 * - https://docs.customer.io/integrations/data-out/connections/webhooks/ —
 *   payload `{ event_id, object_type, metric, timestamp, data }`; `timestamp`
 *   is "The timestamp at which the event being reported took place" (unix
 *   SECONDS), which is what makes it a lawful `occurredAt`. Signature:
 *   `X-CIO-Signature` = HMAC-SHA256 over the string "v0:<X-CIO-Timestamp>:<raw
 *   body>", HEX (their Go example does `hex.DecodeString(XCIOSignature)`), keyed
 *   on the endpoint's signing key; "Always use the request's raw body to
 *   construct the hash". Object types: email, push, in-app, sms, whatsapp,
 *   slack, webhook, customer. Metrics: drafted, attempted, sent, delivered,
 *   opened, clicked, converted, replied, unsubscribed, bounced, dropped,
 *   spammed, failed, undeliverable (customer: subscribed, unsubscribed,
 *   cio_subscription_preferences_changed). "By default, only the first click
 *   event is sent" — Send Frequency on the endpoint decides whether repeats
 *   arrive. Failed deliveries are retried and queued "for up to 7 days", after
 *   which "the pending events expire and you can't recover them".
 * - https://docs.customer.io/integrations/api/app/tag/activities/listActivities/
 *   — `GET /v1/activities` takes `start`, `type`, `name`, `deleted`,
 *   `customer_id`, `id_type`, `limit` and NO time filter; "This endpoint is
 *   guaranteed to return activity history within the past 30 days." Hence
 *   webhook-only (the plan said the App API has no bulk activity list at all;
 *   the live docs say it has one with no time filter, which lands in the same
 *   place for a different reason).
 * - https://docs.customer.io/integrations/api/app/ — base
 *   `https://api.customer.io` (EU: `https://api-eu.customer.io`); "Most
 *   endpoints on this page are limited to 10 requests per second."
 *
 * OPENS ARE PIXEL-BASED. Apple Mail Privacy Protection and every scanning proxy
 * fetch the tracking pixel without a human reading anything, so `email_opened`
 * is an inflated ceiling, not a count of readers — said out loud on the catalog
 * entry's syncNote rather than silently mapped as if it were reliable.
 */

/**
 * The metrics we count. `drafted` and `attempted` are INTERNAL PIPELINE STAGES —
 * Customer.io deciding to build a message and handing it to a provider — not
 * something that happened to a customer, so they are dropped rather than
 * counted. Anything not listed is dropped too: an unrecognised metric is a
 * vocabulary we have not read the docs for, and inventing a type for it would
 * put a name nobody can define in front of a user.
 */
const METRICS = new Set([
  "sent",
  "delivered",
  "opened",
  "clicked",
  "converted",
  "replied",
  "bounced",
  "dropped",
  "spammed",
  "failed",
  "undeliverable",
  "subscribed",
  "unsubscribed",
  "cio_subscription_preferences_changed",
]);

/**
 * Metrics that are NOT about a channel and therefore carry no channel prefix.
 *
 * Two kinds: what happened to the PERSON (subscribed, unsubscribed, and the
 * preference change) and how a send FAILED (bounced, dropped, spammed, failed,
 * undeliverable). A bounce is a bounce whether the message was email or SMS,
 * and `unsubscribed` arrives both as `email`/`unsubscribed` and as
 * `customer`/`unsubscribed` for the same fact — prefixing one and not the other
 * would split one number in two.
 */
const UNPREFIXED = new Set([
  "bounced",
  "dropped",
  "spammed",
  "failed",
  "undeliverable",
  "subscribed",
  "unsubscribed",
  "cio_subscription_preferences_changed",
]);

/** `in-app` is the only hyphenated object_type; event types are snake_case here. */
const channelOf = (objectType: string): string => objectType.replace(/-/g, "_");

export const customerioConnector: Connector = {
  source: "customerio",
  authType: "secret",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const ts = headers["x-cio-timestamp"];
    if (!ts) return false;
    // Only "stale" rejects. `timestampFreshness` documents why "unparseable"
    // must not: the HMAC covers the timestamp AND the body, so authenticity is
    // already proven and all an unrecognised format costs is the replay window.
    // Rejecting on it would be the hex-key incident again.
    if (timestampFreshness(ts) === "stale") return false;
    return hmacHeaderVerify(
      { rawBody, headers, secret },
      { header: "x-cio-signature", encoding: "hex", message: (body) => `v0:${ts}:${body}` },
    );
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const b = asObject(rawPayload);
    const id = str(b["event_id"]);
    const objectType = str(b["object_type"]);
    const metric = str(b["metric"]);
    if (!id || !objectType || !metric || !METRICS.has(metric)) return [];
    const data = asObject(b["data"]);
    const ids = asObject(data["identifiers"]);
    const channel = channelOf(objectType);
    return [
      {
        eventId: eventId("customerio", ctx.connectionId, id),
        eventType: UNPREFIXED.has(metric) || objectType === "customer" ? metric : `${channel}_${metric}`,
        subject: str(ids["email"]) ?? str(data["email_address"]) ?? str(data["recipient"]) ?? str(data["customer_id"]) ?? str(ids["id"]),
        // "The timestamp at which the event being reported took place", in
        // seconds — the moment itself, not the delivery of the notification.
        occurredAt: epochToDate(b["timestamp"], "s") ?? ctx.fallbackOccurredAt ?? new Date(),
        properties: { ...b, channel },
      },
    ];
  },
};
