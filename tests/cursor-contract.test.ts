import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, sourceStreams } from "@/db/schema";
import { syncStream } from "@/lib/sync/streams";
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

/** A stream row for the gsheets connection, with a cursor already stored. */
async function seedStream(cursor: string | null) {
  const configHash = streamConfigHash(CFG);
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
 * A page that yields no records is not the end of the data.
 *
 * Calendly's API has no `event_type` parameter, so narrowing to one meeting type
 * has to happen after the fetch — which means a page can legitimately come back
 * full and leave nothing. The walk used to stop there, and the wider the scope
 * the likelier it was: "just me" fits on page one and worked, the whole
 * organization reported "0 loaded" for an account with hundreds of matching
 * meetings.
 *
 * Driven through Calendly rather than Calendar because Calendar drains its
 * pages inside a single poll; Calendly returns one page per call, which is what
 * puts the decision in the runner's hands.
 */
describe("an empty page does not end the scan", () => {
  const CAL_CFG = { scope: "user", meetingType: "Wanted" };

  const ev = (uri: string, name: string) => ({
    uri,
    name,
    status: "active",
    start_time: "2026-07-20T10:00:00Z",
    created_at: "2026-07-01T10:00:00Z",
  });

  beforeEach(async () => {
    await db.update(connections).set({ source: "calendly" }).where(eq(connections.id, connId));
    const configHash = streamConfigHash(CAL_CFG);
    await db.insert(sourceStreams).values({ orgId: ORG, connectionId: connId, configHash, config: CAL_CFG, cursor: null });
  });

  it("walks past pages the meeting-type filter empties, and finds the data behind them", async () => {
    let pages = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return respond(200, { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        pages += 1;
        // Pages 1 and 2 are other hosts' meeting types — every row filtered out.
        if (pages === 1) return respond(200, { collection: [ev("A", "Other")], pagination: { next_page_token: "P2" } });
        if (pages === 2) return respond(200, { collection: [ev("B", "Other")], pagination: { next_page_token: "P3" } });
        return respond(200, { collection: [ev("C", "Wanted")], pagination: { next_page_token: null } });
      }),
    );

    const [conn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)).limit(1);
    const res = await syncStream(db, conn, stream, 3);

    expect(pages).toBe(3); // it kept going past both empty pages
    expect(res.inserted).toBe(1); // and found the one matching meeting
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
