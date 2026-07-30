import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";
import { streamConfigHash, normalizeStreamConfig } from "@/lib/sync/stream-hash";
import { googleSheetsConnector } from "@/connectors/google-sheets";
import { dateColumnNote, dateColumnSettings, setDateColumn, suggestDateColumn, type DateColumnSettings } from "@/lib/sync/date-column";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * A SHEET ROW'S EVENT TIME.
 *
 * A spreadsheet row has no timestamp of its own, so the connector stamped
 * `occurred_at` with `new Date()` — the import moment — and `preserveOccurredAt`
 * froze it there. Every time-based metric over a sheet was measuring when the
 * data was imported, and the sheet's real date was sitting in a column the whole
 * time: `normalize-dates.ts` was built for exactly these shapes (its docstring
 * names "7/21/2026 14:23:45" as the sheet case) and had been canonicalizing them
 * into `properties` and into `occurred_at` never.
 *
 * The column is nominated PER STREAM, because `occurred_at` is a fact about a
 * ROW and a stream's rows are shared by every flow reading it.
 */

/**
 * The one thing this suite cannot reach on its own: another writer already
 * holding the stream's swap lock.
 *
 * PGlite is single-session, so a genuine advisory-lock collision is unreachable
 * here (`tests/locks.test.ts` says the same and defers to
 * `scripts/verify-pool-driver.ts`). The behaviour it gates is not exotic though —
 * it is the only way a sweep writes zero rows without raising — so it is stood in
 * for rather than left untested. Off by default: every other test in this file
 * runs the real lock.
 */
const lock = vi.hoisted(() => ({ contended: false }));
vi.mock("@/lib/sync/locks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sync/locks")>();
  return {
    ...real,
    withStreamWriteLock: async (db: Parameters<typeof real.withStreamWriteLock>[0], scope: string, fn: never) =>
      lock.contended ? { acquired: false, result: null } : real.withStreamWriteLock(db, scope, fn),
  };
});

const ORG = "org_datecol";
const KEY = randomBytes(32).toString("base64");
const CFG = { spreadsheetId: "DATES", range: "Leads" };
const HASH = streamConfigHash(CFG, "gsheets");

let db: DB;
let close: () => Promise<void>;
let connId: string;
let SHEET: string[][] = [];
/** Drive's answer to "has this file been touched?" — held still on purpose. */
let MODIFIED = "2026-01-01T00:00:00.000Z";
/** Sheets reads this sweep saw, so a SKIP can be told from a read of the same data. */
let valuesReads = 0;
/** Make the tab read fail, to interrupt a sweep partway. */
let failValues = false;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  SHEET = [
    ["Name", "Booked on", "Source"],
    ["Ana", "7/21/2026 14:23:45", "ig"],
    ["Ben", "2026-07-22", "fb"],
    ["Cal", "Jan 5, 2026", "ig"],
  ];
  MODIFIED = "2026-01-01T00:00:00.000Z";
  valuesReads = 0;
  failValues = false;
  lock.contended = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const reply = (body: unknown, ok = true, status = 200) =>
        ({
          ok,
          status,
          statusText: ok ? "OK" : "Forbidden",
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as unknown as Response;
      // Phase 3's change probe. Served for real here — the restamp's whole
      // difficulty is that it has to fire on a sheet this endpoint says is
      // settled, which is the normal state of a sheet.
      if (url.includes("/drive/v3/files/")) return reply({ modifiedTime: MODIFIED, version: "1" });
      if (url.includes("/values/")) {
        valuesReads += 1;
        // 403, not 500: fetchJson retries 5xx, and this is about a sweep that
        // stops, not about how long it takes to stop.
        return failValues ? reply({ error: "nope" }, false, 403) : reply({ values: SHEET });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const [conn] = await db
    .insert(connections)
    .values({
      orgId: ORG,
      source: "gsheets",
      name: "Sheet",
      status: "active",
      authType: "oauth2",
      credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
    })
    .returning({ id: connections.id });
  connId = conn.id;
  await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId: connId, configHash: HASH, config: normalizeStreamConfig(CFG, "gsheets") });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

const sweep = () => reconcileConnection(db, connId);

/**
 * The REAL path, not a raw column write — because setting the column and asking
 * for the restamp are one act, and a test that only did the first would be
 * testing a state the product cannot produce.
 */
const setColumn = (column: string | null) => setDateColumn(db, ORG, connId, HASH, column);

const streamRow = async () => (await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, HASH)))[0];

/**
 * Age the rows already stored, and return the moment they were "first seen".
 *
 * Without this every assertion about first-seen is satisfied by `new Date()` as
 * well, because a test finishes in under a second — the tolerance that would be
 * needed to compare them is wider than the bug. A real sheet was imported days
 * ago, which is the entire reason `received_at` has to be looked up rather than
 * synthesized, so the test says days ago too.
 */
async function ageRows(days = 10): Promise<Date> {
  const at = new Date(Date.now() - days * 86_400_000);
  // occurred_at moves with it: these rows were stamped with their import moment,
  // which is what a sheet imported before any column was chosen actually holds.
  await db.update(events).set({ receivedAt: at, occurredAt: at }).where(eq(events.connectionId, connId));
  return at;
}

/** Stored rows in sheet order, as `{name, occurredAt}`. */
async function stored(): Promise<Array<{ name: unknown; occurredAt: Date }>> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connId), eq(events.streamHash, HASH), isNull(events.deletedAt)));
  return rows
    .sort((a, b) => Number(a.eventId.split(":row:").pop()) - Number(b.eventId.split(":row:").pop()))
    .map((r) => ({ name: (r.properties as Record<string, unknown>)["Name"], occurredAt: r.occurredAt }));
}

const state = async () => (await streamRow()).dateFieldState;

describe("no column nominated — first-seen, and the state says nothing", () => {
  it("stamps the import moment, which is what NULL means", async () => {
    const before = Date.now();
    await sweep();

    const rows = await stored();
    expect(rows).toHaveLength(3);
    // Every row lands within the sweep, not on the dates in the sheet.
    for (const r of rows) {
      expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(r.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
    // Nothing to report about a column nobody chose.
    expect(await state()).toBeNull();
  });
});

describe("a nominated column becomes the row's event time", () => {
  it("reads the sheet's own dates, in the shapes sheets actually write", async () => {
    await setColumn("Booked on");
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z", // "7/21/2026 14:23:45"
      "2026-07-22T00:00:00.000Z", // "2026-07-22"
      "2026-01-05T00:00:00.000Z", // "Jan 5, 2026"
    ]);
    expect(await state()).toEqual({ column: "Booked on", presentInHeader: true, dated: 3, undated: 0, at: expect.any(String) });
  });

  it("counts the rows it could not date, and leaves them at first-seen", async () => {
    SHEET[2][1] = ""; // Ben's date is blank
    SHEET[3][1] = "whenever"; // Cal's is not a date
    await setColumn("Booked on");
    const before = Date.now();
    await sweep();

    const rows = await stored();
    expect(rows[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
    // Not skipped — a mirror that dropped them would lose the rows entirely.
    expect(rows).toHaveLength(3);
    for (const r of rows.slice(1)) expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    // …and the count is the thing the UI shows, so it has to be real.
    expect(await state()).toMatchObject({ column: "Booked on", presentInHeader: true, dated: 1, undated: 2 });
  });

  /**
   * THE NAMED CONDITION. A renamed column makes every row undated, which reads
   * identically to a column full of malformed dates — and the two need different
   * fixes. Only the connector, holding the header row, can tell them apart.
   */
  it("says the column is gone, rather than just reporting nothing parsed", async () => {
    await setColumn("Booked on");
    await sweep();
    expect(await state()).toMatchObject({ presentInHeader: true, dated: 3 });

    SHEET[0][1] = "Booking date"; // the user renamed the header…
    MODIFIED = "2026-02-02T00:00:00.000Z"; // …which is an edit, so Drive says so
    await sweep();

    expect(await state()).toMatchObject({ column: "Booked on", presentInHeader: false, dated: 0, undated: 3 });
  });

  it("clears what is on screen when the picker is cleared", async () => {
    await setColumn("Booked on");
    await sweep();
    expect(await state()).not.toBeNull();

    await setColumn(null);
    await sweep();

    expect(await state()).toBeNull();
  });

  /**
   * The numeric gate stays on. Nominating a column says WHICH column holds the
   * date, not that its values should be reinterpreted more loosely than the
   * detector would anywhere else — an under-parse is counted and shown, where an
   * over-parse silently invents dates.
   */
  it("still refuses bare numbers in a column whose name is not date-like", async () => {
    SHEET = [
      ["Name", "Ref", "Created"],
      ["Ana", "1750000000", "1750000000"],
    ];
    // Read through the connector rather than a sweep: the same row under two
    // different columns cannot be compared through the writer, because the pin
    // keeps whatever the first sweep stored. This is about the PARSE.
    const args = { connectionId: connId, cursor: null, credentials: { accessToken: "tok" }, config: CFG, streamHash: HASH };

    const asRef = await googleSheetsConnector.poll!({ ...args, dateField: "Ref" });
    expect(asRef.dateFieldState).toMatchObject({ dated: 0, undated: 1 });

    const asCreated = await googleSheetsConnector.poll!({ ...args, dateField: "Created" });
    expect(asCreated.dateFieldState).toMatchObject({ dated: 1, undated: 0 });
    expect(asCreated.records[0].occurredAt.toISOString()).toBe("2025-06-15T15:06:40.000Z");
  });
});

/**
 * THE RESTAMP.
 *
 * `preserveOccurredAt` pins `occurred_at` on conflict, so choosing a column
 * fixes rows that arrive LATER and leaves every existing one stamped with its
 * import time — and a full re-sync does not help, because it still upserts on
 * `event_id` and the pin still wins. The person who notices that every sheet
 * metric is measuring import time is exactly the person the correction would
 * silently fail for.
 *
 * So a column change asks for one sweep that does not pin.
 */
describe("changing the column restamps the rows already stored", () => {
  it("moves existing rows onto the sheet's own dates", async () => {
    const before = Date.now();
    await sweep(); // imported with no column: three rows stamped 'now'
    for (const r of await stored()) expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);

    await setColumn("Booked on");
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z",
      "2026-07-22T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
    ]);
  });

  /**
   * The pin is the DEFAULT and stays the default. Only the sweep that follows a
   * change is exempt — an ordinary re-read of a mirror must never shift the
   * event times of rows it is merely restating.
   */
  it("goes back to pinning once the restamp is done", async () => {
    await setColumn("Booked on");
    await sweep();
    expect((await streamRow()).restampRequestedAt).toBeNull();

    // The sheet now says something different about Ana. A mirror re-read
    // restates the row; it does not re-date it.
    SHEET[1][1] = "1/1/2020";
    MODIFIED = "2026-03-03T00:00:00.000Z";
    await sweep();

    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
  });

  /**
   * NAMED TEST 1. A settled sheet is the normal state of a sheet, and Phase 3
   * skips reading one. The restamp has to fire anyway: nothing about the SHEET
   * changed, which is exactly the point — what changed is which column we read
   * the date from.
   */
  it("forces a read even though Drive says the file has not changed", async () => {
    await sweep(); // first read stores the change marker
    const afterFirst = valuesReads;
    await sweep(); // …and this one skips, on an unchanged modifiedTime
    expect(valuesReads).toBe(afterFirst);

    await setColumn("Booked on");
    await sweep();

    expect(valuesReads).toBe(afterFirst + 1); // read, on a file Drive called settled
    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
  });

  /**
   * NAMED TEST 2. The second change is where "keep first-seen" and "pass
   * `preserveOccurredAt`" stop being the same thing: preserve keeps what is
   * STORED, so a row with no date in the newly-chosen column would keep the
   * PREVIOUS column's value — a column the user has explicitly abandoned —
   * while the UI reported it as having kept its import time.
   */
  it("restamps again on a second change, and drops unparseable rows to first-seen", async () => {
    SHEET = [
      ["Name", "Booked on", "Closed on"],
      ["Ana", "7/21/2026 14:23:45", "8/01/2026"],
      ["Ben", "2026-07-22", ""], // dated under the FIRST column, not the second
    ];
    await sweep();
    const firstSeen = await ageRows();

    await setColumn("Booked on");
    await sweep();
    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z",
      "2026-07-22T00:00:00.000Z",
    ]);

    await setColumn("Closed on");
    await sweep();

    const after = await stored();
    expect(after[0].occurredAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    // THE ASSERTION THIS TEST EXISTS FOR. Ben has no "Closed on" date. He falls
    // to when he was first seen — not to 2026-07-22, the value the abandoned
    // column gave him, and not to now, which is neither.
    expect(after[1].occurredAt.toISOString()).toBe(firstSeen.toISOString());
    expect(await state()).toMatchObject({ column: "Closed on", presentInHeader: true, dated: 1, undated: 1 });
  });

  /**
   * Reverting the picker is the same door in the other direction. Under a plain
   * preserve every row would keep the old column's date and nothing would move,
   * making "use import time" a setting the user can leave but never return to.
   */
  it("returns every row to first-seen when the picker is cleared", async () => {
    await sweep();
    const firstSeen = await ageRows();

    await setColumn("Booked on");
    await sweep();
    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");

    await setColumn(null);
    await sweep();

    for (const r of await stored()) expect(r.occurredAt.toISOString()).toBe(firstSeen.toISOString());
    expect(await state()).toBeNull();
  });

  /**
   * NAMED TEST 3 — crash safety. The marker is cleared LAST and only on the
   * branch where the write actually ran. Cleared any earlier, a sweep that dies
   * partway leaves the user with a correction they were told was queued and that
   * silently never happens; re-running it costs one read and produces the same
   * values, so the surviving direction is the harmless one.
   */
  it("keeps the request standing when the sweep writes nothing", async () => {
    await sweep();
    const imported = (await stored()).map((r) => r.occurredAt.getTime());

    await setColumn("Booked on");
    failValues = true;
    await sweep(); // the tab read blows up partway through the restamp

    // Nothing moved, and — the point — the request is still there.
    expect((await stored()).map((r) => r.occurredAt.getTime())).toEqual(imported);
    expect((await streamRow()).restampRequestedAt).not.toBeNull();

    failValues = false;
    // Every stream failed, so the breaker tripped and paused the connection.
    // A real recovery waits that window out; this one just skips to the end of
    // it, because the point under test is the marker, not the backoff.
    await db.update(connections).set({ pausedUntil: null, pausedReason: null }).where(eq(connections.id, connId));
    await sweep();

    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
    expect((await streamRow()).restampRequestedAt).toBeNull();
  });

  /**
   * The same rule, on the one path that writes nothing WITHOUT raising: another
   * writer holds the stream's swap lock, so this sweep stands down. Zero rows
   * written and zero rows to write are indistinguishable from the counts, which
   * is why the marker follows whether the write RAN rather than what it wrote.
   */
  it("keeps the request standing when another writer holds the stream", async () => {
    await sweep();
    const firstSeen = await ageRows();

    await setColumn("Booked on");
    lock.contended = true;
    await sweep(); // reads, then stands down at the swap

    expect((await stored())[0].occurredAt.toISOString()).toBe(firstSeen.toISOString());
    expect((await streamRow()).restampRequestedAt).not.toBeNull();

    lock.contended = false;
    await sweep();

    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
    expect((await streamRow()).restampRequestedAt).toBeNull();
  });

  /**
   * …and cleared it must be, or the stream forces a full read of a settled sheet
   * on every sweep forever — the cost Phase 3 exists to remove.
   */
  it("stops forcing reads once the restamp has happened", async () => {
    await setColumn("Booked on");
    await sweep();
    const afterRestamp = valuesReads;

    await sweep();

    expect(valuesReads).toBe(afterRestamp);
    expect((await streamRow()).restampRequestedAt).toBeNull();
  });
});

/**
 * The unreachable `normalize` is gone rather than repointed.
 *
 * It guessed a hard-coded `row["timestamp"]` while the poll stamped
 * `new Date()` — two different wrong answers for one source. The webhook route
 * answers `isStreamScoped` before verification or storage, so nothing could ever
 * reach it, which is exactly why nothing ever contradicted it.
 */
describe("the dead webhook path is deleted, not repointed", () => {
  it("declares no normalize at all", () => {
    expect(googleSheetsConnector.normalize).toBeUndefined();
  });
});

/**
 * The copy, and the suggestion. Both are pure, and both carry the honesty rule:
 * first-seen is a defensible answer, first-seen presented as the event time is
 * not — so the unset case is a sentence, never silence.
 */
describe("what the user is told", () => {
  const note = (dateField: string | null, state: DateColumnSettings["state"] = null) => dateColumnNote({ dateField, state });
  const at = new Date().toISOString();

  it("names import time when no column is chosen, rather than saying nothing", () => {
    expect(note(null)).toContain("No date column selected");
    expect(note(null)).toContain("first imported");
  });

  it("does not claim a column works before a read has happened under it", () => {
    // Chosen a moment ago; the sweep has not run. Saying "timing uses X" here
    // would be a promise, not a report.
    expect(note("Booked on")).toBe('Timing will use "Booked on" from the next read.');
    // Same when the state still describes the PREVIOUS column.
    expect(note("Closed on", { column: "Booked on", presentInHeader: true, dated: 5, undated: 0, at })).toContain("from the next read");
  });

  it("separates a renamed column from a column of unusable values", () => {
    const renamed = note("Date", { column: "Date", presentInHeader: false, dated: 0, undated: 500, at });
    const unusable = note("Date", { column: "Date", presentInHeader: true, dated: 0, undated: 500, at });
    expect(renamed).toContain('no longer in this sheet');
    expect(unusable).toContain("No row has a usable date");
    // Both end at import time, and the numbers alone cannot tell them apart —
    // which is the entire reason `presentInHeader` is recorded.
    expect(renamed).not.toBe(unusable);
  });

  it("reports the partial case with both numbers", () => {
    expect(note("Date", { column: "Date", presentInHeader: true, dated: 412, undated: 88, at })).toBe(
      'Timing uses "Date" — 88 of 500 rows have no usable date there and fall back to when they were first imported.',
    );
  });

  /**
   * The gap between choosing and sweeping is real, and it is the interval a user
   * would otherwise read as a broken picker: they change the column, look at the
   * rows, and see the old times. Both ends of the change say so.
   */
  it("promises the rows already imported, while the restamp is pending", () => {
    const pending = (dateField: string | null) => dateColumnNote({ dateField, state: null, restampPending: true });
    expect(pending("Booked on")).toBe('Timing will use "Booked on" from the next read, including rows already imported.');
    expect(pending(null)).toBe("No date column selected — from the next read, timing goes back to when each row was first imported.");
    // Once the sweep has run there is nothing pending, and nothing to promise.
    expect(note("Booked on")).not.toContain("already imported");
  });

  it("says the plain thing when every row is dated", () => {
    expect(note("Date", { column: "Date", presentInHeader: true, dated: 500, undated: 0, at })).toBe('Timing uses "Date".');
  });

  it("suggests a date-like header and never guesses at random", () => {
    expect(suggestDateColumn(["Name", "Submitted at", "Source"])).toBe("Submitted at");
    expect(suggestDateColumn(["Name", "Created", "Updated"])).toBe("Created"); // first wins
    expect(suggestDateColumn(["Name", "Source", "Amount"])).toBeNull();
    expect(suggestDateColumn([])).toBeNull();
  });
});

describe("the picker writes to the stream, not to a flow", () => {
  it("is org-scoped, and reports whether anything changed", async () => {
    expect(await setDateColumn(db, ORG, connId, HASH, "Booked on")).toEqual({ changed: true });
    // Re-picking the same column is not a change — an unchanged pick must not
    // look like a reason to re-read a settled sheet.
    expect(await setDateColumn(db, ORG, connId, HASH, "Booked on")).toEqual({ changed: false });
    expect(await setDateColumn(db, ORG, connId, HASH, null)).toEqual({ changed: true });

    // Another org naming this stream exactly gets nothing.
    expect(await setDateColumn(db, "org_other", connId, HASH, "Booked on")).toEqual({ changed: false });
    expect((await dateColumnSettings(db, ORG, connId, HASH))!.dateField).toBeNull();
  });

  it("treats an empty pick as clearing, not as a column named empty string", async () => {
    await setDateColumn(db, ORG, connId, HASH, "Booked on");
    await setDateColumn(db, ORG, connId, HASH, "   ");
    expect((await dateColumnSettings(db, ORG, connId, HASH))!.dateField).toBeNull();
  });
});
