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
    expect(res).toEqual({ records: [], nextCursor: null });
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
