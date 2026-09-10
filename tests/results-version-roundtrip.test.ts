import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { flowResults, flows } from "@/db/schema";
import { resultsVersion } from "@/lib/flow/materialize";
import type { DB } from "@/db/types";

/**
 * THE BEACON IS ONE ROUND TRIP, NOT TWO.
 *
 * `resultsVersion` describes itself as "one aggregate over the org's
 * flow_results" and `/api/results-version` repeats the claim — but it grew a
 * second, sequential aggregate over `backfill_jobs` when import progress had to
 * join the string. Two `await`s against the Neon HTTP driver are two round
 * trips: the driver has no pipelining, and this file's own note upstream
 * measures a warm query at ~110ms.
 *
 * IT IS THE HIGHEST-VOLUME QUERY IN THE PRODUCT. Every visible dashboard polls
 * it on a 12s cadence, and every dashboard render computes it twice over — once
 * to seed the poller, and again as the key the cached tile read hangs off. So
 * the second trip is paid on the render's critical path as well as on the poll.
 *
 * Collapsing them costs nothing: they are independent scalar aggregates over
 * two tables, and one SELECT with two subqueries returns the same six numbers.
 * No staleness is introduced anywhere, which is the reason this is the version
 * of the saving worth having.
 *
 * WHAT THE STRING MEANS is covered where it is exercised for real:
 * tests/stale-scope.test.ts pins that it moves exactly when results move, and
 * tests/backfill-recompute.test.ts pins the import-progress components in both
 * directions. This file exists for the round trip alone, so the two are not
 * asserted twice and cannot drift apart.
 */
let db: DB;
let close: () => Promise<void>;
const ORG = "org_beacon";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

/** Counts `select()` calls, which for this driver is one per round trip. */
function countingDb(real: DB) {
  let selects = 0;
  const orig = real.select.bind(real);
  (real as unknown as { select: unknown }).select = (...args: unknown[]) => {
    selects += 1;
    return (orig as (...a: unknown[]) => unknown)(...args);
  };
  return { db: real, selects: () => selects };
}

describe("computing the freshness beacon", () => {
  it("issues exactly one query", async () => {
    const { db: counted, selects } = countingDb(db);
    await resultsVersion(counted, ORG);
    expect(selects()).toBe(1);
  });

  it("is stable when nothing has moved", async () => {
    const a = await resultsVersion(db, ORG);
    expect(await resultsVersion(db, ORG)).toBe(a);
  });

  it("moves when a stored result does", async () => {
    const [flow] = await db
      .insert(flows)
      .values({ orgId: ORG, name: "f", draftGraph: {}, status: "published", publishedVersion: 1 })
      .returning();
    const before = await resultsVersion(db, ORG);
    await db.insert(flowResults).values({
      orgId: ORG,
      flowId: flow.id,
      version: 1,
      outputNodeId: "out",
      status: "fresh",
      computedAt: new Date("2026-09-10T12:00:00Z"),
    });
    expect(await resultsVersion(db, ORG)).not.toBe(before);
  });
});
