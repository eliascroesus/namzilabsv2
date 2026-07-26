import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  ListOptionsArgs,
  SourceOption,
} from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

const API = "https://api.calendly.com";
/**
 * The rolling window every Calendly stream reads, by MEETING time.
 *
 * The past half is deliberately short. It is the ONLY real lever on how much we
 * pull: `/scheduled_events` has no event-type filter, so the number of pages is
 * decided by scope × window and nothing else. Thirty days instead of a year is a
 * twelvefold cut in pages walked every sweep.
 *
 * The forward half stays generous: upcoming meetings are most of what a calendar
 * is asked about, and they arrive on the same pages.
 *
 * STORED DATA TRACKS THIS WINDOW. The poll declares it as `retireOutsideWindow`,
 * so rows that fall outside are retired rather than left stranded — narrowing
 * the window used to leave an older import sitting behind the new floor with a
 * gap in between, matching neither window.
 *
 * Reaching further BACK than this is a one-time historical import, not a wider
 * sweep — see PRE_LAUNCH_CHECKLIST.md item 9a (E.8 backfill lane).
 *
 * The window is captured in the cursor when a scan starts, so pagination stays
 * stable while it drains; a later sweep opens a fresh window around then-now.
 */
const PAST_DAYS = 30;
const FUTURE_DAYS = 365;

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

  /**
   * Every endpoint this connector can hit, each with its own budget in the
   * catalog. Calendly publishes 60 requests/minute (120 on Enterprise) — one
   * account-wide bucket in practice, but declaring them separately means raising
   * any single one later is a one-line change, and it keeps the catalog honest
   * about what we actually call.
   */
  operations: ["scheduled_events.list", "event_types.list", "groups.list"] as const,

  /**
   * A poll only ever reads scheduled events; the other two serve the config
   * pickers. Resolvable from config alone, before the call, as the contract
   * requires — a budget you can only check after spending the call is not one.
   */
  operationFor(): string {
    return "scheduled_events.list";
  },

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
    return pollScheduledEvents(args, args.cursor);
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    // Newest few meetings for a preview — one page, sorted by soonest-first, no cursor.
    const token = token_(args.credentials);
    const target = await resolveTarget(token, args.connectionId, args.config);
    const params = new URLSearchParams({ ...target, count: String(Math.min(n, 100)), sort: "start_time:desc" });
    const data = await fetchJson<CalendlyList>(`${API}/scheduled_events?${params.toString()}`, { headers: authHeader(token) });
    // Filters exactly as `poll` does, on the same config key and the same field.
    // These drifted once — the preview kept reading `eventTypeUri` and matching
    // `event_type` after the poll had moved on — so one config previewed one set
    // of meetings and synced another. tests/connectors-poll.test.ts pins them
    // together.
    const wanted = str(args.config?.["meetingType"]);
    const tag = streamTag(args);
    return data.collection
      .filter((ev) => !wanted || str(ev["name"]) === wanted)
      .map((ev) => bookedEvent(args.connectionId, tag, ev))
      .slice(0, n);
  },

  /**
   * `groupUri` — the token's Calendly groups (shown when scope = a group).
   * Groups are a paid-tier feature, so an empty list is a legitimate answer for
   * a plan that has none, not a failure.
   *
   * `meetingType` — the account's meeting types, DEDUPED BY NAME with the name
   * as the value. Calendly gives every host their own copy of a shared event
   * type, so an organization running one programme across three people has three
   * rows with identical names and different URIs; listing them raw put the same
   * label in the dropdown three times, each selecting one person's meetings.
   * Names collapse that to one honest choice.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    const token = token_(args.credentials);

    if (key === "groupUri") {
      const { organization } = await identity(token, args.connectionId);
      const params = new URLSearchParams({ organization, count: "100" });
      const data = await fetchJson<{ collection: Array<{ uri: string; name?: string }> }>(
        `${API}/groups?${params.toString()}`,
        { headers: authHeader(token) },
      );
      return (data.collection ?? []).map((g) => ({ value: g.uri, label: g.name ?? g.uri }));
    }

    if (key === "meetingType") {
      const me = await identity(token, args.connectionId);
      // Listed in the same scope the poll will use, so nobody is offered a type
      // their chosen scope cannot return.
      const { scope } = scopeOf(args.config);
      const params = new URLSearchParams(
        scope === "user" ? { user: me.uri, count: "100" } : { organization: me.organization, count: "100" },
      );
      const data = await fetchJson<{ collection: Array<{ uri: string; name?: string }> }>(
        `${API}/event_types?${params.toString()}`,
        { headers: authHeader(token) },
      );
      const names = new Set((data.collection ?? []).map((t) => t.name).filter((n): n is string => Boolean(n)));
      return [...names].sort().map((n) => ({ value: n, label: n }));
    }

    return [];
  },
};

type CalendlyList = { collection: Array<Record<string, unknown>>; pagination?: { next_page_token?: string | null } };
type PollCursor = { floor: string; ceil: string; pageToken?: string | null };

/**
 * Poll one page of scheduled events for a stream, walking Calendly's pagination across
 * calls. Unlike a naive newest-first fetch, this:
 *  - queries ALL statuses (no `status` filter) so it sees cancellations, not just live
 *    bookings — every meeting emits a "booked" event, and canceled ones ALSO emit a
 *    "canceled" event (its own id) so the booking→cancellation transition survives
 *    dedup-on-insert;
 *  - scans a rolling meeting-time window oldest-first and follows `next_page_token`, so
 *    the whole history imports instead of just the soonest ~50 meetings;
 *  - buckets a booking by `created_at` (when it was booked), keeping the meeting time in
 *    properties for use as a metric Time reference.
 * When a scan finishes the cursor drops to null, so the next sweep rescans the window
 * (reconciliation — dedup makes re-inserts cheap). Emitted ids are stream-tagged.
 */
async function pollScheduledEvents(args: PollArgs, rawCursor: string | null): Promise<PollResult> {
  const token = token_(args.credentials);
  const target = await resolveTarget(token, args.connectionId, args.config);
  const cur = parseCursor(rawCursor);
  const status = statusOf(args.config);
  const url = (pageToken?: string | null) => {
    const p = new URLSearchParams({ ...target, count: "100", sort: "start_time:asc", min_start_time: cur.floor, max_start_time: cur.ceil });
    // Sent only when the flow narrowed it. Omitted, Calendly returns every
    // status — which is what lets a cancellation be seen at all.
    if (status) p.set("status", status);
    if (pageToken) p.set("page_token", pageToken);
    return `${API}/scheduled_events?${p.toString()}`;
  };

  let data: CalendlyList;
  try {
    data = await fetchJson<CalendlyList>(url(cur.pageToken), { headers: authHeader(token) });
  } catch (e) {
    // A page token that expired between sweeps self-heals by restarting the scan.
    if (!cur.pageToken) throw e;
    data = await fetchJson<CalendlyList>(url(null), { headers: authHeader(token) });
  }

  // A STORAGE filter, and labelled as one in the UI.
  //
  // `/scheduled_events` has no event_type parameter, so this cannot reduce what
  // we pull — the pages fetched are identical either way. What it does is keep
  // the stored dataset to the one meeting type a flow is about, which is what
  // was asked for. Matched on the type's NAME so it catches every host's copy:
  // Calendly gives each person their own event_type row, so URI matching
  // narrowed an organization-wide read to whoever happened to be picked.
  //
  // `meeting_type`, `host_email` and the rest are still flattened onto every
  // record below, so a Filter step remains the way to slice a shared sync.
  const wanted = str(args.config?.["meetingType"]);
  const tag = streamTag(args);
  const records: CanonicalEvent[] = [];
  for (const ev of data.collection) {
    if (!str(ev["uri"])) continue;
    if (wanted && str(ev["name"]) !== wanted) continue;
    records.push(bookedEvent(args.connectionId, tag, ev));
    if (str(ev["status"]) === "canceled") records.push(canceledEvent(args.connectionId, tag, ev));
  }

  // Settle the unverified parts of this contract from production logs rather
  // than another guess (the same approach Instantly's probe takes): the docs
  // host is unreachable from CI, so what the response ACTUALLY contains is the
  // only evidence available. `returned=0` on an organization scope is the
  // signature of a token without org admin rights.
  if (!cur.pageToken) {
    console.log(
      `[calendly-probe] returned=${data.collection.length} paginated=${Boolean(data.pagination?.next_page_token)} ` +
        `scope=${Object.keys(target).join("+")} status=${status ?? "all"}`,
    );
  }

  const next = data.pagination?.next_page_token ?? null;
  const nextCursor: string | null = next ? JSON.stringify({ floor: cur.floor, ceil: cur.ceil, pageToken: next } satisfies PollCursor) : null;
  return {
    records,
    nextCursor,
    // Stored data tracks the window rather than only growing past it. Without
    // this, narrowing the history window left the older import stranded behind
    // the new floor with a gap in between — data matching neither window.
    // Safe because `occurredAt` is meeting start time, the same axis
    // min_start_time/max_start_time filter on.
    retireOutsideWindow: { from: new Date(cur.floor), to: new Date(cur.ceil) },
  };
}

/** Parse the opaque cursor into a rolling window + page token; a fresh/legacy cursor
 *  opens a new window around now. */
function parseCursor(raw: string | null): PollCursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Partial<PollCursor>;
      if (typeof c.floor === "string" && typeof c.ceil === "string") {
        return { floor: c.floor, ceil: c.ceil, pageToken: typeof c.pageToken === "string" ? c.pageToken : null };
      }
    } catch {
      // Not our JSON (e.g. a legacy timestamp cursor) — fall through to a fresh window.
    }
  }
  const now = Date.now();
  return {
    floor: new Date(now - PAST_DAYS * 86_400_000).toISOString(),
    ceil: new Date(now + FUTURE_DAYS * 86_400_000).toISOString(),
    pageToken: null,
  };
}

/** The `status` query param, or null for "every status" (the default). */
function statusOf(config?: Record<string, unknown> | null): "active" | "canceled" | null {
  const raw = str(config?.["status"]);
  return raw === "active" || raw === "canceled" ? raw : null;
}

/**
 * A Calendly record is dated by WHEN THE MEETING IS, not when it was booked.
 *
 * This was `created_at`, and the mismatch is the whole reason a 30-day window
 * appeared not to work. Calendly filters `/scheduled_events` by `start_time`, so
 * the window is a meeting-time window — but the stored `occurred_at` was booking
 * time. A standing meeting booked in August 2025 whose next occurrence is this
 * week is correctly INSIDE the window and displayed as August 2025. Nothing was
 * over-fetching; two different axes were being read as one.
 *
 * Meeting time is also what the user means. "The last 30 days and the upcoming
 * ones" is a statement about when meetings happen — a future meeting has a
 * future start and a past booking, and only this axis puts it in the future.
 *
 * Booking time is not lost: `booked_at` and `canceled_at` are on every record,
 * so "meetings booked per day" is still a metric anyone can build.
 */
function bookedEvent(connectionId: string, tag: string, ev: Record<string, unknown>): CanonicalEvent {
  return {
    eventId: `calendly:${connectionId}:${tag}${str(ev["uri"])}`,
    eventType: "booked",
    subject: str(ev["name"]) ?? null,
    occurredAt: parseDate(str(ev["start_time"])) ?? parseDate(str(ev["created_at"])) ?? new Date(),
    properties: { ...ev, ...meetingFacts(ev) },
  };
}

function canceledEvent(connectionId: string, tag: string, ev: Record<string, unknown>): CanonicalEvent {
  return {
    eventId: `calendly:${connectionId}:${tag}canceled:${str(ev["uri"])}`,
    eventType: "canceled",
    subject: str(ev["name"]) ?? null,
    // Same axis as the booking, deliberately: a cancellation belongs to the slot
    // it freed up, and both rows must sit inside the window that fetched them or
    // the retire below would tombstone one of them.
    occurredAt: parseDate(str(ev["start_time"])) ?? parseDate(str(ev["updated_at"])) ?? new Date(),
    properties: { ...ev, ...meetingFacts(ev) },
  };
}

/**
 * The things a flow narrows a Calendly dataset by, as flat fields.
 *
 * Narrowing moved out of ingest — it saved no API calls there, and cost a stream
 * per meeting type — so a Filter step is now the way to do it. That only works
 * if the axes are pickable, and two of them were not:
 *
 * - **Meeting type.** The raw payload carries it as `name`, which a picker shows
 *   as the ambiguous "name", and again as the canonical "Subject / person".
 *   Neither reads as the thing it is.
 * - **Host.** Buried in `event_memberships`, an array — so the picker could only
 *   offer it positionally (Item 1, Item 2), which is meaningless. This is the
 *   same shape as Google Calendar's attendee list, and gets the same treatment:
 *   flatten what the question is actually about.
 *
 * Host matters now in a way it did not before: whole-organization is the
 * recommended scope, and without this you cannot tell whose meeting a row is.
 */
function meetingFacts(ev: Record<string, unknown>): Record<string, unknown> {
  const memberships = Array.isArray(ev["event_memberships"]) ? (ev["event_memberships"] as Array<Record<string, unknown>>) : [];
  const host = memberships[0] ?? {};
  return {
    meeting_type: str(ev["name"]) ?? null,
    host_email: str(host["user_email"]) ?? null,
    host_name: str(host["user_name"]) ?? null,
    // The other time axis, kept explicit now that `occurred_at` is meeting time:
    // "meetings booked per day" is a different and equally real question.
    booked_at: str(ev["created_at"]) ?? null,
    canceled_at: str(ev["status"]) === "canceled" ? str(ev["updated_at"]) ?? null : null,
  };
}

function streamTag(args: PollArgs): string {
  // A meeting can be visible under more than one scope (e.g. "just me" and "whole
  // organization"); tag the id with the stream so each flow's stream keeps its own copy.
  return args.streamHash ? `${args.streamHash}:` : "";
}

type Identity = { uri: string; organization: string };

/**
 * `GET /users/me` answers "who is this token", which does not change. It was
 * being called on EVERY poll and every option listing — an extra provider call
 * per stream per sweep that the budget layer never counted, since a claim is
 * made per poll, not per HTTP request. A connection with six Calendly streams
 * was spending twelve calls a sweep to make six reads.
 *
 * Memoized per connection with a short TTL: a warm container reuses it, a cold
 * one pays once, and nothing goes stale for longer than the TTL.
 */
const IDENTITY_TTL_MS = 5 * 60_000;
const identityCache = new Map<string, { at: number; value: Identity }>();

async function identity(token: string, connectionId: string): Promise<Identity> {
  const hit = identityCache.get(connectionId);
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value;
  const me = await fetchJson<{ resource: { uri: string; current_organization: string } }>(`${API}/users/me`, {
    headers: authHeader(token),
  });
  const value: Identity = { uri: me.resource.uri, organization: me.resource.current_organization };
  identityCache.set(connectionId, { at: Date.now(), value });
  return value;
}

/** Resolve the fetch scope from stream config (defaults to the user's own meetings) into
 *  the exact /scheduled_events target params (user, organization, or organization+group). */
async function resolveTarget(
  token: string,
  connectionId: string,
  config?: Record<string, unknown> | null,
): Promise<Record<string, string>> {
  const me = await identity(token, connectionId);
  const { scope, groupUri } = scopeOf(config);
  if (scope === "organization") return { organization: me.organization };
  if (scope === "group" && groupUri) return { organization: me.organization, group: groupUri };
  return { user: me.uri };
}

function scopeOf(config?: Record<string, unknown> | null): { scope: "user" | "organization" | "group"; groupUri: string | null } {
  const raw = str(config?.["scope"]);
  const scope = raw === "organization" || raw === "group" ? raw : "user";
  return { scope, groupUri: str(config?.["groupUri"]) };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function token_(credentials?: Record<string, unknown> | null): string {
  const token = str(credentials?.["accessToken"]) ?? str(credentials?.["apiKey"]);
  if (!token) throw new Error("calendly: missing access token");
  return token;
}

