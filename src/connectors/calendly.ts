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
 * Both halves are deliberately short. The window is the ONLY real lever on how
 * much we pull: `/scheduled_events` has no event-type filter, so the number of
 * pages is decided by scope × window and nothing else. A year forward was a scan
 * a busy organization could not finish between sweeps, which meant its numbers
 * never settled; a quarter drains in one or two.
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
const FUTURE_DAYS = 90;

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
    // Newest few meetings for the connect-time preview — one page, no cursor.
    // Keeps no filter of its own, exactly as `poll` keeps none: meeting type is
    // a read filter now, so a connector-side copy could only disagree with it.
    // The two DID drift once, previewing one set of meetings and syncing
    // another; there is now nothing left to drift.
    const token = token_(args.credentials);
    const target = await resolveTarget(token, args.connectionId, args.config);
    const params = new URLSearchParams({ ...target, count: String(Math.min(n, 100)), sort: "start_time:desc" });
    const data = await fetchJson<CalendlyList>(`${API}/scheduled_events?${params.toString()}`, { headers: authHeader(token) });
    const tag = streamTag(args);
    return data.collection.map((ev) => bookedEvent(args.connectionId, tag, ev)).slice(0, n);
  },

  /**
   * `groupUri` — the token's Calendly groups (shown when scope = a group).
   * Groups are a paid-tier feature, so an empty list is a legitimate answer for
   * a plan that has none, not a failure.
   *
   * `meetingType` — ONE OPTION PER MEETING TYPE, valued by URI and labelled by
   * name. A name is a display detail, not an identity: two types can share one
   * (the same programme set up twice, a duplicated template) and they are still
   * two separate things a person must be able to choose between. Keying the
   * option by name collapsed them into a single entry that pulled both, which is
   * the opposite of what a picker is for.
   *
   * Same split Zapier's Calendly trigger uses — show the name, send the URI —
   * and the poll matches on `event_type`, the URI, accordingly. The label is the
   * name and nothing else; two rows can read alike, and that is fine, because
   * they are still two different types and each selects only its own meetings.
   *
   * Both listings walk their pagination. `count=100` is a page size, not a
   * result limit: an account past 100 event types lost the rest with no error,
   * which looks identical to a picker that cannot see them.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    const token = token_(args.credentials);

    if (key === "groupUri") {
      const { organization } = await identity(token, args.connectionId);
      const groups = await listAll<{ uri: string; name?: string }>(token, "/groups", { organization });
      return groups.map((g) => ({ value: g.uri, label: g.name ?? g.uri }));
    }

    if (key === "meetingType") {
      const me = await identity(token, args.connectionId);
      // Listed in the same scope the poll will use, so nobody is offered a type
      // their chosen scope cannot return.
      const { scope } = scopeOf(args.config);
      const types = await listAll<{ uri: string; name?: string }>(
        token,
        "/event_types",
        scope === "user" ? { user: me.uri } : { organization: me.organization },
      );
      return types
        .filter((t) => Boolean(t.uri))
        .map((t) => ({ value: t.uri, label: t.name ?? t.uri }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return [];
  },
};


/**
 * Every page of a Calendly list endpoint, not just the first.
 *
 * Bounded, because a config panel waiting on an unbounded walk is its own
 * failure: ten pages is 1000 rows, far past any real account's event types or
 * groups, and stopping there degrades to the old behavior rather than hanging.
 */
const MAX_OPTION_PAGES = 10;

async function listAll<T>(token: string, path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_OPTION_PAGES; page++) {
    const p = new URLSearchParams({ ...params, count: "100" });
    if (pageToken) p.set("page_token", pageToken);
    const data = await fetchJson<{ collection?: T[]; pagination?: { next_page_token?: string | null } }>(
      `${API}${path}?${p.toString()}`,
      { headers: authHeader(token) },
    );
    out.push(...(data.collection ?? []));
    pageToken = data.pagination?.next_page_token ?? null;
    if (!pageToken) break;
  }
  return out;
}

type CalendlyList = { collection: Array<Record<string, unknown>>; pagination?: { next_page_token?: string | null } };

type Side = "past" | "future";

/**
 * A scan's whole state: the window it is draining, the instant it calls "now",
 * and one page token per direction.
 *
 * `undefined` = that side has not started, `null` = it is drained. All three
 * boundaries are pinned when the scan starts, so pagination stays stable while
 * it runs and a later sweep opens a fresh window around then-now.
 */
type PollCursor = {
  floor: string;
  ceil: string;
  pivot: string;
  past?: string | null;
  future?: string | null;
  next: Side;
};

/**
 * Poll one page of scheduled events, walking Calendly's pagination across calls.
 *
 *  - Queries ALL statuses (no `status` filter) unless the flow narrowed it, so
 *    cancellations are seen: every meeting emits a "booked" event, and canceled
 *    ones ALSO emit a "canceled" event with its own id, so the booking →
 *    cancellation transition survives dedup-on-insert.
 *  - **Scans OUTWARD FROM NOW, alternating direction.** The past side runs
 *    `start_time:desc` from the pivot (most recent meeting first); the future
 *    side runs `start_time:asc` from the pivot (soonest first); each call takes
 *    one page from whichever side is next and not yet drained.
 *  - Emits ids tagged with the stream.
 *
 * The alternation is the point. This used to run `start_time:asc` from the
 * window's floor, so the first pages were the OLDEST meetings in it — a 4-page
 * Test on a busy account returned 400 meetings from a month ago and nothing
 * else, while "Latest 3 records" showed appointments two weeks stale and every
 * upcoming meeting was missing. Whatever budget a scan gets, it should be spent
 * on the meetings nearest to now in both directions, because those are the ones
 * anyone is looking at.
 *
 * The cursor goes null only when BOTH sides are drained, which is what makes the
 * next sweep rescan the window (reconciliation — dedup makes re-inserts cheap).
 */
async function pollScheduledEvents(args: PollArgs, rawCursor: string | null): Promise<PollResult> {
  const token = token_(args.credentials);
  const target = await resolveTarget(token, args.connectionId, args.config);
  const cur = parseCursor(rawCursor, args.windowFloor ?? null);
  const status = statusOf(args.config);

  // Whichever side is due, unless it is finished — then the other one. Both
  // finished cannot reach here: that returns a null cursor and starts over.
  const side: Side = drained(cur, cur.next) ? other(cur.next) : cur.next;
  const url = (pageToken?: string | null) => {
    const p = new URLSearchParams({
      ...target,
      count: "100",
      ...(side === "past"
        ? { sort: "start_time:desc", min_start_time: cur.floor, max_start_time: cur.pivot }
        : { sort: "start_time:asc", min_start_time: cur.pivot, max_start_time: cur.ceil }),
    });
    // Sent only when the flow narrowed it. Omitted, Calendly returns every
    // status — which is what lets a cancellation be seen at all.
    if (status) p.set("status", status);
    if (pageToken) p.set("page_token", pageToken);
    return `${API}/scheduled_events?${p.toString()}`;
  };

  const token_in = cur[side] ?? null;
  let data: CalendlyList;
  try {
    data = await fetchJson<CalendlyList>(url(token_in), { headers: authHeader(token) });
  } catch (e) {
    // A page token that expired between sweeps self-heals by restarting that side.
    if (!token_in) throw e;
    data = await fetchJson<CalendlyList>(url(null), { headers: authHeader(token) });
  }

  // Every meeting the window returns is stored. Narrowing to one meeting type is
  // a READ filter now (catalog `readFilter`), applied by the engine over a sync
  // every flow on this connection shares — filtering here bought no API calls
  // (there is no event_type parameter) and cost a stream, a cursor and a
  // duplicate row per type, so a freshly-picked type read 0 until its own scan
  // caught up.
  const tag = streamTag(args);
  const records: CanonicalEvent[] = [];
  let typed = 0;
  for (const ev of data.collection) {
    if (!str(ev["uri"])) continue;
    if (str(ev["event_type"])) typed += 1;
    records.push(bookedEvent(args.connectionId, tag, ev));
    if (str(ev["status"]) === "canceled") records.push(canceledEvent(args.connectionId, tag, ev));
  }

  // Settle the unverified parts of this contract from production logs rather
  // than another guess (the same approach Instantly's probe takes): the docs
  // host is unreachable from CI, so what the response ACTUALLY contains is the
  // only evidence available. `returned=0` on an organization scope is the
  // signature of a token without org admin rights.
  //
  // `typed` counts returned events carrying an `event_type` URI — the field the
  // meeting-type read filter matches on. `typed` well below `returned` is the
  // one way that filter could quietly show nothing, and it belongs in a log
  // rather than being inferred from an empty dashboard.
  if (!token_in) {
    console.log(
      `[calendly-probe] side=${side} returned=${data.collection.length} typed=${typed} ` +
        `paginated=${Boolean(data.pagination?.next_page_token)} scope=${Object.keys(target).join("+")} status=${status ?? "all"}`,
    );
  }

  // Advance this side, then hand the turn to the other one.
  const advanced: PollCursor = { ...cur, [side]: data.pagination?.next_page_token ?? null, next: other(side) };
  const done = drained(advanced, "past") && drained(advanced, "future");
  return {
    records,
    nextCursor: done ? null : JSON.stringify(advanced),
    // Stored data tracks the window rather than only growing past it. Without
    // this, narrowing the history window left the older import stranded behind
    // the new floor with a gap in between — data matching neither window.
    // Safe because `occurredAt` is meeting start time, the same axis
    // min_start_time/max_start_time filter on.
    retireOutsideWindow: { from: new Date(cur.floor), to: new Date(cur.ceil) },
  };
}

const other = (side: Side): Side => (side === "past" ? "future" : "past");

/** A side is drained once it has run and come back with no next page. */
function drained(cur: PollCursor, side: Side): boolean {
  return side in cur && cur[side] === null;
}

/**
 * Parse the opaque cursor into a scan state; a fresh/legacy cursor opens a new
 * window around now.
 *
 * `windowFloor` is the stream's own reach when it has one — a backfill that
 * deepened it past the default. It feeds the SAME value into the request bound
 * and into the `retireOutsideWindow` this poll declares, which is the property
 * 6.2 exists for: were the two derived separately, a deepened import would be
 * fetched and then immediately tombstoned by its own declaration.
 *
 * Only ever widens. A floor NEWER than the default would narrow the window and
 * silently retire history the stream is supposed to hold, so a nonsensical
 * value degrades to the default rather than destroying anything.
 */
function parseCursor(raw: string | null, windowFloor: Date | null = null): PollCursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Partial<PollCursor>;
      // `pivot` is required, so a cursor from before the scan became two-sided
      // restarts rather than being read as a half-finished one.
      if (typeof c.floor === "string" && typeof c.ceil === "string" && typeof c.pivot === "string") {
        return {
          floor: c.floor,
          ceil: c.ceil,
          pivot: c.pivot,
          ...("past" in c ? { past: typeof c.past === "string" ? c.past : null } : {}),
          ...("future" in c ? { future: typeof c.future === "string" ? c.future : null } : {}),
          next: c.next === "future" ? "future" : "past",
        };
      }
    } catch {
      // Not our JSON (e.g. a legacy timestamp cursor) — fall through to a fresh window.
    }
  }
  const now = Date.now();
  const defaultFloor = now - PAST_DAYS * 86_400_000;
  const requested = windowFloor?.getTime();
  const floor = requested != null && Number.isFinite(requested) ? Math.min(requested, defaultFloor) : defaultFloor;
  return {
    floor: new Date(floor).toISOString(),
    ceil: new Date(now + FUTURE_DAYS * 86_400_000).toISOString(),
    pivot: new Date(now).toISOString(),
    // Recent past first: "the latest records" is the question a preview answers,
    // and a meeting that already happened is the one a person recognises.
    next: "past",
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

