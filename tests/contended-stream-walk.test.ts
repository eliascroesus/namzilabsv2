import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, sourceStreams } from "@/db/schema";
import { registerConnector } from "@/connectors/registry";
import type { Connector, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * A CONTENDED SWEEP IS AN UNFINISHED SWEEP, AND MUST SAY SO.
 *
 * When another writer holds the stream's advisory lock, `syncStream` breaks out
 * of its page walk with the PREVIOUS cursor still stored and the window only
 * partly read. It reported that as a finished sweep, and it is the one exit that
 * sets no other signal at all:
 *
 *  - `retireOutsideWindow` runs, because it is gated on `!incomplete` — so a
 *    prefix of the window licenses tombstoning rows outside it;
 *  - the cadence tiers the connection down as idle;
 *  - a Test renders a short count as final rather than as a floor;
 *  - the gap to the next sweep is free to widen while a perishable continuation
 *    sits in the row.
 *
 * Unreachable on the http driver, where `withStreamWriteLock` runs its body
 * directly and always reports `acquired: true`. Reachable the moment
 * `DB_DRIVER=pool` engages the advisory locks — so it is fixed BEFORE that flip,
 * which is what PRE_LAUNCH_CHECKLIST item 4 now records.
 *
 * The lock is mocked rather than contended for real: producing genuine
 * contention needs two sessions racing one row, and what is under test is the
 * runner's reaction to losing, not Postgres's ability to arbitrate.
 */

vi.mock("@/lib/sync/locks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sync/locks")>();
  return {
    ...actual,
    withStreamWriteLock: async () => ({ acquired: false, result: null }),
  };
});

const { syncStream } = await import("@/lib/sync/streams");

const ORG = "org_contended";
let db: DB;
let close: () => Promise<void>;

const contended: Connector = {
  source: "contended-stub",
  authType: "none",
  verifySignature: () => true,
  // Always more to fetch, and a window it would like retired.
  poll: async (): Promise<PollResult> => ({
    records: [],
    nextCursor: "page-2",
    retireOutsideWindow: { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") },
  }),
};
registerConnector(contended);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("losing the stream write lock", () => {
  it("reports the sweep as incomplete rather than as finished", async () => {
    const connectionId = await seedConnection(db, { orgId: ORG, source: "contended-stub" });
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    const [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId, configHash: "hash-contended", config: {} })
      .returning();

    const res = await syncStream(db, conn, stream, 5);

    expect(res.incomplete).toBe(true);
    // Nothing was written, and nothing was retired on the strength of a prefix.
    expect(res.inserted).toBe(0);
    expect(res.softDeleted).toBe(0);
  });
});
