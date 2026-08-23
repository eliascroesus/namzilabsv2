import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { fetchJson, HttpError } from "@/lib/http-client";
import { parseDate, str } from "./field-utils";

/**
 * The one endpoint this connector polls. Named rather than `"*"` so the
 * catalog's declared limits and what the runner claims against cannot drift —
 * `tests/budget-operations.test.ts` checks that correspondence both ways, and a
 * wildcard key would satisfy neither direction.
 */
const CALENDAR_OP = "events.list";

const API = "https://www.googleapis.com/calendar/v3/calendars";

/**
 * MEMORY ceiling on pages per poll (8 × 250 = 2,000 changes) — already the
 * ceiling the other connectors were raised to meet, so it keeps its value.
 * With a `PollArgs.budget` the walk is ADDITIONALLY bounded by the ledger's
 * headroom and the deadline (load-bearing here more than anywhere: Calendar
 * spends the fleet-shared Cloud-project quota, and this walk used to be able
 * to overdraw it by up to 7 calls that were only settled after the fact).
 * Google only reveals nextSyncToken on the LAST page, so a cut-short walk
 * stores the pageToken continuation, exactly as before.
 */
const MAX_PAGES = 8; // 8 × 250 = 2000 changes per sweep

/**
 * Google Calendar. Poll-PRIMARY via incremental sync tokens: the first poll
 * does a full list and stores `nextSyncToken`; subsequent polls pass it to get
 * only changes (gap-free). A 410 resets the token for a full resync.
 *
 * config: { calendarId?: string }  (defaults to "primary")
 */
export const googleCalendarConnector: Connector = {
  source: "gcal",
  authType: "oauth2",
  operations: [CALENDAR_OP] as const,
  operationFor: () => CALENDAR_OP,

  // Calendar is poll-only in v1; push channels are a later addition.
  verifySignature(_args: VerifyArgs): boolean {
    return false;
  },

  normalize(_rawPayload: unknown, _ctx: NormalizeContext): CanonicalEvent[] {
    return [];
  },

  /**
   * List changes and walk EVERY nextPageToken page: Google only returns
   * `nextSyncToken` on the last page, so a single-page read of a >250-change
   * window (or a >250-item first import) could never advance the token — every
   * sweep re-read the same first page forever. Draining the listing fixes both.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("gcal: missing access token");
    const calendarId = str(args.config?.["calendarId"]) ?? "primary";

    const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
    /**
     * THE SPAN THIS READ ENUMERATES — null when the read is incremental.
     *
     * Held because it is the difference between "here is what changed" and
     * "here is everything there is", and only the second licenses retiring a
     * stored row. See the mirrorScope handed back below.
     */
    let window: { from: Date; to: Date } | null = null;
    if (args.cursor) {
      params.set("syncToken", args.cursor);
    } else {
      /**
       * THE STREAM'S OWN REACH, when a backfill has asked for one.
       *
       * 30 days is the default span, not a ceiling. `ensureStreamsForGraph`
       * queues a 90-day history import for every new calendar stream, and this
       * connector was ignoring `windowFloor` entirely — so the job asked for
       * ninety days, got thirty, and reported success. Every calendar metric
       * over a range longer than a month was quietly answering from a third of
       * the history it claimed.
       *
       * Only ever DEEPENS: a floor shallower than the default would narrow the
       * window and hand the retire below a span it had no business tombstoning
       * inside.
       */
      const floor = args.windowFloor ?? null;
      const from = floor && floor.getTime() < Date.now() - 30 * 864e5 ? floor : new Date(Date.now() - 30 * 864e5);
      // Bound the FORWARD horizon too. A calendar with a long-running recurring
      // event expands to an unbounded number of instances, so a first sync with
      // only a lower bound can grind indefinitely on connect. A year ahead
      // covers every realistic dashboard question; the sync token takes over
      // afterwards and picks up anything created beyond it.
      const to = new Date(Date.now() + 365 * 864e5);
      window = { from, to };
      params.set("orderBy", "startTime");
      params.set("timeMin", from.toISOString());
      params.set("timeMax", to.toISOString());
    }

    const streamTag = args.streamHash ? `${args.streamHash}:` : "";
    const records: CanonicalEvent[] = [];
    let pageToken: string | null = null;
    /**
     * Requests actually issued, so the ledger can settle up.
     *
     * The runner claims ONE call per `poll()`, but this walk makes up to
     * MAX_PAGES of them — so a claimed "page" was really up to eight requests
     * and the ledger recorded an eighth of the truth. That gap is tolerable for
     * a per-customer credential and is not tolerable for Google, whose quota is
     * consumed per Cloud PROJECT: one shared client, every customer's calls in
     * the same bucket. A fleet ceiling counting claims rather than requests
     * would authorise eight times what it says.
     *
     * Counted on ATTEMPT, not on success: a request that failed still reached
     * Google and still cost quota.
     */
    let providerCalls = 0;

    const pageCap = args.budget ? Math.min(MAX_PAGES, Math.max(1, args.budget.maxCalls)) : MAX_PAGES;
    const nowMs = args.budget?.nowMs ?? Date.now;
    const deadlineMs = args.budget?.deadlineMs;

    for (let page = 0; page < pageCap; page++) {
      if (page > 0 && deadlineMs != null && nowMs() >= deadlineMs) break;
      // Page requests must repeat the original query params + pageToken.
      const pageParams = new URLSearchParams(params);
      if (pageToken) pageParams.set("pageToken", pageToken);

      let data: { items?: Array<Record<string, unknown>>; nextPageToken?: string; nextSyncToken?: string };
      providerCalls += 1;
      try {
        data = await fetchJson(`${API}/${encodeURIComponent(calendarId)}/events?${pageParams.toString()}`, {
          headers: { authorization: `Bearer ${token}` },
        });
      } catch (err) {
        // Expired sync token -> reset and do a full resync next time.
        if (err instanceof HttpError && err.status === 410) return { records: [], nextCursor: null, providerCalls };
        throw err;
      }

      for (const ev of data.items ?? []) {
        /**
         * A DELETED MEETING IS NOT A MEETING. An incremental sync reports a
         * removed event as a tombstone — the same id, `status: "cancelled"`,
         * and no attendees — and storing that as a record would leave a
         * meeting nobody is having inside every count that reads this stream.
         * Absent from `records` is also what licenses the retire below.
         */
        if (str(ev["status"]) === "cancelled") continue;
        records.push({
          eventId: `gcal:${args.connectionId}:${streamTag}${str(ev["id"])}`,
          eventType: "calendar_event",
          subject: str(ev["summary"]) ?? firstAttendeeEmail(ev) ?? null,
          occurredAt: eventStart(ev) ?? new Date(),
          properties: { ...ev, ...attendanceRollup(ev) },
        });
      }

      /**
       * DID A SYNC TOKEN COME BACK, AND IF NOT, WHY NOT?
       *
       * The whole incremental design rests on `nextSyncToken` arriving on the
       * last page of the FIRST sync, and that first request carries three
       * parameters Google documents as incompatible with a sync token —
       * `orderBy`, `timeMin`, `timeMax`. The docs say those cannot be sent
       * ALONGSIDE a token; they do not say whether a request carrying them is
       * refused a token in the first place. Nobody has ever looked.
       *
       * If a token is withheld, every exit below hands back `args.cursor`, which
       * on a first sync is null — START OVER. The connector would re-list the
       * whole 30d/365d window every sweep, for ever, and the data would stay
       * CORRECT the entire time because dedup absorbs it. The only symptom is
       * cost, charged to the per-project Google quota every customer shares.
       *
       * So this is a measurement, not an error path: one line per terminating
       * poll, saying which exit was taken and what was in hand. Read it in the
       * Inngest run output for a real connection.
       */
      const probe = (exit: string) =>
        console.log(
          `[gcal-probe] exit=${exit} first_sync=${!args.cursor} page=${page + 1}/${MAX_PAGES} ` +
            `items=${data.items?.length ?? 0} nextSyncToken=${data.nextSyncToken ? "PRESENT" : "absent"} ` +
            `nextPageToken=${data.nextPageToken ? "present" : "absent"} ` +
            `sent=${[...new URLSearchParams(params).keys()].join("+")}`,
        );

      if (data.nextSyncToken) {
        probe("sync-token");
        return { records, nextCursor: data.nextSyncToken, providerCalls };
      }
      if (!data.nextPageToken) {
        // The listing ended and Google offered no token. On a first sync this
        // returns null — START OVER — so the next sweep re-lists the window and
        // the connection never becomes incremental.
        probe(args.cursor ? "listing-ended-incremental" : "listing-ended-NO-TOKEN");
        /**
         * THE WINDOW WAS ENUMERATED END TO END, SO WHAT IS MISSING IS GONE.
         *
         * The measurement above has its answer: Google withholds
         * `nextSyncToken` from a request carrying `orderBy`/`timeMin`/
         * `timeMax`, so `cursor` stays null for ever and this connector
         * re-lists its whole window on every sweep. That was filed as costing
         * only quota, and it cost accuracy too: `events.list` omits deleted
         * events, nothing else retires a calendar row, and so a meeting that
         * was cancelled STAYED in the store permanently. It kept counting as
         * booked — a customer's acceptance rate read 2 of 7 where the calendar
         * showed 5 meetings, and no amount of correct arithmetic downstream
         * could recover from a denominator holding meetings that no longer
         * existed.
         *
         * Declaring the span makes the re-list do the work its cost already
         * paid for: `retireAbsent` tombstones stored rows INSIDE it that this
         * read did not return. Scoped, so history older than `timeMin` is
         * never touched.
         *
         * Only on this exit. The page-budget exit below walked a prefix of the
         * window, and treating a prefix as the whole would tombstone every
         * live meeting past the last page it reached.
         */
        return { records, nextCursor: args.cursor, providerCalls, ...(window ? { mirrorScope: window } : {}) };
      }
      pageToken = data.nextPageToken;
    }

    // Page budget spent before the listing ended (pathological change volume):
    // keep the old token so the next sweep retries; dedup absorbs the re-reads.
    console.log(
      `[gcal-probe] exit=page-budget first_sync=${!args.cursor} pages=${MAX_PAGES} records=${records.length} ` +
        `nextSyncToken=never-seen — on a first sync this returns null (START OVER), so the window is re-listed next sweep`,
    );
    /**
     * A PREFIX IS NOT THE WINDOW — BUT IT IS EXACTLY A SHORTER WINDOW.
     *
     * The cursor never becomes non-null here, so a calendar holding more than
     * MAX_PAGES × 250 events in its span reaches THIS exit on every single
     * sweep and never the one above. Declaring nothing was the safe choice and
     * it left the cancelled-meeting bug completely unfixed for precisely the
     * busiest calendars — recurring series expand under `singleEvents`, so a
     * handful of daily meetings clears 2,000 across 395 days.
     *
     * `orderBy=startTime` is ascending and is sent on exactly this branch, so
     * the pages that DID come back enumerate `[timeMin, last start seen]`
     * completely. That sub-span is a mirror by the same argument the full
     * window is; beyond it we know nothing and claim nothing, which is what
     * keeps a live meeting past the cut-off from being tombstoned.
     *
     * `incomplete` so the sweep does not read a permanently-truncated calendar
     * as a quiet one and tier its cadence down.
     */
    const edge = records.reduce((max, r) => Math.max(max, r.occurredAt.getTime()), 0);
    return {
      records,
      nextCursor: args.cursor,
      providerCalls,
      incomplete: true,
      ...(window && edge > 0 ? { mirrorScope: { from: window.from, to: new Date(edge) } } : {}),
    };
  },

  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "calendarId") return [];
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("gcal: missing access token");
    const data = await fetchJson<{ items?: Array<{ id: string; summary?: string; primary?: boolean }> }>(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,primary)",
      { headers: { authorization: `Bearer ${token}` } },
    );
    return (data.items ?? []).map((c) => ({ value: c.id, label: c.primary ? `${c.summary ?? c.id} (primary)` : c.summary ?? c.id }));
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null });
    return records.slice(0, n);
  },
};

function eventStart(ev: Record<string, unknown>): Date | null {
  const start = ev["start"];
  if (start && typeof start === "object") {
    const s = start as Record<string, unknown>;
    return parseDate(str(s["dateTime"]) ?? str(s["date"]), "dateTime");
  }
  return null;
}
/**
 * Flatten `attendees` into countable fields.
 *
 * The raw list is unusable for the question people actually ask of a calendar:
 * "how many invitees accepted?". A list of attendee objects can only be picked
 * POSITIONALLY in the flow builder — Item 1, Item 2 — and position means nothing
 * here. Every sales call has different people, Google does not guarantee an
 * order, and the organizer is not reliably first. So a metric built on "Item 1's
 * response status" is measuring a different person on every row.
 *
 * The fix is not a smarter picker, it is different data: counts are what the
 * question is about, so the connector computes them once at read time and every
 * existing filter and aggregate works on them unchanged.
 *
 * THE COUNTS MUST MATCH WHAT GOOGLE SHOWS. Open the event in Google Calendar and
 * it reads "4 guests · 2 yes, 2 awaiting". `guests_total` / `guests_accepted` /
 * `guests_pending` are that line, field for field. This is the whole design
 * constraint, and it is worth stating because the first version broke it: it
 * excluded the organizer and the calendar owner on the theory that the closer's
 * own auto-acceptance would make every meeting look accepted. On a real event
 * where the organizer and the owner were the two people who HAD accepted, it
 * reported 0 — a number the user could disprove at a glance. A definition that
 * cannot be checked against the source is not worth its cleverness; anyone who
 * wants the host discounted can say `guests_accepted > 1`, and anyone who wants
 * it exactly can use the external counts below.
 *
 * So a GUEST here is what Google calls a guest — every invited person, organizer
 * included. Two things are still not people:
 * - Rooms and equipment (`resource: true`), which Google lists as attendees.
 * - Nothing else. `self` and `organizer` are counted like anyone else.
 *
 * EXTERNAL guests are those whose email domain differs from the organizer's —
 * the prospect, as distinct from the colleague added to the call. That is the
 * assumption-free version of "did the lead show intent", needing no user config
 * and no "the closer always accepts" premise.
 *
 * Everything here is derived; the original `attendees` list is left untouched
 * alongside it for anyone who needs the detail.
 */
function attendanceRollup(ev: Record<string, unknown>): Record<string, unknown> {
  const raw = Array.isArray(ev["attendees"]) ? (ev["attendees"] as Array<Record<string, unknown>>) : [];
  // Rooms/equipment are attendees to Google, never to a person asking "who accepted".
  const guests = raw.filter((a) => a["resource"] !== true);

  const organizerEmail =
    str((ev["organizer"] as Record<string, unknown> | undefined)?.["email"]) ??
    str(guests.find((a) => a["organizer"] === true)?.["email"]) ??
    null;
  const organizerDomain = domainOf(organizerEmail);

  const external = guests.filter((a) => {
    const d = domainOf(str(a["email"]));
    return d != null && organizerDomain != null && d !== organizerDomain;
  });

  // Google omits responseStatus for an attendee who has not replied at all.
  const status = (a: Record<string, unknown>) => str(a["responseStatus"]) ?? "needsAction";
  const accepted = (list: Array<Record<string, unknown>>) => list.filter((a) => status(a) === "accepted").length;

  const guestsTotal = guests.length;
  const guestsAccepted = accepted(guests);

  return {
    guests_total: guestsTotal,
    guests_accepted: guestsAccepted,
    guests_declined: guests.filter((a) => status(a) === "declined").length,
    // No `guests_tentative` and no `guest_acceptance_rate`: a "maybe" is not a
    // signal anyone builds on, and a per-event rate is the wrong shape for the
    // question — averaging per-event rates weights a 2-person call the same as a
    // 20-person one. Sum accepted ÷ sum total across the dataset instead, which
    // Calculate already does from the counts below. Note the consequence:
    // tentative replies are inside `guests_total` but in none of the buckets, so
    // the parts only sum to the whole when nobody answered Maybe.
    guests_pending: guests.filter((a) => status(a) === "needsAction").length,
    guests_external: external.length,
    guests_external_accepted: accepted(external),
    /** True when someone outside the organizer's company was invited — the
     *  cheap way to separate real calls from internal meetings. */
    is_external_meeting: external.length > 0,
    organizer_email: organizerEmail,
    organizer_domain: organizerDomain,
  };
}

function domainOf(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : null;
}

function firstAttendeeEmail(ev: Record<string, unknown>): string | null {
  const attendees = ev["attendees"];
  if (Array.isArray(attendees) && attendees.length > 0) {
    const a = attendees[0] as Record<string, unknown>;
    return str(a["email"]);
  }
  return null;
}
