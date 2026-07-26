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
 * Fixed rather than configurable: a per-flow "days of history" box asked the
 * user to tune something they have no way to reason about, and every honest
 * answer to "how far back should this go" is "far enough". A year covers any
 * quarter-over-quarter question, and the forward half is generous because
 * upcoming meetings are most of what a calendar is asked about and cost nothing
 * extra — they arrive on the same pages.
 *
 * The window is captured in the cursor when a scan starts, so pagination stays
 * stable while it drains; a later sweep opens a fresh window around then-now.
 */
const PAST_DAYS = 365;
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
    const wanted = str(args.config?.["eventTypeUri"]);
    const tag = streamTag(args);
    return data.collection
      .filter((ev) => !wanted || str(ev["event_type"]) === wanted)
      .map((ev) => bookedEvent(args.connectionId, tag, ev))
      .slice(0, n);
  },

  /**
   * Live options for the Get data step's dynamic fields.
   *
   * - `groupUri` — the token's Calendly groups (shown when scope = a group).
   *   Groups are a paid-tier feature, so an empty list here is a legitimate
   *   answer for a plan that has none, not a failure.
   * - `eventTypeUri` — the account's meeting types ("30 Minute Meeting", …).
   *   Deliberately NOT called "event type" in the UI: that name already means
   *   the canonical booked/canceled/no_show in this product.
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
      // Scope the listing the same way the poll will be scoped, so the user is
      // never offered a meeting type their chosen scope cannot return.
      const { scope } = scopeOf(args.config);
      const params = new URLSearchParams(
        scope === "user" ? { user: me.uri, count: "100" } : { organization: me.organization, count: "100" },
      );
      const data = await fetchJson<{ collection: Array<{ uri: string; name?: string }> }>(
        `${API}/event_types?${params.toString()}`,
        { headers: authHeader(token) },
      );
      // DEDUPED BY NAME, and the name is the value.
      //
      // Calendly gives every host their own copy of a shared event type, so an
      // organization running one programme across three people has three
      // `event_types` rows with identical names and different URIs. Listing them
      // raw put the same label in the dropdown two or three times; picking one
      // silently narrowed to a single host, and the poll then matched almost
      // nothing — the whole-organization scope was returning zero for exactly
      // this reason while "just me" (one host, one copy) worked.
      //
      // A scheduled event carries its type's NAME in `name`, so matching on that
      // catches every host's copy at once, which is what picking "NAMZI Invite
      // Only Creator Program" plainly means. The cost is that renaming the type
      // in Calendly orphans the filter — visible, and far better than a filter
      // that is wrong from the first day on any multi-host account.
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

  const wanted = str(args.config?.["meetingType"]);
  const tag = streamTag(args);
  const records: CanonicalEvent[] = [];
  let dropped = 0;
  for (const ev of data.collection) {
    if (!str(ev["uri"])) continue;
    // Calendly's /scheduled_events has no event_type query parameter — the type
    // is a field on each returned event, so this narrows what we STORE and what
    // flows compute over, not how many calls we make. Scope and window are what
    // reduce calls. Stated here because the difference is invisible in the UI.
    //
    // Matched on the type's NAME (`ev.name`), not its URI: Calendly gives each
    // host their own copy of a shared event type, so URI matching silently
    // narrowed an organization-wide read to one person's meetings. See
    // listOptions("meetingType").
    if (wanted && str(ev["name"]) !== wanted) {
      dropped += 1;
      continue;
    }
    records.push(bookedEvent(args.connectionId, tag, ev));
    if (str(ev["status"]) === "canceled") records.push(canceledEvent(args.connectionId, tag, ev));
  }

  // Settle the unverified parts of this contract from production logs rather
  // than another guess (the same approach Instantly's probe takes): the docs
  // host is unreachable from CI, so what the response ACTUALLY contains is the
  // only evidence available.
  if (!cur.pageToken) {
    console.log(
      `[calendly-probe] returned=${data.collection.length} paginated=${Boolean(data.pagination?.next_page_token)} ` +
        `scope=${Object.keys(target).join("+")} status=${status ?? "all"} eventTypeFilter=${wanted ? "on" : "off"} dropped=${dropped}`,
    );
  }

  const next = data.pagination?.next_page_token ?? null;
  const nextCursor: string | null = next ? JSON.stringify({ floor: cur.floor, ceil: cur.ceil, pageToken: next } satisfies PollCursor) : null;
  return { records, nextCursor };
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

function bookedEvent(connectionId: string, tag: string, ev: Record<string, unknown>): CanonicalEvent {
  const start = parseDate(str(ev["start_time"]));
  return {
    eventId: `calendly:${connectionId}:${tag}${str(ev["uri"])}`,
    eventType: "booked",
    subject: str(ev["name"]) ?? null,
    occurredAt: parseDate(str(ev["created_at"])) ?? start ?? new Date(),
    properties: ev,
  };
}

function canceledEvent(connectionId: string, tag: string, ev: Record<string, unknown>): CanonicalEvent {
  const start = parseDate(str(ev["start_time"]));
  return {
    eventId: `calendly:${connectionId}:${tag}canceled:${str(ev["uri"])}`,
    eventType: "canceled",
    subject: str(ev["name"]) ?? null,
    occurredAt: parseDate(str(ev["updated_at"])) ?? start ?? new Date(),
    properties: ev,
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

