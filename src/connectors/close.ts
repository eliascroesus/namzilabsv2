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
import { asObject, parseDate, spanCovered, str } from "./field-utils";

const API = "https://api.close.com/api/v1";

/** Event Log page size (the endpoint's documented maximum). */
const EVENT_LOG_LIMIT = 50;
/** Pages walked per poll() call; deeper windows resume next sweep via the stored continuation. */
const PAGES_PER_POLL = 4;
/**
 * Re-read cushion below the high-water mark. Close's Events API docs recommend
 * re-scanning the latest five minutes because events can surface out of order;
 * event_id dedup makes the wider overlap free.
 */
const OVERLAP_MS = 5 * 60_000;
/**
 * How far back a FIRST sync reaches.
 *
 * Without this the first poll sent no `date_created__gte` at all — and because
 * `hw` only advances once a window drains, "the first window" was the entire
 * workspace event log. A mature account walked it 200 records at a time,
 * forever, and since every sweep inserted rows the cadence ladder never
 * demoted it: it simply ran for days. Close is the highest-volume connector
 * here and a mature workspace is the likeliest day-one account, so the
 * unbounded case was the default case.
 *
 * Thirty days matches Sendblue (`FIRST_SYNC_DAYS` there) and is a floor on the
 * first REQUEST, not a statement about how much history we will ever hold.
 * Reaching further back is a one-time historical import — see
 * PRE_LAUNCH_CHECKLIST.md item 9a (the E.8 backfill lane).
 */
const FIRST_SYNC_DAYS = 30;

/**
 * THE ORDERING, settled — because this file was briefly rewritten around the
 * wrong answer and the wrong answer is the kind that comes back.
 *
 * Close's Event Log is **NEWEST-first**, as its documentation says. An earlier
 * run of `scripts/verify-close-pagination.ts` reported OLDEST-first and that
 * finding was a bug in the script, not a fact about the provider: the check
 * compared `Date.parse(a) >= Date.parse(b)` and one event's `date_created` did
 * not parse, so every comparison against NaN was false and a correctly ordered
 * log read as unordered. The script now emits raw evidence instead of verdicts,
 * and re-run it agrees with the documentation.
 *
 * NOTHING BELOW WAS REVERTED, and that is deliberate. What the false finding
 * produced was code that assumes no ordering at all, which is strictly more
 * robust than code that assumes the right one — and it carried two real defects
 * out with it (a 1970 cursor fallback and a first-sync serialization bug) that
 * had nothing to do with direction. So the shapes stay; only the claims about
 * why change. Everything here is written to be correct on a log ordered either
 * way, and is exercised both ways in `tests/close-poll.test.ts`.
 */

/**
 * The first RUNG of a first sync's window: how recent the opening request is.
 *
 * One request bounded at `now - 30d` returns whichever end of that window the
 * provider sorts from. On a newest-first log that is fine; on an oldest-first
 * one the first thing a new Close user sees in the editor is their oldest 200
 * events from a month ago — technically ingested, useless for building a metric,
 * and it stays that way for as many sweeps as the walk takes.
 *
 * So a first sync opens with ONE request bounded to the last day, then steps out
 * to the full target and walks that. Costing one request to be right either way
 * is the trade this file makes everywhere; with the ordering now settled as
 * newest-first the rung is insurance rather than a fix, and insurance priced at
 * one request against a preview that shows month-old data is worth keeping.
 *
 * The rung is a request bound, not a depth policy: the target is still
 * `FIRST_SYNC_DAYS` and the walk still gets there.
 *
 * ONE request, deliberately, and this is the part that took a correction. Letting
 * the rung page to exhaustion re-read everything it had covered once the walk
 * stepped out, and on an account whose whole history fits inside a day that is
 * the entire dataset read twice plus an extra sweep before the window settles.
 * A single peek costs exactly one request per first sync, cannot delay the real
 * walk by more than that, and still puts recent records in front of the user
 * immediately.
 *
 * A rung is only needed at all because Close has no `date_created__lte` to bound
 * the other end — with one, a first sync could walk exclusive recent-first
 * segments and none of this would be necessary. C6 in
 * `scripts/verify-close-pagination.ts` probes for exactly that.
 */
const FIRST_RUNG_DAYS = 1;

/**
 * Poll cursor for the Close Event Log. Serialized as the plain high-water
 * date string when no page walk is in flight (back-compat with cursors stored
 * by the old single-page poll), or as JSON mid-walk:
 * - `hw`      — newest fully-ingested `date_created` from the LAST completed
 *               window; the lower bound (with overlap) of the current window.
 * - `cont`    — the provider's `cursor_next`, resuming a partially-walked window.
 * - `maxSeen` — newest `date_created` seen so far in the current walk; becomes
 *               the new `hw` only once the window is fully drained.
 * - `floor`   — the first sync's lower bound, PINNED when the walk starts.
 *               Recomputing `now - FIRST_SYNC_DAYS` each sweep would creep the
 *               boundary forward while the walk pages backwards, so the depth
 *               reached would depend on how long the walk took. Only meaningful
 *               before `hw` exists; after that `hw - overlap` governs and this
 *               is dropped.
 * - `covLo`/`covHi`
 *               — oldest and newest `date_created` ingested by the walk of the
 *               TARGET window, which is what "covering 12 of 30 days" reports.
 *               The walk pages monotonically through that window, so everything
 *               between the two marks is held and their difference is a real
 *               span. It carries no direction: the span grows from whichever end
 *               the provider orders from, so a newest-first log (which Close's
 *               is) and an oldest-first one both read correctly.
 *
 *               Deliberately NOT derived from `maxSeen`. That mark spans
 *               everything ingested, the opening peek included, so it reaches
 *               from the 30-day floor to an hour ago after the peek plus ONE
 *               page — announcing full coverage while holding a fraction of the
 *               events, which is the overstatement this whole shape exists to
 *               prevent. True on either ordering: the peek alone is enough to
 *               stretch it.
 *
 *               The peek's own span is therefore not counted, and the step-out
 *               below is the single place these marks are cleared. So the last day
 *               is held and not added on: an understatement of up to a day, which
 *               is the only direction that cannot mislead.
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
 * the walk happens to have got to. Those coincide on a newest-first log, which
 * this one is — but a progress number that is only correct because of how the
 * provider sorts is a number nobody can check. See PollResult.importProgress.
 */
function coverage(c: CloseCursor, target: Date): { coveredMs: number; targetMs: number } {
  return spanCovered(c.covLo ?? null, c.covHi ?? null, target.getTime());
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

/** Map Close event log object_type + action to a canonical event type. */
function canonicalType(objectType: string, action: string): string {
  const key = `${objectType}.${action}`;
  const map: Record<string, string> = {
    "activity.sms.created": "sms_sent",
    "activity.call.created": "call",
    "activity.email.created": "email_sent",
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
        occurredAt: parseDate(str(event["date_created"])) ?? new Date(),
        properties: event,
      },
    ];
  },

  /**
   * Walk the Event Log window ABOVE the stored high-water mark all the way to
   * its end (Defect #2). The old single-page poll jumped the cursor to the
   * newest record it saw, stranding everything older in a burst > one page —
   * those rows were never queried by anything again. Now:
   * - the window `date_created >= hw - overlap` is paged via the provider's
   *   `cursor_next` until drained (up to PAGES_PER_POLL pages per call);
   * - a deeper window persists its continuation in the cursor and resumes on
   *   the next sweep — nothing is skipped, the sweep just takes another pass;
   * - `hw` only advances once the window is FULLY ingested, and the overlap
   *   re-reads boundary ties (event_id dedup makes that a no-op).
   *
   * NOTHING HERE ASSUMES AN ORDERING, and it stays that way now that the
   * ordering is settled as newest-first (see the note above `FIRST_RUNG_DAYS`).
   * Ingesting every record on every page and stopping only on cursor exhaustion
   * never depended on direction, so no data was ever at risk either way — but
   * everything that reads MEANING out of a partial walk did, and those are the
   * parts worth keeping direction-free: a number that is right only because the
   * provider sorts a particular way is a number nobody can check, and the
   * provider is free to change it. See `covLo` for progress and
   * `testFetchLatest` for the preview.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const key = apiKey_(args.credentials);
    const cur = parseCloseCursor(args.cursor);
    // Keyed by eventId: see the ingest loop — the peek and the target walk can
    // cover the same records inside one poll.
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
    // `cur.hw` truthy, and three separate decisions read that field rather than
    // the parsed value: the floor pin below, the peek gate, and serialization. So
    // the walk would use a 30-day fallback target while never pinning it — and an
    // unpinned fallback recomputes `now - 30d` every sweep, sliding the boundary
    // forward while the walk pages through it. The depth reached would then depend
    // on how long the walk took, which is the exact drift `floor` exists to stop.
    if (!Number.isFinite(hwMs)) cur.hw = null;
    const target = cur.hw
      ? new Date(hwMs - OVERLAP_MS)
      : new Date(Number.isFinite(floorMs) ? floorMs : firstSyncFloor);
    if (!cur.hw) cur.floor = target.toISOString();

    /**
     * What is actually REQUESTED. A FRESH first sync opens one request shallower
     * than the target (see FIRST_RUNG_DAYS); everything else asks for the target
     * directly.
     *
     * The `cur.cont` case is why the peek is gated on being fresh, and it is
     * load-bearing rather than defensive: a provider cursor is only valid for the
     * query that produced it, so re-issuing a stored continuation under a
     * different `date_created__gte` would be a different walk wearing the same
     * cursor. A resumed walk therefore keeps the bound it started with.
     */
    const peeking = !cur.hw && !cur.cont;
    let bound = peeking ? new Date(Math.max(target.getTime(), Date.now() - FIRST_RUNG_DAYS * 86_400_000)) : target;


    let pages = 0;
    while (pages < PAGES_PER_POLL) {
      const params = new URLSearchParams({ _limit: String(EVENT_LOG_LIMIT) });
      // Sent on EVERY request now. Omitted on a first sync, this asked for the
      // whole workspace event log and got exactly that.
      params.set("date_created__gte", bound.toISOString());
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

      // The high-water mark counts EVERYTHING ingested, because it becomes the
      // next window's floor and must not sit below data already held. Coverage
      // is measured per bound — see CloseCursor.covLo.
      for (const event of data.data) {
        const record = mapEvent(event, args.connectionId);
        // Keyed, not appended: the peek and the target walk overlap, and on an
        // account whose history fits inside the peek they overlap entirely.
        // `upsertEvents` would dedup these anyway — handing it duplicates just
        // makes every count downstream of this poll wrong about its own work.
        records.set(record.eventId, record);
        const at = str(event["date_created"]) ?? null;
        cur.maxSeen = laterDate(cur.maxSeen, at);
        cur.covLo = earlierDate(cur.covLo ?? null, at);
        cur.covHi = laterDate(cur.covHi ?? null, at);
      }

      const next = data.cursor_next ?? null;
      if (bound.getTime() > target.getTime()) {
        // The peek is done — one request, whatever it returned. Step out to the
        // full target and keep walking WITHIN this poll: ending the sweep here
        // would put the real window a whole cadence interval away, and on a
        // quiet account the peek is empty, so the first Test would show nothing
        // at all — worse than showing month-old events.
        //
        // Not charged against the page budget, deliberately: one request per
        // first sync, and charging it would shorten every first walk of the
        // actual window by a page.
        bound = target;
        cur.cont = null;
        /**
         * THE ONLY PLACE the coverage marks are cleared, and the invariant that
         * makes them mean anything: every return path below reports the span of
         * the TARGET walk, because this is the one bound whose marks do not
         * survive to a return.
         *
         * Without it the peek's newest record (an hour old) pairs with the target
         * bound's oldest (the 30-day floor) and the reported span becomes the
         * whole window after a single page — while the days in between are not
         * held at all. That is the overstatement `covLo` exists to prevent,
         * arriving by a different route than `maxSeen`.
         */
        cur.covLo = null;
        cur.covHi = null;
        continue;
      }
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
   * The newest `n` events — PROVEN newest, not assumed newest.
   *
   * This used to be one unbounded request for the first page, on the ASSUMPTION
   * that the Event Log is newest-first. It is (see the note above
   * `FIRST_RUNG_DAYS`) — but a function named `testFetchLatest` that returns the
   * oldest events in the workspace whenever that assumption stops holding is the
   * connect-time preview, the first thing anyone sees, and there is nothing in
   * the response that would have made the mistake visible.
   *
   * There is no `_order_by` to lean on (C7 probes for one) and no
   * `date_created__lte`, so the newest page cannot be requested directly. What
   * CAN be established from a response is this: when a bounded request comes
   * back with `cursor_next` null, that one page IS the entire window — every
   * event since the bound, in whatever order. Since every window here ends at
   * `now`, the newest `n` of a fully-held window are the newest `n` overall,
   * whichever way the provider sorted them.
   *
   * So: bound at a day, and adjust. A window held whole with too few events
   * reaches further back; a window that needs paging narrows toward now until it
   * fits — unless the page is demonstrably newest-first, in which case page one
   * already holds the answer and one request was enough. On Close's live
   * ordering that early exit is the usual path, so the search costs one request
   * in practice and the narrowing is what makes it safe if that ever changes.
   *
   * Every attempt accumulates, and the newest are taken at the end from
   * everything seen. That makes the fallback safe rather than arbitrary: if the
   * search runs out of attempts, it returns the newest events it managed to
   * reach, which is the closest honest answer available.
   */
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const key = apiKey_(args.credentials);
    const want = Math.max(1, Math.min(n, EVENT_LOG_LIMIT));
    const seen = new Map<string, Record<string, unknown>>();
    let span = PREVIEW_START_MS;

    for (let attempt = 0; attempt < PREVIEW_MAX_CALLS; attempt++) {
      const params = new URLSearchParams({
        _limit: String(EVENT_LOG_LIMIT),
        date_created__gte: new Date(Date.now() - span).toISOString(),
      });
      const data = await fetchJson<{ data: Array<Record<string, unknown>>; cursor_next?: string | null }>(
        `${API}/event/?${params.toString()}`,
        { headers: { authorization: basicAuth(key) } },
      );
      for (const event of data.data) seen.set(String(event["id"]), event);

      if (!data.cursor_next) {
        // The whole window, in hand. Enough events (or as deep as a preview goes)
        // means the newest `want` of them are settled.
        if (data.data.length >= want || span >= PREVIEW_MAX_MS) break;
        span = Math.min(PREVIEW_MAX_MS, span * 4);
        continue;
      }
      // Paged, so this page is not the window. Newest-first means it is still
      // the newest events; anything else means narrow and try again.
      if (isNewestFirst(data.data)) break;
      if (span <= PREVIEW_MIN_MS) break;
      span = Math.max(PREVIEW_MIN_MS, Math.floor(span / 4));
    }

    return [...seen.values()]
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

/** Where the preview's bounded search starts, and how far it may move. */
const PREVIEW_START_MS = 86_400_000;
const PREVIEW_MIN_MS = 5 * 60_000;
const PREVIEW_MAX_MS = FIRST_SYNC_DAYS * 86_400_000;
/** Requests the preview may spend before answering with the best it reached. */
const PREVIEW_MAX_CALLS = 6;

const dateMs = (event: Record<string, unknown>): number => Date.parse(str(event["date_created"]) ?? "") || 0;

/**
 * Whether a page is DEMONSTRABLY newest-first.
 *
 * False for fewer than two dates and for an all-identical page: both are
 * consistent with either ordering, and the caller uses a true answer to stop
 * searching — so "cannot tell" has to read as "keep looking", never as yes.
 */
function isNewestFirst(rows: Array<Record<string, unknown>>): boolean {
  const ts = rows.map(dateMs).filter((t) => t > 0);
  if (ts.length < 2 || ts[0] === ts[ts.length - 1]) return false;
  return ts.every((t, i) => i === 0 || ts[i - 1] >= t);
}

/** Map one Event Log entry to a canonical event (shared by poll + preview). */
function mapEvent(event: Record<string, unknown>, connectionId: string): CanonicalEvent {
  const objectType = str(event["object_type"]) ?? "object";
  const action = str(event["action"]) ?? "event";
  return {
    eventId: `close:${connectionId}:${str(event["id"])}`,
    eventType: canonicalType(objectType, action),
    subject: null,
    occurredAt: parseDate(str(event["date_created"])) ?? new Date(),
    properties: event,
  };
}

function apiKey_(credentials?: Record<string, unknown> | null): string {
  const key = str(credentials?.["apiKey"]);
  if (!key) throw new Error("close: missing API key");
  return key;
}

