import type {
  Connector,
  CanonicalEvent,
  VerifyArgs,
  NormalizeContext,
  PollArgs,
  PollResult,
  RegisterWebhookArgs,
  RegisterWebhookResult,
  VerifyWebhookArgs,
  VerifyWebhookResult,
} from "./types";
import { createHmac } from "node:crypto";
import { safeEqual, timestampFreshness } from "@/lib/signatures";
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
/**
 * MEMORY ceiling on pages per poll() — no longer the throughput governor.
 *
 * This was 4, and 4 was the connection's real throughput ceiling: ~200 events
 * per 10-minute sweep against a workspace that can easily emit more, on the
 * provider whose event log DELETES ITSELF at 30 days — the silent-data-loss
 * shape the close-lag invariant watches for. The real governors are now the
 * ledger budget the runner passes in (`PollArgs.budget.maxCalls`, from the
 * claim's `remaining`) and its wall-clock deadline; this constant only bounds
 * how many records one poll() may accumulate in memory before returning
 * (40 × 50 = 2,000 — the same ceiling Calendar's 8 × 250 walk has always
 * had). Deeper windows resume next sweep via the stored continuation, as
 * always. Absent a budget (legacy callers, tests) the walk stops at the OLD
 * default below.
 */
const MAX_PAGES_PER_POLL = 40;
/** The pre-budget default, kept for callers that pass no budget. */
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

/**
 * Exported for the nightly invariant scan (`closeCursorLag` in
 * lib/health/invariants.ts), which needs to read `hw` out of stored cursors —
 * ONE definition of the cursor grammar, two readers, rather than the scan
 * re-implementing a parse that would silently drift the day this changes.
 */
export function parseCloseCursor(cursor: string | null): CloseCursor {
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
 *
 * IT DOES NOT GUARD THE STEADY STATE, and it must not have to. With `hw` set,
 * this falls through to `maxSeen ?? hw` for any caller that clears `cont` — so a
 * MID-WALK caller doing that promotes a partial walk's newest record to the next
 * floor, which is the identical failure one paragraph up, on a connection that
 * has simply been running longer. This function cannot tell "drained" from "gave
 * up", because `cont: null` is what both look like from in here.
 *
 * So the rule lives at the CALL SITES, where the difference is known: a caller
 * that drained promotes `maxSeen`, a caller that stopped early clears it. Both
 * say which they are rather than leaving this function to guess.
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
 * CLOSE'S SIGNATURE KEY IS HEX, AND THE BYTES ARE THE KEY.
 *
 * `registerWebhook` stores `signature_key` exactly as Close returns it — a
 * 64-character hex string — and the shared `hmacSha256Hex` keys an HMAC with the
 * UTF-8 bytes of whatever string it is handed. So the key in use was the 64
 * ASCII characters "4f7a…", not the 32 bytes they spell. Close's own
 * verification example decodes first:
 *
 *   hmac.new(bytearray.fromhex(signature_key), (timestamp + data).encode(), sha256)
 *
 * Those two HMACs share no bytes, so **every Close webhook delivery has been
 * rejected with a 401 since the connector shipped** — not intermittently, not
 * under load: all of them, always. It stayed invisible because a rejection wrote
 * nothing anywhere (fixed in `lib/webhooks/rejections.ts`) and because the poll
 * lane kept importing the same events a few minutes later, so the data looked
 * merely slow rather than broken.
 *
 * DECODED HERE AND NOWHERE ELSE. `hmacSha256Hex` is deliberately left alone:
 * every other signing secret in this codebase is minted by `randomSecret()` as
 * `whsec_<base64url>` and is used as UTF-8 on both sides by construction, so a
 * global "decode hex keys" rule would silently break the catch-hook, Instantly
 * and gsheets the moment one of those secrets happened to contain only hex
 * digits. Close is the only connector that is handed a key BY a provider, and
 * therefore the only one whose key format is not ours to choose.
 *
 * A key that is not clean hex is refused rather than coerced.
 * `Buffer.from(s, "hex")` truncates at the first invalid character instead of
 * throwing, so an unchecked decode of `whsec_…` yields an empty key and an HMAC
 * that verifies nothing — the same silent-wrong-key failure being fixed here.
 * Refusing surfaces as a recorded `invalid-signature` rejection, which the
 * nightly scan reads.
 */
function closeSigningKey(secret: string): Buffer | null {
  if (secret.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(secret)) return null;
  return Buffer.from(secret, "hex");
}

/**
 * Close CRM. Instant path: Event Log webhook subscriptions signed as
 * `close-sig-hash = HMAC-SHA256(fromhex(signatureKey), close-sig-timestamp + body)`.
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
    const key = closeSigningKey(secret);
    if (!key) return false;
    const expected = createHmac("sha256", key).update(`${timestamp}${rawBody}`, "utf8").digest("hex");
    if (!safeEqual(hash, expected)) return false;
    /**
     * REPLAY PROTECTION, after authenticity. The timestamp is inside the
     * signed message, so a valid HMAC over a stale timestamp proves exactly
     * one thing: Close sent this ONCE — not that whoever is re-sending it now
     * is Close. Without an age check a captured delivery verifies forever.
     *
     * "stale" rejects. "unparseable" ACCEPTS deliberately: Close's timestamp
     * format is documented nowhere reachable (bot-walled docs), and rejecting
     * on a format assumption is precisely how the hex-key bug silently
     * refused every delivery this connector ever received. Authenticity is
     * already proven; only the replay window is lost, and `event_id` dedup
     * makes a replayed delivery a no-op anyway.
     */
    return timestampFreshness(timestamp) !== "stale";
  },

  /**
   * The webhook envelope is `{event: {...}}`; the event inside is the same kind
   * of object the Event Log returns, so it goes through the SAME mapper the poll
   * uses. Unwrapping is the only thing this function does that `mapEvent` does
   * not — see `mapEvent` for why sharing it is not a tidiness preference.
   */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    return [mapEvent(asObject(asObject(rawPayload)["event"]), ctx.connectionId, ctx.fallbackOccurredAt)];
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

    // Budget-driven paging: the ledger's headroom (never below 1 — the claim
    // that authorized this poll bought one call) capped by the memory
    // ceiling; the wall-clock deadline is checked between pages. No budget =
    // the pre-budget default, so legacy callers are byte-identical.
    const pageCap = args.budget ? Math.min(MAX_PAGES_PER_POLL, Math.max(1, args.budget.maxCalls)) : PAGES_PER_POLL;
    const nowMs = args.budget?.nowMs ?? Date.now;
    const deadlineMs = args.budget?.deadlineMs;

    let pages = 0;
    while (pages < pageCap) {
      if (pages > 0 && deadlineMs != null && nowMs() >= deadlineMs) {
        // Out of clock mid-walk: same exit as running out of pages — the
        // continuation below carries the walk into the next sweep.
        break;
      }
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
            /**
             * `maxSeen` IS DISCARDED, and that is the fix rather than a detail.
             *
             * `serializeCloseCursor` guards the first sync — `(!c.hw && c.floor)`
             * keeps the JSON shape so an early page's newest record cannot become
             * the floor. In STEADY STATE it did not: with `hw` set, dropping
             * `cont` fell through to `maxSeen ?? hw`, and the log is newest-first
             * by `date_updated`, so a walk that died on page three had read the
             * newest pages and left the older part of its window unread. Promoting
             * `maxSeen` put that remainder below the next floor, where nothing
             * requests it again. The comment on the serializer described exactly
             * this failure and guarded only the case where `hw` was absent.
             *
             * The mark stays where it was. The window is re-walked from the same
             * bound next sweep, and `event_id` dedup makes the re-read free.
             */
            nextCursor: serializeCloseCursor({ ...cur, cont: null, maxSeen: null }),
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

  /**
   * THE HEX FIX ALONE DOES NOT BRING CLOSE BACK, because the subscription is
   * almost certainly switched off at the provider by now.
   *
   * Close pauses a webhook subscription after roughly three days during which
   * every delivery fails, and a paused subscription stays paused until something
   * re-activates it. Deliveries here failed 100% of the time from the day the
   * connector shipped, so the three days elapsed long ago: correcting the key
   * makes the *next* delivery verifiable and there is no next delivery. Fixing
   * the signature without this is fixing a lock on a door nobody is knocking at.
   *
   * RE-ACTIVATE, NEVER RE-CREATE — and this is the sharp edge. `POST /webhook/`
   * mints a NEW `signature_key`, and for most of this connector's life
   * `VerifyWebhookResult` had no field to carry a secret back, so a
   * re-creating implementation would have left the connection holding the OLD
   * key against a NEW subscription with every delivery failing silently.
   * That field now EXISTS (`signingSecret`, added for Calendly, which has no
   * re-activate verb and can only self-heal by re-creating) and reconcile
   * persists it — but Close stays re-activate-only BY CHOICE: re-activation
   * preserves the existing key, which is strictly better wherever the
   * provider offers the verb. Sendblue can re-create freely because its
   * secret is one we mint; Close's is one we are given.
   *
   * The re-activation verb is `PUT /api/v1/webhook/{id}/` with a `status` field,
   * which Close's update documentation demonstrates directly — its own cURL
   * example sends `{"status": "paused"}` and documents `status` as an optional
   * request field. The literal `"active"` is the one thing not enumerated there,
   * so the call stays written to FAIL LOUDLY: a rejected PUT surfaces as
   * `healthy: false` carrying Close's own error text onto the connection, rather
   * than as a silent no-op that looks like success.
   *
   * CLOSE DIAGNOSES ITSELF, so stop inferring. The subscription object carries
   * `health_status`, `latest_error`, `pause_reason` and
   * `recent_consecutive_fail_buckets_cnt` — the provider stating what is wrong,
   * on a GET already being made. `latest_error` goes onto the connection because
   * it is the sentence a human actually needs, and guessing from a status string
   * when the provider will simply say it is how this connector got here.
   *
   * The failure signal used for a VERDICT is the counter, not the words.
   * `recent_consecutive_fail_buckets_cnt > 0` means deliveries are failing right
   * now and resets when one succeeds; `health_status` is an unenumerated string
   * this codebase has not seen the value set of, so it is reported and never
   * branched on. A number is unambiguous without documentation. A vocabulary is
   * not — and inventing one is the same mistake as assuming a key encoding.
   *
   * RE-ACTIVATION IS GUARDED, because switching deliveries back on toward an
   * endpoint we know refuses them does not repair anything — it restarts the
   * three-day failure period that caused the pause. `recentlyRejecting` is the
   * caller's reading of `delivery_log`: direct evidence that requests arriving
   * now are being refused. When it is set, the subscription is left paused and
   * the reason is reported. See `REJECTION_MEMORY_MS` for why the window leans
   * long and what it does and does not accomplish.
   *
   * Reading is unconditional, mutating is not: the PUT is issued only when a
   * subscription exists, reports a non-active status, AND nothing is being
   * refused — so a healthy connection costs one GET per sweep and writes
   * nothing.
   */
  async verifyWebhookSubscription(args: VerifyWebhookArgs): Promise<VerifyWebhookResult> {
    const key = apiKey_(args.credentials);
    try {
      const data = await fetchJson<{ data?: Array<Record<string, unknown>> }>(`${API}/webhook/`, {
        headers: { authorization: basicAuth(key) },
      });
      const hook = (data.data ?? []).find((h) => str(h["url"]) === args.webhookUrl);
      if (!hook) {
        return {
          healthy: false,
          reregistered: false,
          detail: "no Close webhook subscription points at this URL; reconnect to create one (a new subscription issues a new signing key, which only connect-time can store)",
        };
      }
      const status = str(hook["status"]) ?? "unknown";
      const diagnosis = closeDiagnosis(hook);

      if (status === "active") {
        // Active and delivering: nothing to say. Active while every delivery
        // fails is the state this connector spent its whole life in, so it is
        // reported rather than counted as healthy.
        const failing = num(hook["recent_consecutive_fail_buckets_cnt"]) > 0;
        if (!failing) return { healthy: true, reregistered: false };
        return { healthy: false, reregistered: false, detail: `subscription is active but Close reports consecutive delivery failures — ${diagnosis}` };
      }

      if (args.recentlyRejecting) {
        return {
          healthy: false,
          reregistered: false,
          detail: `subscription is ${status} and this endpoint refused a delivery within the last day, so it is left paused rather than re-activated into the same failure — ${diagnosis}`,
        };
      }

      const id = str(hook["id"]);
      if (!id) return { healthy: false, reregistered: false, detail: `subscription is ${status} and carries no id to re-activate — ${diagnosis}` };
      await fetchJson(`${API}/webhook/${id}/`, {
        method: "PUT",
        headers: { authorization: basicAuth(key), "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      return { healthy: true, reregistered: true };
    } catch (e) {
      return { healthy: false, reregistered: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

/**
 * Close's own account of what is wrong with a subscription, as one line.
 *
 * `latest_error` first because it is the only field written for a human to read;
 * the rest give it context when it is absent or stale. Every part is omitted
 * when the provider did not send it, so this never manufactures a diagnosis it
 * does not have.
 */
function closeDiagnosis(hook: Record<string, unknown>): string {
  const parts = [
    str(hook["latest_error"]) && `Close reports: ${str(hook["latest_error"])}`,
    str(hook["pause_reason"]) && `pause_reason=${str(hook["pause_reason"])}`,
    str(hook["health_status"]) && `health_status=${str(hook["health_status"])}`,
    hook["recent_consecutive_fail_buckets_cnt"] != null &&
      `recent_consecutive_fail_buckets_cnt=${num(hook["recent_consecutive_fail_buckets_cnt"])}`,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length > 0 ? parts.join("; ") : "Close reported no detail";
}

/** A numeric field, or 0 — used only where a count's ABSENCE and zero mean the same thing. */
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** When a record says it HAPPENED — the axis a preview is sorted on. */
const dateMs = (event: Record<string, unknown>): number => Date.parse(str(event["date_created"]) ?? "") || 0;

/**
 * THE ONLY MAPPER. Webhook, poll and preview all arrive here.
 *
 * It was two, and they disagreed about `subject`: the webhook path read
 * `contact_name`/`lead_name`/`to`/`phone` out of `data`, and this one wrote
 * `null`. Both produce the identical `event_id`, so the disagreement never
 * showed up as duplicate rows — it showed up as a row that could not decide what
 * it was called. `upsertEvents` writes `excluded.subject` whenever it differs
 * and the incoming generation is at least the stored one, and the poll writes
 * generation >= 1 over a webhook's 0, so every Close row would have gained a
 * name the moment a delivery verified and lost it again at the next sweep, every
 * ten minutes, forever.
 *
 * That defect was DORMANT and this batch is what wakes it: no Close webhook has
 * ever verified, so `normalize` has never once written a row. Which is why the
 * signature fix and this cannot ship apart — correcting the key without
 * correcting this turns a path that produced nothing into a path that flaps.
 *
 * So the mapper is one function rather than two that agree today, because two
 * that agree today are two that stop agreeing on the next edit, silently, and
 * the symptom is a value oscillating in the database rather than a test failing.
 *
 * WHAT THIS DOES TO EXISTING ROWS, so a later reader does not diagnose a bug.
 * The poll now writes a `subject` where it used to write null, and `subject` is
 * in `upsertEvents`'s change gate — so a re-polled row is UPDATED rather than
 * deduped, and the sweep that does it reports a raised `updated` count, marks
 * the stream changed and triggers one recompute. Expected, once, not a
 * regression.
 *
 * It is NOT a backfill of every Close row, and the difference matters if anyone
 * is waiting for a spike to confirm the deploy. The window is
 * `date_updated >= hw - overlap`, so an incremental sweep re-reads only records
 * Close has touched since the last high-water mark — on a steady connection,
 * few. Every row outside that window KEEPS `subject = null` indefinitely,
 * because `hw` only moves forward and nothing re-reads behind it.
 *
 * A full resync reaches further but NOT all the way, and the difference is not
 * a detail. It re-polls from a null cursor, so it reaches `FIRST_SYNC_DAYS`
 * back — which is everything Close SERVES, because the Event Log retains 30
 * days. It is not everything this database HOLDS. A connection older than a
 * month contains rows imported while they were still inside that window, and
 * Close will never serve them again, so nothing can re-read them: those rows
 * keep `subject = null` permanently, and no operation available to us changes
 * that. The repair is bounded by the provider's retention, not by ours.
 *
 * And a full resync is not the tool for it anyway, for a reason that lives in
 * `resync.ts`: the retire is scoped by generation and connection with no date
 * bound, so a completed thirty-day walk over a longer-lived database used to
 * tombstone everything older. That is now gated — see the comment there — but
 * the shape of the operation is still "re-import a window", which cannot be a
 * backfill for rows outside it.
 *
 * `occurredAt` is `date_created` and stays there. It is the one field in this
 * connector that must NOT follow the cursor onto `date_updated`: a record's
 * event time is when the thing happened, and Close's consolidation is explicit
 * that an edited record keeps its original `date_created` and takes a new
 * `date_updated`. Dating rows by the latter would move a lead's creation to
 * whenever somebody last touched it — every metric built on "leads per day"
 * would restate itself as people tidied up old records.
 *
 * The id falls back to `date_created`, which the poll path did not do — it
 * interpolated a missing id straight into the string and produced
 * `close:<conn>:undefined`, collapsing every id-less record onto one row. An
 * Event Log entry without an `id` is close to hypothetical, and the fallback
 * costs nothing, but the old behaviour was a silent merge rather than a loud
 * failure and that is not a thing to keep.
 */
function mapEvent(event: Record<string, unknown>, connectionId: string, fallbackOccurredAt?: Date): CanonicalEvent {
  const objectType = str(event["object_type"]) ?? "object";
  const action = str(event["action"]) ?? "event";
  const naturalId = str(event["id"]) ?? str(event["date_created"]) ?? "unknown";
  const data = asObject(event["data"]);
  return {
    eventId: `close:${connectionId}:${naturalId}`,
    eventType: canonicalType(objectType, action),
    subject: str(data["contact_name"]) ?? str(data["lead_name"]) ?? str(data["to"]) ?? str(data["phone"]) ?? null,
    /**
     * `fallbackOccurredAt` is the DELIVERY time, and it only exists on the
     * webhook path — the poll has no such thing, so it keeps `new Date()`.
     *
     * The difference only shows on an unparseable `date_created`, and only then
     * does it matter enormously: `new Date()` dates the row to whenever this
     * function ran, which for a REPLAY out of `raw_events` is the replay, not
     * the event. Dating a two-month-old delivery to this afternoon because a
     * timestamp failed to parse is precisely the failure this field exists to
     * prevent, and Close was ignoring it.
     */
    occurredAt: parseDate(str(event["date_created"]), "date_created") ?? fallbackOccurredAt ?? new Date(),
    /**
     * NOT UNIFIED, deliberately, and this is the open question rather than an
     * oversight. Both paths store the provider's object verbatim, but the
     * webhook's comes out of the `{event: {...}}` envelope and may carry fields
     * the Event Log's copy does not. If it does, `properties` differs from
     * `excluded.properties` on every sweep, the row is rewritten every ten
     * minutes, `updated > 0` marks the stream changed, and every Close
     * connection is pinned at base cadence with a recompute behind it.
     *
     * That is a measurement, not a guess, and it cannot be taken yet: no Close
     * webhook has ever verified, so no stored payload exists to diff against
     * `GET /event/{id}`. `scripts/verify-close-payload-shapes.ts` takes it the
     * moment one does.
     */
    properties: event,
  };
}

function apiKey_(credentials?: Record<string, unknown> | null): string {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("close: missing API key");
  return key;
}

