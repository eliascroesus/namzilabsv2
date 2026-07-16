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
import { fetchJson } from "@/lib/http-client";

const API = "https://api.calendly.com";

/** invitee.created -> booked, invitee.canceled -> canceled, etc. */
const EVENT_TYPE_MAP: Record<string, string> = {
  "invitee.created": "booked",
  "invitee.canceled": "canceled",
  "invitee_no_show.created": "no_show",
  "invitee_no_show.deleted": "no_show_removed",
  "routing_form_submission.created": "form_submission",
};

/**
 * Calendly (v2). Instant path: webhook subscriptions signed with HMAC-SHA256
 * over `${timestamp}.${body}`, sent in the `Calendly-Webhook-Signature` header
 * as `t=<ts>,v1=<hex>`. Backfill path: list scheduled events.
 */
export const calendlyConnector: Connector = {
  source: "calendly",
  authType: "oauth2",

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false; // Calendly always signs when a key is configured.
    const header = headers["calendly-webhook-signature"];
    if (!header) return false;
    const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=").map((s) => s.trim())));
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) return false;
    const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
    return safeEqual(v1, expected);
  },

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const eventName = str(body["event"]) ?? "calendly.event";
    const payload = asObject(body["payload"]);
    const scheduled = asObject(payload["scheduled_event"]);
    // Use the scheduled event URI as the id so webhook + poll dedupe together.
    const naturalId = str(scheduled["uri"]) ?? str(payload["uri"]) ?? undefined;
    const eventId = naturalId
      ? `calendly:${ctx.connectionId}:${naturalId}`
      : `calendly:${ctx.connectionId}:${str(body["created_at"]) ?? Date.now()}`;
    const occurredAt =
      parseDate(str(scheduled["start_time"])) ?? parseDate(str(body["created_at"])) ?? new Date();
    return [
      {
        eventId,
        eventType: EVENT_TYPE_MAP[eventName] ?? eventName,
        subject: str(payload["email"]) ?? str(payload["name"]) ?? null,
        occurredAt,
        properties: payload,
      },
    ];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const records = await listScheduledEvents(args, 50, args.cursor);
    const nextCursor = records.length > 0 ? records[0].occurredAt.toISOString() : args.cursor;
    return { records, nextCursor };
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    return listScheduledEvents(args, n, null);
  },

  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const token = token_(args.credentials);
    const me = await fetchJson<{ resource: { current_organization: string; uri: string } }>(`${API}/users/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await fetchJson<{ resource: { uri: string; signing_key?: string } }>(`${API}/webhook_subscriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        url: args.webhookUrl,
        events: ["invitee.created", "invitee.canceled", "invitee_no_show.created"],
        organization: me.resource.current_organization,
        scope: "organization",
      }),
    });
    return { signingSecret: res.resource.signing_key, externalId: res.resource.uri };
  },
};

async function listScheduledEvents(args: PollArgs, count: number, cursor: string | null): Promise<CanonicalEvent[]> {
  const token = token_(args.credentials);
  const me = await fetchJson<{ resource: { uri: string } }>(`${API}/users/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const params = new URLSearchParams({
    user: me.resource.uri,
    count: String(Math.min(count, 100)),
    sort: "start_time:desc",
    status: "active",
  });
  if (cursor) params.set("min_start_time", cursor);
  const data = await fetchJson<{ collection: Array<Record<string, unknown>> }>(
    `${API}/scheduled_events?${params.toString()}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return data.collection.map((ev) => ({
    eventId: `calendly:${args.connectionId}:${str(ev["uri"])}`,
    eventType: "booked",
    subject: str(ev["name"]) ?? null,
    occurredAt: parseDate(str(ev["start_time"])) ?? new Date(),
    properties: ev,
  }));
}

function token_(credentials?: Record<string, unknown> | null): string {
  const token = str(credentials?.["accessToken"]) ?? str(credentials?.["apiKey"]);
  if (!token) throw new Error("calendly: missing access token");
  return token;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
