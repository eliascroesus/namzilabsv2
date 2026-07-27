import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { rekeySendblueIds } from "@/lib/sync/sendblue-rekey";
import type { DB } from "@/db/types";

/**
 * Sendblue ids stopped embedding the message status, so old and new rows do not
 * collide and every already-stored message exists twice until this runs.
 *
 * The half that matters: poll-written rows (generation >= 1) are retired by a
 * full re-sync through the existing generation mechanism, but webhook-written
 * rows sit at generation 0 with a null stream_hash and NOTHING in the codebase
 * can reach them — every soft-delete site is either generation-guarded or
 * stream-hash-scoped, because the append-only class has to survive sweeps.
 * Those rows are permanent until something deliberately targets them.
 */

const ORG = "org_rekey";
let db: DB;
let close: () => Promise<void>;
let sbId = "";
let otherId = "";

async function row(o: { connectionId: string; eventId: string; generation: number; source?: string }) {
  await db.insert(events).values({
    eventId: o.eventId,
    orgId: ORG,
    connectionId: o.connectionId,
    source: o.source ?? "sendblue",
    eventType: "sms_outbound",
    occurredAt: new Date(),
    syncGeneration: o.generation,
    properties: {},
  });
}

const liveIds = async (connectionId: string) =>
  (await db.select({ eventId: events.eventId }).from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt))))
    .map((r) => r.eventId)
    .sort();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  sbId = await seedConnection(db, { orgId: ORG, source: "sendblue" });
  otherId = await seedConnection(db, { orgId: ORG, source: "close" });

  // Old shape, both provenances.
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:sms_queued:h1`, generation: 0 }); // webhook
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:sms_sent:h1`, generation: 0 }); // webhook
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:sms_delivered:h1`, generation: 0 }); // webhook
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:sms_delivered:h2`, generation: 1 }); // poll
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:sms_received:h3`, generation: 1 }); // poll
  // New shape — must never be touched.
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:h1`, generation: 1 });
  await row({ connectionId: sbId, eventId: `sendblue:${sbId}:h2`, generation: 1 });
  // A different source, same-looking id fragment — must never be touched.
  await row({ connectionId: otherId, eventId: `close:${otherId}:sms_sent:x1`, generation: 1, source: "close" });
});

afterEach(async () => {
  await close();
});

describe("sendblue re-key cleanup", () => {
  it("counts the duplicate window, and names the rows no sweep can reach", async () => {
    const r = await rekeySendblueIds(db);
    expect(r.dryRun).toBe(true);
    expect(r.candidates).toBe(5); // 3 webhook + 2 poll
    // THE number worth printing: generation-0 rows are permanent without this.
    expect(r.unreachableByAnySweep).toBe(3);
    expect(r.tombstoned).toBe(0);
    expect(await liveIds(sbId)).toHaveLength(7); // dry run wrote nothing
  });

  it("retires only the old shape, leaving the new ids and other sources alone", async () => {
    await rekeySendblueIds(db, { apply: true });
    expect(await liveIds(sbId)).toEqual([`sendblue:${sbId}:h1`, `sendblue:${sbId}:h2`]);
    // A Close row whose natural id merely contains "sms_sent" is not ours.
    expect(await liveIds(otherId)).toEqual([`close:${otherId}:sms_sent:x1`]);
  });

  it("is idempotent — a re-run, or a resumed interrupted run, finds nothing left", async () => {
    const first = await rekeySendblueIds(db, { apply: true });
    expect(first.tombstoned).toBe(5);
    const second = await rekeySendblueIds(db, { apply: true });
    expect(second.candidates).toBe(0);
    expect(second.tombstoned).toBe(0);
  });
});
