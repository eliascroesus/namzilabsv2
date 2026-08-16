import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { runSync } from "@/lib/sync/resync";
import { registerConnector } from "@/connectors/registry";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { events, sourceStreams } from "@/db/schema";
import type { CanonicalEvent, Connector, PollArgs, PollResult } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * A FULL RE-SYNC MUST CARRY THE STREAM'S OWN SETTINGS INTO THE RE-POLL.
 *
 * `runStreamSync(mode: "full")` re-polls every stream from a null cursor at a
 * new generation and then soft-deletes every poll-managed row still below it.
 * It built `PollArgs` from the connection and the stream's config hash, and
 * dropped the four fields the stream itself owns.
 *
 * `windowFloor` is the one that deletes. It is how far back a stream is SUPPOSED
 * to reach once a backfill deepened it past the connector's default, and the
 * connector reads it to set the request bound. Absent, the bound falls back to
 * the default — the deepened rows are never re-fetched, they stay at the
 * previous generation, and the retire tombstones them as though upstream had
 * removed them. A user asking to repair their data got their history deleted,
 * counted as ordinary cleanup.
 *
 * `dateField` corrupts instead, and permanently: rows first seen by the re-sync
 * are stamped by the connector's fallback (the import moment) and then frozen
 * there by `preserveOccurredAt` on every later mirror sweep.
 *
 * `restamp` is the one that decides whether the re-poll happens at all. A mirror
 * that believes nothing changed answers with no records — to a caller that has
 * just bumped the generation and is about to retire everything below it.
 */

const DAY = 86_400_000;
const ORG = "org_settings";

/**
 * A source is STREAM-SCOPED when its catalog entry declares `flowFields`, so a
 * stub connector alone cannot reach `runStreamSync` — `runSync` would take the
 * connection-scoped branch and never touch a stream row. Registering catalog
 * entries is what puts these two on the path under test. Vitest isolates
 * modules per file, so this array mutation does not escape.
 */
function registerStreamScoped(source: string, name: string, sync?: "mirror"): void {
  CONNECTOR_CATALOG.push({
    source,
    name,
    description: "test stub",
    connect: "apiKey",
    instant: false,
    poll: true,
    autoWebhook: false,
    credentialFields: [],
    flowFields: [{ key: "resource", label: "Resource" }],
    ...(sync ? { sync } : {}),
  });
}
registerStreamScoped("windowed-stream", "Windowed");
registerStreamScoped("dated-stream", "Dated");
registerStreamScoped("mirror-stream", "Mirror", "mirror");

/** Every PollArgs the connector was handed, so what was dropped is visible. */
let SEEN: PollArgs[] = [];

const rec = (id: string, ageDays: number): CanonicalEvent => ({
  eventId: `settings:conn:${id}`,
  eventType: "booked",
  subject: id,
  occurredAt: new Date(Date.now() - ageDays * DAY),
  properties: {},
});

/**
 * A connector shaped like Calendly's: it reaches back to `windowFloor` when it
 * is given one, and to its own 30-day default when it is not. Records older than
 * the bound are simply not returned — which is what makes the drop invisible at
 * the call site and fatal at the retire.
 */
const DEFAULT_FLOOR_DAYS = 30;
const windowedConnector: Connector = {
  source: "windowed-stream",
  authType: "none",
  verifySignature: () => true,
  poll: async (args: PollArgs): Promise<PollResult> => {
    SEEN.push(args);
    const floorDays = args.windowFloor ? (Date.now() - args.windowFloor.getTime()) / DAY : DEFAULT_FLOOR_DAYS;
    const all = [rec("recent", 5), rec("deep", 60)];
    return { records: all.filter((r) => Date.now() - r.occurredAt.getTime() <= floorDays * DAY), nextCursor: null };
  },
};
registerConnector(windowedConnector);

/**
 * A connector shaped like Sheets': it dates rows from the nominated column, and
 * falls back to the import moment when nobody nominated one. It also declines to
 * re-read when it believes nothing changed, unless asked to restamp.
 */
const IMPORT_MOMENT_MARKER = new Date("2020-01-01T00:00:00Z");
const datedConnector: Connector = {
  source: "dated-stream",
  authType: "none",
  verifySignature: () => true,
  poll: async (args: PollArgs): Promise<PollResult> => {
    SEEN.push(args);
    if (!args.restamp) return { records: [], nextCursor: "settled-marker", unchanged: true };
    const dated = args.dateField != null;
    return {
      records: [
        {
          eventId: "settings:conn:row-1",
          eventType: "row_added",
          subject: "row-1",
          // The nominated column holds a real date; without it, the import moment.
          occurredAt: dated ? new Date("2026-03-04T00:00:00Z") : IMPORT_MOMENT_MARKER,
          properties: {},
        },
      ],
      nextCursor: null,
      dateFieldState: args.dateField
        ? { column: args.dateField, source: "user", presentInHeader: true, dated: 1, undated: 0 }
        : { column: args.detectDateField ? "Detected At" : null, source: "detected", presentInHeader: true, dated: 1, undated: 0 },
    };
  },
};
registerConnector(datedConnector);

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  SEEN = [];
});
afterEach(async () => {
  await close();
});

async function seedStream(
  connectionId: string,
  patch: Partial<typeof sourceStreams.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId, configHash: "hash-1", config: {}, ...patch })
    .returning();
  return row.id;
}

const liveSubjects = async (connectionId: string): Promise<string[]> => {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)));
  return rows.map((r) => r.subject!).sort();
};

describe("a deepened window survives a full re-sync", () => {
  it("re-polls to the stream's own floor, not the connector's default", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "windowed-stream" });
    await seedStream(conn, { windowFloor: new Date(Date.now() - 90 * DAY) });

    await runSync(db, conn, "full");

    expect(SEEN[0].windowFloor?.getTime()).toBeCloseTo(Date.now() - 90 * DAY, -4);
    expect(await liveSubjects(conn)).toEqual(["deep", "recent"]);
  });

  /**
   * The failure this replaces, stated as its own case so the two are not
   * confused: with no floor set the default IS the right answer, and the deep
   * row is genuinely outside what the stream claims to hold.
   */
  it("still uses the default for a stream nobody deepened", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "windowed-stream" });
    await seedStream(conn);

    await runSync(db, conn, "full");

    expect(SEEN[0].windowFloor).toBeNull();
    expect(await liveSubjects(conn)).toEqual(["recent"]);
  });

  /**
   * The deletion itself, which is the part that made this urgent. A first
   * re-sync WITH the floor imports the deep row; a second one that lost the
   * floor would tombstone it, because it stays at the older generation while
   * everything the shorter walk saw moves up.
   */
  it("does not tombstone deepened history on the next full re-sync", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "windowed-stream" });
    await seedStream(conn, { windowFloor: new Date(Date.now() - 90 * DAY) });

    await runSync(db, conn, "full");
    expect(await liveSubjects(conn)).toEqual(["deep", "recent"]);

    const second = await runSync(db, conn, "full");
    expect(second.softDeleted).toBe(0);
    expect(await liveSubjects(conn)).toEqual(["deep", "recent"]);
  });
});

describe("the stream's dating settings reach the re-poll", () => {
  it("dates rows from the nominated column instead of the import moment", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "dated-stream" });
    await seedStream(conn, { dateField: "Booked On", dateFieldLocked: true });

    await runSync(db, conn, "full");

    expect(SEEN[0].dateField).toBe("Booked On");
    // A locked stream is one a human answered for; detection must not overrule it.
    expect(SEEN[0].detectDateField).toBe(false);

    const [row] = await db.select().from(events).where(eq(events.connectionId, conn));
    expect(row.occurredAt.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(row.occurredAt.getTime()).not.toBe(IMPORT_MOMENT_MARKER.getTime());
  });

  it("asks an unanswered stream to detect, on the same terms a sweep does", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "dated-stream" });
    const streamId = await seedStream(conn);

    await runSync(db, conn, "full");

    expect(SEEN[0].detectDateField).toBe(true);
    // A dating decision nobody can see is worse than none: what the read used is
    // recorded, so the next sweep does not re-detect and call it a change.
    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, streamId));
    expect(stream.dateFieldState?.column).toBe("Detected At");
    expect(stream.dateFieldState?.at).toBeTruthy();
  });

  /**
   * A full re-sync is precisely the caller that must not be told "nothing
   * changed": it has bumped the generation and is about to retire everything
   * below it, so an empty answer is an empty replacement set.
   */
  it("reads even when the source believes nothing changed", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "dated-stream" });
    await seedStream(conn, { dateField: "Booked On", dateFieldLocked: true });

    const res = await runSync(db, conn, "full");

    expect(SEEN[0].restamp).toBe(true);
    expect(res.inserted).toBe(1);
    expect(await liveSubjects(conn)).toEqual(["row-1"]);
  });
});

/**
 * AN EMPTY READ MEANS NOTHING WAS READ, NOT THAT EVERYTHING WAS DELETED.
 *
 * The full re-sync's retire is scoped by connection and generation and by
 * nothing else — no date, no window — and was gated only on `complete`.
 * `complete` separates a truncated walk from a finished one; it does not
 * separate completion-with-data from completion-with-nothing, and it says
 * nothing at all about rows outside the window the walk covered.
 *
 * Both gaps are reachable. `pollAll` sets `complete` when `nextCursor` is null,
 * and the window serializers in Close and Instantly both fall through to
 * `maxSeen ?? hw` — both null on a fresh walk that returned nothing. Worse,
 * Instantly's analytics streams return `nextCursor: null` on EVERY poll by
 * construction, so an empty analytics response needs no edge case at all.
 *
 * A mirror is the exception, and the reason is the rule: it re-reads the whole
 * resource, so an empty read genuinely means an empty resource and those rows
 * should go.
 */
describe("an empty full re-sync does not tombstone the history it did not read", () => {
  /** Serves rows on the first run and nothing on the second, draining both times. */
  let SERVE = true;
  const emptyingConnector: Connector = {
    source: "emptying-stream",
    authType: "none",
    verifySignature: () => true,
    poll: async (args: PollArgs): Promise<PollResult> => {
      SEEN.push(args);
      // Drained either way: the provider says there is no next page.
      return { records: SERVE ? [rec("kept", 5)] : [], nextCursor: null };
    },
  };
  registerConnector(emptyingConnector);
  registerStreamScoped("emptying-stream", "Emptying");

  beforeEach(() => {
    SERVE = true;
  });

  it("keeps rows a completed-but-empty walk never saw", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "emptying-stream" });
    await seedStream(conn);

    await runSync(db, conn, "full");
    expect(await liveSubjects(conn)).toEqual(["kept"]);

    // The window is now empty — an account with no activity in its window, not
    // an account whose records were deleted.
    SERVE = false;
    const second = await runSync(db, conn, "full");
    expect(second.softDeleted).toBe(0);
    expect(await liveSubjects(conn)).toEqual(["kept"]);
  });
});

/**
 * A MIRROR IS THE ONE CLASS WHERE AN EMPTY READ IS AN ANSWER, because it read
 * the whole resource. A sheet whose rows were deleted comes back empty, and
 * those rows genuinely should go — so the guard above must not apply here.
 */
/**
 * "Re-sync" IS THE BUTTON A CUSTOMER PRESSES WHEN THE NUMBERS LOOK WRONG, so it
 * is the one path that must not re-freeze them.
 *
 * It passed `preserveOccurredAt: isMirrorSource(...)` unconditionally, so a full
 * re-sync of a sheet restated every row's content and pinned every row's date to
 * whatever it already held. The repair path was the one guaranteed not to
 * repair — and, unlike an ordinary sweep, it never consulted the restamp marker
 * either, so nothing else in the system would have corrected it afterwards.
 */
describe("a full re-sync re-dates a mirror's rows from its own date column", () => {
  registerStreamScoped("redate-stream", "Redate", "mirror");
  let CELL = "2026-03-04T00:00:00.000Z";
  registerConnector({
    source: "redate-stream",
    authType: "none",
    verifySignature: () => true,
    poll: async (args: PollArgs): Promise<PollResult> => {
      SEEN.push(args);
      return {
        records: [
          { eventId: "settings:conn:row-1", eventType: "row_added", subject: "row-1", occurredAt: new Date(CELL), properties: {} },
        ],
        nextCursor: null,
        dateFieldState: { column: "Booked On", source: "user", presentInHeader: true, dated: 1, undated: 0 },
      };
    },
  });

  const dateOf = async (conn: string): Promise<string> =>
    (await db.select().from(events).where(eq(events.connectionId, conn)))[0].occurredAt.toISOString();

  it("moves a stored row onto the date the source now reports", async () => {
    CELL = "2026-03-04T00:00:00.000Z";
    const conn = await seedConnection(db, { orgId: ORG, source: "redate-stream" });
    await seedStream(conn, { dateField: "Booked On", dateFieldLocked: true });

    await runSync(db, conn, "full");
    expect(await dateOf(conn)).toBe("2026-03-04T00:00:00.000Z");

    // The row now says something else about itself — a spreadsheet cell edited,
    // or rows shifted so this key holds a different record entirely.
    CELL = "2026-05-05T00:00:00.000Z";
    await runSync(db, conn, "full");

    // REVERT THE RE-SYNC DATING RULE AND THIS READS 2026-03-04 FOREVER.
    expect(await dateOf(conn)).toBe("2026-05-05T00:00:00.000Z");
  });
});

describe("a mirror still retires on an empty re-read", () => {
  let MIRROR_SERVE = true;
  const mirrorConnector: Connector = {
    source: "mirror-stream",
    authType: "none",
    verifySignature: () => true,
    poll: async (args: PollArgs): Promise<PollResult> => {
      SEEN.push(args);
      return { records: MIRROR_SERVE ? [rec("row-1", 1)] : [], nextCursor: null };
    },
  };
  registerConnector(mirrorConnector);

  beforeEach(() => {
    MIRROR_SERVE = true;
  });

  it("removes rows the whole-resource read no longer produced", async () => {
    const conn = await seedConnection(db, { orgId: ORG, source: "mirror-stream" });
    await seedStream(conn);

    await runSync(db, conn, "full");
    expect(await liveSubjects(conn)).toEqual(["row-1"]);

    MIRROR_SERVE = false;
    const second = await runSync(db, conn, "full");
    expect(second.softDeleted).toBe(1);
    expect(await liveSubjects(conn)).toEqual([]);
  });
});
