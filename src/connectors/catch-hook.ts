import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { firstString, firstNumber, parseDate } from "./field-utils";
import { normalizeDateValue } from "@/lib/normalize-dates";

/** Header the generic catch-hook checks for an HMAC-SHA256 signature of the body. */
export const CATCH_HOOK_SIGNATURE_HEADER = "x-namzilabs-signature";

/**
 * The universal "catch any webhook" connector — Zapier's Catch Hook equivalent.
 * Any external app can POST JSON (an object or an array of objects) to a
 * connection's inbound URL and it becomes canonical events immediately.
 */
export const catchHookConnector: Connector = {
  source: "webhook",
  authType: "secret",

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    // No secret configured => open catch-hook (accept). Configuring a secret
    // upgrades the endpoint to authenticated HMAC verification.
    if (!secret) return true;
    const provided = headers[CATCH_HOOK_SIGNATURE_HEADER];
    if (!provided) return false;
    const normalized = provided.startsWith("sha256=") ? provided.slice("sha256=".length) : provided;
    const expected = hmacSha256Hex(secret, rawBody);
    return safeEqual(normalized, expected);
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const items = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
    return items.map((item, index) => toCanonical(item, ctx, index));
  },
};

/** Standard-webhooks delivery id headers (stable across redeliveries of one message). */
function deliveryId(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if ((key === "webhook-id" || key === "svix-id") && v) return v;
  }
  return null;
}

function toCanonical(item: unknown, ctx: NormalizeContext, index: number): CanonicalEvent {
  const obj: Record<string, unknown> =
    item && typeof item === "object" ? (item as Record<string, unknown>) : { value: item };

  // Dedup key preference: (1) the payload's own natural id — identifies the
  // business record; (2) the delivery id header (standard-webhooks/svix) —
  // identical on every redelivery of the same message but distinct for two
  // deliveries that happen to carry equal payloads; (3) payload hash, last
  // resort. Array payloads suffix the item index so one delivery of N items
  // stays N events.
  const natural = firstString(obj, ["id", "event_id", "eventId", "uuid", "ID"]);
  const delivery = deliveryId(ctx.headers);
  const eventId = natural
    ? `webhook:${ctx.connectionId}:${natural}`
    : delivery
      ? `webhook:${ctx.connectionId}:delivery:${delivery}:${index}`
      : hashId(`webhook:${ctx.connectionId}`, obj);

  const eventType = firstString(obj, ["event_type", "eventType", "type", "event"]) ?? "webhook.received";
  const subject = firstString(obj, ["email", "subject", "phone", "contact", "name", "user"]);
  const value = firstNumber(obj, ["value", "amount", "count", "revenue"]);

  /**
   * WHEN IT HAPPENED — and there are two answers here on purpose.
   *
   * FROZEN (`ctx.eventTime` absent): the seven fixed keys in their original
   * order, read with `parseDate`. Byte-for-byte what this connector did before
   * the event-time work, kept because changing how NEW events are dated without
   * restamping the old ones puts two meanings inside one metric silently. This
   * branch is scheduled for deletion with the rollout gate.
   *
   * RESOLVED (`ctx.eventTime` present): the nominated key, read with
   * `normalizeDateValue` — the same parser the sheet path uses, so the same
   * value gives the same answer whichever door it came through. Bare `new Date`
   * reads "21/07/2026" and an epoch string as Invalid Date and drops the event
   * to delivery time; it also reads "2026-02-30" as March 2nd, which does not
   * fail, it lies. The full disagreement is tabulated above `parseDate`.
   *
   * A payload without the nominated key falls to the delivery moment, matching
   * exactly what `EventTimeState.coverage` counts — so the number that says
   * "20 of 25 would fall back" is the number that happens.
   */
  const occurredAt = ctx.eventTime ? resolvedDate(obj, ctx.eventTime.key, ctx) : legacyDate(obj, ctx);

  return { eventId, eventType, subject, occurredAt, value, properties: obj };
}

/**
 * The value at a one-level path (`created_at`, `data.created_at`).
 *
 * One level, matching the detector: provider payloads routinely wrap in
 * `data`/`event`/`payload`, and deeper than that is a tree walk whose candidate
 * set grows faster than anyone can choose from.
 */
function valueAt(obj: Record<string, unknown>, path: string): unknown {
  const [head, tail] = path.split(".");
  const top = obj[head];
  if (tail == null) return top;
  return top && typeof top === "object" ? (top as Record<string, unknown>)[tail] : undefined;
}

/**
 * The pre-feature behaviour, frozen.
 *
 * Seven keys in their original order, read with `parseDate`. Every part of it is
 * improvable — the order was nobody's decision, the parser is the loose one, and
 * `updated_at` is not in the list only by luck — and none of it is improved
 * here, because a better answer for new events alongside the old answer for old
 * ones is the failure this whole feature is about. It improves when the
 * connection is restamped, which is when `ctx.eventTime` starts arriving.
 *
 * Deleted with the rollout gate.
 */
/** The seven, in their original order. Frozen; see `legacyDate`. */
const LEGACY_KEYS = ["occurred_at", "occurredAt", "timestamp", "created_at", "createdAt", "time", "date"];

function legacyDate(obj: Record<string, unknown>, ctx: NormalizeContext): Date {
  const found = parseDate(firstString(obj, LEGACY_KEYS), "occurred_at");
  return found ?? ctx.fallbackOccurredAt ?? new Date();
}

/** The nominated key, read with the shared parser, else the delivery moment. */
function resolvedDate(obj: Record<string, unknown>, key: string | null, ctx: NormalizeContext): Date {
  const canonical = key ? normalizeDateValue(valueAt(obj, key), key.split(".").pop() ?? key) : null;
  const ms = canonical ? Date.parse(canonical) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : (ctx.fallbackOccurredAt ?? new Date());
}
