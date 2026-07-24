import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { firstString, firstNumber, parseDate } from "./field-utils";

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
    return items.map((item) => toCanonical(item, ctx));
  },
};

function toCanonical(item: unknown, ctx: NormalizeContext): CanonicalEvent {
  const obj: Record<string, unknown> =
    item && typeof item === "object" ? (item as Record<string, unknown>) : { value: item };

  const natural = firstString(obj, ["id", "event_id", "eventId", "uuid", "ID"]);
  const eventId = natural
    ? `webhook:${ctx.connectionId}:${natural}`
    : hashId(`webhook:${ctx.connectionId}`, obj);

  const eventType = firstString(obj, ["event_type", "eventType", "type", "event"]) ?? "webhook.received";
  const subject = firstString(obj, ["email", "subject", "phone", "contact", "name", "user"]);
  const occurredAt =
    parseDate(firstString(obj, ["occurred_at", "occurredAt", "timestamp", "created_at", "createdAt", "time", "date"])) ??
    new Date();
  const value = firstNumber(obj, ["value", "amount", "count", "revenue"]);

  return { eventId, eventType, subject, occurredAt, value, properties: obj };
}
