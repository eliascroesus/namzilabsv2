import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
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
  isPaused,
  laneLimit,
  pauseConnection,
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
