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
import { fetchJson, basicAuth, HttpError, parseRateLimit, type ObservedRateLimit } from "@/lib/http-client";
import { asObject, holdsWindowContinuation, parseDate, spanCovered, str } from "./field-utils";

const API = "https://api.close.com/api/v1";

/**
 * Event Log page size — and the one place where the docs and the live API
 * DISAGREE.
 *
 * The documentation says this endpoint does not support `_limit` at all. The
 * live API honours `_limit=50` and rejects `_limit=51` with an error naming
 * `max_limit=50`, which is not the behaviour of a parameter being ignored: an
 * ignored parameter cannot reject a value. So the endpoint processes it and the
 * docs are wrong.
 *
 * Kept at 50 on the strength of the OBSERVATION, not the documentation, and
 * written down here because it is the counter-example to the rule the rest of
 * this file now follows. `date_created__gte` was wrong because we trusted code
 * over docs; `_limit` would be wrong if we trusted docs over the API. Neither
 * source is authoritative alone, which is why the check in
 * `scripts/verify-close-pagination.ts` compares them rather than picking one.
 */
const EVENT_LOG_LIMIT = 50;
/** Pages walked per poll() call; deeper windows resume next sweep via the stored continuation. */
const PAGES_PER_POLL = 4;
/**
 * Re-read cushion below the high-water mark.
 *
 * This is a CITED VENDOR RECOMMENDATION, not a number we picked. Close's Events
 * API documentation explicitly recommends re-scanning the latest five minutes of
 * events to avoid missing recent ones during pagination. We arrived at five
 * minutes independently and the agreement is worth recording: it means the
 * cushion is sized to the provider's own statement about its ordering
 * guarantees rather than to our guess about them. `event_id` dedup makes the
 * re-read free.
 */
const OVERLAP_MS = 5 * 60_000;
/**
 * How far back a FIRST sync reaches.
 *
 * THIS BOUND HAS NEVER ONCE BEEN APPLIED, until now, and the reason is worth
 * keeping: it was sent as `date_created__gte`, and this endpoint filters on
 * `date_updated`. Close drops unknown query parameters silently, so every
 * request the connector has ever issued was unbounded — and the long comment
 * that used to sit here explained in detail why a parameter the server was
 * discarding was load-bearing.
 *
 * Nothing was lost by that, and the reason for THAT is luck rather than design:
 * Close's Event Log only retains 30 days ("up to 30 days back in history"), so
 * the provider's own retention has been doing the bounding all along, at exactly
 * the depth we intended. The two numbers agreeing is what kept an unbounded walk
 * from looking like one.
 *
 * So the value stays at 30 and its STATUS changes. It is now belt-and-braces
 * over a limit the API enforces itself, not the thing standing between a mature
 * workspace and a walk that runs for days. Reaching further back than the
 * retention window is not possible from this endpoint at any depth setting.
 */
const FIRST_SYNC_DAYS = 30;

/**
 * THE ORDERING, and THE AXIS — which is the half that was wrong.
 *
 * Close's Event Log is latest-first, and the documentation is explicit about
 * what "latest" means: *"Events are always ordered by date (latest first), i.e.
 * the `date_updated` field."* The direction was never in doubt. The FIELD was,
 * silently: everything here used to check ordering on `date_created`, which the
 * provider has never claimed to sort by, and a check asking about the wrong
 * field cannot fail usefully no matter how carefully it is written.
 *
 * That mattered because of EVENT CONSOLIDATION. Several updates to one object
 * merge into a single event which KEEPS its original `date_created` and takes a
 * new `date_updated` — documented and intentional. So on a consolidated log the
 * two fields do not even move together, and a `date_created` ordering check on a
 * `date_updated`-sorted list is measuring noise.
 *
 * An earlier run of `scripts/verify-close-pagination.ts` also reported
 * OLDEST-first, and that was a third thing wrong again: a single unparseable
 * value made every `Date.parse(a) >= Date.parse(b)` comparison false. Three
 * separate errors, all about the same list, none of which the output could
 * distinguish — which is why that script now prints raw evidence rather than
 * verdicts, and why the connector below still ingests every record on every page
 * and stops only on cursor exhaustion. Nothing about the DATA depends on the
 * ordering being what the docs say; only the preview does, and that is now a
 * cited claim rather than an assumption.
 */

/**
 * Poll cursor for the Close Event Log. Serialized as the plain high-water
 * date string when no page walk is in flight (back-compat with cursors stored
 * by the old single-page poll), or as JSON mid-walk.
 *
 * TWO FIELDS, TWO JOBS, and mixing them is the defect this shape now prevents.
 * `date_updated` is when Close last touched a record — the axis the endpoint
 * FILTERS and SORTS on, so it is the only correct axis for a watermark: a
 * watermark on any other field is not a frontier of the thing being filtered,
 * and consolidation (a record created weeks ago, edited today) is exactly the
 * case that separates them. `date_created` is when the thing HAPPENED, which is
 * what `occurred_at` means and what a person reading a date wants.
 *
 * - `hw`      — newest fully-ingested `date_updated` from the LAST completed
 *               window; the lower bound (with overlap) of the current window.
 * - `cont`    — the provider's `cursor_next`, resuming a partially-walked window.
 * - `maxSeen` — newest `date_updated` seen so far in the current walk; becomes
 *               the new `hw` only once the window is fully drained.
 * - `floor`   — the first sync's lower bound, PINNED when the walk starts.
 *               Recomputing `now - FIRST_SYNC_DAYS` each sweep would creep the
 *               boundary forward while the walk pages backwards, so the depth
 *               reached would depend on how long the walk took. Only meaningful
 *               before `hw` exists; after that `hw - overlap` governs and this
 *               is dropped.
 * - `covLo`/`covHi`
 *               — oldest and newest **`date_created`** ingested by this walk,
 *               which is what "covering 12 of 30 days" reports.
 *
 *               ON THE OTHER AXIS FROM `hw`, deliberately, and this is the whole
 *               reason both marks exist. "Covering 12 of 30 days" is read as *how
 *               much of my history do I have* — a question about when things
 *               happened. Measured on `date_updated` the same sentence would mean
 *               *how much of the change stream have I walked*, and on a workspace
 *               where old records get edited the two answers diverge in both
 *               directions: a two-day span of edits can carry a year of history,
 *               and a month of edits can carry almost none. One number, two
 *               meanings, and nothing on screen to say which — the failure this
 *               connector keeps producing in new forms.
 *
 *               Deliberately NOT derived from `maxSeen`, which tracks
 *               `date_updated` and therefore cannot answer a history question at
 *               all.
 */
type CloseCursor = {
  hw: string | null;
  cont: string | null;
  maxSeen: string | null;
  floor?: string | null;
  covLo?: string | null;
  covHi?: string | null;
};

function parseCloseCursor(cursor: string | null): CloseCursor {
  if (!cursor) return { hw: null, cont: null, maxSeen: null };
  if (cursor.startsWith("{")) {
    try {
      const parsed = JSON.parse(cursor) as Partial<CloseCursor>;
      return {
        hw: parsed.hw ?? null,
        cont: parsed.cont ?? null,
        maxSeen: parsed.maxSeen ?? null,
        floor: parsed.floor ?? null,
        covLo: parsed.covLo ?? null,
        covHi: parsed.covHi ?? null,
      };
    } catch {
      return { hw: null, cont: null, maxSeen: null };
    }
  }
  return { hw: cursor, cont: null, maxSeen: null };
}

/**
 * JSON while a walk is in flight, the plain high-water string once it is not.
 *
 * An UNFINISHED FIRST SYNC counts as in flight even with no continuation, and
 * that clause is load-bearing rather than tidy. The plain form is read back as a
 * high-water mark, so dropping to it mid-first-sync would promote whatever the
 * walk happened to have seen — the newest record of an early page — to the floor
 * of the next window, and everything older would never be requested by anything
 * again. That is the Defect #2 failure reached through the cursor instead of
 * through the walk. The path that gets there is real: an expired continuation
 * returns `{…cur, cont: null}` partway through a first sync.
 */
function serializeCloseCursor(c: CloseCursor): string | null {
  if (c.cont || (!c.hw && c.floor)) return JSON.stringify(c);
  return c.maxSeen ?? c.hw;
}

/**
 * The span actually ingested, against the span being aimed at.
 *
 * Derived from what LANDED (oldest to newest ingested) rather than from where
 * the walk happens to have got to. Those coincide on a latest-first log, which
 * this one is — but a progress number that is only correct because of how the
 * provider sorts is a number nobody can check. See PollResult.importProgress.
 *
 * CLAMPED AT THE FLOOR, and this is a consequence of measuring coverage on
 * `date_created` while bounding the request on `date_updated`. Consolidation
 * means a record inside the 30-day CHANGE window can have been created a year
 * ago, so the raw `covLo..covHi` span can be far wider than the window we are
 * reporting progress against — and "covering 365 of 30 days" is not a sentence
 * that survives being read. Records older than the floor are genuine extra
 * history rather than an error, so they are kept and simply do not count toward
 * a fraction they would make nonsense of.
 */
function coverage(c: CloseCursor, target: Date): { coveredMs: number; targetMs: number } {
  const floorMs = target.getTime();
  const loMs = c.covLo ? Date.parse(c.covLo) || 0 : 0;
  // Only the part of the ingested span that lies inside the window being
  // reported on. `spanCovered` still does the measuring, so the "nothing
  // ingested yet reads as 0, never as complete" rule stays in one place.
  const lo = loMs > 0 && loMs < floorMs ? new Date(floorMs).toISOString() : (c.covLo ?? null);
  return spanCovered(lo, c.covHi ?? null, floorMs);
}

/** Earlier of two provider date strings (by parsed time; unparseable loses). */
function earlierDate(a: string | null, b: string | null): string | null {
  const ta = a ? Date.parse(a) || null : null;
  const tb = b ? Date.parse(b) || null : null;
  if (ta == null) return b;
  if (tb == null) return a;
  return tb < ta ? b : a;
}

/** Later of two provider date strings (by parsed time; unparseable loses). */
function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return (Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a;
}

/**
 * SERVER-SIDE FILTERING BY TYPE: MEASURED, AND ANSWERED NO. Do not re-open.
 *
 * This connector fetches every event type and maps six. Filtering the request
 * instead — "Phase 9" — looks obviously right: fewer rows, less storage, fewer
 * pages. It was probed against the live API and it is worse. The numbers, so
 * that the next person to have the idea can check them rather than repeat the
 * work:
 *
 * WHAT THE API ALLOWS (`scripts/verify-close-pagination.ts` SECTION 7):
 *   object_type + action + date_updated__gte   ACCEPTED — one pair per request
 *   object_type + date_updated__gte            REJECTED
 *   action + date_updated__gte                 REJECTED
 *   multiple values (`__in`, repeated key, comma-separated)   NOT SUPPORTED
 *
 * The middle two are what decide it. `action` alone would have collapsed five
 * of the six pairs into a single `action=created` walk; `object_type` alone
 * would have allowed three. Neither combines with the incremental bound, so
 * every pair needs its own request and its own cursor: SIX walks.
 *
 * THE ARITHMETIC, in the state the system is in almost all of the time:
 *   a steady-state sweep with ~4 new events
 *     today     1 request
 *     filtered  6 requests, five of them returning nothing, forever
 *
 * So filtering is 6× WORSE in normal operation, and it only pays during a first
 * import — which Close already caps at 30 days of retention. It is an
 * optimization that costs six times more except in the one case that is already
 * bounded.
 *
 * AND THE PART THAT IS NOT ABOUT COST. Six walks means six independent cursors.
 * One of them stalling loses one event type silently while the other five keep
 * moving and the connection looks healthy — the exact silent-partial-data shape
 * this project has spent months removing, and one this codebase has already
 * found three times in three different connectors (`tests/stranding-contract.test.ts`).
 * Trading a single cursor for six is buying five new ways to be quietly wrong.
 *
 * The six mapped pairs are ~30% of the log by volume, so the upside was never
 * large enough to be worth any of that.
 */

/**
 * Map Close event log object_type + action to a canonical event type.
 *
 * NAMING, NOT FETCHING. An unmapped pair falls through to `objectType.action`
 * verbatim, so every type Close sends is already stored and already filterable —
 * `activity.meeting.completed` works in a Filter step today. What a name buys is
 * that somebody can find it, and that it reads as the thing it measures.
 *
 * The additions come from a census of 500 live events (SECTION 7c of
 * `scripts/verify-close-pagination.ts`), which found the calls-and-meetings
 * lifecycle sitting unnamed while a mapped pair — `task.completed` — appeared
 * ZERO times. Sales teams measure dials against connects and meetings booked
 * against meetings held; neither comparison was expressible without knowing
 * Close's raw vocabulary.
 *
 * `activity.call.created` was `"call"` and is now `call_logged`. A bare "call"
 * cannot sit next to `call_connected` and `call_completed` without reading like
 * the total of them, which it is not.
 *
 * DELIBERATELY NOT ALIGNED WITH CALENDLY. `activity.meeting.scheduled` is
 * `meeting_scheduled` and not `booked`, even though Calendly emits `booked` and
 * a shared name would let one flow count meetings across both sources. Nothing
 * in this system can tell a Calendly meeting from the Close activity logged for
 * the same meeting, so a shared name does not merge them — it counts them twice,
 * silently, and the number looks plausible.
 *
 * `activity.meeting.updated` stays unmapped ON PURPOSE: a reschedule and a typo
 * correction are the same event, so no honest name exists for it.
 * `task.completed` stays mapped despite 0/500 — a census of one workspace says
 * that workspace does not use tasks, not that nobody does, and an unused mapping
 * costs nothing.
 */
function canonicalType(objectType: string, action: string): string {
  const key = `${objectType}.${action}`;
  const map: Record<string, string> = {
    "activity.sms.created": "sms_sent",
    "activity.email.created": "email_sent",
    // The call lifecycle: logged → connected → finished. Dials against connects
    // is the ratio; without the middle one it cannot be asked.
    "activity.call.created": "call_logged",
    "activity.call.answered": "call_connected",
    "activity.call.completed": "call_completed",
    // The meeting lifecycle. `scheduled` is booked ahead of time; `created` is
    // logged after the fact; `held` is the one that converts.
    "activity.meeting.scheduled": "meeting_scheduled",
    "activity.meeting.created": "meeting_logged",
    "activity.meeting.completed": "meeting_held",
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

  /**
   * Mid-walk means a `_cursor` is stored, not merely that a mark is stored.
   * `serializeCloseCursor` drops to a bare `date_updated` string the moment the
   * window drains, and that string is non-null for the life of the connection —
   * so `cursor != null` would pin this connection at base cadence forever.
   */
  holdsContinuation: holdsWindowContinuation,

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
        occurredAt: parseDate(str(event["date_created"]), "date_created") ?? new Date(),
        properties: event,
      },
    ];
  },

  /**
   * Walk the Event Log window ABOVE the stored high-water mark all the way to
   * its end (Defect #2). The old single-page poll jumped the cursor to the
   * newest record it saw, stranding everything older in a burst > one page —
   * those rows were never queried by anything again. Now:
   * - the window `date_updated >= hw - overlap` is paged via the provider's
   *   `cursor_next` until drained (up to PAGES_PER_POLL pages per call);
   * - a deeper window persists its continuation in the cursor and resumes on
   *   the next sweep — nothing is skipped, the sweep just takes another pass;
   * - `hw` only advances once the window is FULLY ingested, and the overlap
   *   re-reads boundary ties (event_id dedup makes that a no-op).
   *
   * THE WINDOW IS ON `date_updated`, which is the field this endpoint actually
   * filters on. It used to be sent as `date_created__gte` — a parameter Close
   * does not accept and therefore silently discarded, so the "window" was the
   * whole retained log every time. Beyond the wasted reads, the pairing was
   * incoherent in a way that would have started losing records the moment the
   * name was corrected on its own: a watermark taken from `date_created` is not
   * a frontier of `date_updated`, so a record created long ago and edited
   * recently sits on the wrong side of it. Both halves had to move together.
   *
   * NOTHING HERE ASSUMES AN ORDERING. Ingesting every record on every page and
   * stopping only on cursor exhaustion never depended on direction, so no data
   * was ever at risk either way — but everything that reads MEANING out of a
   * partial walk did, and those are the parts worth keeping direction-free: a
   * number that is right only because the provider sorts a particular way is a
   * number nobody can check. See `covLo` for progress and `testFetchLatest` for
   * the preview, which is the one place the cited ordering is relied on.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const key = apiKey_(args.credentials);
    const cur = parseCloseCursor(args.cursor);
    // Keyed by eventId. The overlap re-reads boundary ties within one poll, and
    // handing the runner duplicates would make every count downstream of this
    // poll wrong about its own work even though `upsertEvents` dedups them.
    const records = new Map<string, CanonicalEvent>();
    // Close publishes RFC `ratelimit` on EVERY response, so its own account of
    // what is left is available on the way past — no extra request, and no
    // waiting for a 429 to find out.
    let providerCalls = 0;
    let rateLimit: ObservedRateLimit | null = null;

    // The window's lower bound, decided once per walk and never recomputed.
    // A cursor from before this bound existed (`{hw:null, cont:"…"}`, an
    // unbounded walk already in flight) picks one up here, which stops it —
    // deliberately: that walk had no end.
    //
    // An unparseable mark falls back to the first-sync default rather than to
    // the epoch. `Date.parse(x) || 0` gave 1970, which is not a conservative
    // reading of a corrupt cursor — it is the unbounded walk this bound exists
    // to prevent, arriving through a bad stored value instead of a missing one.
    const firstSyncFloor = Date.now() - FIRST_SYNC_DAYS * 86_400_000;
    const hwMs = cur.hw ? Date.parse(cur.hw) : NaN;
    const floorMs = cur.floor ? Date.parse(cur.floor) : NaN;
    // A corrupt mark is DISCARDED, not merely ignored. Leaving it in place kept
    // `cur.hw` truthy, and two separate decisions read that field rather than the
    // parsed value: the floor pin below, and serialization. So the walk would use
    // a 30-day fallback target while never pinning it — and an unpinned fallback
    // recomputes `now - 30d` every sweep, sliding the boundary forward while the
    // walk pages through it. The depth reached would then depend on how long the
    // walk took, which is the exact drift `floor` exists to stop.
    if (!Number.isFinite(hwMs)) cur.hw = null;
    const target = cur.hw
      ? new Date(hwMs - OVERLAP_MS)
      : new Date(Number.isFinite(floorMs) ? floorMs : firstSyncFloor);
    if (!cur.hw) cur.floor = target.toISOString();

    /**
     * ONE bound for the whole walk, and a resumed walk keeps the one it started
     * with — a provider cursor is only valid for the query that produced it, so
     * re-issuing a stored continuation under a different bound would be a
     * different walk wearing the same cursor.
     *
     * There used to be a second, shallower opening request here (`FIRST_RUNG_DAYS`)
     * so that a first sync put recent records in front of the user regardless of
     * which end the provider sorted from. It is gone for two reasons, and the
     * first is the embarrassing one: the two requests differed ONLY in the date
     * parameter, and that parameter was being discarded — so the peek and the
     * request it was hedging against were byte-identical, and a first sync issued
     * the same query twice and re-read page 1. The second is that the hedge is no
     * longer needed: the ordering is documented as latest-first by `date_updated`,
     * so page 1 IS the recent end.
     */
    const bound = target;

    let pages = 0;
    while (pages < PAGES_PER_POLL) {
      const params = new URLSearchParams({ _limit: String(EVENT_LOG_LIMIT) });
      // THE FIELD THIS ENDPOINT ACTUALLY FILTERS ON. Sent as `date_created__gte`
      // for the life of this connector until now, which Close accepts and
      // discards — an unbounded request every time, wearing a bound.
      params.set("date_updated__gte", bound.toISOString());
      if (cur.cont) params.set("_cursor", cur.cont);

      let data: { data: Array<Record<string, unknown>>; cursor_next?: string | null };
      try {
        providerCalls += 1;
        data = await fetchJson(`${API}/event/?${params.toString()}`, {
          headers: { authorization: basicAuth(key) },
          onResponse: (res) => {
            rateLimit = parseRateLimit(res.headers) ?? rateLimit;
          },
        });
      } catch (e) {
        // A dead provider continuation (expired/invalid _cursor) must not wedge
        // the stream forever: drop it and restart the window on the next sweep.
        if (cur.cont && e instanceof HttpError && e.status === 400) {
          return {
            records: [...records.values()],
            nextCursor: serializeCloseCursor({ ...cur, cont: null }),
            providerCalls,
            rateLimit: rateLimit ?? undefined,
            // The window is going to be re-walked from its bound next sweep, so
            // there IS outstanding work. Saying nothing here let a connection
            // mid-import read as idle for that sweep, which tiers its cadence
            // down — slowing the very pages it is waiting on — and told a Test
            // the import had finished when it had not.
            incomplete: true,
            // Only for a genuine first sync. In steady state the window is the
            // five-minute overlap, and "covering 0 of 1 days" reads as alarming
            // nonsense about a routine retry; the note falls back to its
            // no-numbers form, which is true of both.
            importProgress: cur.hw ? undefined : coverage(cur, target),
          };
        }
        throw e;
      }

      /**
       * TWO MARKS, TWO AXES, in one pass — see {@link CloseCursor}.
       *
       * `maxSeen` tracks `date_updated` because it becomes the next window's
       * floor and that window is filtered on `date_updated`; a floor taken from
       * any other field is not a frontier of the thing being filtered, and would
       * put a record created long ago and edited recently on the wrong side of
       * it. `covLo`/`covHi` track `date_created` because they are reported to a
       * person as "covering N of 30 days", which is a question about when things
       * happened.
       *
       * A record missing either field contributes to neither mark rather than
       * to both — `laterDate`/`earlierDate` already drop unparseable values, and
       * a record that cannot say when it changed must not be allowed to advance
       * a watermark past records that can.
       */
      for (const event of data.data) {
        const record = mapEvent(event, args.connectionId);
        records.set(record.eventId, record);
        const changedAt = str(event["date_updated"]) ?? null;
        const happenedAt = str(event["date_created"]) ?? null;
        cur.maxSeen = laterDate(cur.maxSeen, changedAt);
        cur.covLo = earlierDate(cur.covLo ?? null, happenedAt);
        cur.covHi = laterDate(cur.covHi ?? null, happenedAt);
      }

      const next = data.cursor_next ?? null;
      if (!next || data.data.length === 0) {
        // The target window is drained: the high-water mark advances to the
        // newest ingested, and the floor/progress bookkeeping is no longer
        // meaningful. Dropping the floor returns the cursor to its plain form.
        return {
          records: [...records.values()],
          nextCursor: serializeCloseCursor({ hw: cur.maxSeen ?? cur.hw, cont: null, maxSeen: null }),
          providerCalls,
          rateLimit: rateLimit ?? undefined,
        };
      }
      cur.cont = next;
      pages += 1;
    }

    // Page budget spent mid-window: persist the continuation (hw unchanged) so
    // the next sweep resumes exactly where this one stopped.
    return {
      records: [...records.values()],
      nextCursor: serializeCloseCursor(cur),
      providerCalls,
      rateLimit: rateLimit ?? undefined,
      // There IS more to fetch. Without this the connection-scoped path could
      // not tell a finished import from one that has days left, so the editor
      // showed a climbing number with nothing to explain it.
      incomplete: true,
      importProgress: coverage(cur, target),
    };
  },

  /**
   * The newest `n` events, in ONE request.
   *
   * This was a six-request search that narrowed and widened a window until it
   * could PROVE which end of the log it was holding, because the ordering was an
   * assumption and a preview that silently shows the oldest events in the
   * workspace is the first thing a new user sees. The proof machinery is gone,
   * and what replaced it is a citation rather than a shortcut: Close documents
   * that events are *"always ordered by date (latest first), i.e. the
   * `date_updated` field"*, so page 1 is the recent end and asking for it is
   * enough.
   *
   * The search was also never doing what it claimed. Every one of its requests
   * carried `date_created__gte`, which this endpoint discards — so all six were
   * the same unbounded request, and the "window" it believed it was narrowing
   * never moved. It could not have detected a wrong ordering; it could only have
   * spent six calls agreeing with itself.
   *
   * TWO AXES SHOW UP HERE TOO. The provider returns the page sorted by
   * `date_updated`; the preview then sorts by `date_created`, because "latest
   * records" to a person means the things that happened most recently, not the
   * ones edited most recently. On a consolidated log those differ, and the
   * person is right.
   */
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const key = apiKey_(args.credentials);
    const want = Math.max(1, Math.min(n, EVENT_LOG_LIMIT));
    const params = new URLSearchParams({
      _limit: String(EVENT_LOG_LIMIT),
      // Bounded at the retention window: the endpoint holds nothing older, so
      // this asks for everything there is and makes the request self-describing.
      date_updated__gte: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000).toISOString(),
    });
    const data = await fetchJson<{ data: Array<Record<string, unknown>>; cursor_next?: string | null }>(
      `${API}/event/?${params.toString()}`,
      { headers: { authorization: basicAuth(key) } },
    );
    return data.data
      .slice()
      .sort((a, b) => dateMs(b) - dateMs(a))
      .slice(0, want)
      .map((event) => mapEvent(event, args.connectionId));
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
          { object_type: "activity.email", action: "created" },
          { object_type: "lead", action: "created" },
          { object_type: "opportunity", action: "created" },
        ],
      }),
    });
    return { signingSecret: res.signature_key, externalId: res.id };
  },
};

/** When a record says it HAPPENED — the axis a preview is sorted on. */
const dateMs = (event: Record<string, unknown>): number => Date.parse(str(event["date_created"]) ?? "") || 0;

/**
 * Map one Event Log entry to a canonical event (shared by poll + preview).
 *
 * `occurredAt` is `date_created` and stays there. It is the one field in this
 * connector that must NOT follow the cursor onto `date_updated`: a record's
 * event time is when the thing happened, and Close's consolidation is explicit
 * that an edited record keeps its original `date_created` and takes a new
 * `date_updated`. Dating rows by the latter would move a lead's creation to
 * whenever somebody last touched it — every metric built on "leads per day"
 * would restate itself as people tidied up old records.
 */
function mapEvent(event: Record<string, unknown>, connectionId: string): CanonicalEvent {
  const objectType = str(event["object_type"]) ?? "object";
  const action = str(event["action"]) ?? "event";
  return {
    eventId: `close:${connectionId}:${str(event["id"])}`,
    eventType: canonicalType(objectType, action),
    subject: null,
    occurredAt: parseDate(str(event["date_created"]), "date_created") ?? new Date(),
    properties: event,
  };
}

function apiKey_(credentials?: Record<string, unknown> | null): string {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("close: missing API key");
  return key;
}

