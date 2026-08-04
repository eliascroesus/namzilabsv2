import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { deliveryLog, rawEvents } from "@/db/schema";
import { recordRejectedDelivery, rejectingConnections } from "@/lib/webhooks/rejections";
import { scanInvariants } from "@/lib/health/invariants";
import type { DB } from "@/db/types";

/**
 * A REJECTING ENDPOINT MUST BE VISIBLE WITHOUT READING THE PLATFORM LOG.
 *
 * Both 401 paths in the inbound route produced no persistent record: nothing in
 * `raw_events` (correct — an unverified payload must never enter the replay
 * source of truth), nothing in `delivery_log`, and the signature branch did not
 * even log. A connection could refuse every delivery indefinitely and the only
 * evidence was the platform's request log, which nothing aggregates.
 *
 * What is recorded is the FACT and never the body, at one row per connection per
 * minute — the flood that prompted this ran at one to three per second, and
 * recording each would have made the observability fix into a disk problem.
 */

const ORG = "org_reject";
let db: DB;
let close: () => Promise<void>;
let connId = "";
const conn = () => ({ id: connId, orgId: ORG, source: "webhook" });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "webhook" });
});
afterEach(async () => {
  await close();
});

const rows = async () => db.select().from(deliveryLog).where(eq(deliveryLog.connectionId, connId));

describe("recording a refused delivery", () => {
  it("writes the fact, with no raw event behind it", async () => {
    expect(await recordRejectedDelivery(db, conn(), "invalid-signature")).toBe(true);

    const [row] = await rows();
    expect(row.status).toBe("rejected");
    expect(row.rawEventId).toBeNull();
    expect(row.error).toContain("invalid-signature");
    // The payload is the thing that failed authentication. It is never stored.
    expect(await db.select().from(rawEvents)).toHaveLength(0);
  });

  /**
   * The bound is the design, not a nicety. At three refusals a second an
   * unsampled recorder writes a quarter of a million rows a day into a table
   * whose nightly prune removes five thousand.
   */
  it("records at most once per connection per minute", async () => {
    const t0 = Date.now();
    expect(await recordRejectedDelivery(db, conn(), "invalid-signature", t0)).toBe(true);
    for (let i = 1; i < 200; i++) {
      expect(await recordRejectedDelivery(db, conn(), "invalid-signature", t0 + i * 100)).toBe(false);
    }
    expect(await rows()).toHaveLength(1);

    // A minute later it speaks again, so "still happening" stays answerable.
    expect(await recordRejectedDelivery(db, conn(), "invalid-signature", t0 + 60_001)).toBe(true);
    expect(await rows()).toHaveLength(2);
  });

  it("distinguishes the two 401 paths", async () => {
    const t0 = Date.now();
    await recordRejectedDelivery(db, conn(), "unreadable-secret", t0);
    const [row] = await rows();
    expect(row.error).toContain("unreadable-secret");
  });
});

describe("the reader, which is the half that was missing", () => {
  it("reports a connection that has been refusing deliveries", async () => {
    const t0 = Date.now();
    await recordRejectedDelivery(db, conn(), "invalid-signature", t0);
    await recordRejectedDelivery(db, conn(), "invalid-signature", t0 + 60_001);

    const found = await rejectingConnections(db, 24 * 3_600_000);
    expect(found).toHaveLength(1);
    // Minutes in which something was refused, not requests — the recorder
    // samples, so a request count would be uninterpretable.
    expect(found[0]).toMatchObject({ connectionId: connId, minutes: 2 });
  });

  it("says nothing about a connection that is not refusing anything", async () => {
    expect(await rejectingConnections(db, 24 * 3_600_000)).toHaveLength(0);
  });

  it("surfaces in the nightly scan, so it reaches a human", async () => {
    await recordRejectedDelivery(db, conn(), "invalid-signature");
    const report = await scanInvariants(db);
    expect(report.rejectingEndpoints).toHaveLength(1);
    expect(report.anyFindings).toBe(true);
  });
});
