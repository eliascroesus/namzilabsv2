import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { fetchJson } from "@/lib/http-client";
import { parseDate, str } from "./field-utils";

const API = "https://www.googleapis.com/calendar/v3/calendars";

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
    }

    let data: { items?: Array<Record<string, unknown>>; nextSyncToken?: string };
    try {
      data = await fetchJson(`${API}/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (err) {
      // Expired sync token -> reset and do a full resync next time.
      if (err instanceof Error && err.message.includes("410")) return { records: [], nextCursor: null };
      throw err;
    }

    const streamTag = args.streamHash ? `${args.streamHash}:` : "";
    const records: CanonicalEvent[] = (data.items ?? []).map((ev) => ({
      eventId: `gcal:${args.connectionId}:${streamTag}${str(ev["id"])}`,
      eventType: "calendar_event",
      subject: str(ev["summary"]) ?? firstAttendeeEmail(ev) ?? null,
      occurredAt: eventStart(ev) ?? new Date(),
      properties: ev,
    }));
    return { records, nextCursor: data.nextSyncToken ?? args.cursor };
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
