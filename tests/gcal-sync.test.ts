import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { googleCalendarConnector } from "@/connectors/google-calendar";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { upsertEvents } from "@/ingestion/pipeline";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * Google Calendar sync-token CDC — the incremental strategy done right:
 * pagination is followed to the end (a >250-event calendar must not truncate),
 * the initial list never sets orderBy (Google withholds nextSyncToken when it
 * is set), updates re-emit the event, and cancellations arrive as `deleted`
 * records that tombstone without clobbering.
 */

type GcalEvent = Record<string, unknown>;
type Page = { items?: GcalEvent[]; nextPageToken?: string; nextSyncToken?: string };

const ev = (id: string, over: GcalEvent = {}): GcalEvent => ({
  id,
  status: "confirmed",
  summary: `Meeting ${id}`,
  start: { dateTime: "2026-05-01T10:00:00Z" },
  ...over,
});

let fetchedUrls: string[] = [];

/** Serve pages keyed by pageToken ("" = first request). */
function servePages(pages: Record<string, Page | { status: number }>) {
  fetchedUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      fetchedUrls.push(url);
      const token = new URL(url).searchParams.get("pageToken") ?? "";
      const page = pages[token];
      if (!page) throw new Error(`unexpected pageToken: ${token}`);
      if ("status" in page && typeof page.status === "number") {
        return { ok: false, status: page.status, statusText: "Gone", json: async () => ({}), text: async () => "sync token expired" } as unknown as Response;
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => page, text: async () => "" } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = { connectionId: "c1", credentials: { accessToken: "tok" }, config: { calendarId: "primary" }, streamHash: "h" };

describe("Google Calendar polling — pagination + sync tokens", () => {
  it("follows nextPageToken across ALL pages and returns the final nextSyncToken (no >250-event truncation)", async () => {
    servePages({
      "": { items: [ev("e1")], nextPageToken: "P2" },
      P2: { items: [ev("e2")], nextPageToken: "P3" },
      P3: { items: [ev("e3")], nextSyncToken: "SYNC1" },
    });

    const res = await googleCalendarConnector.poll!({ ...BASE, cursor: null });
    expect(res.records.map((r) => r.eventId)).toEqual(["gcal:c1:h:e1", "gcal:c1:h:e2", "gcal:c1:h:e3"]);
    expect(res.nextCursor).toBe("SYNC1");
    expect(fetchedUrls).toHaveLength(3);

    // The initial list must NOT set orderBy (it suppresses nextSyncToken) and
    // must bound the window with timeMin, not a syncToken.
    const first = new URL(fetchedUrls[0]);
    expect(first.searchParams.get("orderBy")).toBeNull();
    expect(first.searchParams.get("syncToken")).toBeNull();
    expect(first.searchParams.get("timeMin")).not.toBeNull();
    expect(first.searchParams.get("singleEvents")).toBe("true");
  });

  it("an incremental poll passes the stored syncToken and receives only the delta", async () => {
    servePages({ "": { items: [ev("e2", { summary: "Renamed" })], nextSyncToken: "SYNC2" } });
    const res = await googleCalendarConnector.poll!({ ...BASE, cursor: "SYNC1" });
    const first = new URL(fetchedUrls[0]);
    expect(first.searchParams.get("syncToken")).toBe("SYNC1");
    expect(first.searchParams.get("timeMin")).toBeNull();
    expect(res.records).toHaveLength(1);
    expect(res.records[0].subject).toBe("Renamed");
    expect(res.nextCursor).toBe("SYNC2");
  });

  it("maps status=cancelled to a deleted record", async () => {
    servePages({ "": { items: [ev("e1"), ev("e2", { status: "cancelled" })], nextSyncToken: "S" } });
    const res = await googleCalendarConnector.poll!({ ...BASE, cursor: "T" });
    expect(res.records.find((r) => r.eventId.endsWith("e1"))!.deleted).toBeUndefined();
    expect(res.records.find((r) => r.eventId.endsWith("e2"))!.deleted).toBe(true);
  });

  it("heals an expired sync token: 410 → empty batch + null cursor (next sweep relists in full)", async () => {
    servePages({ "": { status: 410 } });
    const res = await googleCalendarConnector.poll!({ ...BASE, cursor: "EXPIRED" });
    expect(res).toEqual({ records: [], nextCursor: null });
  });

  it("keeps what it read and the OLD cursor when the page cap trips (giant calendar, no data loss)", async () => {
    // Every page advertises another page — the 40-page safety valve must trip.
    const pages: Record<string, Page> = { "": { items: [ev("e0")], nextPageToken: "P1" } };
    for (let i = 1; i <= 45; i++) pages[`P${i}`] = { items: [ev(`e${i}`)], nextPageToken: `P${i + 1}` };
    servePages(pages);

    const res = await googleCalendarConnector.poll!({ ...BASE, cursor: "OLD" });
    expect(res.records.length).toBe(40); // one per page up to the cap
    expect(res.nextCursor).toBe("OLD"); // retry the walk next sweep — never a half-baked token
  });
});

describe("Google Calendar through the store — updates refresh, cancellations tombstone", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("an updated event refreshes in place; a later cancellation soft-deletes WITHOUT clobbering it", async () => {
    const connectionId = await seedConnection(db, { source: "gcal" });
    const meta = { orgId: "org_test", connectionId, source: "gcal", streamHash: "h", generation: 1 };

    // Initial import.
    servePages({ "": { items: [ev("e1", { summary: "Kickoff", attendees: [{ email: "a@b.com" }] })], nextSyncToken: "S1" } });
    const p1 = await googleCalendarConnector.poll!({ ...BASE, connectionId, cursor: null });
    await upsertEvents(db, meta, p1.records);

    // Delta: the meeting was renamed and moved.
    servePages({ "": { items: [ev("e1", { summary: "Kickoff (moved)", start: { dateTime: "2026-05-02T10:00:00Z" } })], nextSyncToken: "S2" } });
    const p2 = await googleCalendarConnector.poll!({ ...BASE, connectionId, cursor: "S1" });
    const r2 = await upsertEvents(db, meta, p2.records);
    expect(r2).toMatchObject({ inserted: 0, updated: 1 });

    let [stored] = await db.select().from(events).where(eq(events.eventId, `gcal:${connectionId}:h:e1`));
    expect(stored.subject).toBe("Kickoff (moved)");
    expect(stored.occurredAt.toISOString()).toBe("2026-05-02T10:00:00.000Z");
    expect(stored.deletedAt).toBeNull();

    // Delta: cancelled — Google sends a skeleton (no summary/start).
    servePages({ "": { items: [{ id: "e1", status: "cancelled" }], nextSyncToken: "S3" } });
    const p3 = await googleCalendarConnector.poll!({ ...BASE, connectionId, cursor: "S2" });
    await upsertEvents(db, meta, p3.records);

    [stored] = await db.select().from(events).where(eq(events.eventId, `gcal:${connectionId}:h:e1`));
    expect(stored.deletedAt).not.toBeNull(); // gone from flows
    expect(stored.subject).toBe("Kickoff (moved)"); // history intact — skeleton never clobbers
    expect((stored.properties as Record<string, unknown>).summary).toBe("Kickoff (moved)");
  });
});
