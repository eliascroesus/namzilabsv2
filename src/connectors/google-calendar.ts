import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { fetchJson } from "@/lib/http-client";
import { parseDate, str } from "./field-utils";

const API = "https://www.googleapis.com/calendar/v3/calendars";

/** How far back the initial full list reaches (matches inMirrorScope below). */
const LIST_WINDOW_DAYS = 30;
/** Safety valve on pages per poll call (250 events/page → 10k events). */
const MAX_PAGES = 40;

/**
 * Google Calendar — INCREMENTAL via sync tokens (Google's own change feed): the
 * first poll pages through the full list and stores `nextSyncToken`; subsequent
 * polls pass it and receive exactly what changed — including UPDATED events and
 * CANCELLATIONS (mapped to soft-deletes). A 410 resets the token for a full
 * relist. `nextPageToken` is followed until Google hands over the sync token
 * (it only appears on the final page, and never when `orderBy` is set — which
 * is why this list is unordered).
 *
 * config: { calendarId?: string }  (defaults to "primary")
 */
export const googleCalendarConnector: Connector = {
  source: "gcal",
  authType: "oauth2",
  syncStrategy: "incremental",

  /** Manual full re-syncs only relist the last LIST_WINDOW_DAYS; older stored
   * events were not rescanned and must survive that pass's soft-delete. */
  inMirrorScope(row): boolean {
    return row.occurredAt.getTime() >= Date.now() - LIST_WINDOW_DAYS * 864e5;
  },

  // Calendar is poll-only in v1; push channels are a later addition.
  verifySignature(_args: VerifyArgs): boolean {
    return false;
  },

  normalize(_rawPayload: unknown, _ctx: NormalizeContext): CanonicalEvent[] {
    return [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("gcal: missing access token");
    const calendarId = str(args.config?.["calendarId"]) ?? "primary";
    const streamTag = args.streamHash ? `${args.streamHash}:` : "";

    const records: CanonicalEvent[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
      if (args.cursor) params.set("syncToken", args.cursor);
      else params.set("timeMin", new Date(Date.now() - LIST_WINDOW_DAYS * 864e5).toISOString());
      if (pageToken) params.set("pageToken", pageToken);

      let data: { items?: Array<Record<string, unknown>>; nextPageToken?: string; nextSyncToken?: string };
      try {
        data = await fetchJson(`${API}/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
          headers: { authorization: `Bearer ${token}` },
        });
      } catch (err) {
        // Expired sync token -> reset and do a full relist next sweep.
        if (err instanceof Error && err.message.includes("410")) return { records: [], nextCursor: null };
        throw err;
      }

      for (const ev of data.items ?? []) {
        const cancelled = str(ev["status"]) === "cancelled";
        records.push({
          eventId: `gcal:${args.connectionId}:${streamTag}${str(ev["id"])}`,
          eventType: "calendar_event",
          subject: str(ev["summary"]) ?? firstAttendeeEmail(ev) ?? null,
          occurredAt: eventStart(ev) ?? new Date(),
          properties: ev,
          // A cancellation is a deletion of state: stored as a soft-delete, and
          // never allowed to clobber the stored event's real fields (the
          // cancelled item Google sends is a skeleton).
          deleted: cancelled || undefined,
        });
      }

      if (data.nextSyncToken) return { records, nextCursor: data.nextSyncToken };
      if (!data.nextPageToken) return { records, nextCursor: args.cursor ?? null };
      pageToken = data.nextPageToken;
    }
    // Page cap tripped mid-list (huge calendar): keep what we read, keep the old
    // cursor so the next sweep retries the walk from the start.
    return { records, nextCursor: args.cursor ?? null };
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
function firstAttendeeEmail(ev: Record<string, unknown>): string | null {
  const attendees = ev["attendees"];
  if (Array.isArray(attendees) && attendees.length > 0) {
    const a = attendees[0] as Record<string, unknown>;
    return str(a["email"]);
  }
  return null;
}
