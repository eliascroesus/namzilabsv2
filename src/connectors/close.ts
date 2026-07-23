import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  RegisterWebhookArgs,
  RegisterWebhookResult,
} from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson, basicAuth } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

const API = "https://api.close.com/api/v1";

/** Map Close event log object_type + action to a canonical event type. */
function canonicalType(objectType: string, action: string): string {
  const key = `${objectType}.${action}`;
  const map: Record<string, string> = {
    "activity.sms.created": "sms_sent",
    "activity.call.created": "call",
    "activity.email.created": "email_sent",
    "lead.created": "lead_created",
    "opportunity.created": "opportunity_created",
    "task.completed": "task_completed",
  };
  return map[key] ?? key;
}

/**
 * Close CRM. Instant path: Event Log webhook subscriptions signed as
 * `close-sig-hash = HMAC-SHA256(signatureKey, close-sig-timestamp + body)`.
 * Backfill path: the Event Log list endpoint. Auth: API key as Basic username.
 */
export const closeConnector: Connector = {
  source: "close",
  authType: "apiKey",
  // The Close event log is an append-only stream of immutable events.
  syncStrategy: "incremental",

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    const hash = headers["close-sig-hash"];
    const timestamp = headers["close-sig-timestamp"];
    if (!hash || !timestamp) return false;
    const expected = hmacSha256Hex(secret, `${timestamp}${rawBody}`);
    return safeEqual(hash, expected);
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const event = asObject(body["event"]);
    const objectType = str(event["object_type"]) ?? "object";
    const action = str(event["action"]) ?? "event";
    const naturalId = str(event["id"]) ?? `${str(event["date_created"])}`;
    const data = asObject(event["data"]);
    return [
      {
        eventId: `close:${ctx.connectionId}:${naturalId}`,
        eventType: canonicalType(objectType, action),
        subject:
          str(data["contact_name"]) ??
          str(data["lead_name"]) ??
          str(data["to"]) ??
          str(data["phone"]) ??
          null,
        occurredAt: parseDate(str(event["date_created"])) ?? new Date(),
        properties: event,
      },
    ];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const records = await listEvents(args, 50, args.cursor);
    // Close event log is reverse-chronological; cursor = latest date_created seen.
    const nextCursor =
      records.length > 0 ? String(records[0].properties?.["date_created"] ?? args.cursor) : args.cursor;
    return { records, nextCursor };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    return listEvents(args, n, null);
  },

  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const key = apiKey_(args.credentials);
    const res = await fetchJson<{ id: string; signature_key: string }>(`${API}/webhook/`, {
      method: "POST",
      headers: { authorization: basicAuth(key), "content-type": "application/json" },
      body: JSON.stringify({
        url: args.webhookUrl,
        events: [
          { object_type: "activity.sms", action: "created" },
          { object_type: "activity.call", action: "created" },
          { object_type: "lead", action: "created" },
          { object_type: "opportunity", action: "created" },
        ],
      }),
    });
    return { signingSecret: res.signature_key, externalId: res.id };
  },
};

async function listEvents(args: PollArgs, limit: number, cursor: string | null): Promise<CanonicalEvent[]> {
  const key = apiKey_(args.credentials);
  const params = new URLSearchParams({ _limit: String(Math.min(limit, 100)) });
  if (cursor) params.set("date_created__gt", cursor);
  const data = await fetchJson<{ data: Array<Record<string, unknown>> }>(`${API}/event/?${params.toString()}`, {
    headers: { authorization: basicAuth(key) },
  });
  return data.data.map((event) => {
    const objectType = str(event["object_type"]) ?? "object";
    const action = str(event["action"]) ?? "event";
    return {
      eventId: `close:${args.connectionId}:${str(event["id"])}`,
      eventType: canonicalType(objectType, action),
      subject: null,
      occurredAt: parseDate(str(event["date_created"])) ?? new Date(),
      properties: event,
    };
  });
}

function apiKey_(credentials?: Record<string, unknown> | null): string {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("close: missing API key");
  return key;
}

