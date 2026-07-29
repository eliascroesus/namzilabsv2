import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, sourceStreams, usageLedger } from "@/db/schema";
import { randomBytes } from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { syncStream } from "@/lib/sync/streams";
import { streamConfigHash } from "@/lib/sync/stream-hash";

const KEY = randomBytes(32).toString("base64");
import {
  budgetFor,
  claimCalls,
  fleetBudgetFor,
  fleetLaneLimit,
  type CallLane,
  FLEET_CONNECTION_ID,
  FLEET_ORG_ID,
  isPaused,
  laneLimit,
  pauseConnection,
  applyObservedRateLimit,
  recordExtraCalls,
  recordObservedLimit,
  recordProviderError,
  recordSuccess,
  tripBreaker,
} from "@/lib/provider-gateway/budget";
import { dueConnectionsForSweep } from "@/ingestion/reconcile";
import type { DB } from "@/db/types";

/**
 * Workstream F (proactive): budgets are enforced from the catalog's declared
 * limits, exhaustion DEFERS rather than drops, and the breaker never produces
 * a terminal state — every pause carries an expiry that heals itself.
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;
const ORG = "org_test";
const NOW = new Date("2026-07-01T12:00:30Z"); // mid-minute, so window math is visible

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db, { source: "instantly" });
});
afterEach(async () => {
  await close();
});

const conn = () => ({ id: connectionId, orgId: ORG, source: "instantly" });

describe("F.1 — budgets come from the catalog's declared limits", () => {
  it("Instantly's declared 20/min emails.list budget is now ENFORCED at the configured share", () => {
    // 20 published × 0.7 share = 14 calls/minute actually spent.
    expect(budgetFor("instantly", "emails.list")).toBe(14);
    // Undeclared operations fall back to the default budget.
    expect(budgetFor("instantly", "*")).toBe(42);
    expect(budgetFor("close", "*")).toBe(42);
  });

  it("claims are atomic and deny once the window budget is spent", async () => {
    // Interactive lane sees the full budget (background stops at the reserve).
    const limit = budgetFor("instantly", "emails.list");
    for (let i = 0; i < limit; i++) {
      const r = await claimCalls(db, conn(), "emails.list", 1, NOW, "interactive");
      expect(r.allowed).toBe(true);
    }
    const denied = await claimCalls(db, conn(), "emails.list", 1, NOW, "interactive");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterMs).toBe(30_000); // remainder of the minute
      expect(denied.reason).toContain("Instantly");
    }

    // The denied claim didn't consume a token, and the throttle is recorded.
    const [row] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(row.calls).toBe(limit);
    expect(row.throttled).toBe(1);
  });

  it("concurrent claims cannot overspend the budget (atomic counter)", async () => {
    const limit = budgetFor("instantly", "emails.list");
    const results = await Promise.all(
      Array.from({ length: limit + 10 }, () => claimCalls(db, conn(), "emails.list", 1, NOW, "interactive")),
    );
    expect(results.filter((r) => r.allowed).length).toBe(limit);
    expect(results.filter((r) => !r.allowed).length).toBe(10);
  });

  it("the next minute window starts fresh", async () => {
    const limit = budgetFor("instantly", "emails.list");
    for (let i = 0; i < limit; i++) await claimCalls(db, conn(), "emails.list", 1, NOW);
    expect((await claimCalls(db, conn(), "emails.list", 1, NOW)).allowed).toBe(false);

    const nextMinute = new Date(NOW.getTime() + 60_000);
    expect((await claimCalls(db, conn(), "emails.list", 1, nextMinute)).allowed).toBe(true);
  });

  it("budgets are per operation and per connection (no cross-contamination)", async () => {
    const limit = budgetFor("instantly", "emails.list");
    for (let i = 0; i < limit; i++) await claimCalls(db, conn(), "emails.list", 1, NOW);
    // A different operation on the same connection has its own budget.
    expect((await claimCalls(db, conn(), "*", 1, NOW)).allowed).toBe(true);
    // A different connection is unaffected.
    const other = await seedConnection(db, { source: "instantly" });
    expect((await claimCalls(db, { id: other, orgId: ORG, source: "instantly" }, "emails.list", 1, NOW)).allowed).toBe(true);
  });
});

describe("F.8 — reserved headroom for interactive work", () => {
  it("background stops short of the budget; interactive may use the reserve", () => {
    // 14 total → 25% reserve (4) → background 10, interactive 14.
    expect(laneLimit("instantly", "emails.list", "background")).toBe(10);
    expect(laneLimit("instantly", "emails.list", "interactive")).toBe(14);
    expect(laneLimit("instantly", "emails.list", "background")).toBeLessThan(budgetFor("instantly", "emails.list"));
  });

  it("a user's Test can still claim after background sweeps have spent their share", async () => {
    const bg = laneLimit("instantly", "emails.list", "background");
    for (let i = 0; i < bg; i++) {
      expect((await claimCalls(db, conn(), "emails.list", 1, NOW, "background")).allowed).toBe(true);
    }
    // Background is done for this minute…
    expect((await claimCalls(db, conn(), "emails.list", 1, NOW, "background")).allowed).toBe(false);
    // …but the person clicking Test still gets through.
    expect((await claimCalls(db, conn(), "emails.list", 1, NOW, "interactive")).allowed).toBe(true);
  });

  it("once even the reserve is spent, interactive claims are denied too (bounded, not unlimited)", async () => {
    const total = laneLimit("instantly", "emails.list", "interactive");
    for (let i = 0; i < total; i++) {
      await claimCalls(db, conn(), "emails.list", 1, NOW, "interactive");
    }
    const denied = await claimCalls(db, conn(), "emails.list", 1, NOW, "interactive");
    expect(denied.allowed).toBe(false);
  });
});

describe("F.3/F.6 — the sweep filter is EXPIRY-aware (this is the probe)", () => {
  it("dispatches a connection whose pause has expired, skips one still paused", async () => {
    const paused = await seedConnection(db, { source: "instantly" });
    const expired = await seedConnection(db, { source: "instantly" });
    const healthy = await seedConnection(db, { source: "instantly" });

    await pauseConnection(db, paused, 60 * 60_000, "still waiting", NOW); // 1h out
    await pauseConnection(db, expired, -60_000, "pause elapsed", NOW); // already past

    const due = (await dueConnectionsForSweep(db, NOW)).map((c) => c.id).sort();
    expect(due).toContain(expired); // the expired pause IS dispatched → the probe fires
    expect(due).toContain(healthy);
    expect(due).toContain(connectionId); // never-paused connections unaffected
    expect(due).not.toContain(paused); // still deferred → no queue traffic
  });

  it("disabled and error connections are never dispatched, paused or not", async () => {
    const disabled = await seedConnection(db, { source: "instantly", status: "disabled" });
    const errored = await seedConnection(db, { source: "instantly", status: "error" });
    const due = (await dueConnectionsForSweep(db, NOW)).map((c) => c.id);
    expect(due).not.toContain(disabled);
    expect(due).not.toContain(errored);
  });
});

describe("F.3 — defer, never drop", () => {
  it("pausing records when work resumes and why, in user-facing language", async () => {
    const until = await pauseConnection(db, connectionId, 45_000, "Respecting Instantly's rate limit — resumes automatically", NOW);
    expect(until.getTime()).toBe(NOW.getTime() + 45_000);

    const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(row.pausedReason).toContain("Respecting Instantly");
    expect(isPaused(row, NOW)).toBe(true);
    // The pause EXPIRES — that is what makes deferral safe.
    expect(isPaused(row, new Date(NOW.getTime() + 46_000))).toBe(false);
  });
});

describe("F.6 — the breaker is never terminal", () => {
  it("walks the probe ladder 1h → 4h → daily, and every state has an expiry", async () => {
    const first = await tripBreaker(db, connectionId, "provider 500", NOW);
    expect(first.attempt).toBe(1);
    expect(first.pausedUntil.getTime()).toBe(NOW.getTime() + 60 * 60_000);

    const second = await tripBreaker(db, connectionId, "provider 500", NOW);
    expect(second.attempt).toBe(2);
    expect(second.pausedUntil.getTime()).toBe(NOW.getTime() + 4 * 60 * 60_000);

    const third = await tripBreaker(db, connectionId, "provider 500", NOW);
    expect(third.pausedUntil.getTime()).toBe(NOW.getTime() + 24 * 60 * 60_000);
    // The ladder saturates at daily — it never becomes "never".
    const fourth = await tripBreaker(db, connectionId, "provider 500", NOW);
    expect(fourth.pausedUntil.getTime()).toBe(NOW.getTime() + 24 * 60 * 60_000);

    const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(row.pausedUntil).not.toBeNull(); // always a countdown, never a dead end
    expect(row.pausedReason).toContain("failed attempt");
  });

  it("a successful poll never erases a standing webhook-health warning (clearError: false)", async () => {
    await db.update(connections).set({ lastError: "Webhook subscription check failed: provider 500" }).where(eq(connections.id, connectionId));
    await recordSuccess(db, connectionId, { clearError: false, now: NOW });
    const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(row.status).toBe("active"); // sync is healthy…
    expect(row.consecutiveFailures).toBe(0);
    expect(row.lastError).toContain("Webhook subscription check failed"); // …but the instant path isn't
  });

  it("a successful poll heals the connection completely", async () => {
    await tripBreaker(db, connectionId, "provider 500", NOW);
    await db.update(connections).set({ status: "error" }).where(eq(connections.id, connectionId));

    await recordSuccess(db, connectionId, { now: NOW });

    const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(row.consecutiveFailures).toBe(0);
    expect(row.pausedUntil).toBeNull();
    expect(row.pausedReason).toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.status).toBe("active"); // back in the sweep automatically
  });
});

describe("F.7 — the ledger is the audit trail", () => {
  it("counts calls, throttles and errors per window", async () => {
    await claimCalls(db, conn(), "emails.list", 1, NOW);
    await recordProviderError(db, conn(), "emails.list", NOW);
    const [row] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(row.calls).toBe(1);
    expect(row.errors).toBe(1);
    expect(row.provider).toBe("instantly");
    expect(row.windowStart.toISOString()).toBe("2026-07-01T12:00:00.000Z"); // minute-aligned
  });
});

/**
 * F.1 — one claim per PROVIDER REQUEST, not per sync.
 *
 * The claim was taken once by the caller and then authorised the whole page
 * walk, so a budget of N permitted up to N x maxPages real requests: the ledger
 * reported 20% utilisation while the connection was several times over the
 * provider's published limit. That is the number the whole budget layer exists
 * to keep honest.
 */
describe("the ledger counts what was actually spent", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_perpage";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await close();
  });

  async function calendlyStream(): Promise<{ conn: typeof connections.$inferSelect; stream: typeof sourceStreams.$inferSelect }> {
    process.env.ENCRYPTION_KEY = KEY;
    const [conn] = await db
      .insert(connections)
      .values({
        orgId: ORG,
        source: "calendly",
        name: "Calendly",
        status: "active",
        authType: "oauth2",
        credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "t" }), Buffer.from(KEY, "base64")),
      })
      .returning();
    const cfg = { scope: "user" };
    const [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: conn.id, configHash: streamConfigHash(cfg, "calendly"), config: cfg })
      .returning();
    return { conn, stream };
  }

  /** Calendly returns one page per poll, so the runner's loop is what walks. */
  function serveEndlessPages() {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes("/users/me")
          ? { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } }
          : { collection: [], pagination: { next_page_token: `P${++n}` } };
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );
  }

  it("charges one call per page walked, not one per sync", async () => {
    const { conn, stream } = await calendlyStream();
    serveEndlessPages();

    await syncStream(db, conn, stream, 4);

    const [led] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, conn.id));
    expect(led.calls).toBe(4); // was 1, while four requests went out
  });

  it("stops the walk when the budget runs out mid-page, and says why", async () => {
    const { conn, stream } = await calendlyStream();
    serveEndlessPages();
    // Spend the background lane down to its last token.
    const limit = laneLimit("calendly", "scheduled_events.list", "background");
    await claimCalls(db, conn, "scheduled_events.list", limit - 1);

    const res = await syncStream(db, conn, stream, 10);

    expect(res.deferred).toBeDefined();
    expect(res.deferred!.retryAfterMs).toBeGreaterThan(0);
    expect(res.incomplete).toBe(true); // the walk did not finish
    const [led] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, conn.id));
    expect(led.calls).toBe(limit); // never exceeded, which is the point
  });
});

/**
 * F.1 (fleet) — a limit every customer spends at once.
 *
 * Per-connection budgets are right when the credential belongs to the customer:
 * Calendly's 60/min is that account's, and one customer cannot spend another's.
 * Google is the opposite — Sheets and Calendar authorize through one
 * GOOGLE_CLIENT_ID, so the quota is charged to our Cloud project. Ten
 * connections each politely under their own budget can still take the project
 * over its limit together, and the failure is not one customer throttled but
 * every Google connection failing at once.
 */
describe("F.1 (fleet) — a shared credential means a shared ceiling", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG_A = "org_fleet_a";
  const ORG_B = "org_fleet_b";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  const gsheets = (id: string, orgId: string) => ({ id, orgId, source: "gsheets" });
  /**
   * The operation a Sheets poll is claimed against. Not `"*"`: this project's
   * quota is per API, so the catalog declares Sheets (300/min) and Drive
   * (12,000/min) separately and `fleetBudgetFor` has NO wildcard fallback — a
   * wildcard here would silently mean "no fleet ceiling", which is the failure
   * the suite below exists to catch.
   */
  const SHEETS_OP = "sheets.values.get";
  const fleetRow = async (source: string) => {
    const [row] = await db
      .select()
      .from(usageLedger)
      .where(and(eq(usageLedger.connectionId, FLEET_CONNECTION_ID), eq(usageLedger.provider, source)));
    return row;
  };
  const ownCalls = async (connectionId: string) => {
    const [row] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    return row?.calls ?? 0;
  };

  /**
   * Spend the whole fleet ceiling, spread across as many customers as it takes.
   *
   * It takes several, and that is the point of the real numbers: this project
   * gets 300 Sheets reads a minute while each user's grant gets 60, so ONE
   * connection cannot exhaust the project — five polite ones together can. That
   * is precisely the failure a per-connection budget alone cannot see, and it is
   * why these tests could not stay written around a single spender.
   */
  const exhaustFleet = async (lane: CallLane = "interactive") => {
    const fleet = fleetLaneLimit("gsheets", SHEETS_OP, lane)!;
    const perConn = laneLimit("gsheets", SHEETS_OP, lane);
    let spent = 0;
    for (let n = 0; spent < fleet; n++) {
      const c = gsheets(await seedConnection(db, { orgId: `org_spender_${n}`, source: "gsheets" }), `org_spender_${n}`);
      for (let i = 0; i < perConn && spent < fleet; i++) {
        expect((await claimCalls(db, c, SHEETS_OP, 1, NOW, lane)).allowed).toBe(true);
        spent += 1;
      }
    }
    return spent;
  };

  it("denies a FRESH connection once the project budget is spent, though its own budget is untouched", async () => {
    const b = gsheets(await seedConnection(db, { orgId: ORG_B, source: "gsheets" }), ORG_B);

    // Several customers, each strictly inside its own 60/min grant, together
    // reaching the project's 300 — the shape one connection could never make.
    await exhaustFleet();

    const denied = await claimCalls(db, b, SHEETS_OP, 1, NOW, "interactive");
    expect(denied.allowed).toBe(false);
    // B has spent nothing of its own — a per-connection budget alone would have
    // waved this straight through, which is the hole this closes.
    expect(await ownCalls(b.id)).toBe(0);
  });

  it("does not charge a blameless connection for a call the fleet refused", async () => {
    const b = gsheets(await seedConnection(db, { orgId: ORG_B, source: "gsheets" }), ORG_B);
    await exhaustFleet();

    await claimCalls(db, b, SHEETS_OP, 1, NOW, "interactive");
    await claimCalls(db, b, SHEETS_OP, 1, NOW, "interactive");

    // Both attempts unwound. Otherwise B burns its personal budget on calls it
    // was never allowed to make, and stays denied on its OWN limit after the
    // shared one frees up — throttled twice for one shortage.
    expect(await ownCalls(b.id)).toBe(0);
    const [row] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, b.id));
    expect(row?.throttled ?? 0).toBe(0); // …and not blamed for it either
  });

  it("says whose limit it is, so a blameless customer is not sent hunting", async () => {
    const b = gsheets(await seedConnection(db, { orgId: ORG_B, source: "gsheets" }), ORG_B);
    await exhaustFleet();

    const denied = await claimCalls(db, b, SHEETS_OP, 1, NOW, "interactive");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/shared/i);
      expect(denied.reason).not.toMatch(/respecting/i); // the per-connection wording
    }
  });

  it("leaves per-customer credentials alone — no fleet bucket, no cross-customer throttling", async () => {
    expect(fleetBudgetFor("calendly", "scheduled_events.list")).toBeNull();
    expect(fleetBudgetFor("close", "*")).toBeNull();
    expect(fleetBudgetFor("instantly", "emails.list")).toBeNull();

    const a = { id: await seedConnection(db, { orgId: ORG_A, source: "close" }), orgId: ORG_A, source: "close" };
    const b = { id: await seedConnection(db, { orgId: ORG_B, source: "close" }), orgId: ORG_B, source: "close" };
    const limit = laneLimit("close", "*", "interactive");
    // Close publishes one account-wide limit, so `"*"` is its real bucket here.
    for (let i = 0; i < limit; i++) await claimCalls(db, a, "*", 1, NOW, "interactive");

    // A is spent; B is untouched and must still be allowed.
    expect((await claimCalls(db, a, "*", 1, NOW, "interactive")).allowed).toBe(false);
    expect((await claimCalls(db, b, "*", 1, NOW, "interactive")).allowed).toBe(true);
    expect(await fleetRow("close")).toBeUndefined(); // no sentinel row at all
  });

  /**
   * The settle-up is the load-bearing half for Google: its connectors make most
   * of their requests INSIDE one poll, so a fleet ceiling fed only by claims
   * would count one request in three and permit three times what it declares.
   */
  it("counts settled-up requests against the fleet, not just claimed ones", async () => {
    const a = gsheets(await seedConnection(db, { orgId: ORG_A, source: "gsheets" }), ORG_A);
    await claimCalls(db, a, SHEETS_OP, 1, NOW, "interactive");
    await recordExtraCalls(db, a, SHEETS_OP, 2, NOW); // the Drive probe + the re-stamp

    expect((await fleetRow("gsheets")).calls).toBe(3);
  });

  /**
   * The behavioural half of the split: a spent Sheets bucket must not take the
   * Drive probe down with it. Sharing one bucket did exactly that, and it is
   * self-defeating — the probe is how a sweep decides it does NOT need a Sheets
   * read, so the first thing a Sheets shortage would block is the mechanism for
   * consuming less Sheets quota.
   */
  it("an exhausted Sheets bucket still lets the probe that saves Sheets calls through", async () => {
    const c = gsheets(await seedConnection(db, { orgId: ORG_B, source: "gsheets" }), ORG_B);
    await exhaustFleet();

    expect((await claimCalls(db, c, SHEETS_OP, 1, NOW, "interactive")).allowed).toBe(false);
    expect((await claimCalls(db, c, "drive.files.get", 1, NOW, "interactive")).allowed).toBe(true);
  });

  it("books the fleet row to a sentinel that can never be a real org or connection", async () => {
    const a = gsheets(await seedConnection(db, { orgId: ORG_A, source: "gsheets" }), ORG_A);
    await claimCalls(db, a, SHEETS_OP, 1, NOW, "interactive");

    const row = await fleetRow("gsheets");
    expect(row.orgId).toBe(FLEET_ORG_ID);
    expect(row.orgId).not.toBe(ORG_A);
    expect(row.connectionId).toBe(FLEET_CONNECTION_ID);
    expect(row.provider).toBe("gsheets"); // still legible, not an anonymous counter
    // Any future per-org aggregate must exclude this row, or it attributes every
    // other customer's calls to whoever it is summing.
    expect(row.orgId.startsWith("__")).toBe(true);
  });

  it("gives interactive work headroom the background lane cannot reach", async () => {
    const b = gsheets(await seedConnection(db, { orgId: ORG_B, source: "gsheets" }), ORG_B);
    // Spent to the BACKGROUND ceiling of the fleet bucket, which stops short of
    // the reserve — so the shared quota is out for sweeps and not for people.
    await exhaustFleet("background");

    expect((await claimCalls(db, b, SHEETS_OP, 1, NOW, "background")).allowed).toBe(false);
    expect((await claimCalls(db, b, SHEETS_OP, 1, NOW, "interactive")).allowed).toBe(true); // a Test still gets through
  });
});

/**
 * The runner's per-page claim only counts the pages IT walks. A connector that
 * makes several requests inside one `poll()` was invisible to it, and on the
 * stream path nothing ever settled up — so the ledger recorded a fraction of
 * the real spend for every stream-scoped source.
 *
 * It matters most for Google, whose quota is per Cloud PROJECT: one OAuth
 * client shared by every customer (`GOOGLE_CLIENT_ID`, google-oauth.ts:33), so
 * an under-count is not one account's problem but the whole fleet's.
 */
describe("stream-scoped spend is settled after the fact", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_sheets_spend";
  const SHEET = "SHEET_1";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await close();
  });

  async function sheetStream(cursor: string | null) {
    process.env.ENCRYPTION_KEY = KEY;
    const [conn] = await db
      .insert(connections)
      .values({
        orgId: ORG,
        source: "gsheets",
        name: "Sheets",
        status: "active",
        authType: "oauth2",
        credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "t" }), Buffer.from(KEY, "base64")),
      })
      .returning();
    const cfg = { spreadsheetId: SHEET, range: "Tab1" };
    const [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: conn.id, configHash: streamConfigHash(cfg, "gsheets"), config: cfg, cursor })
      .returning();
    return { conn, stream };
  }

  /** Drive reports `stamp`; the values endpoint returns one data row. */
  function serveSheet(stamp: { modifiedTime: string; version: string }) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        const body = url.startsWith("https://www.googleapis.com/drive/v3/files")
          ? stamp
          : { values: [["email"], ["a@example.com"]] };
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );
    return calls;
  }

  /** Total calls charged across every operation, and per operation. */
  const ledgerCalls = async (connectionId: string) => {
    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    return rows.reduce((n, r) => n + r.calls, 0);
  };
  const ledgerFor = async (connectionId: string, operation: string) => {
    const rows = await db
      .select()
      .from(usageLedger)
      .where(and(eq(usageLedger.connectionId, connectionId), eq(usageLedger.operation, operation)));
    return rows.reduce((n, r) => n + r.calls, 0);
  };

  it("charges a changed sheet both of its requests, not the one claimed", async () => {
    // A marker that will NOT match, so the probe falls through to a full read.
    const { conn, stream } = await sheetStream(JSON.stringify({ stamp: "OLD|1", skips: 0 }));
    const calls = serveSheet({ modifiedTime: "2026-07-01T00:00:00Z", version: "9" });

    await syncStream(db, conn, stream, 1);

    expect(calls).toHaveLength(2); // Drive probe + values read; the probe's stamp is reused
    expect(await ledgerCalls(conn.id)).toBe(2); // was 1, while two requests went out
    // …and each request against ITS OWN API's budget. This project gets 300
    // Sheets reads a minute and 12,000 Drive requests; one bucket would make the
    // Sheets number ration the Drive probe too.
    expect(await ledgerFor(conn.id, "sheets.values.get")).toBe(1);
    expect(await ledgerFor(conn.id, "drive.files.get")).toBe(1);
  });

  it("charges an unchanged sheet the one probe it really made", async () => {
    const stamp = { modifiedTime: "2026-07-01T00:00:00Z", version: "9" };
    const { conn, stream } = await sheetStream(JSON.stringify({ stamp: `${stamp.modifiedTime}|${stamp.version}`, skips: 0 }));
    const calls = serveSheet(stamp);

    await syncStream(db, conn, stream, 1);

    expect(calls).toHaveLength(1); // the skip is real: no values read
    expect(await ledgerCalls(conn.id)).toBe(1);
    // The saving lands where it was made. The claim reserved a Sheets read up
    // front; the poll only probed Drive, so the reservation is handed back —
    // otherwise a skip costs the tight bucket exactly what a read does and the
    // change detection is invisible to the thing rationing the quota.
    expect(await ledgerFor(conn.id, "sheets.values.get")).toBe(0);
    expect(await ledgerFor(conn.id, "drive.files.get")).toBe(1);
  });

  /**
   * The skip must STAY a skip across sweeps. A skip that quietly reverted to a
   * full read would still look correct — same rows, same tiles — and show up
   * only as three times the quota, which is the failure this whole pass exists
   * to make visible.
   *
   * (This does not pin the settle-up: a skip spends exactly the one request the
   * claim already counted, so reporting it is a no-op arithmetically. The
   * changed-sheet case above is what pins it.)
   */
  it("keeps costing one request per sweep while the sheet is unchanged", async () => {
    const stamp = { modifiedTime: "2026-07-01T00:00:00Z", version: "9" };
    const { conn, stream } = await sheetStream(JSON.stringify({ stamp: `${stamp.modifiedTime}|${stamp.version}`, skips: 0 }));
    const calls = serveSheet(stamp);

    await syncStream(db, conn, stream, 1);
    await syncStream(db, conn, stream, 1);

    expect(calls).toHaveLength(2); // two sweeps, two probes — not two full reads
    expect(await ledgerCalls(conn.id)).toBe(2);
  });

  it("charges a first sync its two requests (no marker to probe against)", async () => {
    const { conn, stream } = await sheetStream(null);
    const calls = serveSheet({ modifiedTime: "2026-07-01T00:00:00Z", version: "9" });

    await syncStream(db, conn, stream, 1);

    expect(calls).toHaveLength(2); // values read + Drive stamp; nothing to compare yet
    expect(await ledgerCalls(conn.id)).toBe(2);
  });

  /**
   * Calendar is the worst case, and it is on the OTHER branch of syncStream.
   * Google only reveals `nextSyncToken` on the last page, so one `poll()` drains
   * up to MAX_PAGES = 8 requests — all of them under a single claimed page.
   */
  it("charges Calendar every page it drained inside one poll", async () => {
    process.env.ENCRYPTION_KEY = KEY;
    const [conn] = await db
      .insert(connections)
      .values({
        orgId: ORG,
        source: "gcal",
        name: "Calendar",
        status: "active",
        authType: "oauth2",
        credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "t" }), Buffer.from(KEY, "base64")),
      })
      .returning();
    const cfg = { calendarId: "primary" };
    const [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: conn.id, configHash: streamConfigHash(cfg, "gcal"), config: cfg })
      .returning();

    // Three pages, then a sync token to end the walk.
    let n = 0;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        calls.push(String(input));
        n += 1;
        const body = n < 3 ? { items: [], nextPageToken: `P${n}` } : { items: [], nextSyncToken: "SYNC" };
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );

    await syncStream(db, conn, stream, 1); // ONE runner page…

    expect(calls).toHaveLength(3); // …three real Google requests
    expect(await ledgerCalls(conn.id)).toBe(3); // was 1
  });
});

/**
 * A connector that pages INSIDE itself is invisible to the runner's per-page
 * claim, so the ledger under-counted by its whole page budget. The spend cannot
 * be un-made after the fact; what matters is that the next claim sees the truth.
 */
describe("connection-scoped spend is settled after the fact", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_settle";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("records calls that already happened, without allow/deny semantics", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    const conn = { id, orgId: ORG, source: "close" };

    await claimCalls(db, conn, "*"); // the one call the runner authorised
    await recordExtraCalls(db, conn, "*", 3); // …the three the connector also made

    const [led] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, id));
    expect(led.calls).toBe(4);
  });

  it("does not refund an over-budget settle-up — the calls were real", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    const conn = { id, orgId: ORG, source: "close" };
    const over = laneLimit("close", "*", "background") + 50;

    await recordExtraCalls(db, conn, "*", over);
    const [led] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, id));
    expect(led.calls).toBe(over);

    // …and the next claim is correctly denied on that reading.
    const claim = await claimCalls(db, conn, "*");
    expect(claim.allowed).toBe(false);
  });

  it("ignores a zero or negative settle-up", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await recordExtraCalls(db, { id, orgId: ORG, source: "close" }, "*", 0);
    expect(await db.select().from(usageLedger)).toHaveLength(0);
  });
});

/** The provider's own account of its quota beats the figure we declared. */
describe("observed rate limits", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_observed";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("defers the connection when the provider says nothing is left", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    const until = await applyObservedRateLimit(db, { id, orgId: ORG, source: "close" }, { remaining: 0, resetSeconds: 30 });
    expect(until).not.toBeNull();

    const [conn] = await db.select().from(connections).where(eq(connections.id, id));
    expect(isPaused(conn)).toBe(true);
    expect(conn.pausedReason).toContain("rate limit is spent");
  });

  it("does nothing while quota remains, or when the provider says nothing", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    const conn = { id, orgId: ORG, source: "close" };
    expect(await applyObservedRateLimit(db, conn, { remaining: 5, resetSeconds: 30 })).toBeNull();
    expect(await applyObservedRateLimit(db, conn, null)).toBeNull();

    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(isPaused(row)).toBe(false);
  });
});

/**
 * 5b's evidence. The catalog governs close, sendblue, gsheets and gcal with a
 * DEFAULT_RPM of 60 that no provider ever published. Close states its real
 * limit on every response, and the runner parsed that number and dropped it.
 */
describe("F.1 (observed) — keep what the provider said its ceiling was", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_observed";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  const conn = async () => ({ id: await seedConnection(db, { orgId: ORG, source: "close" }), orgId: ORG, source: "close" });
  const row = async (id: string) => (await db.select().from(usageLedger).where(eq(usageLedger.connectionId, id)))[0];

  it("records the stated limit alongside the calls actually spent", async () => {
    const c = await conn();
    await claimCalls(db, c, "*", 1, NOW);
    await recordObservedLimit(db, c, "*", { limit: 120, remaining: 118, resetSeconds: 30 }, NOW);

    const r = await row(c.id);
    expect(r.observedLimit).toBe(120);
    expect(r.calls).toBe(1); // the claim is untouched by the observation
  });

  it("leaves the window NULL when the provider sent no limit", async () => {
    const c = await conn();
    await claimCalls(db, c, "*", 1, NOW);
    // `remaining` present but no `limit` — the shape most providers send.
    await recordObservedLimit(db, c, "*", { limit: null, remaining: 5, resetSeconds: 10 }, NOW);
    await recordObservedLimit(db, c, "*", null, NOW);

    // NULL, not 0. A window with no observation is not a window with a limit of
    // zero, and anything averaging these later must be able to tell them apart.
    expect((await row(c.id)).observedLimit).toBeNull();
  });

  it("records without an existing claim row, and does not invent calls", async () => {
    const c = await conn();
    await recordObservedLimit(db, c, "*", { limit: 40, remaining: 39, resetSeconds: 60 }, NOW);

    const r = await row(c.id);
    expect(r.observedLimit).toBe(40);
    expect(r.calls).toBe(0);
  });

  it("changes nothing about whether work is allowed", async () => {
    const c = await conn();
    // A stated limit far below our own budget must not start denying claims:
    // this observes, it does not enforce. Acting on one header is how a
    // transient value becomes a permanent throttle.
    await recordObservedLimit(db, c, "*", { limit: 1, remaining: 0, resetSeconds: 60 }, NOW);
    expect((await claimCalls(db, c, "*", 1, NOW)).allowed).toBe(true);
  });
});
