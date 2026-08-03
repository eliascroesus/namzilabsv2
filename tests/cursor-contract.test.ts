import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { primeStream, syncStream } from "@/lib/sync/streams";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * `PollResult.nextCursor: null` means START OVER.
 *
 * The type cannot distinguish that from "nothing changed", and the runner used
 * to implement the other reading — `cursor = nextCursor ?? cursor`, which folds
 * null back to the previous value. Two connectors already assumed reset, and
 * both were silently broken by it:
 *
 * - **Calendly** returns null when a scan reaches its last page, meaning
 *   "rescan the window next sweep". Folded back, the cursor stayed pinned to
 *   that final page token and every later sweep re-fetched the same last page.
 *   No booking made after the first sweep was ever ingested.
 * - **Google Calendar** returns null on a 410, meaning "this sync token is dead,
 *   do a full resync". Folded back, it re-sent the dead token forever.
 *
 * Both are one-line `return null` sites, which is exactly why the ambiguity was
 * invisible. These cases pin the contract from the runner's side.
 */

const ORG = "org_cursor";
const KEY = randomBytes(32).toString("base64");
/**
 * Google Calendar, not Sheets: Sheets is a MIRROR source and takes the other
 * branch of syncStream entirely, so it can never exercise the incremental
 * cursor. Calendar is stream-scoped AND incremental AND has a real
 * `return null` (the 410 path) — the exact shape of the production bug.
 */
const CFG = { calendarId: "primary" };

let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [row] = await db
    .insert(connections)
    .values({
      orgId: ORG,
      source: "gcal",
      name: "Calendar",
      status: "active",
      authType: "oauth2",
      // No refreshToken → the Google refresh path is skipped and the token is used as-is.
      credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
    })
    .returning({ id: connections.id });
  connId = row.id;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

/** A stream row for the Calendar connection, with a cursor already stored. */
async function seedStream(cursor: string | null) {
  const configHash = streamConfigHash(CFG, "gcal");
  await db.insert(sourceStreams).values({ orgId: ORG, connectionId: connId, configHash, config: CFG, cursor });
  const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, configHash)).limit(1);
  return stream;
}

async function storedCursor(): Promise<string | null> {
  const [s] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
  return s?.cursor ?? null;
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function runSweep() {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
  const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
  return syncStream(db, conn, stream, 1);
}

describe("nextCursor: null means start over, not carry on", () => {
  /**
   * THE regression, driven through the real connector and the real runner.
   * A dead sync token used to be written straight back, so the connection 410'd
   * on every sweep forever with no way out but a manual full re-sync.
   */
  it("a 410 clears the stored sync token instead of writing it back", async () => {
    await seedStream("DEAD_SYNC_TOKEN");
    vi.stubGlobal("fetch", vi.fn(async () => respond(410, { error: "sync token expired" })));

    await runSweep();

    expect(await storedCursor()).toBeNull();
  });

  it("the next sweep then does a full list, and stores the fresh token", async () => {
    await seedStream("DEAD_SYNC_TOKEN");
    vi.stubGlobal("fetch", vi.fn(async () => respond(410, { error: "expired" })));
    await runSweep();

    // Second sweep: no cursor, so Calendar does a bounded full list.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input));
        return respond(200, { items: [], nextSyncToken: "FRESH_TOKEN" });
      }),
    );
    await runSweep();

    expect(urls[0]).toContain("timeMin="); // a full list, not a syncToken read
    expect(urls[0]).not.toContain("syncToken=");
    expect(await storedCursor()).toBe("FRESH_TOKEN");
  });

  it("a live token is kept — 'no change' is a cursor, never null", async () => {
    await seedStream("LIVE_TOKEN");
    // No nextSyncToken and no nextPageToken: Calendar returns args.cursor.
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { items: [] })));

    await runSweep();

    expect(await storedCursor()).toBe("LIVE_TOKEN");
  });

});

/**
 * A page that yields no records is not the end of the data, and a scan cut short
 * by its page budget must say so.
 *
 * Driven through Calendly rather than Calendar because Calendar drains its pages
 * inside a single poll; Calendly returns one page per call, which is what puts
 * the decision in the runner's hands.
 */
describe("an empty page does not end the scan", () => {
  const CAL_CFG = { scope: "user" };

  const ev = (uri: string, name: string) => ({
    uri,
    name,
    status: "active",
    start_time: "2026-07-20T10:00:00Z",
    created_at: "2026-07-01T10:00:00Z",
  });

  beforeEach(async () => {
    await db.update(connections).set({ source: "calendly" }).where(eq(connections.id, connId));
    const configHash = streamConfigHash(CAL_CFG, "calendly");
    await db.insert(sourceStreams).values({ orgId: ORG, connectionId: connId, configHash, config: CAL_CFG, cursor: null });
  });

  /**
   * "0 loaded" and "0 loaded so far" are different claims. When the walk stops
   * because it ran out of page budget rather than data, the count is a floor —
   * and a Test that renders the two identically is the silent zero again.
   */
  it("reports an incomplete scan, so a partial count is never shown as the answer", async () => {
    let endless = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return respond(200, { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        // Always another page, and a DIFFERENT token each time so the cursor
        // genuinely advances — the source never runs out, so only the page
        // budget can stop the walk.
        endless += 1;
        return respond(200, { collection: [ev(`A${endless}`, "Wanted")], pagination: { next_page: `https://api.calendly.com/scheduled_events?page_token=P${endless}` } });
      }),
    );

    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
    const partial = await syncStream(db, conn, stream, 2);
    expect(partial.incomplete).toBe(true);

    // And the Test path turns that into something the user can read: the window
    // it actually covers (Calendly's 30 days back plus everything upcoming),
    // followed by the reason the count can still move.
    const primed = await primeStream(db, ORG, connId, CAL_CFG, { force: true, maxPages: 2 });
    expect(primed.ok).toBe(true);
    if (primed.ok) {
      expect(primed.note).toContain("last 30 days and onwards");
      expect(primed.note).toContain("still loading");
    }
  });

  it("does not cry partial when the scan actually finished", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return respond(200, { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        return respond(200, { collection: [ev("A", "Wanted")], pagination: { next_page: null } });
      }),
    );
    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
    const done = await syncStream(db, conn, stream, 5);
    expect(done.incomplete).toBeFalsy();
  });

  /**
   * The stranded import. Calendly's history window narrowed from a year to 30
   * days; the older rows sat behind the new floor with a gap between them and
   * the current window, matching neither. A rolling window that only ever adds
   * is not a window.
   *
   * Safe only because `occurred_at` is meeting start time — the same axis
   * `min_start_time`/`max_start_time` filter on. When it was booking time, this
   * retire would have tombstoned live meetings booked long ago.
   */
  it("retires rows that fall outside the window it now covers", async () => {
    const now = Date.now();
    const inWindow = new Date(now - 5 * 86_400_000).toISOString();
    const stranded = new Date(now - 300 * 86_400_000).toISOString(); // last year's import

    // Seed a row from the old, wider window under this stream's hash.
    await db.insert(events).values({
      orgId: ORG,
      connectionId: connId,
      source: "calendly",
      streamHash: streamConfigHash(CAL_CFG, "calendly"),
      eventId: "calendly:old:stranded",
      eventType: "booked",
      occurredAt: new Date(stranded),
      syncGeneration: 1,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return respond(200, { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        return respond(200, {
          collection: [{ uri: "E1", name: "Wanted", status: "active", start_time: inWindow, created_at: stranded }],
          pagination: { next_page: null },
        });
      }),
    );

    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
    const res = await syncStream(db, conn, stream, 3);

    expect(res.softDeleted).toBe(1);
    const live = await db
      .select()
      .from(events)
      .where(and(eq(events.connectionId, connId), isNull(events.deletedAt)));
    // Only the in-window meeting survives — and it survives despite having been
    // BOOKED 300 days ago, which is the whole point of the axis fix.
    expect(live).toHaveLength(1);
    expect(live[0].eventId).toContain("E1");
  });

  it("leaves everything alone when the scan was cut short", async () => {
    // A prefix of the window is not grounds for tombstoning anything.
    await db.insert(events).values({
      orgId: ORG,
      connectionId: connId,
      source: "calendly",
      streamHash: streamConfigHash(CAL_CFG, "calendly"),
      eventId: "calendly:old:stranded",
      eventType: "booked",
      occurredAt: new Date(Date.now() - 300 * 86_400_000),
      syncGeneration: 1,
    });
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return respond(200, { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        n += 1;
        return respond(200, { collection: [], pagination: { next_page: `https://api.calendly.com/scheduled_events?page_token=P${n}` } });
      }),
    );
    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
    const res = await syncStream(db, conn, stream, 2);

    expect(res.incomplete).toBe(true);
    expect(res.softDeleted).toBe(0);
  });

  it("walks past pages that come back empty, and finds the data behind them", async () => {
    let pages = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return respond(200, { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        pages += 1;
        // A provider may legitimately return an empty page mid-scan. The walk
        // used to stop at the first one and report "0 loaded".
        if (pages === 1) return respond(200, { collection: [], pagination: { next_page: "https://api.calendly.com/scheduled_events?page_token=P2" } });
        if (pages === 2) return respond(200, { collection: [], pagination: { next_page: "https://api.calendly.com/scheduled_events?page_token=P3" } });
        return respond(200, { collection: [ev("C", "Wanted")], pagination: { next_page: null } });
      }),
    );

    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
    const res = await syncStream(db, conn, stream, 3);

    expect(pages).toBe(3); // it kept going past both empty pages
    expect(res.inserted).toBe(1); // and found the meeting behind them
  });
});

/**
 * The same contract, stated at the connector boundary where it is easiest to get
 * wrong. Each of these is a real `return` in a shipped connector.
 */
describe("what each connector means by its nextCursor", () => {
  it("Google Calendar: a 410 clears the sync token instead of re-sending it", async () => {
    const { googleCalendarConnector } = await import("@/connectors/google-calendar");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 410,
        statusText: "Gone",
        headers: { get: () => null },
        json: async () => ({ error: "expired" }),
        text: async () => "sync token expired",
      }) as unknown as Response),
    );
    const res = await googleCalendarConnector.poll!({
      connectionId: "c1",
      cursor: "DEAD_SYNC_TOKEN",
      credentials: { accessToken: "t" },
      config: { calendarId: "primary" },
    });
    expect(res.nextCursor).toBeNull(); // → runner clears it → next sweep does a full list
    expect(res.records).toEqual([]);
  });

  it("Google Calendar: an ordinary page returns the cursor it was given, meaning keep", async () => {
    const { googleCalendarConnector } = await import("@/connectors/google-calendar");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => ({ items: [] }), // no nextSyncToken, no nextPageToken
        text: async () => "",
      }) as unknown as Response),
    );
    const res = await googleCalendarConnector.poll!({
      connectionId: "c1",
      cursor: "LIVE_SYNC_TOKEN",
      credentials: { accessToken: "t" },
      config: { calendarId: "primary" },
    });
    expect(res.nextCursor).toBe("LIVE_SYNC_TOKEN");
  });
});
