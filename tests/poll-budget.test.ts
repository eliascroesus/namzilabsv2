import { describe, it, expect, afterEach, vi } from "vitest";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import { googleCalendarConnector } from "@/connectors/google-calendar";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { sourceStreams, usageLedger } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import type { Connector } from "@/connectors/types";

/**
 * O1 — BUDGET-DRIVEN PAGING. Every connector's page walk was bounded by a
 * hard-coded constant (Close: 4 pages = ~200 events per sweep, on the
 * provider whose event log deletes itself at 30 days) while the ledger's
 * `remaining` — the budget actually available — was returned by every claim
 * and discarded by every call site. `PollArgs.budget` is the missing
 * symmetric half of `PollResult.providerCalls`: the walk is bounded BEFORE
 * it spends instead of settled into overdraft afterwards.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** N pages of Close events, each carrying a cursor to the next. */
function stubClosePages(pages: number) {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      const page = calls;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => ({
          data: [
            {
              id: `ev_${page}`,
              object_type: "lead",
              action: "updated",
              date_created: "2026-07-01T00:00:00+00:00",
              date_updated: "2026-07-01T00:00:00+00:00",
            },
          ],
          cursor_next: `cur_${page + 1}`,
        }),
        text: async () => "",
      } as unknown as Response;
    }),
  );
  return () => calls;
}

const closeArgs = (budget?: { maxCalls: number; deadlineMs?: number; nowMs?: () => number }) => ({
  connectionId: "c1",
  cursor: null,
  credentials: { apiKey: "k" },
  budget,
});

describe("Close honors the budget", () => {
  it("walks exactly budget.maxCalls pages when the ledger is the binding constraint", async () => {
    const calls = stubClosePages(50);
    await closeConnector.poll!(closeArgs({ maxCalls: 2 }));
    // THE regression: old code walked its constant 4 regardless.
    expect(calls()).toBe(2);
  });

  it("walks past the old constant when the budget allows — the throughput unlock", async () => {
    const calls = stubClosePages(50);
    await closeConnector.poll!(closeArgs({ maxCalls: 12 }));
    // Old code could NEVER exceed 4 pages per poll; ~200 events per sweep was
    // the ceiling that let a busy workspace slide past Close's 30-day cliff.
    expect(calls()).toBe(12);
  });

  it("without a budget, behaves exactly as before (legacy callers untouched)", async () => {
    const calls = stubClosePages(50);
    await closeConnector.poll!(closeArgs(undefined));
    expect(calls()).toBe(4);
  });

  it("stops between pages when the deadline passes", async () => {
    const calls = stubClosePages(50);
    let now = 1_000_000;
    await closeConnector.poll!(closeArgs({ maxCalls: 40, deadlineMs: 1_000_001, nowMs: () => (now += 10) }));
    // Page 0 always runs (the claim already bought it); the deadline check
    // fires before page 1.
    expect(calls()).toBe(1);
  });
});

describe("Instantly reports every request it makes", () => {
  it("a multi-page walk returns providerCalls equal to the requests made", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => ({
            items: [
              // Inside the 30-day window, or the below-floor check would end
              // the walk legitimately after one page.
              { id: `e${calls}`, ue_type: 1, timestamp_created: new Date(Date.now() - calls * 3_600_000).toISOString(), campaign_id: "camp" },
            ],
            next_starting_after: `tok_${calls}`,
          }),
          text: async () => "",
        } as unknown as Response;
      }),
    );

    const res = await instantlyConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { apiKey: "k" },
      config: { campaignId: "camp", streamType: "raw_emails" },
    });

    // THE metering bug: this walk made 3 real requests for the connector's
    // whole life and returned no providerCalls, so the ledger billed 1.
    expect(calls).toBe(3);
    expect(res.providerCalls).toBe(3);
  });
});

describe("Google Calendar honors the budget", () => {
  it("stops at budget.maxCalls instead of its memory ceiling", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => ({ items: [], nextPageToken: `p${calls}` }),
          text: async () => "",
        } as unknown as Response;
      }),
    );

    const res = await googleCalendarConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "tok" },
      config: {},
      budget: { maxCalls: 3 },
    });

    // Load-bearing for the fleet: Calendar spends the shared Cloud-project
    // quota, and this walk could previously overdraw it by up to 7 calls
    // that were only settled after the fact.
    expect(calls).toBe(3);
    expect(res.providerCalls).toBe(3);
  });
});

describe("the sweep hands its clock down", () => {
  afterEach(async () => {
    registerConnector((await import("@/connectors/instantly")).instantlyConnector);
  });

  it("an expired sweep budget stops before any stream is polled, reported as incomplete", async () => {
    const { db, close } = await createTestDb();
    try {
      let polls = 0;
      const stub: Connector = {
        source: "instantly",
        authType: "apiKey",
        verifySignature: () => true,
        normalize: () => [],
        poll: async () => {
          polls += 1;
          return { records: [], nextCursor: null };
        },
      };
      registerConnector(stub);
      const id = await seedConnection(db, { source: "instantly" });
      await db.insert(sourceStreams).values({ orgId: "org_test", connectionId: id, configHash: "s1", config: {} });

      // A clock already past its deadline: the between-streams check fires
      // before the first stream. Old code had NO deadline anywhere in the
      // sweep — it iterated every stream × every page against the 60s
      // container ceiling and died mid-write instead of truncating honestly.
      let t = Date.now();
      const res = await reconcileConnection(db, id, { nowMs: () => (t += 60_000) });

      expect(polls).toBe(0);
      expect(res.incomplete).toBe(true);
    } finally {
      await close();
    }
  });

  it("the ledger's remaining sizes the connector walk end-to-end", async () => {
    const { db, close } = await createTestDb();
    try {
      const seen: number[] = [];
      const stub: Connector = {
        source: "instantly",
        authType: "apiKey",
        verifySignature: () => true,
        normalize: () => [],
        poll: async (args) => {
          seen.push(args.budget?.maxCalls ?? -1);
          return { records: [], nextCursor: null };
        },
      };
      registerConnector(stub);
      const id = await seedConnection(db, { source: "instantly" });
      await db.insert(sourceStreams).values({ orgId: "org_test", connectionId: id, configHash: "s1", config: {} });

      // Pre-spend the workspace bucket down to a known remainder.
      const limit = 3_150; // instantly "*", background lane
      const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      await db.insert(usageLedger).values({
        orgId: "org_test",
        connectionId: id,
        provider: "instantly",
        operation: "*",
        windowStart,
        calls: limit - 5,
      });

      await reconcileConnection(db, id);

      // The claim spent 1 of the 5 left; the connector was told it may make
      // that one call plus the 4 remaining. Old code passed NO budget — the
      // connector saw -1 here and walked its constant blind.
      expect(seen).toEqual([5]);
    } finally {
      await close();
    }
  });
});
