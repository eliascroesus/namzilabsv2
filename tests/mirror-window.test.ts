import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { syncStream } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import { connections, events, sourceStreams } from "@/db/schema";
import type { Connector, CanonicalEvent, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";
import { randomBytes } from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { streamConfigHash } from "@/lib/sync/stream-hash";

const KEY = randomBytes(32).toString("base64");

/**
 * Window-bounded mirror.
 *
 * A whole-resource mirror (a spreadsheet tab) can retire everything its read
 * omitted, because the read covered everything. A rolling window cannot: a read
 * of the last N days says nothing about day N+1. Retiring on that basis would
 * tombstone all history behind the window on EVERY sweep — the stored copy
 * would never hold more than the window, and the loss would be silent because
 * soft-deleted rows simply stop appearing.
 *
 * `mirrorScope` is the connector's declaration of what its read is complete
 * for. These cases pin the three things that must hold:
 *   1. restated rows inside the window update in place;
 *   2. rows that vanish from inside the window are retired;
 *   3. rows OUTSIDE the window survive, sweep after sweep.
 */

let db: DB;
let close: () => Promise<void>;

const DAY = 86_400_000;
const NOW = new Date("2026-03-31T00:00:00Z");
const day = (offset: number) => new Date(NOW.getTime() - offset * DAY);

/** What the fake analytics endpoint currently reports, and for what window. */
let REPORT: CanonicalEvent[] = [];
let SCOPE: { from: Date; to: Date } | undefined;

const analytics = (dayOffset: number, sent: number): CanonicalEvent => ({
  eventId: `winmirror:daily:${dayOffset}`,
  eventType: "campaign_day",
  subject: `day-${dayOffset}`,
  occurredAt: day(dayOffset),
  properties: { sent },
});

const windowConnector: Connector = {
  source: "win-mirror",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async (): Promise<PollResult> => ({ records: REPORT, nextCursor: null, mirrorScope: SCOPE }),
};
registerConnector(windowConnector);

/** Same connector, but declaring no scope — the incremental control case. */
const plainConnector: Connector = {
  source: "win-plain",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async (): Promise<PollResult> => ({ records: REPORT, nextCursor: null }),
};
registerConnector(plainConnector);

async function setup(source: string) {
  const connectionId = await seedConnection(db, { source });
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: "org_test", connectionId, configHash: "hash-a", config: { campaignId: "c1" } })
    .returning();
  return { conn, stream };
}

const liveDays = async () => {
  const rows = await db.select().from(events).where(isNull(events.deletedAt));
  return rows.map((r) => r.subject).sort();
};
const sentFor = async (subject: string) => {
  const [row] = await db.select().from(events).where(and(eq(events.subject, subject), isNull(events.deletedAt)));
  return (row?.properties as { sent?: number } | null)?.sent;
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  REPORT = [];
  SCOPE = undefined;
});
afterEach(async () => {
  await close();
});

describe("a rolling window retires inside itself and never behind itself", () => {
  it("keeps history older than the window across repeated sweeps", async () => {
    const { conn, stream } = await setup("win-mirror");

    // Sweep 1: a wide window seeds four days of history.
    REPORT = [analytics(1, 10), analytics(2, 20), analytics(10, 30), analytics(40, 40)];
    SCOPE = { from: day(60), to: NOW };
    await syncStream(db, conn, stream);
    expect(await liveDays()).toEqual(["day-1", "day-10", "day-2", "day-40"]);

    // Sweep 2: a NARROW window — the endpoint now only reports the last 3 days.
    // Days 10 and 40 are outside it, so their absence means nothing.
    REPORT = [analytics(1, 11), analytics(2, 20)];
    SCOPE = { from: day(3), to: NOW };
    await syncStream(db, conn, stream);

    expect(await liveDays()).toEqual(["day-1", "day-10", "day-2", "day-40"]);
    expect(await sentFor("day-1")).toBe(11); // restated in place

    // Sweep 3 and 4: still nothing behind the window is lost.
    await syncStream(db, conn, stream);
    await syncStream(db, conn, stream);
    expect(await liveDays()).toEqual(["day-1", "day-10", "day-2", "day-40"]);
  });

  it("retires a row that disappears from INSIDE the window", async () => {
    const { conn, stream } = await setup("win-mirror");
    REPORT = [analytics(1, 10), analytics(2, 20)];
    SCOPE = { from: day(3), to: NOW };
    await syncStream(db, conn, stream);
    expect(await liveDays()).toEqual(["day-1", "day-2"]);

    // Day 2 stops being reported while still inside the window: genuinely gone.
    REPORT = [analytics(1, 10)];
    const res = await syncStream(db, conn, stream);
    expect(res.softDeleted).toBe(1);
    expect(await liveDays()).toEqual(["day-1"]);
  });

  it("an empty window report retires only what is inside it", async () => {
    const { conn, stream } = await setup("win-mirror");
    REPORT = [analytics(1, 10), analytics(40, 40)];
    SCOPE = { from: day(60), to: NOW };
    await syncStream(db, conn, stream);

    REPORT = [];
    SCOPE = { from: day(3), to: NOW };
    const res = await syncStream(db, conn, stream);
    expect(res.softDeleted).toBe(1); // day-1 only
    expect(await liveDays()).toEqual(["day-40"]);
  });

  it("without a declared scope nothing is ever retired (plain incremental)", async () => {
    const { conn, stream } = await setup("win-plain");
    REPORT = [analytics(1, 10), analytics(2, 20)];
    await syncStream(db, conn, stream);
    expect(await liveDays()).toEqual(["day-1", "day-2"]);

    REPORT = []; // an incremental poll returning nothing means "no news"
    const res = await syncStream(db, conn, stream);
    expect(res.softDeleted).toBe(0);
    expect(await liveDays()).toEqual(["day-1", "day-2"]);
  });

  it("restatement preserves the day the row describes, not first-seen", async () => {
    const { conn, stream } = await setup("win-mirror");
    REPORT = [analytics(2, 20)];
    SCOPE = { from: day(3), to: NOW };
    await syncStream(db, conn, stream);
    REPORT = [analytics(2, 99)];
    await syncStream(db, conn, stream);

    const [row] = await db.select().from(events).where(isNull(events.deletedAt));
    expect((row.properties as { sent: number }).sent).toBe(99);
    expect(new Date(row.occurredAt).toISOString()).toBe(day(2).toISOString());
  });

  it("one stream's window never reaches another stream on the same connection", async () => {
    const { conn, stream } = await setup("win-mirror");
    const [other] = await db
      .insert(sourceStreams)
      .values({ orgId: "org_test", connectionId: conn.id, configHash: "hash-b", config: { campaignId: "c2" } })
      .returning();

    REPORT = [analytics(1, 10)];
    SCOPE = { from: day(3), to: NOW };
    await syncStream(db, conn, stream);
    // Same day number, different stream — distinct rows because the hash differs.
    REPORT = [{ ...analytics(1, 77), eventId: "winmirror:daily:1:b", subject: "other-day-1" }];
    await syncStream(db, conn, other);

    REPORT = []; // stream A's window empties
    await syncStream(db, conn, stream);
    expect(await liveDays()).toEqual(["other-day-1"]); // B untouched
  });
});


/**
 * Skipping an unchanged tab is an efficiency win with one catastrophic failure
 * mode: a mirror's EMPTY read means "every row was deleted upstream", so if a
 * skip fell through to `retireAbsent` it would tombstone the entire sheet on
 * the first sweep where nothing had changed. `PollResult.unchanged` is the
 * difference, and this suite is why it exists.
 */
describe("gsheets: an unchanged tab is skipped, not read as empty", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_unchanged";
  const CFG = { spreadsheetId: "SHEET1", range: "Tab1" };
  let connId = "";
  let stream: typeof sourceStreams.$inferSelect;

  const SHEET = { values: [["name"], ["Alice"], ["Bob"]] };

  /** Drive reports `modified`; the values endpoint serves the tab. */
  function serve(modified: string, onValues?: () => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes("/drive/v3/files")
          ? { modifiedTime: modified, version: "1" }
          : (onValues?.(), SHEET);
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

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    process.env.ENCRYPTION_KEY = KEY;
    const [conn] = await db
      .insert(connections)
      .values({
        orgId: ORG,
        source: "gsheets",
        name: "Sheets",
        status: "active",
        authType: "oauth2",
        credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
      })
      .returning();
    connId = conn.id;
    [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: connId, configHash: streamConfigHash(CFG, "gsheets"), config: CFG })
      .returning();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await close();
  });

  const conn = async () => (await db.select().from(connections).where(eq(connections.id, connId)))[0];
  const live = async () =>
    (await db.select().from(events).where(and(eq(events.connectionId, connId), isNull(events.deletedAt)))).length;

  it("reads the tab and stores a marker on the first sweep", async () => {
    let valueReads = 0;
    serve("2026-07-01T00:00:00Z", () => (valueReads += 1));
    const r = await syncStream(db, await conn(), stream);
    expect(r.inserted).toBe(2);
    expect(valueReads).toBe(1);

    const [after] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id));
    expect(after.cursor).toContain("2026-07-01T00:00:00Z");
  });

  it("SKIPS the read when unchanged — and retires nothing", async () => {
    serve("2026-07-01T00:00:00Z");
    await syncStream(db, await conn(), stream);
    expect(await live()).toBe(2);

    const [primed] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id));
    let valueReads = 0;
    serve("2026-07-01T00:00:00Z", () => (valueReads += 1));
    const second = await syncStream(db, await conn(), primed);

    expect(valueReads).toBe(0); // the tab was never transferred
    expect(second.softDeleted).toBe(0);
    // THE assertion. An empty record set reaching retireAbsent would leave 0.
    expect(await live()).toBe(2);
  });

  it("reads again the moment Drive reports a change", async () => {
    serve("2026-07-01T00:00:00Z");
    await syncStream(db, await conn(), stream);

    const [primed] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id));
    let valueReads = 0;
    serve("2026-07-02T00:00:00Z", () => (valueReads += 1));
    await syncStream(db, await conn(), primed);
    expect(valueReads).toBe(1);
  });

  it("reads anyway every sixth skip, because modifiedTime can miss a recalculation", async () => {
    serve("2026-07-01T00:00:00Z");
    await syncStream(db, await conn(), stream);

    let valueReads = 0;
    let current = (await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id)))[0];
    for (let i = 0; i < 6; i++) {
      serve("2026-07-01T00:00:00Z", () => (valueReads += 1));
      await syncStream(db, await conn(), current);
      current = (await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id)))[0];
    }
    // Five skips, then a forced full read — a volatile formula cannot hide
    // behind an unchanged modifiedTime forever.
    expect(valueReads).toBe(1);
    expect(await live()).toBe(2);
  });

  it("falls back to reading when Drive is unreachable, keeping the old marker", async () => {
    serve("2026-07-01T00:00:00Z");
    await syncStream(db, await conn(), stream);
    const [primed] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id));

    let valueReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/drive/v3/files")) throw new Error("drive down");
        valueReads += 1;
        return {
          ok: true, status: 200, statusText: "OK", headers: { get: () => null },
          json: async () => SHEET, text: async () => JSON.stringify(SHEET),
        } as unknown as Response;
      }),
    );
    await syncStream(db, await conn(), primed);

    expect(valueReads).toBe(1); // degraded to the old behaviour: read
    const [after] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id));
    expect(after.cursor).toBe(primed.cursor); // a blip does not cost the next sweep too
    expect(await live()).toBe(2);
  });
});
