import { describe, it, expect, vi, afterEach } from "vitest";
import { googleCalendarConnector } from "@/connectors/google-calendar";

/**
 * Q9 (folded into Defect #2's fix): Google Calendar reveals `nextSyncToken`
 * only on the LAST page of a listing. The old single-page poll never advanced
 * the token when a window held >250 changes (or on a >250-item first import) —
 * every sweep re-read the same first page forever. The poll now walks every
 * nextPageToken page and returns the sync token from the final one.
 */

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

const item = (id: string) => ({ id, summary: `Event ${id}`, start: { dateTime: "2026-07-01T10:00:00Z" } });

const pollArgs = (cursor: string | null) => ({
  connectionId: "c1",
  cursor,
  credentials: { accessToken: "tok" },
  config: { calendarId: "primary" },
  streamHash: "h1",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Calendar pagination (sync token only on the last page)", () => {
  it("walks all nextPageToken pages and returns the final nextSyncToken", async () => {
    const pages: Record<string, unknown> = {
      first: { items: [item("a1"), item("a2")], nextPageToken: "P2" },
      P2: { items: [item("a3")], nextPageToken: "P3" },
      P3: { items: [item("a4")], nextSyncToken: "SYNC-2" },
    };
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        urls.push(String(input));
        const key = url.searchParams.get("pageToken") ?? "first";
        return jsonResponse(pages[key]);
      }),
    );

    const res = await googleCalendarConnector.poll!(pollArgs("SYNC-1"));
    expect(res.records.map((r) => r.eventId)).toEqual([
      "gcal:c1:h1:a1",
      "gcal:c1:h1:a2",
      "gcal:c1:h1:a3",
      "gcal:c1:h1:a4",
    ]);
    expect(res.nextCursor).toBe("SYNC-2");
    // Every page request kept the original syncToken query.
    expect(urls).toHaveLength(3);
    for (const u of urls) expect(u).toContain("syncToken=SYNC-1");
  });

  it("first import (no cursor) also drains pages before storing the sync token", async () => {
    const pages: Record<string, unknown> = {
      first: { items: [item("b1")], nextPageToken: "P2" },
      P2: { items: [item("b2")], nextSyncToken: "SYNC-1" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        return jsonResponse(pages[url.searchParams.get("pageToken") ?? "first"]);
      }),
    );
    const res = await googleCalendarConnector.poll!(pollArgs(null));
    expect(res.records).toHaveLength(2);
    expect(res.nextCursor).toBe("SYNC-1");
  });

  it("a 410 (expired sync token) resets the cursor for a full resync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 410,
        statusText: "Gone",
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "sync token expired",
      }) as unknown as Response),
    );
    const res = await googleCalendarConnector.poll!(pollArgs("SYNC-OLD"));
    // The failed request still reached Google and still cost project quota, so
    // it is reported. `nextCursor: null` is the load-bearing part: START OVER.
    expect(res).toEqual({ records: [], nextCursor: null, providerCalls: 1 });
  });

  it("keeps the old token when the page budget ends before the listing does (no token loss)", async () => {
    // Endless pages: nextPageToken forever, never a nextSyncToken.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const n = Number(url.searchParams.get("pageToken") ?? "0");
        return jsonResponse({ items: [item(`c${n}`)], nextPageToken: String(n + 1) });
      }),
    );
    const res = await googleCalendarConnector.poll!(pollArgs("SYNC-1"));
    expect(res.records.length).toBeGreaterThan(0);
    expect(res.nextCursor).toBe("SYNC-1"); // unchanged → next sweep retries; dedup absorbs re-reads
  });
});

/**
 * A CANCELLED MEETING HAS TO STOP COUNTING.
 *
 * Google withholds `nextSyncToken` from a request carrying
 * orderBy/timeMin/timeMax, so this connector re-lists its whole window on
 * every sweep and the cursor stays null for ever. `events.list` omits deleted
 * events and nothing else retires a calendar row, so a cancelled meeting
 * stayed stored permanently and kept counting as booked: one workspace's
 * acceptance rate read 2 of 7 while the calendar showed five meetings.
 *
 * The window read now declares itself a mirror, which is what lets the sweep
 * tombstone what it did not return.
 */
describe("deleted meetings stop counting", () => {
  it("declares the listed window a mirror when the listing completes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [item("a1")] })));
    const res = await googleCalendarConnector.poll!(pollArgs(null));

    expect(res.mirrorScope).toBeDefined();
    // The span actually asked for: 30 days back, a year ahead.
    const days = (res.mirrorScope!.to.getTime() - res.mirrorScope!.from.getTime()) / 864e5;
    expect(Math.round(days)).toBe(395);
    expect(res.mirrorScope!.from.getTime()).toBeLessThan(Date.now());
    expect(res.mirrorScope!.to.getTime()).toBeGreaterThan(Date.now());
  });

  it("claims no mirror on an incremental read", async () => {
    // A sync token reports CHANGES, not the whole calendar — retiring on that
    // basis would tombstone every meeting it simply had no news about.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [item("a1")], nextSyncToken: "S2" })));
    const res = await googleCalendarConnector.poll!(pollArgs("SYNC-1"));
    expect(res.mirrorScope).toBeUndefined();
  });

  it("mirrors only the prefix it enumerated when the page budget cut the listing short", async () => {
    /**
     * The cursor never becomes non-null, so a calendar with more than
     * MAX_PAGES × 250 events in its span hits THIS exit every sweep and never
     * the one above. Declaring nothing here left the cancelled-meeting bug
     * unfixed for exactly the busiest calendars; declaring the WHOLE window
     * would tombstone every live meeting past the last page reached.
     * `orderBy=startTime` is ascending, so the prefix is a mirror of itself.
     */
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const day = String(10 + n).padStart(2, "0");
        n += 1;
        return jsonResponse({
          items: [{ id: `c${n}`, summary: "E", start: { dateTime: `2026-07-${day}T10:00:00Z` } }],
          nextPageToken: String(n),
        });
      }),
    );
    const res = await googleCalendarConnector.poll!(pollArgs(null));

    expect(res.incomplete).toBe(true);
    expect(res.mirrorScope).toBeDefined();
    // Ends at the newest start actually seen, never at the window's far edge.
    expect(res.mirrorScope!.to.toISOString()).toBe(
      res.records.reduce((m, r) => (r.occurredAt > m ? r.occurredAt : m), new Date(0)).toISOString(),
    );
    expect(res.mirrorScope!.to.getTime()).toBeLessThan(Date.now() + 365 * 864e5);
  });

  it("deepens the window to a backfill's floor instead of silently keeping 30 days", async () => {
    // A 90-day history import asked for ninety days and used to get thirty,
    // then report success.
    const floor = new Date(Date.now() - 90 * 864e5);
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input));
        return jsonResponse({ items: [item("a1")] });
      }),
    );
    const res = await googleCalendarConnector.poll!({ ...pollArgs(null), windowFloor: floor });
    expect(new URL(urls[0]).searchParams.get("timeMin")).toBe(floor.toISOString());
    expect(res.mirrorScope!.from.toISOString()).toBe(floor.toISOString());
  });

  it("ignores a floor shallower than the default rather than narrowing the window", async () => {
    // Narrowing would hand the retire a span it has no business tombstoning in.
    const shallow = new Date(Date.now() - 2 * 864e5);
    const res = await (async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [item("a1")] })));
      return googleCalendarConnector.poll!({ ...pollArgs(null), windowFloor: shallow });
    })();
    expect(res.mirrorScope!.from.getTime()).toBeLessThan(shallow.getTime());
  });

  it("never stores a cancelled event as a live meeting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          items: [
            item("live"),
            // The tombstone shape an incremental sync sends for a deletion.
            { id: "gone", status: "cancelled" },
          ],
        }),
      ),
    );
    const res = await googleCalendarConnector.poll!(pollArgs(null));
    expect(res.records).toHaveLength(1);
    expect(res.records[0].eventId).toContain("live");
  });
});
