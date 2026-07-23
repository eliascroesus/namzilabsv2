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
/** How far back / forward a poll scan looks by meeting time (a rolling window). */
const BACKFILL_DAYS = 400;
const FUTURE_DAYS = 400;

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
  // Bookings are mutable state (reschedules edit a meeting in place), scanned
  // over a rolling meeting-time window — mirrored, with the window guarded by
  // inMirrorScope below so meetings outside it are never soft-deleted.
  syncStrategy: "mirror",

  /**
   * A mirror pass rescans meetings whose start_time lies in the rolling window.
   * A stored row outside that window (or whose start_time can't be parsed) was
   * not rescanned, so it must survive soft-delete.
   */
  inMirrorScope(row): boolean {
    const raw = row.properties?.["start_time"];
    const t = typeof raw === "string" ? Date.parse(raw) : NaN;
    if (Number.isNaN(t)) return false;
    const now = Date.now();
    return t >= now - BACKFILL_DAYS * 86_400_000 && t <= now + FUTURE_DAYS * 86_400_000;
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
    const target = await resolveTarget(token, args.config);
    const params = new URLSearchParams({ ...target, count: String(Math.min(n, 100)), sort: "start_time:desc" });
    const data = await fetchJson<CalendlyList>(`${API}/scheduled_events?${params.toString()}`, { headers: authHeader(token) });
    const tag = streamTag(args);
    return data.collection.map((ev) => bookedEvent(args.connectionId, tag, ev)).slice(0, n);
  },

  /** Live options for the Get data step's dynamic fields. "group" lists the token's
   *  Calendly groups (only shown when scope = A specific group). */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "groupUri") return [];
    const token = token_(args.credentials);
    const me = await fetchJson<{ resource: { current_organization: string } }>(`${API}/users/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const params = new URLSearchParams({ organization: me.resource.current_organization, count: "100" });
    const data = await fetchJson<{ collection: Array<{ uri: string; name?: string }> }>(
      `${API}/groups?${params.toString()}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    return (data.collection ?? []).map((g) => ({ value: g.uri, label: g.name ?? g.uri }));
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
  const target = await resolveTarget(token, args.config);
  const cur = parseCursor(rawCursor);
  const url = (pageToken?: string | null) => {
    const p = new URLSearchParams({ ...target, count: "100", sort: "start_time:asc", min_start_time: cur.floor, max_start_time: cur.ceil });
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

  const tag = streamTag(args);
  const records: CanonicalEvent[] = [];
  for (const ev of data.collection) {
    if (!str(ev["uri"])) continue;
    records.push(bookedEvent(args.connectionId, tag, ev));
    if (str(ev["status"]) === "canceled") records.push(canceledEvent(args.connectionId, tag, ev));
  }

  const next = data.pagination?.next_page_token ?? null;
  const nextCursor: string | null = next ? JSON.stringify({ floor: cur.floor, ceil: cur.ceil, pageToken: next } satisfies PollCursor) : null;
  return { records, nextCursor };
}

/** Parse the opaque cursor into a rolling window + page token; a fresh/legacy cursor
 *  starts a new window around now. */
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
    floor: new Date(now - BACKFILL_DAYS * 86_400_000).toISOString(),
    ceil: new Date(now + FUTURE_DAYS * 86_400_000).toISOString(),
    pageToken: null,
  };
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

/** Resolve the fetch scope from stream config (defaults to the user's own meetings) into
 *  the exact /scheduled_events target params (user, organization, or organization+group). */
async function resolveTarget(token: string, config?: Record<string, unknown> | null): Promise<Record<string, string>> {
  const me = await fetchJson<{ resource: { uri: string; current_organization: string } }>(`${API}/users/me`, {
    headers: authHeader(token),
  });
  const { scope, groupUri } = scopeOf(config);
  if (scope === "organization") return { organization: me.resource.current_organization };
  if (scope === "group" && groupUri) return { organization: me.resource.current_organization, group: groupUri };
  return { user: me.resource.uri };
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

