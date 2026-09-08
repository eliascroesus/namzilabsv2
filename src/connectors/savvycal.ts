import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, requireCredential, walkImportProgress, windowedWalk, ymd } from "./kit";

/**
 * SavvyCal (Meetings). `created_at` is documented as "When the event was
 * created", so `booked` is dated exactly; `start_at` is the SLOT and rides in
 * properties. Payment is Stripe-backed and counts as `value` only once the
 * money is in.
 *
 * Docs read 8 Sep 2026:
 * - https://developers.savvycal.com/authentication — `Authorization: Bearer
 *   pt_secret_XXXXXXXXXXX` against `https://api.savvycal.com/v1` (the page's own
 *   cURL example calls `/v1/me`).
 * - https://developers.savvycal.com/api/list-events — GET /v1/events. Its ONLY
 *   date filter is `period=fixed` plus `from`/`until`, and those are "Lower/Upper
 *   bound for START date" — plain `YYYY-MM-DD`. `limit` 1–100 (default 20),
 *   `after`/`before` cursors, `state` (default `confirmed`; `all` to see
 *   cancellations), `attendance` (default `attending`; `any` for everything the
 *   token can reach), `direction` asc|desc.
 *   DEVIATION FROM THE PLAN: there is no `created_after` parameter, so the
 *   watermark cannot be `created_at`. It is `start_at` — the field `from`
 *   bounds — CLAMPED TO NOW, and that clamp loses nothing: nobody books a slot
 *   in the past, so every event created since the last poll already has
 *   `start_at` at or after that poll's clock. Cancellations and reschedules of
 *   an upcoming meeting are in front of the mark for the same reason.
 * - https://developers.savvycal.com/api/schemas/eventlistresponse and
 *   .../paginationmeta — the envelope is `{ entries[], metadata: { after,
 *   before, limit } }`; `after` is "Cursor for next page", null at the end.
 * - https://developers.savvycal.com/api/schemas/event — `created_at` "When the
 *   event was created", `canceled_at` "When the event was canceled",
 *   `rescheduled_at` "When the event was rescheduled" (DEVIATION: the plan said
 *   `updated_at`; the Event schema has no such field), `state` ∈ confirmed,
 *   canceled, awaiting_reschedule, awaiting_checkout, checkout_expired,
 *   awaiting_approval, declined, tentative; `scheduler` is the person who
 *   booked, `organizer` the host.
 * - https://developers.savvycal.com/api/schemas/payment — `amount_total` is
 *   "Total amount charged (in cents)" and `state` ∈ awaiting_checkout | paid.
 *   DEVIATION: the field is `amount_total`, not `amount`, and the documented
 *   schema carries NO currency at all.
 * - https://developers.savvycal.com/webhooks — `x-savvycal-signature:
 *   sha256=<HMAC-SHA256 of the raw body>`, hex, and the Elixir sample uses
 *   `Base.encode16()`, whose output is UPPERCASE — hence the fold below. No
 *   timestamp is signed, so there is no staleness window to check. The envelope
 *   is `{ type, id: "payload_…", occurred_at, payload: <Event>, version }`, and
 *   `event.created` fires again "when approval is granted", alongside
 *   `event.approved` — one event id, so the two dedupe.
 */
const API = "https://api.savvycal.com/v1";
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 90, overlapMs: 5 * 60_000 };
const PAGE = 100;

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "SavvyCal"), "SavvyCal");
const iso = (v: unknown, field: string): Date | null => parseDate(str(v), field);

type Kind = "booked" | "canceled" | "rescheduled";

/** An approval-gated REQUEST is not a booking, and a declined one never became one. */
const NOT_BOOKED = new Set(["awaiting_approval", "declined"]);

/** Who booked: SavvyCal calls them the `scheduler`; else the first attendee who is not the host. */
function subjectOf(e: Record<string, unknown>): string | null {
  const attendees = Array.isArray(e["attendees"]) ? (e["attendees"] as unknown[]).map(asObject) : [];
  return (
    str(asObject(e["scheduler"])["email"]) ??
    str(attendees.find((a) => a["is_organizer"] !== true)?.["email"]) ??
    str(attendees[0]?.["email"])
  );
}

/**
 * Revenue, and only once the money is in: a paid link sits at
 * `awaiting_checkout` while the booking already exists, so the COUNT stands and
 * the value waits — the same rule Stripe's checkout sessions follow.
 */
function paid(e: Record<string, unknown>): { value: number | null; currency: string | null } {
  const p = asObject(e["payment"]);
  if (p["state"] !== "paid" || typeof p["amount_total"] !== "number") return { value: null, currency: null };
  // Cents → major units. The documented Payment schema has no currency, so this
  // is normally null; it is read anyway because the API is explicitly additive.
  // Without one the zero-decimal rule cannot be applied, which is why the
  // catalog entry says the amount is Stripe's minor units divided by 100.
  return { value: p["amount_total"] / 100, currency: str(p["currency"])?.toUpperCase() ?? null };
}

function meetingEvent(e: Record<string, unknown>, connectionId: string, kind: Kind, at: Date | null, fallback?: Date): CanonicalEvent | null {
  const id = str(e["id"]);
  if (!id) return null;
  const money = kind === "booked" ? paid(e) : { value: null, currency: null };
  return {
    eventId: eventId("savvycal", connectionId, id) + (kind === "booked" ? "" : `:${kind}`),
    eventType: kind,
    subject: subjectOf(e),
    occurredAt: at ?? fallback ?? new Date(),
    ...money,
    // The Event object itself on BOTH paths, so `payment.state` and `start_at`
    // mean the same thing whether the row arrived by webhook or by poll.
    properties: e,
  };
}

export const savvycalConnector: Connector = {
  source: "savvycal",
  authType: "apiKey",
  operations: ["events.list"] as const,
  operationFor: () => "events.list",
  importProgress: walkImportProgress,
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    // Elixir's `Base.encode16()` emits UPPERCASE hex; Node's `digest("hex")` is
    // lower, and the comparison is constant-time and therefore case-sensitive.
    const provided = headers["x-savvycal-signature"];
    return hmacHeaderVerify(
      { rawBody, headers: { ...headers, "x-savvycal-signature": (provided ?? "").toLowerCase() }, secret },
      { header: "x-savvycal-signature", encoding: "hex", prefix: "sha256=" },
    );
  },
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const env = asObject(rawPayload);
    const e = asObject(env["payload"]);
    // "When the action occurred" on the envelope — the provider's own stamp for
    // this delivery, and a better fallback than the moment we happened to read it.
    const delivered = iso(env["occurred_at"], "occurred_at") ?? ctx.fallbackOccurredAt;
    let ev: CanonicalEvent | null = null;
    switch (str(env["type"])) {
      case "event.created":
      case "event.approved":
        // Both fire on approval; both are dated by created_at so the webhook and
        // the poll agree on one eventId with one date.
        if (NOT_BOOKED.has(String(e["state"]))) return [];
        ev = meetingEvent(e, ctx.connectionId, "booked", iso(e["created_at"], "created_at") ?? delivered ?? null, ctx.fallbackOccurredAt);
        break;
      case "event.canceled":
        ev = meetingEvent(e, ctx.connectionId, "canceled", iso(e["canceled_at"], "canceled_at") ?? delivered ?? null, ctx.fallbackOccurredAt);
        break;
      case "event.rescheduled":
        ev = meetingEvent(e, ctx.connectionId, "rescheduled", iso(e["rescheduled_at"], "rescheduled_at") ?? delivered ?? null, ctx.fallbackOccurredAt);
        break;
      // event.requested is a request awaiting the organizer, not a booking;
      // event.declined, event.changed, the checkout/attendee/poll/workflow
      // families and anything new fall through to nothing.
      default:
        return [];
    }
    return ev ? [ev] : [];
  },
  async poll(args: PollArgs): Promise<PollResult> {
    const client = api(args.credentials);
    const now = args.budget?.nowMs ?? Date.now;
    const capMs = now();
    const res = await windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      now,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await client.get<{ entries?: unknown[]; metadata?: { after?: string | null } }>("/events", {
          limit: PAGE,
          // `state` defaults to `confirmed`, which would hide every cancellation,
          // and `attendance` to `attending`, which would hide meetings the token's
          // user does not personally attend.
          state: "all",
          attendance: "any",
          period: "fixed",
          from: ymd(since),
          direction: "asc",
          after: cont ?? undefined,
        });
        const rows = (page.entries ?? []).map(asObject);
        return { rows, next: str(page.metadata?.after), rateLimit: client.rateLimit() };
      },
      // The watermark is `start_at` because `from` is what bounds the request —
      // clamped to now so one meeting booked for December cannot push the floor
      // past a meeting booked tomorrow for next week.
      changedAt: (e) => {
        const start = isoOrNull(e["start_at"]);
        return start && Date.parse(start) > capMs ? new Date(capMs).toISOString() : start;
      },
      happenedAt: (e) => isoOrNull(e["created_at"]),
      map: (e) => (NOT_BOOKED.has(String(e["state"])) ? null : meetingEvent(e, args.connectionId, "booked", iso(e["created_at"], "created_at"))),
    });
    // The poll sees an event's CURRENT state: every one of them was booked, a
    // canceled one also gets its cancellation, a moved one its reschedule.
    const extra: CanonicalEvent[] = [];
    for (const r of res.records) {
      const e = r.properties ?? {};
      const canceledAt = iso(e["canceled_at"], "canceled_at");
      if (canceledAt) {
        const c = meetingEvent(e, args.connectionId, "canceled", canceledAt);
        if (c) extra.push(c);
      }
      const rescheduledAt = iso(e["rescheduled_at"], "rescheduled_at");
      if (rescheduledAt) {
        const m = meetingEvent(e, args.connectionId, "rescheduled", rescheduledAt);
        if (m) extra.push(m);
      }
    }
    return { ...res, records: [...res.records, ...extra] };
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
};
