import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  RegisterWebhookArgs,
  RegisterWebhookResult,
  UnregisterWebhookArgs,
} from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { HttpError } from "@/lib/http-client";
import { eventId, headerKeyClient, isoOrNull, requireCredential, timestampedHmacVerify, walkImportProgress, windowedWalk } from "./kit";

/**
 * OnceHub (Booking Calendars API v2). A booking carries `creation_time` (when
 * it was booked) and `starting_time` (the slot) side by side: `booked` is dated
 * by creation_time, `meeting_held` and `no_show` by starting_time, and the slot
 * of a future booking never becomes an occurredAt on its own.
 *
 * Docs read 8 Sep 2026 — the OLD HOST IS GONE: every developers.oncehub.com
 * page (e.g. /reference/list-all-bookings) 301s to
 * https://help.oncehub.com/developers/, so the plan's URLs were re-read there.
 * - https://help.oncehub.com/developers/overview/authentication/ — "Include your
 *   API key in the API-Key header of every HTTP request", host api.oncehub.com.
 * - https://help.oncehub.com/developers/api/ (Booking Calendars API, OpenAPI
 *   3.1.0 / API version 2.0.0) — server `https://api.oncehub.com/v2`, so the
 *   list is GET /v2/bookings and NOT /bookings as the plan had it. Filters:
 *   `creation_time.gt|lt`, `starting_time.gt|lt`, `last_updated_time.gt|lt`;
 *   `expand` ∈ owner, contact, conversation; `before`/`after` object-id cursors;
 *   `limit` "Defaults to 10 ... maximum limit of 100". Response
 *   `{ object: "list", data: [...], has_more }`. Booking `status` ∈ requested,
 *   scheduled, rescheduled, completed, canceled, no_show; `payment_information`
 *   is "Payment information for the booking if payment was collected via
 *   Stripe" ({ amount_charged: 5000, currency: "USD" }); the customer's email
 *   is `form_submission.email` — there is NO `customer` object, which the plan
 *   assumed. Webhooks: POST /v2/webhooks { url, name, events } →
 *   { id, api_version: "v2", secret }, DELETE /v2/webhooks/{id}; the event tags
 *   are booking.scheduled, .rescheduled, .reassigned, .canceled_then_rescheduled,
 *   .canceled_reschedule_requested, .canceled, .completed, .no_show; the
 *   delivery envelope is { id, object: "event", creation_time, type, api_version }
 *   with the booking under `data`.
 * - https://help.oncehub.com/developers/recipes/fetch-bookings-periodically/ —
 *   OnceHub's OWN polling recipe bounds on `last_updated_time.gt`. THE WATERMARK
 *   IS last_updated_time, not the plan's creation_time: bound on creation_time
 *   and a booking cancelled a week after it was made never comes back.
 * - https://help.oncehub.com/developers/overview/pagination/ — `after` "is an
 *   object ID that defines your place in the list", results come back in reverse
 *   chronological order, and a `Link` header carries rel=next (we page on
 *   `has_more` + the last row's id, which needs no header parsing).
 * - https://help.oncehub.com/developers/overview/rate-limits/ — "5 requests per
 *   second" per account (300/min) and "200 requests per 5 minutes" per IP
 *   address (40/min). The entry declares the tighter of the two.
 * - https://help.oncehub.com/developers/webhooks/webhook-signatures/ —
 *   `Oncehub-Signature: t=<unix>,s=<hex>`, HMAC-SHA256 over the timestamp, a
 *   `.`, and the raw body, keyed on the endpoint's secret. "If the webhook was
 *   created in v2 of the API, each event will be signed"; a v1 subscription
 *   sends nothing to verify, so failing closed rejects it BY DESIGN — which is
 *   why this connector creates its own subscription (POST /webhooks is always
 *   v2) instead of asking the customer to paste a secret that may not exist.
 * - https://docs.stripe.com/currencies — "All API requests expect `amount`
 *   values in the currency's minor unit"; the zero-decimal set mirrors
 *   src/connectors/stripe.ts (ISK and UGX are two-decimal for compatibility).
 */
const API = "https://api.oncehub.com/v2";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 100;
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** Booking lifecycle events worth counting; `booking.reassigned` moves a host, not a meeting. */
export const ONCEHUB_EVENTS = [
  "booking.scheduled",
  "booking.rescheduled",
  "booking.canceled_then_rescheduled",
  "booking.canceled_reschedule_requested",
  "booking.canceled",
  "booking.completed",
  "booking.no_show",
] as const;

const api = (c?: Record<string, unknown> | null) => headerKeyClient(API, "api-key", requireCredential(c, "apiKey", "OnceHub"), "OnceHub");

type Kind = "booked" | "canceled" | "rescheduled" | "meeting_held" | "no_show";

/** The customer, as they identified themselves on the booking form. */
function subjectOf(b: Record<string, unknown>): string | null {
  const email = str(asObject(b["form_submission"])["email"]);
  if (email) return email;
  const attendees = Array.isArray(b["attendees"]) ? (b["attendees"] as unknown[]) : [];
  return str(attendees[0]) ?? str(b["tracking_id"]);
}

/** Stripe-collected charge, minor → major units, currency uppercase. */
function money(b: Record<string, unknown>): { value: number | null; currency: string | null } {
  const p = asObject(b["payment_information"]);
  const cur = str(p["currency"])?.toUpperCase() ?? null;
  const n = Number(p["amount_charged"]);
  if (!Number.isFinite(n) || !cur) return { value: null, currency: cur };
  return { value: ZERO_DECIMAL.has(cur.toLowerCase()) ? n : n / 100, currency: cur };
}

function bookingEvent(b: Record<string, unknown>, connectionId: string, kind: Kind, at: Date | null, fallback?: Date): CanonicalEvent | null {
  const id = str(b["id"]);
  if (!id) return null;
  const suffix = kind === "booked" ? "" : kind === "meeting_held" ? ":held" : `:${kind}`;
  // The charge is collected when the slot is taken, so it rides on `booked`
  // alone; summing value across a booking's outcomes must not count it twice.
  const amount = kind === "booked" ? money(b) : { value: null, currency: null };
  return {
    eventId: eventId("oncehub", connectionId, id) + suffix,
    eventType: kind,
    subject: subjectOf(b),
    occurredAt: at ?? fallback ?? new Date(),
    value: amount.value,
    currency: amount.currency,
    properties: b,
  };
}

const at = (v: unknown, field: string): Date | null => parseDate(str(v), field);

export const oncehubConnector: Connector = {
  source: "oncehub",
  authType: "apiKey",
  operations: ["bookings.list"] as const,
  operationFor: () => "bookings.list",
  importProgress: walkImportProgress,
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return timestampedHmacVerify(
      { rawBody, headers, secret },
      { header: "oncehub-signature", timestampKey: "t", signatureKey: "s", message: (t, body) => `${t}.${body}` },
    );
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const envelope = asObject(rawPayload);
    const b = asObject(envelope["data"]);
    // When the EVENT object was created — the moment a cancel or a reschedule
    // happened. The booking's own last_updated_time is the same instant seen
    // from the record's side, and stands in when the envelope omits one.
    const evented = at(envelope["creation_time"], "creation_time") ?? at(b["last_updated_time"], "last_updated_time");
    let ev: CanonicalEvent | null = null;
    switch (str(envelope["type"])) {
      case "booking.scheduled":
        ev = bookingEvent(b, ctx.connectionId, "booked", at(b["creation_time"], "creation_time") ?? evented, ctx.fallbackOccurredAt);
        break;
      case "booking.rescheduled":
      // "Customer cancels a booking and then reschedules on a different booking
      // page" — the meeting moved rather than went away, so it counts as a move.
      case "booking.canceled_then_rescheduled":
        ev = bookingEvent(b, ctx.connectionId, "rescheduled", evented, ctx.fallbackOccurredAt);
        break;
      case "booking.canceled":
      // "User cancels and sends a request to the Customer to reschedule" — the
      // booking IS cancelled; the reschedule is only invited.
      case "booking.canceled_reschedule_requested":
        ev = bookingEvent(b, ctx.connectionId, "canceled", evented, ctx.fallbackOccurredAt);
        break;
      case "booking.completed":
        // Fired when the end time has passed; the meeting HAPPENED at its slot.
        ev = bookingEvent(b, ctx.connectionId, "meeting_held", at(b["starting_time"], "starting_time") ?? evented, ctx.fallbackOccurredAt);
        break;
      case "booking.no_show":
        ev = bookingEvent(b, ctx.connectionId, "no_show", at(b["starting_time"], "starting_time") ?? evented, ctx.fallbackOccurredAt);
        break;
      default:
        // booking.reassigned and the conversation.* family are not counted.
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
        const page = await client.get<{ data?: unknown[]; has_more?: boolean }>("/bookings", {
          limit: PAGE,
          // The bound and the watermark are the SAME field, and `expand=owner`
          // makes a polled booking carry the owner object a webhook already does.
          "last_updated_time.gt": since.toISOString(),
          expand: "owner",
          after: cont ?? undefined,
        });
        const rows = (page.data ?? []).map(asObject);
        const last = rows.length ? str(rows[rows.length - 1]["id"]) : null;
        return { rows, next: page.has_more && last ? last : null, rateLimit: client.rateLimit() };
      },
      changedAt: (b) => isoOrNull(b["last_updated_time"]) ?? isoOrNull(b["creation_time"]),
      happenedAt: (b) => isoOrNull(b["creation_time"]),
      // A "requested" booking is awaiting the user's approval — nothing is
      // booked yet. Skipping it still advances the mark, and approval bumps
      // last_updated_time, so it comes back the moment it becomes real.
      map: (b) => (str(b["status"]) === "requested" ? null : bookingEvent(b, args.connectionId, "booked", at(b["creation_time"], "creation_time"))),
    });
    // The list returns a booking's CURRENT state, so its outcome is read off
    // `status`: every row was booked, and a cancelled/moved/held/no-showed one
    // also gets the event that says so.
    const extra: CanonicalEvent[] = [];
    for (const r of res.records) {
      const b = r.properties ?? {};
      const updated = at(b["last_updated_time"], "last_updated_time") ?? r.occurredAt;
      const started = at(b["starting_time"], "starting_time");
      let outcome: CanonicalEvent | null = null;
      switch (str(b["status"])) {
        case "canceled":
          outcome = bookingEvent(b, args.connectionId, "canceled", updated);
          break;
        case "rescheduled":
          outcome = bookingEvent(b, args.connectionId, "rescheduled", updated);
          break;
        case "completed":
          outcome = bookingEvent(b, args.connectionId, "meeting_held", started);
          break;
        case "no_show":
          outcome = bookingEvent(b, args.connectionId, "no_show", started);
          break;
      }
      if (outcome) extra.push(outcome);
    }
    return { ...res, records: [...res.records, ...extra] };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    // The name must be unique per account (a duplicate answers 409), and a
    // subscription created through the API is always v2 — i.e. always signed.
    const res = await api(args.credentials).post<{ id?: string; secret?: string }>("/webhooks", {
      url: args.webhookUrl,
      name: `Namzilabs ${args.connectionId}`,
      events: [...ONCEHUB_EVENTS],
    });
    return { signingSecret: str(res.secret) ?? undefined, externalId: str(res.id) ?? undefined };
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
