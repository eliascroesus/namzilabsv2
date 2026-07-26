import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { fetchJson, HttpError } from "@/lib/http-client";
import { parseDate, str } from "./field-utils";

const API = "https://www.googleapis.com/calendar/v3/calendars";

/** Pages walked per poll; Google only reveals nextSyncToken on the LAST page. */
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
    if (args.cursor) {
      params.set("syncToken", args.cursor);
    } else {
      params.set("orderBy", "startTime");
      params.set("timeMin", new Date(Date.now() - 30 * 864e5).toISOString());
      // Bound the FORWARD horizon too. A calendar with a long-running recurring
      // event expands to an unbounded number of instances, so a first sync with
      // only a lower bound can grind indefinitely on connect. A year ahead
      // covers every realistic dashboard question; the sync token takes over
      // afterwards and picks up anything created beyond it.
      params.set("timeMax", new Date(Date.now() + 365 * 864e5).toISOString());
    }

    const streamTag = args.streamHash ? `${args.streamHash}:` : "";
    const records: CanonicalEvent[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      // Page requests must repeat the original query params + pageToken.
      const pageParams = new URLSearchParams(params);
      if (pageToken) pageParams.set("pageToken", pageToken);

      let data: { items?: Array<Record<string, unknown>>; nextPageToken?: string; nextSyncToken?: string };
      try {
        data = await fetchJson(`${API}/${encodeURIComponent(calendarId)}/events?${pageParams.toString()}`, {
          headers: { authorization: `Bearer ${token}` },
        });
      } catch (err) {
        // Expired sync token -> reset and do a full resync next time.
        if (err instanceof HttpError && err.status === 410) return { records: [], nextCursor: null };
        throw err;
      }

      for (const ev of data.items ?? []) {
        records.push({
          eventId: `gcal:${args.connectionId}:${streamTag}${str(ev["id"])}`,
          eventType: "calendar_event",
          subject: str(ev["summary"]) ?? firstAttendeeEmail(ev) ?? null,
          occurredAt: eventStart(ev) ?? new Date(),
          properties: { ...ev, ...attendanceRollup(ev) },
        });
      }

      if (data.nextSyncToken) return { records, nextCursor: data.nextSyncToken };
      if (!data.nextPageToken) return { records, nextCursor: args.cursor };
      pageToken = data.nextPageToken;
    }

    // Page budget spent before the listing ended (pathological change volume):
    // keep the old token so the next sweep retries; dedup absorbs the re-reads.
    return { records, nextCursor: args.cursor };
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
    return parseDate(str(s["dateTime"]) ?? str(s["date"]));
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
 * Definitions, chosen so the common sales case falls out for free:
 * - Rooms and equipment (`resource: true`) are never people, and are excluded
 *   from every count.
 * - A GUEST is an attendee who is neither the organizer nor the calendar owner
 *   (`self`). Counting the closer's own acceptance would make every meeting look
 *   accepted, which is exactly the noise being complained about.
 * - EXTERNAL guests are those whose email domain differs from the organizer's —
 *   the prospect, as distinct from the colleague you added to the call. This is
 *   what separates "did the lead show intent" from internal chatter, and it needs
 *   no configuration from the user.
 *
 * Everything here is derived; the original `attendees` list is left untouched
 * alongside it for anyone who needs the detail.
 */
function attendanceRollup(ev: Record<string, unknown>): Record<string, unknown> {
  const raw = Array.isArray(ev["attendees"]) ? (ev["attendees"] as Array<Record<string, unknown>>) : [];
  // Rooms/equipment are attendees to Google, never to a person asking "who came".
  const people = raw.filter((a) => a["resource"] !== true);

  const organizerEmail =
    str((ev["organizer"] as Record<string, unknown> | undefined)?.["email"]) ??
    str(people.find((a) => a["organizer"] === true)?.["email"]) ??
    null;
  const organizerDomain = domainOf(organizerEmail);

  const guests = people.filter((a) => a["organizer"] !== true && a["self"] !== true);
  const external = guests.filter((a) => {
    const d = domainOf(str(a["email"]));
    return d != null && organizerDomain != null && d !== organizerDomain;
  });

  const status = (a: Record<string, unknown>) => str(a["responseStatus"]) ?? "needsAction";
  const accepted = (list: Array<Record<string, unknown>>) => list.filter((a) => status(a) === "accepted").length;

  const guestsTotal = guests.length;
  const guestsAccepted = accepted(guests);

  return {
    guests_total: guestsTotal,
    guests_accepted: guestsAccepted,
    guests_declined: guests.filter((a) => status(a) === "declined").length,
    guests_tentative: guests.filter((a) => status(a) === "tentative").length,
    guests_pending: guests.filter((a) => status(a) === "needsAction").length,
    guests_external: external.length,
    guests_external_accepted: accepted(external),
    /** 0–1, and null rather than 0 when there were no guests to accept — an
     *  internal solo block must not drag an average acceptance rate down. */
    guest_acceptance_rate: guestsTotal > 0 ? guestsAccepted / guestsTotal : null,
    any_guest_accepted: guestsAccepted > 0,
    /** True when someone outside the organizer's company was invited — the
     *  cheap way to separate real calls from internal meetings. */
    is_external_meeting: external.length > 0,
    organizer_email: organizerEmail,
    organizer_domain: organizerDomain,
    attendee_count: people.length,
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
