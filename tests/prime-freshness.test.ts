import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { primeStream } from "@/lib/sync/streams";
import { primeConnection } from "@/lib/sync/resync";
import { claimCalls, laneLimit, pauseConnection } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
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
    const hash = streamConfigHash(CFG, "gsheets");
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
      const hash = streamConfigHash(CFG, "gsheets");
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
    // Pin the clock BEFORE spending: the sliding window carries the previous
    // minute's spend forward, so an unpinned real-clock loop that straddled a
    // boundary would split the spend across two buckets and change which
    // claim denies. (Under the old fixed window this flake was permissive —
    // a straddle under-charged; under the sliding window it would be
    // restrictive, firing on the later allowed-assertions.)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:30Z"));
    // Spend the whole interactive budget for this connection's minute window —
    // against the operation a Sheets poll actually claims. Not `"*"`: this
    // project's quota is per API, so Sheets (60/min per user) and Drive
    // (12,000/min) are separate buckets and draining a wildcard one would drain
    // nothing the sweep ever asks for.
    const op = pollOperation("gsheets");
    const total = laneLimit("gsheets", op, "interactive");
    for (let i = 0; i < total; i++) {
      await claimCalls(db, { id: connId, orgId: ORG, source: "gsheets" }, op, 1, new Date(), "interactive");
    }
    SHEET.push(["Bob", "bob@acme.com"]);

    const denied = await primeStream(db, ORG, connId, CFG, { force: true });
    expect(denied.ok).toBe(true);
    if (denied.ok) {
      expect(denied.refreshed).toBe(false);
      expect(denied.note).toContain("Couldn't re-read the source");
    }
    expect(await liveRows()).toHaveLength(0); // nothing synced — but no error either

    // TWO minutes later — a single minute boundary is no longer an amnesty
    // under the sliding window (the spent minute would still carry into the
    // next one); after two, the past has fully decayed and the Test
    // refreshes normally, saying nothing.
    vi.setSystemTime(new Date("2026-07-01T12:02:30Z"));
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

/**
 * The gap `primeStream` could not cover, and what it cost.
 *
 * `primeStreamsForTest` only primed a step whose `sourceConfig` was non-empty.
 * Sendblue and Close have no flowFields — the account IS the resource — so their
 * steps carry an empty config and the refresh was skipped entirely. Test then ran
 * the flow over whatever storage held and printed "0 loaded · No records
 * returned": identical to a genuinely empty source, with no request made and so
 * nothing to diagnose. It also made connector fixes look inert, since changing a
 * poll cannot change a Test that never calls it.
 */
describe("primeConnection — sources with no per-flow resource", () => {
  const SB_KEY = { apiKey: "kid", apiSecret: "ksec" };
  let sbId: string;

  const message = (handle: string, minsAgo: number) => ({
    message_handle: handle,
    status: "DELIVERED",
    is_outbound: true,
    to_number: "+15551234567",
    date_sent: new Date(Date.now() - minsAgo * 60_000).toISOString(),
  });

  async function connectSendblue(): Promise<string> {
    const [row] = await db
      .insert(connections)
      .values({
        orgId: ORG,
        source: "sendblue",
        name: "Sendblue",
        status: "active",
        authType: "secret",
        credentialsEncrypted: encrypt(JSON.stringify(SB_KEY), Buffer.from(KEY, "base64")),
      })
      .returning({ id: connections.id });
    return row.id;
  }

  function serve(messages: unknown[], status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers: { get: () => null },
        json: async () => ({ messages }),
        text: async () => JSON.stringify({ messages }),
      }) as unknown as Response),
    );
  }

  beforeEach(async () => {
    sbId = await connectSendblue();
  });

  it("actually calls the provider and stores what comes back", async () => {
    serve([message("h1", 10), message("h2", 20)]);
    const res = await primeConnection(db, ORG, sbId);
    expect(res).toEqual({ ok: true, refreshed: true });

    const rows = await db.select().from(events).where(and(eq(events.connectionId, sbId), isNull(events.deletedAt)));
    expect(rows).toHaveLength(2);
  });

  it("reports a provider failure as an error, not as zero records", async () => {
    // THE regression: before, this path was never reached and the user saw
    // "0 loaded" with no indication anything had gone wrong.
    serve([], 401);
    const res = await primeConnection(db, ORG, sbId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("401");
  });

  it("an account that really is empty stays zero, with no error", async () => {
    serve([]);
    const res = await primeConnection(db, ORG, sbId);
    expect(res).toEqual({ ok: true, refreshed: true });
    const rows = await db.select().from(events).where(eq(events.connectionId, sbId));
    expect(rows).toHaveLength(0);
  });

  it("declines to touch a stream-scoped connection — that is primeStream's job", async () => {
    serve([message("h1", 5)]);
    const res = await primeConnection(db, ORG, connId); // the gsheets connection
    expect(res).toEqual({ ok: true, refreshed: false });
  });

  it("honors the same pause guard as primeStream, with the same wording", async () => {
    await pauseConnection(db, sbId, 60_000, "provider limit");
    serve([message("h1", 5)]);
    const res = await primeConnection(db, ORG, sbId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.refreshed).toBe(false);
      expect(res.note).toContain("Couldn't re-read the source");
    }
  });

  /**
   * The day-one experience this fixes: a connection-scoped source has no page
   * loop in the runner (`connector.poll` is called once), so Close and Sendblue
   * could not say "still importing" no matter how much history was outstanding.
   * A new account watched a number climb for a day with nothing to explain it.
   */
  it("says it is still importing, with real coverage, when the connector reports more to fetch", async () => {
    const conn = await db.select().from(connections).where(eq(connections.id, sbId)).limit(1);
    await db.update(connections).set({ source: "close" }).where(eq(connections.id, sbId));
    expect(conn).toHaveLength(1);

    // 260 events an hour apart, newest-first: Close walks 4 pages of 50 and
    // stops with more left. Spaced by the HOUR so the coverage it reports is a
    // real number of days rather than a rounding artefact of a 4-hour fixture.
    const T0 = Date.now() - 20 * 86_400_000;
    const log = Array.from({ length: 260 }, (_, i) => ({
      id: `e${i + 1}`,
      object_type: "activity.sms",
      action: "created",
      date_created: new Date(T0 + i * 3_600_000).toISOString(),
    })).reverse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const params = new URL(String(input)).searchParams;
        // Honors date_created__gte, so the connector's window rungs behave as
        // they do live — a mock that ignored the bound would keep the whole walk
        // on the opening rung and never exercise the step out to the target.
        const gte = params.get("date_created__gte");
        const rows = gte ? log.filter((e) => Date.parse(e.date_created) >= Date.parse(gte)) : log;
        const offset = params.get("_cursor") ? Number(params.get("_cursor")) : 0;
        const page = rows.slice(offset, offset + 50);
        const body = { data: page, cursor_next: offset + page.length < rows.length ? String(offset + page.length) : null };
        return { ok: true, status: 200, statusText: "OK", headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
      }),
    );

    const res = await primeConnection(db, ORG, sbId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.refreshed).toBe(true);
      expect(res.note).toContain("Still importing");
      // Both numbers are real — the SPAN ingested against the 30-day window.
      // 200 of 260 hourly events ≈ 8 days, and pinning the numerator is what
      // stops this passing on "covering 0 of 30 days".
      expect(res.note).toMatch(/covering 8 of 30 days/);
    }
  });
});
