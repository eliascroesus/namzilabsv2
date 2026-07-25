import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { primeStream } from "@/lib/sync/streams";
import { claimCalls, laneLimit, pauseConnection } from "@/lib/provider-gateway/budget";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * Defect #1 regression: an explicit user Test must read the CURRENT source.
 *
 * The old gate (`if (stream.lastPolledAt != null) return`) skipped the re-read
 * FOREVER once the 10-minute sweep had touched a stream, so a Test computed
 * over stale, pre-edit data indefinitely. The fix: `force: true` (the Test
 * path) always re-polls; a non-forced prime (passive surfaces like field
 * pickers) skips only within a small freshness window.
 */

const ORG = "org_prime";
const KEY = randomBytes(32).toString("base64");
const CFG = { spreadsheetId: "SHEET_LIVE", range: "Tab1" };

// Mutable "living spreadsheet": header + data rows served by the mocked fetch.
let SHEET: string[][] = [];
let fetchCalls = 0;

let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  SHEET = [
    ["name", "email"],
    ["Alice", "alice@acme.com"],
  ];
  fetchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/values/")) throw new Error(`unexpected fetch: ${url}`);
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ values: SHEET }),
        text: async () => JSON.stringify({ values: SHEET }),
      } as unknown as Response;
    }),
  );
  const [row] = await db
    .insert(connections)
    .values({
      orgId: ORG,
      source: "gsheets",
      name: "Sheets",
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

async function liveRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connId), isNull(events.deletedAt)));
  return rows.map((r) => r.properties as Record<string, unknown>);
}

describe("primeStream freshness gate (Defect #1)", () => {
  it("first prime pulls the sheet; a forced prime after an edit reflects the current source", async () => {
    const first = await primeStream(db, ORG, connId, CFG);
    expect(first).toEqual({ ok: true, refreshed: true });
    expect(await liveRows()).toEqual([{ name: "Alice", email: "alice@acme.com" }]);

    // The user edits the sheet (new row) AFTER the sweep has already polled once.
    SHEET.push(["Bob", "bob@acme.com"]);

    // Explicit Test → force: must re-read even though lastPolledAt is fresh.
    const forced = await primeStream(db, ORG, connId, CFG, { force: true });
    expect(forced).toEqual({ ok: true, refreshed: true });
    expect(await liveRows()).toEqual([
      { name: "Alice", email: "alice@acme.com" },
      { name: "Bob", email: "bob@acme.com" },
    ]);
  });

  it("non-forced prime skips within the freshness window (passive surfaces stay cheap)", async () => {
    await primeStream(db, ORG, connId, CFG);
    const callsAfterFirst = fetchCalls;
    SHEET.push(["Bob", "bob@acme.com"]);

    // Field-picker-style prime right after: recently polled → no provider call.
    const lazy = await primeStream(db, ORG, connId, CFG);
    expect(lazy).toEqual({ ok: true, refreshed: false });
    expect(fetchCalls).toBe(callsAfterFirst);
    expect(await liveRows()).toHaveLength(1);
  });

  it("non-forced prime re-polls once the last poll is older than maxAge (no permanent skip)", async () => {
    await primeStream(db, ORG, connId, CFG);
    SHEET.push(["Bob", "bob@acme.com"]);

    // Backdate the stream's lastPolledAt beyond the window — the old code
    // skipped forever here; the gate must re-poll now.
    const hash = streamConfigHash(CFG);
    await db
      .update(sourceStreams)
      .set({ lastPolledAt: new Date(Date.now() - 10 * 60_000) })
      .where(and(eq(sourceStreams.connectionId, connId), eq(sourceStreams.configHash, hash)));

    const later = await primeStream(db, ORG, connId, CFG);
    expect(later).toEqual({ ok: true, refreshed: true });
    expect(await liveRows()).toHaveLength(2);
  });

  it("Q6 (pool driver): a forced Test adopts a just-completed concurrent sync instead of double-polling", async () => {
    process.env.DB_DRIVER = "pool";
    try {
      await primeStream(db, ORG, connId, CFG); // initial import
      const callsAfterFirst = fetchCalls;

      // Simulate the awaited in-flight sync finishing DURING our wait: its
      // completion stamps lastPolledAt after our call starts.
      const hash = streamConfigHash(CFG);
      await db
        .update(sourceStreams)
        .set({ lastPolledAt: new Date(Date.now() + 250), status: "active" })
        .where(and(eq(sourceStreams.connectionId, connId), eq(sourceStreams.configHash, hash)));

      const forced = await primeStream(db, ORG, connId, CFG, { force: true });
      expect(forced).toEqual({ ok: true, refreshed: true });
      // No second provider call — the concurrent sync's read IS the fresh data.
      expect(fetchCalls).toBe(callsAfterFirst);
    } finally {
      delete process.env.DB_DRIVER;
    }
  });

  it("Q6 (pool driver): with no fresh concurrent sync, the forced Test still re-polls itself", async () => {
    process.env.DB_DRIVER = "pool";
    try {
      await primeStream(db, ORG, connId, CFG);
      const callsAfterFirst = fetchCalls;
      SHEET.push(["Bob", "bob@acme.com"]);

      const forced = await primeStream(db, ORG, connId, CFG, { force: true });
      expect(forced).toEqual({ ok: true, refreshed: true });
      expect(fetchCalls).toBeGreaterThan(callsAfterFirst); // own sync ran
      expect(await liveRows()).toHaveLength(2);
    } finally {
      delete process.env.DB_DRIVER;
    }
  });

  it("F.8: a paused connection makes Test compute on stored data with an honest note — never an error", async () => {
    await primeStream(db, ORG, connId, CFG); // seed stored data
    const callsAfterFirst = fetchCalls;
    SHEET.push(["Bob", "bob@acme.com"]);

    await pauseConnection(db, connId, 30 * 60_000, "Respecting Google's rate limit — resumes automatically");

    const res = await primeStream(db, ORG, connId, CFG, { force: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.refreshed).toBe(false); // did NOT pretend to re-read
      expect(res.note).toContain("Couldn't re-read the source");
      expect(res.note).toContain("paused");
    }
    expect(fetchCalls).toBe(callsAfterFirst); // no provider call was spent
    expect(await liveRows()).toHaveLength(1); // stored data is what Test computes on
  });

  it("F.8: an exhausted budget yields the same honesty (note, not failure); a healthy claim refreshes", async () => {
    // Spend the whole interactive budget for this connection's minute window.
    const total = laneLimit("gsheets", "*", "interactive");
    for (let i = 0; i < total; i++) {
      await claimCalls(db, { id: connId, orgId: ORG, source: "gsheets" }, "*", 1, new Date(), "interactive");
    }
    SHEET.push(["Bob", "bob@acme.com"]);

    const denied = await primeStream(db, ORG, connId, CFG, { force: true });
    expect(denied.ok).toBe(true);
    if (denied.ok) {
      expect(denied.refreshed).toBe(false);
      expect(denied.note).toContain("Couldn't re-read the source");
    }
    expect(await liveRows()).toHaveLength(0); // nothing synced — but no error either

    // Next minute: budget resets, the Test refreshes normally and says nothing.
    vi.setSystemTime(new Date(Date.now() + 61_000));
    const ok = await primeStream(db, ORG, connId, CFG, { force: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.refreshed).toBe(true);
      expect(ok.note).toBeUndefined();
    }
    expect(await liveRows()).toHaveLength(2);
    vi.useRealTimers();
  });

  it("surfaces poll errors instead of throwing (Test shows the message)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({}),
        text: async () => "insufficient permissions",
      }) as unknown as Response),
    );
    const res = await primeStream(db, ORG, connId, CFG, { force: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("403");
  });
});
