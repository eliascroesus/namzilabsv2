import { randomBytes } from "node:crypto";
import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, RegisterWebhookArgs, RegisterWebhookResult, UnregisterWebhookArgs } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, windowedWalk } from "./kit";

/**
 * Cal.com (API v2). A booking carries createdAt (when it was booked) and
 * start/end (when it happens); `booked` is dated by createdAt and the slot
 * rides in properties.
 *
 * Docs read 8 Sep 2026:
 * - https://cal.com/docs/api-reference/v2/bookings/get-all-bookings — header
 *   `cal-api-version: 2026-05-01` is mandatory; `afterUpdatedAt` + `sortUpdatedAt`
 *   filter and order on updatedAt, so that is the watermark; `cursor`/`limit`
 *   (1–100) with `pagination.nextCursor`/`hasMore`; status ∈ cancelled,
 *   accepted, rejected, pending; `updatedAt` is nullable.
 * - https://cal.com/docs/developing/guides/automation/webhooks — `x-cal-signature-256`
 *   = HMAC-SHA256 hex over the raw body keyed on the webhook secret; delivery
 *   `{ triggerEvent, createdAt, payload }`, except MEETING_STARTED/ENDED which
 *   are FLAT. The delivery carries no booking createdAt, so a webhook `booked`
 *   is dated by the delivery's createdAt and the next poll restates it from the
 *   booking (same eventId).
 * - https://cal.com/docs/api-reference/v2/webhooks/create-a-webhook — POST
 *   /v2/webhooks { subscriberUrl, triggers, active, secret } → data.id;
 *   DELETE /v2/webhooks/{webhookId}.
 */
const DEFAULT_API = "https://api.cal.com/v2";
const API_VERSION = "2026-05-01";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 100;

export const CALCOM_TRIGGERS = ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "BOOKING_NO_SHOW_UPDATED", "MEETING_ENDED"] as const;

function api(credentials?: Record<string, unknown> | null) {
  const base = str(credentials?.["baseUrl"]) || DEFAULT_API;
  return bearerClient(base, requireCredential(credentials, "apiKey", "Cal.com"), "Cal.com", { "cal-api-version": API_VERSION });
}

const attendeeEmail = (b: Record<string, unknown>): string | null => {
  const a = Array.isArray(b["attendees"]) ? asObject((b["attendees"] as unknown[])[0]) : {};
  return str(a["email"]);
};
const iso = (v: unknown, field: string): Date | null => parseDate(str(v), field);

type Kind = "booked" | "canceled" | "rescheduled" | "no_show" | "meeting_held";

function bookingEvent(b: Record<string, unknown>, kind: Kind, connectionId: string, at: Date | null, fallback?: Date): CanonicalEvent | null {
  const uid = str(b["uid"]) ?? str(b["bookingId"]) ?? (typeof b["bookingId"] === "number" ? String(b["bookingId"]) : null);
  if (!uid) return null;
  const suffix = kind === "booked" ? "" : kind === "meeting_held" ? ":held" : `:${kind}`;
  return {
    eventId: eventId("calcom", connectionId, uid) + suffix,
    eventType: kind,
    subject: attendeeEmail(b),
    occurredAt: at ?? fallback ?? new Date(),
    properties: b,
  };
}

export const calcomConnector: Connector & { apiVersion: string } = {
  source: "calcom",
  authType: "apiKey",
  apiVersion: API_VERSION,
  operations: ["bookings.list"] as const,
  operationFor: () => "bookings.list",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-cal-signature-256", encoding: "hex" });
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const trigger = str(body["triggerEvent"]);
    const nested = asObject(body["payload"]);
    // MEETING_STARTED / MEETING_ENDED are delivered flat: the booking fields sit
    // next to triggerEvent instead of under payload.
    const b = Object.keys(nested).length > 0 ? nested : body;
    const delivered = iso(body["createdAt"], "createdAt") ?? ctx.fallbackOccurredAt;
    let ev: CanonicalEvent | null = null;
    switch (trigger) {
      case "BOOKING_CREATED":
        ev = bookingEvent(b, "booked", ctx.connectionId, iso(b["createdAt"], "createdAt") ?? delivered ?? null, ctx.fallbackOccurredAt);
        break;
      case "BOOKING_CANCELLED":
        ev = bookingEvent(b, "canceled", ctx.connectionId, delivered ?? null, ctx.fallbackOccurredAt);
        break;
      case "BOOKING_RESCHEDULED":
        ev = bookingEvent(b, "rescheduled", ctx.connectionId, delivered ?? null, ctx.fallbackOccurredAt);
        break;
      case "BOOKING_NO_SHOW_UPDATED":
        ev = bookingEvent(b, "no_show", ctx.connectionId, delivered ?? iso(b["startTime"], "startTime"), ctx.fallbackOccurredAt);
        break;
      case "MEETING_ENDED":
        ev = bookingEvent(b, "meeting_held", ctx.connectionId, iso(b["endTime"], "endTime") ?? delivered ?? null, ctx.fallbackOccurredAt);
        break;
      default:
        return [];
    }
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ data?: unknown[]; pagination?: { nextCursor?: string | null; hasMore?: boolean } }>("/bookings", {
          afterUpdatedAt: since.toISOString(),
          sortUpdatedAt: "asc",
          limit: PAGE,
          cursor: cont ?? undefined,
        });
        const rows = (page.data ?? []).map(asObject);
        const next = page.pagination?.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : null;
        return { rows, next, rateLimit: client.rateLimit() };
      },
      changedAt: (b) => isoOrNull(b["updatedAt"]) ?? isoOrNull(b["createdAt"]),
      happenedAt: (b) => isoOrNull(b["createdAt"]),
      map: (b) => bookingEvent(b, "booked", args.connectionId, iso(b["createdAt"], "createdAt")),
    });
    // The poll sees a booking's CURRENT state: every booking was booked, a
    // cancelled one also gets its cancellation, a rescheduled one its move.
    // No-shows and held meetings arrive by webhook only.
    const extra: CanonicalEvent[] = [];
    for (const r of res.records) {
      const b = r.properties ?? {};
      const status = str(b["status"]);
      if (status === "cancelled" || status === "rejected") {
        const c = bookingEvent(b, "canceled", args.connectionId, iso(b["updatedAt"], "updatedAt") ?? r.occurredAt);
        if (c) extra.push(c);
      }
      if (str(b["rescheduledFromUid"])) {
        const m = bookingEvent(b, "rescheduled", args.connectionId, iso(b["createdAt"], "createdAt"));
        if (m) extra.push(m);
      }
    }
    return { ...res, records: [...res.records, ...extra] };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const client = api(args.credentials);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const res = await client.post<{ data?: { id?: number | string } }>("/webhooks", {
      subscriberUrl: args.webhookUrl,
      triggers: [...CALCOM_TRIGGERS],
      active: true,
      secret,
    });
    const id = res.data?.id;
    return { signingSecret: secret, externalId: id != null ? String(id) : undefined };
  },
  async unregisterWebhook(args: UnregisterWebhookArgs): Promise<void> {
    try {
      await api(args.credentials).del(`/webhooks/${encodeURIComponent(args.externalId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return; // already gone is success
      throw e;
    }
  },
};
