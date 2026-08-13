import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { runSync } from "@/lib/sync/resync";
import { registerConnector } from "@/connectors/registry";
import { events } from "@/db/schema";
import type { CanonicalEvent, Connector, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * A FULL RE-SYNC MAY ONLY RETIRE WHAT ITS WALK ACTUALLY COVERED.
 *
 * `runSync(mode: "full")` bumps the generation, re-imports at N, and then
 * soft-deletes every poll-managed row still below N. That is correct exactly as
 * far as the walk is: a row the walk never fetched is not a row the provider no
 * longer has, and tombstoning it is the difference between "prune what upstream
 * deleted" and "delete what we did not get round to reading".
 *
 * `pollAll` had two ways to stop early and neither was reported:
 *
 *  1. `records.length === 0` ended the walk on the first empty page. `syncStream`
 *     removed exactly that condition and says why in a comment beside it — a
 *     connector that filters client-side returns an empty page while the next one
 *     is full, and Calendly's two-sided scan returns an empty PAST page for any
 *     account with no meetings in the last 30 days. The retire then tombstoned
 *     the entire live future window.
 *  2. `PAGE_CAP` truncation looked identical to a finished walk.
 *
 * Both now mark the stream as not-fully-walked, and a stream that was not fully
 * walked is not eligible for the retire.
 */

const DAY = 86_400_000;

/** Pages the stub connector will serve, in order. */
let PAGES: Array<{ records: CanonicalEvent[]; nextCursor: string | null }> = [];
let served = 0;

const rec = (id: string): CanonicalEvent => ({
  eventId: `trunc:conn:${id}`,
  eventType: "booked",
  subject: id,
  occurredAt: new Date(Date.now() - DAY),
  properties: {},
});

const pagedConnector: Connector = {
  source: "trunc-poller",
  authType: "none",
  verifySignature: () => true,
  poll: async (): Promise<PollResult> => {
    const page = PAGES[Math.min(served, PAGES.length - 1)];
    served += 1;
    return { records: page.records, nextCursor: page.nextCursor };
  },
};
registerConnector(pagedConnector);

/** When true, the walk never ends: every page advances and none is the last. */
let ENDLESS = false;
let ENDLESS_N = 0;

const endlessConnector: Connector = {
  source: "trunc-endless",
  authType: "none",
  verifySignature: () => true,
  poll: async (): Promise<PollResult> => {
    if (!ENDLESS) {
      const page = PAGES[Math.min(served, PAGES.length - 1)];
      served += 1;
      return { records: page.records, nextCursor: page.nextCursor };
    }
    ENDLESS_N += 1;
    return { records: [rec(`new-${ENDLESS_N}`)], nextCursor: `page-${ENDLESS_N}` };
  },
};
registerConnector(endlessConnector);

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  PAGES = [];
  served = 0;
  ENDLESS = false;
  ENDLESS_N = 0;
});
afterEach(async () => {
  await close();
});

const liveIds = async (connectionId: string): Promise<string[]> => {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)));
  return rows.map((r) => r.subject!).sort();
};

describe("a full re-sync walks past an empty page", () => {
  /**
   * The Calendly shape, reduced: page one of the past side is empty because the
   * account has no meetings in the last 30 days, and every upcoming meeting is
   * on the page after it.
   */
  it("an empty first page is not the end of the data", async () => {
    const conn = await seedConnection(db, { source: "trunc-poller" });
    PAGES = [
      { records: [], nextCursor: "p2" },
      { records: [rec("future-1"), rec("future-2")], nextCursor: null },
    ];

    const res = await runSync(db, conn, "full");

    expect(res.inserted).toBe(2);
    expect(await liveIds(conn)).toEqual(["future-1", "future-2"]);
  });

  /**
   * The same shape, on the SECOND full re-sync — which is where the retire is
   * live. Without the fix the walk stops on the empty page, upserts nothing at
   * the new generation, and the generation sweep tombstones everything that was
   * already stored.
   */
  it("does not tombstone the window it never reached", async () => {
    const conn = await seedConnection(db, { source: "trunc-poller" });
    PAGES = [{ records: [rec("future-1"), rec("future-2")], nextCursor: null }];
    await runSync(db, conn, "full");
    expect(await liveIds(conn)).toEqual(["future-1", "future-2"]);

    served = 0;
    PAGES = [
      { records: [], nextCursor: "p2" },
      { records: [rec("future-1"), rec("future-2")], nextCursor: null },
    ];
    await runSync(db, conn, "full");

    expect(await liveIds(conn)).toEqual(["future-1", "future-2"]);
  });
});

describe("a walk cut short by the page cap licenses no retire", () => {
  /**
   * The connector never says it is done, so `pollAll` stops on `PAGE_CAP`. What
   * it holds is a PREFIX, and a prefix is not grounds for tombstoning anything —
   * the same rule `syncStream` applies to `retireOutsideWindow` when its own
   * scan was incomplete.
   */
  it("keeps rows the truncated walk did not re-fetch", async () => {
    const conn = await seedConnection(db, { source: "trunc-endless" });

    // Sweep 1 finishes cleanly and stores one row at generation 1.
    ENDLESS = false;
    ENDLESS_N = 0;
    PAGES = [{ records: [rec("old-1")], nextCursor: null }];
    await runSync(db, conn, "full");
    expect(await liveIds(conn)).toEqual(["old-1"]);

    // Sweep 2 never reaches the end — every page advances and none is the last,
    // so the walk stops on PAGE_CAP holding a prefix that does NOT contain
    // `old-1`. Before the fix that prefix licensed the generation retire and
    // `old-1` was tombstoned as "removed upstream".
    ENDLESS = true;
    ENDLESS_N = 0;
    await runSync(db, conn, "full");

    expect(await liveIds(conn)).toContain("old-1");
  });
});

/**
 * A COMPLETED WALK OF NOTHING IS NOT A DELETION NOTICE.
 *
 * `complete` separates a truncated walk from a finished one, which is what
 * `ebc1ec3` was for. It does not separate completion-with-data from
 * completion-with-nothing, and the connection-scoped retire is scoped by
 * connection and generation with no date bound at all — so a finished walk that
 * returned zero records tombstoned the connection's entire history.
 *
 * The path is real rather than contrived. `pollAll` sets `complete` when
 * `nextCursor` is null, and Close's drained branch hands
 * `{hw: maxSeen ?? hw, cont: null, maxSeen: null}` to a serializer that falls
 * through to `maxSeen ?? hw` — both null on a fresh walk that found nothing. A
 * Close workspace with no Event Log activity in thirty days is all it takes.
 *
 * The deeper problem the gate fixes is not the empty case though: a completed
 * walk covers a WINDOW. Close's Event Log retains thirty days, so any mature
 * connection had everything older than that tombstoned on every full re-sync,
 * from a button that offers to rebuild the dataset. Absence licenses deletion
 * only where the read covered the whole resource, so the retire is limited to
 * mirror-class sources — and no connection-scoped source is one.
 */
describe("a full re-sync of a windowed source never tombstones on absence", () => {
  it("keeps history when a completed walk comes back empty", async () => {
    const conn = await seedConnection(db, { source: "trunc-poller" });

    PAGES = [{ records: [rec("historical-1"), rec("historical-2")], nextCursor: null }];
    await runSync(db, conn, "full");
    expect(await liveIds(conn)).toEqual(["historical-1", "historical-2"]);

    // The provider's window is now empty — which says nothing whatever about
    // rows imported when they were still inside it.
    served = 0;
    PAGES = [{ records: [], nextCursor: null }];
    const second = await runSync(db, conn, "full");

    expect(second.softDeleted).toBe(0);
    expect(await liveIds(conn)).toEqual(["historical-1", "historical-2"]);
  });

  /**
   * The case that needs no edge condition. A walk that returns records still
   * only covers its window, and everything the provider no longer serves sits
   * outside it at an older generation.
   */
  it("keeps rows older than the window even when the walk returns data", async () => {
    const conn = await seedConnection(db, { source: "trunc-poller" });

    PAGES = [{ records: [rec("old-1"), rec("old-2")], nextCursor: null }];
    await runSync(db, conn, "full");

    // A later re-sync sees only what the provider still serves.
    served = 0;
    PAGES = [{ records: [rec("recent-1")], nextCursor: null }];
    const second = await runSync(db, conn, "full");

    expect(second.softDeleted).toBe(0);
    expect(await liveIds(conn)).toEqual(["old-1", "old-2", "recent-1"]);
  });
});
