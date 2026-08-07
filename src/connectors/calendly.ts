import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  ListOptionsArgs,
  SourceOption,
  RegisterWebhookArgs,
  RegisterWebhookResult,
  VerifyWebhookArgs,
  VerifyWebhookResult,
} from "./types";
import { hmacSha256Hex, safeEqual, timestampFreshness } from "@/lib/signatures";
import { fetchJson, HttpError } from "@/lib/http-client";
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

/** Consecutive restarts before a side is reported as not advancing. */
const RESTART_ALARM = 2;
/** The page size every scan request asks for. */
const COUNT_PER_PAGE = 100;

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

  /**
   * NO `holdsContinuation`, deliberately — this connector no longer stores one.
   *
   * It used to hold Calendly's `next_page` URL across sweeps, and CL13 measured
   * why that could never be reliable: the URL survives 600s and is rejected by
   * 1200s, while the sweep gap is 600-1200s. The brackets intersect, so some
   * sweeps restarted at page 1 silently — the restart SUCCEEDED, which is what
   * made it invisible. The cursor now stores date watermarks (see PollCursor),
   * which cannot expire, and the mid-scan cadence hold rides `incomplete`
   * instead, which the runner reads since b8ff1a7.
   */

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false; // Calendly always signs when a key is configured.
    const header = headers["calendly-webhook-signature"];
    if (!header) return false;
    const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=").map((s) => s.trim())));
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) return false;
    const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
    if (!safeEqual(v1, expected)) return false;
    // Replay protection: `t` is unix seconds inside the signed payload, so a
    // valid HMAC over a stale `t` proves only that Calendly sent this once.
    // Calendly's own verification example enforces a tolerance (3 minutes);
    // ours is the shared 5-minute window. "unparseable" accepts — see
    // timestampFreshness for why a format surprise must not become a 100%
    // rejection.
    return timestampFreshness(t) !== "stale";
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
      parseDate(str(scheduled["start_time"]), "start_time") ?? parseDate(str(body["created_at"]), "created_at") ?? new Date();
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

  /**
   * One ORG-scoped subscription covering every event type we map — org scope
   * so one registration serves all of a connection's streams, whatever their
   * per-flow scope. Calendly returns `signing_key` exactly once, at creation
   * (Close's shape); `createConnection` stores it encrypted and the webhook
   * route verifies every delivery against it.
   *
   * Webhooks are plan-gated (Standard+). A 4xx here is NOT a broken
   * connection — polling is the primary path and unaffected — which is why
   * the catalog marks Calendly `webhookOptional` and `createConnection`
   * degrades instead of erroring.
   */
  async registerWebhook(args: RegisterWebhookArgs): Promise<RegisterWebhookResult> {
    const token = token_(args.credentials);
    const me = await identity(token, args.connectionId);
    const res = await fetchJson<{ resource: { uri: string; signing_key?: string } }>(`${API}/webhook_subscriptions`, {
      method: "POST",
      headers: { ...authHeader(token), "content-type": "application/json" },
      body: JSON.stringify({
        url: args.webhookUrl,
        organization: me.organization,
        scope: "organization",
        events: Object.keys(EVENT_TYPE_MAP),
      }),
    });
    return { signingSecret: res.resource.signing_key, externalId: res.resource.uri };
  },

  /**
   * D.6 for Calendly. Active subscription at our URL → healthy. Missing and
   * the endpoint is not refusing deliveries → RE-CREATE and hand the new
   * signing key back for the caller to persist (`VerifyWebhookResult`
   * gained the field for exactly this: Calendly has no re-activate verb, so
   * re-creation is the only self-heal, and a re-created subscription's key
   * is new). Missing while deliveries were recently rejected → report only,
   * same guard as Close: re-subscribing an endpoint that is refusing
   * deliveries manufactures more refusals. Plan-gated 4xx → `unsupported`,
   * which the caller treats as "no health signal", never as failure.
   */
  async verifyWebhookSubscription(args: VerifyWebhookArgs): Promise<VerifyWebhookResult> {
    const token = token_(args.credentials);
    try {
      const me = await identity(token, args.connectionId);
      const params = new URLSearchParams({ organization: me.organization, scope: "organization", count: "100" });
      const list = await fetchJson<{ collection: Array<{ uri: string; callback_url: string; state: string }> }>(
        `${API}/webhook_subscriptions?${params.toString()}`,
        { headers: authHeader(token) },
      );
      const mine = list.collection.find((s) => s.callback_url === args.webhookUrl);
      if (mine && mine.state === "active") return { healthy: true, reregistered: false };

      if (args.recentlyRejecting) {
        return {
          healthy: false,
          reregistered: false,
          detail: "Calendly subscription missing, and recent deliveries were refused — fix the endpoint before re-subscribing.",
        };
      }
      const created = await this.registerWebhook!({
        connectionId: args.connectionId,
        webhookUrl: args.webhookUrl,
        credentials: args.credentials ?? {},
      });
      return { healthy: true, reregistered: true, signingSecret: created.signingSecret, externalId: created.externalId };
    } catch (e) {
      // Plan gating surfaces as 4xx on the subscriptions endpoints. Not a
      // failure: the poll path is primary and untouched.
      if (e instanceof HttpError && (e.status === 401 || e.status === 402 || e.status === 403)) {
        return { healthy: false, reregistered: false, unsupported: true, detail: "Calendly webhooks need a Standard+ plan; polling continues." };
      }
      return { healthy: false, reregistered: false, detail: e instanceof Error ? e.message : String(e) };
    }
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

/**
 * FOLLOW THE URL CALENDLY GIVES YOU. Never rebuild one from `next_page_token`.
 *
 * Calendly's pagination object carries two continuations: `next_page_token`, an
 * opaque string, and `next_page`, a complete ready-to-call URL. This connector
 * used the token at both of its pagination sites and rebuilt a request around
 * it. **The rebuild is rejected in every form.** Verified live, 2026-08-03:
 *
 *   - CL12 sent `next_page` verbatim → ACCEPTED, 100 events. Sent the same
 *     token rebuilt three ways — full query, token only, token appended
 *     unencoded → all three HTTP 400 `{"parameter":"page_token"}`.
 *   - CL10 sent the token back MILLISECONDS after it was issued, with and
 *     without the query it came from. Both refused. So it is not expiry, not
 *     single-use, and not timestamp precision — the second arm carried no
 *     timestamps at all.
 *   - CL8 walked a wide span through `next_page` at two page sizes: 9 pages at
 *     count=10 and 3 at count=30 returned the same 90 records with zero
 *     duplicates. Two walks with completely different page boundaries agreeing
 *     is also why the `sort` parameter's absence from Calendly's own URL is
 *     cosmetic — the order is carried inside the continuation, not in the
 *     query string.
 *
 * TWO CONSUMERS NOW, WITH DIFFERENT RIGHTS. `listAll` (the config pickers)
 * still follows `next_page` — within one call, which CL8 backs. The POLL reads
 * it only as a boolean ("is this side drained?") and never follows or stores
 * it: CL13 measured the URL surviving 600s and dying by 1200s, inside the
 * sweep gap, so a continuation that crosses a sweep is a coin toss and the
 * poll resumes by date watermark instead.
 */
const nextPage = (p?: { next_page?: string | null } | null): string | null => {
  const url = p?.next_page;
  if (typeof url !== "string" || url === "") return null;
  /**
   * ORIGIN CHECK before the URL is stored or followed. A `next_page` is
   * fetched verbatim with the customer's bearer token attached, and one exit
   * (`parseCursor`) PERSISTS it in the stream cursor, where it is re-fetched
   * every sweep — so a URL pointing anywhere but Calendly's API would ship
   * the customer's PAT to an arbitrary host, from inside our runtime, on a
   * schedule. Every legitimate continuation Calendly has ever returned is an
   * absolute URL on this origin (verified live alongside CL12); anything
   * else is treated as "no next page", which ends the walk exactly like a
   * drained scan and costs nothing but a restart.
   */
  try {
    if (new URL(url).origin !== new URL(API).origin) {
      console.warn(`[calendly] refusing off-origin next_page URL: ${url.slice(0, 120)}`);
      return null;
    }
  } catch {
    return null; // not parseable as an absolute URL — not a continuation
  }
  return url;
};

async function listAll<T>(token: string, path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = `${API}${path}?${new URLSearchParams({ ...params, count: "100" }).toString()}`;
  for (let page = 0; page < MAX_OPTION_PAGES && next; page++) {
    const data: { collection?: T[]; pagination?: { next_page?: string | null } } = await fetchJson(next, {
      headers: authHeader(token),
    });
    out.push(...(data.collection ?? []));
    next = nextPage(data.pagination);
  }
  return out;
}

type CalendlyList = { collection: Array<Record<string, unknown>>; pagination?: { next_page?: string | null } };

type Side = "past" | "future";

/**
 * A scan's whole state: the window it is draining, the instant it calls "now",
 * and one DATE WATERMARK per direction.
 *
 * `undefined` = that side has not started, `null` = it is drained, a string =
 * mid-walk. The three-state meaning is the one this cursor has always had; what
 * the string CONTAINS has now changed twice, and the second change is the one
 * that removes the failure class instead of shrinking it.
 *
 * It held a `page_token` (rejected in every rebuilt form — CL10/CL12), then
 * Calendly's own `next_page` URL — which CL13 measured surviving 600s and being
 * rejected at 1200s, against a sweep gap of 600-1200s. Those brackets
 * intersect: some sweeps restarted at page 1, silently, because the restart
 * succeeded. No continuation lifetime we can influence fixes that. So no
 * continuation crosses a sweep at all.
 *
 * The watermark is the boundary `start_time` of ground actually ingested:
 * lowest seen for the past side, highest for the future side. Each poll issues
 * a FRESH first-page request bounded by the mark, so nothing perishable is
 * ever stored — a date cannot expire. That resume-by-bound works here for a
 * reason that does not generalise: the walk is strictly monotonic in the sort
 * direction and `start_time` is IMMUTABLE (a meeting's start does not drift
 * when edited), so the mark only ever moves to the edge of ground already
 * read. Close cannot do this — its axis (`date_updated`) is mutable, so a
 * record can appear below a mark that already passed, which is why its mark
 * only promotes on drain.
 *
 * THE BOUND IS EXACT, not padded. CL15 measured BOTH `min_start_time` and
 * `max_start_time` as INCLUSIVE, so a request bounded at mark L re-reads the
 * tie group AT L (meetings sharing that exact start) and `event_id` dedup
 * absorbs the repeats. An earlier draft padded by one second to be safe under
 * either reading; the measurement made the padding dead weight.
 */
type PollCursor = {
  floor: string;
  ceil: string;
  pivot: string;
  past?: string | null;
  future?: string | null;
  next: Side;
  /**
   * Consecutive polls where a side ingested a page and its watermark DID NOT
   * MOVE (and the side did not drain).
   *
   * The counter that used to count rejected continuations, repurposed rather
   * than deleted, because the residual risk changed shape but not severity: a
   * tie group larger than one page (hundreds of meetings sharing one exact
   * start second) pins the mark inside that instant, and the scan re-reads it
   * every sweep — silently, without this. Lives in the cursor because a poll
   * sees no state between sweeps except what it persisted; cleared by any poll
   * that advanced or drained, so it only ever counts a RUN.
   */
  restarts?: number;
};

/**
 * Poll one page of scheduled events, resuming BY DATE BOUND rather than by
 * continuation.
 *
 *  - Queries ALL statuses (no `status` filter) unless the flow narrowed it, so
 *    cancellations are seen: every meeting emits a "booked" event, and canceled
 *    ones ALSO emit a "canceled" event with its own id, so the booking →
 *    cancellation transition survives dedup-on-insert.
 *  - **Scans OUTWARD FROM NOW, alternating direction.** The past side runs
 *    `start_time:desc` from the pivot down toward the floor; the future side
 *    runs `start_time:asc` from the pivot up toward the ceiling; each call
 *    takes one page from whichever side is next and not yet drained.
 *  - EVERY request is a first-page request. The past side is bounded above by
 *    its watermark (the lowest `start_time` already ingested), the future side
 *    below by its own (the highest). Calendly's `next_page` URL is read only to
 *    answer "is this side drained?" and never stored — CL13 measured it dying
 *    between sweeps, silently, because the page-1 restart succeeds.
 *
 * A side is DRAINED when its bounded request comes back with no `next_page`.
 * The bound is `[floor, mark]` (or `[mark, ceil]`), so no next page means the
 * provider returned everything left inside it — a within-response signal,
 * evaluated in the same response that produced it, never carried anywhere.
 *
 * The alternation is the point. This used to run `start_time:asc` from the
 * window's floor, so the first pages were the OLDEST meetings in it — a 4-page
 * Test on a busy account returned 400 meetings from a month ago and nothing
 * else. Whatever budget a scan gets, it should be spent on the meetings nearest
 * to now in both directions, because those are the ones anyone is looking at.
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
  const mark = cur[side] ?? null;
  /**
   * The side's current resume bound: its watermark, or the pivot before the
   * first page. `sort`, `status`, scope and the bounds are all set fresh on
   * every request — there is no other request shape left.
   */
  const bound = mark ?? cur.pivot;
  const p = new URLSearchParams({
    ...target,
    count: String(COUNT_PER_PAGE),
    ...(side === "past"
      ? { sort: "start_time:desc", min_start_time: cur.floor, max_start_time: bound }
      : { sort: "start_time:asc", min_start_time: bound, max_start_time: cur.ceil }),
  });
  // Sent only when the flow narrowed it. Omitted, Calendly returns every
  // status — which is what lets a cancellation be seen at all.
  if (status) p.set("status", status);
  const data = await fetchJson<CalendlyList>(`${API}/scheduled_events?${p.toString()}`, { headers: authHeader(token) });

  // Every meeting the window returns is stored. Narrowing to one meeting type is
  // a READ filter now (catalog `readFilter`), applied by the engine over a sync
  // every flow on this connection shares — filtering here bought no API calls
  // (there is no event_type parameter) and cost a stream, a cursor and a
  // duplicate row per type, so a freshly-picked type read 0 until its own scan
  // caught up.
  const tag = streamTag(args);
  const records: CanonicalEvent[] = [];
  let typed = 0;
  /**
   * The page's extreme `start_time` in this side's walk direction, computed
   * over PARSED values rather than trusted from response order. CL4 verified
   * both sorts are honoured live, but a mark derived positionally would be
   * silently wrong the day that stops being true, and min/max over the page
   * costs nothing.
   */
  let edge: number | null = null;
  for (const ev of data.collection) {
    if (!str(ev["uri"])) continue;
    if (str(ev["event_type"])) typed += 1;
    records.push(bookedEvent(args.connectionId, tag, ev));
    if (str(ev["status"]) === "canceled") records.push(canceledEvent(args.connectionId, tag, ev));
    const t = Date.parse(str(ev["start_time"]) ?? "");
    if (Number.isFinite(t)) edge = edge == null ? t : side === "past" ? Math.min(edge, t) : Math.max(edge, t);
  }

  // Settle the unverified parts of this contract from production logs rather
  // than another guess: the docs host is unreachable from CI, so what the
  // response ACTUALLY contains is the only evidence available. `returned=0` on
  // an organization scope is the signature of a token without org admin rights.
  // Logged on a side's first page only, so a draining walk stays one line.
  if (mark == null) {
    console.log(
      `[calendly-probe] side=${side} returned=${data.collection.length} typed=${typed} ` +
        `paginated=${Boolean(nextPage(data.pagination))} scope=${Object.keys(target).join("+")} status=${status ?? "all"}`,
    );
  }

  const sideDrained = nextPage(data.pagination) == null;
  /**
   * Did this page move the mark? Bounds are inclusive (CL15), so the tie group
   * AT the mark is re-read on every resume and the new edge can EQUAL the old
   * bound — that is the re-read working, not progress. Only a strict move in
   * the walk direction counts.
   */
  const boundMs = Date.parse(bound);
  const advancedMark = edge != null && (side === "past" ? edge < boundMs : edge > boundMs);

  /**
   * A SIDE THAT KEEPS NOT ADVANCING IS PINNED, and says so.
   *
   * With a per-page watermark the one way a scan stops making progress is a tie
   * group larger than the page: every meeting on the page shares the boundary
   * second, the mark cannot move past the instant, and the same page re-reads
   * every sweep. Narrow — the tie census measured 100 events / 100 distinct
   * starts on the live account — but silent, which is the shape this codebase
   * keeps paying for. If this alarm ever fires the escalation is to follow
   * `next_page` WITHIN the single poll to walk the tie group (fresh
   * continuation, nothing stored); not built until the alarm says it happens.
   */
  const restarts = sideDrained || advancedMark ? 0 : (cur.restarts ?? 0) + 1;
  if (restarts >= RESTART_ALARM) {
    console.warn(
      `[calendly-probe] ${side} side has not advanced for ${restarts} polls — the watermark is pinned at ` +
        `${bound} with more pages behind it. A tie group larger than ${COUNT_PER_PAGE} meetings at one ` +
        `start second is the known cause; the escalation is walking next_page within a single poll.`,
    );
  }

  const advanced: PollCursor = {
    ...cur,
    [side]: sideDrained ? null : advancedMark ? new Date(edge!).toISOString() : bound,
    next: other(side),
    ...(restarts > 0 ? { restarts } : { restarts: undefined }),
  };
  const done = drained(advanced, "past") && drained(advanced, "future");

  return {
    records,
    nextCursor: done ? null : JSON.stringify(advanced),
    /**
     * `incomplete` comes from the ALARM only, never from "mid-scan". The
     * runner owns the mid-scan signal: it walks pages within a sweep and sets
     * `incomplete` itself when the budget runs out with the cursor still live
     * (`page === maxPages - 1` in streams.ts), while a scan that drains inside
     * the budget breaks on the null cursor first. A blanket `!done` here would
     * be ORed across pages and taint a sweep whose LAST page finished the scan
     * — reporting a completed walk as partial, skipping the window retire, and
     * telling a Test the import never finishes. The cadence hold that
     * `holdsContinuation` used to provide is therefore the runner's
     * budget-exhaustion signal, which fires on exactly the sweeps that end
     * mid-scan.
     */
    ...(restarts >= RESTART_ALARM ? { incomplete: true } : {}),
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
/**
 * A stored side value from EITHER previous cursor generation: the `page_token`
 * era (opaque strings, rejected in every rebuilt form) or the `next_page`-URL
 * era (perishable — CL13 measured rejection between sweeps). A valid side value
 * is now a date watermark, so the test is simply "does it parse as a date":
 * URLs and tokens parse to NaN, ISO timestamps do not. Inverted from the last
 * migration, where a URL was the NEW shape.
 *
 * `undefined` (side not started) and `null` (side drained) are not marks at all
 * and must pass through untouched — were either mistaken for the old shape,
 * every healthy cursor in the fleet would be discarded on the first sweep after
 * deploy.
 */
const isLegacyContinuation = (v: unknown): boolean => typeof v === "string" && !Number.isFinite(Date.parse(v));

function parseCursor(raw: string | null, windowFloor: Date | null = null): PollCursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Partial<PollCursor>;
      // `pivot` is required, so a cursor from before the scan became two-sided
      // restarts rather than being read as a half-finished one.
      if (typeof c.floor === "string" && typeof c.ceil === "string" && typeof c.pivot === "string") {
        /**
         * A CURSOR HOLDING A CONTINUATION IS DISCARDED WHOLE, not repaired —
         * same rule as the last migration, same reason, one generation on.
         *
         * A stored `next_page` URL means the scan was mid-walk when this code
         * deployed, and `done` never fired while continuations were failing —
         * so `floor`/`ceil`/`pivot` may be frozen at whenever the scan first
         * started. Re-using them would keep reading a stale window and keep
         * declaring it to `retireOutsideWindow`. Converting the URL to a mark
         * is not possible either: the URL does not say what was ingested.
         *
         * Falling through re-opens the window around now, which is exactly the
         * `nextCursor: null` path the connector already takes every time a scan
         * finishes. One rescan, which dedup-on-insert makes cheap, and the
         * window is repaired in the same move.
         */
        if (!isLegacyContinuation(c.past) && !isLegacyContinuation(c.future)) {
          return {
            floor: c.floor,
            ceil: c.ceil,
            pivot: c.pivot,
            ...("past" in c ? { past: typeof c.past === "string" ? c.past : null } : {}),
            ...("future" in c ? { future: typeof c.future === "string" ? c.future : null } : {}),
            next: c.next === "future" ? "future" : "past",
            ...(typeof c.restarts === "number" && c.restarts > 0 ? { restarts: c.restarts } : {}),
          };
        }
        console.warn(
          `[calendly-probe] discarding a cursor that stored a continuation (page_token or next_page URL) ` +
            `instead of a date watermark; re-opening the window at now. One-time migration per stream.`,
        );
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
    occurredAt: parseDate(str(ev["start_time"]), "start_time") ?? parseDate(str(ev["created_at"]), "created_at") ?? new Date(),
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
    occurredAt: parseDate(str(ev["start_time"]), "start_time") ?? parseDate(str(ev["updated_at"]), "updated_at") ?? new Date(),
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

