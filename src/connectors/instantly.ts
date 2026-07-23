import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { asObject, parseDate, str } from "./field-utils";

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
 * Instantly (v2). Webhook-primary source. Instantly's docs recommend adding
 * idempotency + verification on the receiver: we verify an optional HMAC-SHA256
 * signature over the body via `x-instantly-signature` when a secret is set.
 */
export const instantlyConnector: Connector = {
  source: "instantly",
  authType: "apiKey",
  // Email events (sent/opened/replied…) are immutable happenings: append + dedup.
  syncStrategy: "incremental",

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
};

