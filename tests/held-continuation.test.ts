import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, sourceStreams } from "@/db/schema";
import { syncStream } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import { BASE_INTERVAL_MS, decideCadence } from "@/lib/sync/cadence";
import { calendlyConnector } from "@/connectors/calendly";
import { closeConnector } from "@/connectors/close";
import { instantlyConnector } from "@/connectors/instantly";
import { sendblueConnector } from "@/connectors/sendblue";
import { googleCalendarConnector } from "@/connectors/google-calendar";
import { googleSheetsConnector } from "@/connectors/google-sheets";
import type { Connector, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * A PERISHABLE CONTINUATION MUST NOT BE AGED PAST ITS LIFE.
 *
 * CL13 measured Calendly's `next_page` URL: accepted at 600s, refused at 3600s.
 * The connector stores that URL across sweeps, so the sweep gap is the thing
 * that decides whether the outward scan advances or restarts at page 1 forever —
 * with no error anywhere, because the restart succeeds.
 *
 * Two separate defects made that reachable, and they are tested separately here
 * because they fail independently:
 *
 *  1. `syncStream` never read `PollResult.incomplete`. The connector's restart
 *     alarm reached the log and nothing else, so `stuck` could not hold cadence
 *     the way its own comment claimed.
 *  2. Nothing anywhere said "do not widen the gap while a continuation is
 *     held". The property held only as a side effect of the page-budget rule,
 *     which stops covering it the moment the stream write-lock is contended —
 *     i.e. at `DB_DRIVER=pool`.
 *
 * The signal is deliberately NOT "a cursor exists". Three of the four
 * stream-scoped sources keep a non-null cursor forever (a sync token, a
 * change-detection marker, a bare high-water mark), and pinning those at base
 * cadence permanently would repeal H.1/H.2 — background cost tracking the
 * change rate rather than the tenant count — to fix a Calendly-only problem.
 */

const ORG = "org_held";
let db: DB;
let close: () => Promise<void>;

/** What the stub connector reports on its next poll. */
let NEXT: PollResult = { records: [], nextCursor: null };

const stub: Connector = {
  source: "held-stub",
  authType: "none",
  verifySignature: () => true,
  poll: async () => NEXT,
};
registerConnector(stub);

/** Same connector, declaring a JSON cursor as a live continuation. */
const stubWithDeclaration: Connector = {
  source: "held-stub-declared",
  authType: "none",
  verifySignature: () => true,
  poll: async () => NEXT,
  holdsContinuation: (cursor) => cursor != null && cursor.startsWith("{"),
};
registerConnector(stubWithDeclaration);

async function setup(source: string) {
  const connectionId = await seedConnection(db, { orgId: ORG, source });
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId, configHash: "hash-held", config: {} })
    .returning();
  return { conn, stream };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  NEXT = { records: [], nextCursor: null };
});
afterEach(async () => {
  await close();
});

describe("the runner reads the connector's own `incomplete`", () => {
  /**
   * The bug: `syncStream` destructured records/nextCursor/mirrorScope/
   * preserveOccurredAt/retireOutsideWindow and stopped. Every stream-scoped
   * source's `incomplete` was dropped — Calendly, Calendar, Sheets, Instantly —
   * while the connection-scoped path in reconcile.ts read it correctly, which is
   * why Close and Sendblue worked and this went unnoticed.
   *
   * A null cursor is deliberate: the walk then breaks before the page-budget
   * rule can set `incomplete` itself, so the only way the flag can be true is if
   * the runner took it from the connector.
   */
  it("surfaces `incomplete` even when the walk ended on its own", async () => {
    const { conn, stream } = await setup("held-stub");
    NEXT = { records: [], nextCursor: null, incomplete: true };

    const res = await syncStream(db, conn, stream);
    expect(res.incomplete).toBe(true);
  });

  it("does not invent `incomplete` for a connector that reported none", async () => {
    const { conn, stream } = await setup("held-stub");
    NEXT = { records: [], nextCursor: null };

    const res = await syncStream(db, conn, stream);
    expect(res.incomplete).toBeFalsy();
  });
});

describe("a stream reports whether it is holding a continuation", () => {
  it("asks the CONNECTOR, not the shape of the cursor", async () => {
    const { conn, stream } = await setup("held-stub-declared");
    NEXT = { records: [], nextCursor: '{"cont":"abc"}' };

    const res = await syncStream(db, conn, stream);
    expect(res.heldContinuation).toBe(true);
  });

  it("is false once the connector's cursor settles", async () => {
    const { conn, stream } = await setup("held-stub-declared");
    NEXT = { records: [], nextCursor: "2026-08-03T10:00:00Z" };

    const res = await syncStream(db, conn, stream);
    expect(res.heldContinuation).toBe(false);
  });

  /**
   * A connector that declares nothing is never pinned. That default is what
   * keeps this change from reaching Sheets and Calendar, whose cursors are
   * non-null forever and whose re-reads are correct behaviour rather than a
   * stranded walk.
   */
  it("is false for a connector that does not declare one", async () => {
    const { conn, stream } = await setup("held-stub");
    NEXT = { records: [], nextCursor: '{"looks":"like a continuation"}' };

    const res = await syncStream(db, conn, stream);
    expect(res.heldContinuation).toBe(false);
  });
});

describe("which connectors hold a perishable continuation", () => {
  /**
   * MEASURED PER CONNECTOR, because the cursor is opaque to the runner by
   * contract ("sync token, timestamp, row number, …") and the one convention
   * that looks generic is a trap: `startsWith("{")` is what
   * stranding-contract.test.ts uses as its mid-walk heuristic, and it is WRONG
   * for Sheets, whose SETTLED marker is also JSON.
   */
  it("calendly: any non-null cursor is a live scan, null is START OVER", () => {
    expect(calendlyConnector.holdsContinuation!(null)).toBe(false);
    expect(calendlyConnector.holdsContinuation!('{"floor":"x","ceil":"y","pivot":"z","next":"past"}')).toBe(true);
  });

  it("close / instantly / sendblue: the `cont` field, not the bare high-water mark", () => {
    for (const c of [closeConnector, instantlyConnector, sendblueConnector]) {
      expect(c.holdsContinuation!(null), c.source).toBe(false);
      // The settled form: a plain date string. Non-null, and NOT a continuation.
      expect(c.holdsContinuation!("2026-08-03T10:00:00Z"), c.source).toBe(false);
      expect(c.holdsContinuation!('{"hw":"2026-08-01T00:00:00Z","cont":null,"maxSeen":null}'), c.source).toBe(false);
      expect(c.holdsContinuation!('{"hw":"2026-08-01T00:00:00Z","cont":"CUR123","maxSeen":null}'), c.source).toBe(true);
      // Garbage must never pin a connection forever.
      expect(c.holdsContinuation!("{not json"), c.source).toBe(false);
    }
  });

  it("sendblue's continuation is an object, and still reads as held", () => {
    expect(sendblueConnector.holdsContinuation!('{"hw":null,"cont":{"offset":100,"lowWater":null},"maxSeen":null}')).toBe(true);
  });

  /**
   * The two that must NOT declare one. Both keep a non-null cursor for the life
   * of the connection, so declaring would pin every Google connection at base
   * cadence permanently.
   */
  it("gcal and gsheets declare none — their cursors are not mid-walk continuations", () => {
    expect(googleCalendarConnector.holdsContinuation).toBeUndefined();
    expect(googleSheetsConnector.holdsContinuation).toBeUndefined();
  });
});

describe("cadence never widens past a held continuation", () => {
  it("pins base cadence, whatever the no-op streak has reached", () => {
    const d = decideCadence({ changed: false, previousNoOps: 80, heldContinuation: true, now: new Date() });
    expect(d.intervalMs).toBe(BASE_INTERVAL_MS);
    expect(d.reason).toBe("continuation-held");
  });

  /**
   * The streak is HELD, not reset — the same treatment `incomplete` gets. A
   * mid-scan sweep is not evidence of activity, so it must not clear a streak
   * that was legitimately accumulating; it must only stop it advancing on work
   * that had not finished.
   */
  it("holds the no-op streak rather than advancing or clearing it", () => {
    const d = decideCadence({ changed: false, previousNoOps: 12, heldContinuation: true, now: new Date() });
    expect(d.consecutiveNoOpSweeps).toBe(12);
  });

  it("a change still outranks it, so a live connection is never mislabelled", () => {
    const d = decideCadence({ changed: true, previousNoOps: 3, heldContinuation: true, now: new Date() });
    expect(d.reason).toBe("changed");
    expect(d.consecutiveNoOpSweeps).toBe(0);
  });

  it("without one, the ladder still widens exactly as before", () => {
    const d = decideCadence({ changed: false, previousNoOps: 80, heldContinuation: false, now: new Date() });
    expect(d.intervalMs).toBe(24 * 60 * 60_000);
    expect(d.reason).toBe("idle-tier");
  });

  /**
   * The 60-minute webhook backstop must not be able to outrank this. It is
   * unreachable for Calendly today (it needs `webhook_healthy_at`, written only
   * for a connector implementing `verifyWebhookSubscription` — Sendblue alone),
   * but a connector gaining one later must not silently start aging its own
   * continuation past its life.
   */
  it("outranks the webhook backstop", () => {
    const d = decideCadence({
      changed: false,
      previousNoOps: 0,
      heldContinuation: true,
      webhookHealthyAt: new Date(),
      now: new Date(),
    });
    expect(d.intervalMs).toBe(BASE_INTERVAL_MS);
    expect(d.reason).toBe("continuation-held");
  });
});
