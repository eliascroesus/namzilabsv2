import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext } from "./types";
import { safeEqual } from "@/lib/signatures";
import { hashId } from "@/lib/ids";
import { asObject, parseDate, str } from "./field-utils";

/** Candidate headers Sendblue may place the configured signing secret in. */
const SECRET_HEADERS = [
  "sendblue-signing-secret",
  "sb-signing-secret",
  "sb-secret",
  "x-sendblue-secret",
  "x-sendblue-signing-secret",
  "signing-secret",
];

/**
 * Sendblue (iMessage/SMS). Webhook-primary source. When a signing secret is
 * configured, Sendblue includes it in the webhook request headers; we compare
 * it constant-time. Status lifecycle: QUEUED -> SENT -> DELIVERED.
 */
export const sendblueConnector: Connector = {
  source: "sendblue",
  authType: "secret",
  // Message status/inbound webhooks are an event stream: append + dedup.
  syncStrategy: "incremental",

  verifySignature({ headers, secret }: VerifyArgs): boolean {
    if (!secret) return true; // No secret configured => accept.
    for (const h of SECRET_HEADERS) {
      const value = headers[h];
      if (value && safeEqual(value, secret)) return true;
    }
    return false;
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const status = (str(body["status"]) ?? "").toUpperCase();
    // Inbound "receive" webhooks carry no outbound status; outbound status
    // webhooks always include a `status`.
    const isInbound = body["is_outbound"] === false || (status === "" && str(body["date_received"]) !== null);
    const eventType = statusToType(status, isInbound);
    // Sendblue docs: dedupe on message_handle.
    const naturalId = str(body["message_handle"]) ?? str(body["handle"]) ?? str(body["message_id"]) ?? undefined;
    const eventId = naturalId
      ? `sendblue:${ctx.connectionId}:${eventType}:${naturalId}`
      : hashId(`sendblue:${ctx.connectionId}`, body);
    const subject =
      str(body["to_number"]) ?? str(body["from_number"]) ?? str(body["number"]) ?? str(body["phone"]) ?? null;
    const occurredAt =
      parseDate(str(body["date_sent"]) ?? str(body["date_received"]) ?? str(body["date_updated"])) ?? new Date();
    return [{ eventId, eventType, subject, occurredAt, properties: body }];
  },
};

function statusToType(status: string, inbound: boolean): string {
  if (inbound) return "sms_received";
  if (status === "DELIVERED") return "sms_delivered";
  if (status === "SENT") return "sms_sent";
  if (status === "QUEUED") return "sms_queued";
  if (status === "ERROR") return "sms_error";
  return "sms_sent";
}

