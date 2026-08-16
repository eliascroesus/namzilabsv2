import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";
import { syncStream } from "@/lib/sync/streams";
import { streamConfigHash, normalizeStreamConfig } from "@/lib/sync/stream-hash";
import { googleSheetsConnector } from "@/connectors/google-sheets";
import { detectDateColumn } from "@/lib/normalize-dates";
import {
  dateColumnChoice,
  dateColumnNote,
  dateColumnSettings,
  setDateColumn,
  type DateColumnSettings,
} from "@/lib/sync/date-column";
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
 * The column is PER STREAM, because `occurred_at` is a fact about a ROW and a
 * stream's rows are shared by every flow reading it. And it is DETECTED by
 * default, because a sheet with an obvious date column sitting on import time
 * until somebody notices is the same defect one layer up.
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
 * The three answers, through the REAL path — setting the column and asking for
 * the restamp are one act, and a test that only did the first would be testing a
 * state the product cannot produce.
 */
const pick = (column: string) => setDateColumn(db, ORG, connId, HASH, { kind: "column", column });
const useImportTime = () => setDateColumn(db, ORG, connId, HASH, { kind: "none" });
const useAuto = () => setDateColumn(db, ORG, connId, HASH, { kind: "auto" });

const streamRow = async () => (await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, HASH)))[0];

/** A sheet with nothing a detector could use, for the import-time baseline. */
const NO_DATES = [
  ["Name", "Source", "Notes"],
  ["Ana", "ig", "warm"],
  ["Ben", "fb", "cold"],
  ["Cal", "ig", "warm"],
];

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
  // which is what a sheet imported before any column was in force actually holds.
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

/**
 * DETECTION, as a pure function. Name proposes, values decide — the second gate
 * is the one that matters, because "Start", "Closed" and "Notes on" all read as
 * date-like and none of them has to hold a date.
 */
describe("finding the date column", () => {
  const rows = (...vals: string[]) => vals.map((v) => ["x", v]);

  it("takes a date-hinted column whose values are actually dates", () => {
    expect(detectDateColumn(["Name", "Booked on"], rows("7/21/2026", "2026-07-22"))).toEqual({
      column: "Booked on",
      candidates: ["Booked on"],
    });
  });

  it("refuses a date-hinted column that holds text", () => {
    // "Closed" passes the name test and holds yes/no. This is the case a
    // header-only guess got wrong, and it would have dated every row from it.
    expect(detectDateColumn(["Name", "Closed"], rows("yes", "no", "yes"))).toEqual({ column: null, candidates: [] });
  });

  it("tolerates a minority of unparseable values, and no more", () => {
    expect(detectDateColumn(["Name", "Date"], rows("2026-07-01", "2026-07-02", "tbc")).column).toBe("Date");
    expect(detectDateColumn(["Name", "Date"], rows("2026-07-01", "tbc", "tbc")).column).toBeNull();
  });

  it("ignores blanks rather than counting them against a column", () => {
    expect(detectDateColumn(["Name", "Date"], rows("2026-07-01", "", "  ", "2026-07-02")).column).toBe("Date");
    // …but a column with no values at all is not the date column.
    expect(detectDateColumn(["Name", "Date"], rows("", "  ")).column).toBeNull();
  });

  it("never picks a column whose NAME is not date-like, whatever it holds", () => {
    expect(detectDateColumn(["Name", "Ref"], rows("2026-07-01", "2026-07-02")).candidates).toEqual([]);
  });

  /**
   * THE AMBIGUOUS CASE. Two real answers, and picking either is a coin toss the
   * user cannot see — so nothing is used and both names come back as the
   * question.
   */
  it("returns every qualifying column and chooses none when there are several", () => {
    const d = detectDateColumn(["Name", "Booked on", "Closed on"], [["x", "2026-07-01", "2026-08-01"]]);
    expect(d).toEqual({ column: null, candidates: ["Booked on", "Closed on"] });
  });

  it("says nothing about a sheet with headers and no rows", () => {
    expect(detectDateColumn(["Name", "Booked on"], [])).toEqual({ column: null, candidates: [] });
  });
});

/**
 * THE DEFAULT. Nobody has answered the question for this stream, so the read
 * answers it — and says that it did.
 */
describe("a sheet dates itself, without being asked", () => {
  it("uses the one column that holds real dates", async () => {
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z",
      "2026-07-22T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
    ]);
    expect(await state()).toMatchObject({ column: "Booked on", source: "detected", dated: 3, undated: 0 });
    // The stream is still unanswered — a detection is not a choice.
    expect((await streamRow()).dateFieldLocked).toBe(false);
    expect((await streamRow()).dateField).toBeNull();
  });

  it("says the column was detected, and never silently", async () => {
    await sweep();
    const note = dateColumnNote(await dateColumnSettings(db, ORG, connId, HASH));
    expect(note).toBe('Dating rows from "Booked on" (detected).');
  });

  it("falls back to first-seen, with the label, when nothing qualifies", async () => {
    SHEET = NO_DATES;
    const before = Date.now();
    await sweep();

    for (const r of await stored()) expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    // Recorded, not left absent: "we looked and found nothing" and "we have never
    // looked" are different states, and only one of them still owes a read.
    expect(await state()).toMatchObject({ column: null, source: "detected", dated: 0 });
    expect(dateColumnNote(await dateColumnSettings(db, ORG, connId, HASH))).toBe(
      "No column in this sheet holds usable dates — timing uses when each row was first imported.",
    );
  });

  /**
   * The only case where choosing is anybody's job. Two columns hold real dates,
   * so nothing is used and both names are put in the question.
   */
  it("asks, by name, when more than one column qualifies", async () => {
    SHEET = [
      ["Name", "Booked on", "Closed on"],
      ["Ana", "7/21/2026", "8/01/2026"],
      ["Ben", "2026-07-22", "2026-08-02"],
    ];
    const before = Date.now();
    await sweep();

    for (const r of await stored()) expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(await state()).toMatchObject({ column: null, candidates: ["Booked on", "Closed on"] });
    expect(dateColumnNote(await dateColumnSettings(db, ORG, connId, HASH))).toBe(
      'More than one column could be the date — "Booked on" and "Closed on". Choose one; until then timing uses when each row was first imported.',
    );
  });

  /**
   * A stream that has been importing for weeks and then gains a detection — the
   * shape every existing sheet takes the first time this ships. Nothing about
   * the mechanism differs from a pick, and neither does the outcome.
   */
  it("restamps the rows already stored when a detection appears", async () => {
    SHEET = NO_DATES;
    await sweep();
    const firstSeen = await ageRows();

    // A date column is added to the sheet.
    SHEET = [
      ["Name", "Source", "Notes", "Booked on"],
      ["Ana", "ig", "warm", "7/21/2026 14:23:45"],
      ["Ben", "fb", "cold", "2026-07-22"],
      ["Cal", "ig", "warm", "Jan 5, 2026"],
    ];
    MODIFIED = "2026-02-02T00:00:00.000Z";
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z",
      "2026-07-22T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
    ]);
    // …and it was the DETECTION that did it, not a pending request from a picker
    // nobody touched.
    expect((await streamRow()).restampRequestedAt).toBeNull();
    expect(firstSeen.getTime()).toBeLessThan(Date.now());
  });

  /**
   * THE STREAM THAT ALREADY EXISTS — every sheet in production the first time
   * this ships: rows imported, a change marker stored, and nobody ever asked
   * about a date column.
   *
   * Phase 3 skips reading a settled sheet, and a settled sheet is the normal
   * state, so without a forced read that stream would keep its import-time
   * stamps until somebody happened to edit the tab. A fresh stream does not
   * prove this — it has no marker yet, so its first sweep reads for an unrelated
   * reason.
   */
  it("forces one read on a settled sheet that has been syncing all along", async () => {
    await useImportTime();
    await sweep(); // rows at import time, and a marker matching MODIFIED
    const settled = valuesReads;
    expect((await streamRow()).cursor).toContain(MODIFIED);

    // …and now it is a stream nobody has answered for, which is what the 0019
    // backfill leaves behind for every sheet without an explicit pick.
    await db.update(sourceStreams).set({ dateFieldLocked: false, dateFieldState: null }).where(eq(sourceStreams.configHash, HASH));
    await sweep();

    expect(valuesReads).toBe(settled + 1); // read, on a file Drive called settled
    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
  });

  it("stops forcing that read once the answer is recorded", async () => {
    await sweep();
    const afterFirst = valuesReads;
    expect(await state()).not.toBeNull();

    await sweep();
    await sweep();

    expect(valuesReads).toBe(afterFirst); // the skip resumes
  });

  it("keeps owing that read when the write did not run", async () => {
    lock.contended = true;
    await sweep();
    // Nothing was written, so nothing was learned — recording the detection here
    // would tell the next sweep it had already been applied to rows it never
    // touched, and the restamp it implies would be lost.
    expect(await state()).toBeNull();

    lock.contended = false;
    await sweep();
    expect(await state()).toMatchObject({ column: "Booked on", source: "detected" });
    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
  });
});

describe("the picker overrides the detection", () => {
  it("uses the chosen column even when another one would be detected", async () => {
    SHEET = [
      ["Name", "Booked on", "Closed on"],
      ["Ana", "7/21/2026", "8/01/2026"],
    ];
    await pick("Closed on");
    await sweep();

    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(await state()).toMatchObject({ column: "Closed on", source: "user" });
  });

  /**
   * "Use import time" is an ANSWER, not the absence of one. Without that
   * distinction the detector overrules it on the next sweep and there is no way
   * to say no.
   */
  it("stops detecting when the answer is import time", async () => {
    const before = Date.now();
    await useImportTime();
    await sweep();

    for (const r of await stored()) expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(await state()).toBeNull();
    expect(dateColumnNote(await dateColumnSettings(db, ORG, connId, HASH))).toBe(
      "No date column selected — timing uses when each row was first imported.",
    );

    // …and it stays that way. A second sweep does not quietly re-detect.
    MODIFIED = "2026-02-02T00:00:00.000Z";
    await sweep();
    expect(await state()).toBeNull();
  });

  /** An override with no way back is a one-way door. */
  it("hands the question back when auto is chosen again", async () => {
    await useImportTime();
    await sweep();
    expect(await state()).toBeNull();

    await useAuto();
    await sweep();

    expect(await state()).toMatchObject({ column: "Booked on", source: "detected" });
    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");
  });
});

describe("a nominated column becomes the row's event time", () => {
  it("reads the sheet's own dates, in the shapes sheets actually write", async () => {
    await pick("Booked on");
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z", // "7/21/2026 14:23:45"
      "2026-07-22T00:00:00.000Z", // "2026-07-22"
      "2026-01-05T00:00:00.000Z", // "Jan 5, 2026"
    ]);
    expect(await state()).toEqual({
      column: "Booked on",
      source: "user",
      presentInHeader: true,
      dated: 3,
      undated: 0,
      at: expect.any(String),
    });
  });

  it("counts the rows it could not date, and leaves them at first-seen", async () => {
    SHEET[2][1] = ""; // Ben's date is blank
    SHEET[3][1] = "whenever"; // Cal's is not a date
    await pick("Booked on");
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
    await pick("Booked on");
    await sweep();
    expect(await state()).toMatchObject({ presentInHeader: true, dated: 3 });

    SHEET[0][1] = "Booking date"; // the user renamed the header…
    MODIFIED = "2026-02-02T00:00:00.000Z"; // …which is an edit, so Drive says so
    await sweep();

    expect(await state()).toMatchObject({ column: "Booked on", presentInHeader: false, dated: 0, undated: 3 });
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
 * `preserveOccurredAt` pins `occurred_at` on conflict, so an answer fixes rows
 * that arrive LATER and leaves every existing one stamped with its import time —
 * and a full re-sync does not help, because it still upserts on `event_id` and
 * the pin still wins. The person who notices that every sheet metric is measuring
 * import time is exactly the person the correction would silently fail for.
 *
 * So a change of answer asks for one sweep that does not pin.
 */
describe("changing the column restamps the rows already stored", () => {
  /** Rows in the database, stamped with their import moment. */
  const importedWithoutDates = async () => {
    await useImportTime();
    await sweep();
  };

  it("moves existing rows onto the sheet's own dates", async () => {
    const before = Date.now();
    await importedWithoutDates();
    for (const r of await stored()) expect(r.occurredAt.getTime()).toBeGreaterThanOrEqual(before);

    await pick("Booked on");
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z",
      "2026-07-22T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
    ]);
  });

  /**
   * A ROW IS DATED BY WHAT IT SAYS NOW, on every sweep — not only on the one
   * that follows a change of column.
   *
   * This test asserted the opposite until the dating rule changed, and the
   * behaviour it protected was a live data-corruption bug. A sheet row's
   * identity is its ROW NUMBER, so when rows shift, row 10 becomes a different
   * lead while staying the same event id. The writer updates `properties` and
   * pinned `occurred_at`, so each new occupant inherited the previous one's
   * date. Measured in production: 22 of 33 rows carried somebody else's date —
   * real timestamps spanning 12-14 Aug, stored dates saying 7-8 Aug — and every
   * Today/Yesterday metric over that sheet read 0 with the data sitting in it.
   *
   * REVERT `restamping` TO THE ONE-SHOT MARKER AND THIS FAILS: Ana keeps
   * 2026-07-21 forever, however many times the sheet says otherwise.
   */
  it("re-dates a row whenever the sheet's own date column changes", async () => {
    await pick("Booked on");
    await sweep();
    expect((await streamRow()).restampRequestedAt).toBeNull();

    // The sheet now says something different about Ana, with no picker change
    // and no marker pending — content alone.
    SHEET[1][1] = "1/1/2020";
    MODIFIED = "2026-03-03T00:00:00.000Z";
    await sweep();

    expect((await stored())[0].occurredAt.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  /**
   * The other half of the same rule, and the reason it is not simply
   * "stop pinning": a row the column CANNOT date must not drift. Without the
   * `restampRecords` pass, an undated row is written with the connector's
   * fallback stamp — `new Date()` — so every sweep would move it to the import
   * moment, which is the original defect this whole mechanism exists to
   * prevent, now firing every ten minutes instead of once.
   */
  it("leaves a row the column cannot date on its first-seen time, sweep after sweep", async () => {
    await pick("Booked on");
    await sweep();
    const firstSeen = await ageRows();

    SHEET[1][1] = "not a date at all";
    MODIFIED = "2026-03-03T00:00:00.000Z";
    await sweep();
    expect((await stored())[0].occurredAt.getTime()).toBe(firstSeen.getTime());

    // The second sweep is the one that matters: it is where a rule that runs
    // every time, rather than once, would show its drift.
    MODIFIED = "2026-03-04T00:00:00.000Z";
    await sweep();
    expect((await stored())[0].occurredAt.getTime()).toBe(firstSeen.getTime());

    // …and it is reported as undated rather than silently counted as dated.
    expect((await streamRow()).dateFieldState).toMatchObject({ column: "Booked on", undated: 1 });
  });

  /**
   * NAMED TEST 1. A settled sheet is the normal state of a sheet, and Phase 3
   * skips reading one. The restamp has to fire anyway: nothing about the SHEET
   * changed, which is exactly the point — what changed is which column we read
   * the date from.
   */
  it("forces a read even though Drive says the file has not changed", async () => {
    await importedWithoutDates();
    const afterFirst = valuesReads;
    await sweep(); // …and this one skips, on an unchanged modifiedTime
    expect(valuesReads).toBe(afterFirst);

    await pick("Booked on");
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
    // Two columns qualify, so the detector declines and the rows land on import
    // time — the ambiguous case, doing its job as this test's starting point.
    await sweep();
    const firstSeen = await ageRows();

    await pick("Booked on");
    await sweep();
    expect((await stored()).map((r) => r.occurredAt.toISOString())).toEqual([
      "2026-07-21T14:23:45.000Z",
      "2026-07-22T00:00:00.000Z",
    ]);

    await pick("Closed on");
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
   * Reverting to import time is the same door in the other direction. Under a
   * plain preserve every row would keep the old column's date and nothing would
   * move, making it a setting the user can leave but never return to.
   */
  it("returns every row to first-seen when import time is chosen", async () => {
    await sweep();
    const firstSeen = await ageRows();

    await pick("Booked on");
    await sweep();
    expect((await stored())[0].occurredAt.toISOString()).toBe("2026-07-21T14:23:45.000Z");

    await useImportTime();
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
    await importedWithoutDates();
    const imported = (await stored()).map((r) => r.occurredAt.getTime());

    await pick("Booked on");
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
    await importedWithoutDates();
    const firstSeen = await ageRows();

    await pick("Booked on");
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
    await pick("Booked on");
    await sweep();
    const afterRestamp = valuesReads;

    await sweep();

    expect(valuesReads).toBe(afterRestamp);
    expect((await streamRow()).restampRequestedAt).toBeNull();
  });
});

/**
 * 10(c) — THE MIRROR'S OWN GUARANTEE, CHECKED.
 *
 * "Stored live rows ≡ the source after every sweep" is the strongest claim any
 * guarantee class here makes, and nothing was verifying it. Both halves — the
 * upsert and the retire — have been wrong before, and when they are the rows
 * still look right one at a time: the failure is a COUNT, which no per-row
 * assertion can see.
 *
 * Free to take, which is why it is here and not in the nightly scan: a
 * whole-resource mirror has just read its whole resource, so the number is
 * already in hand. Everywhere else a count means a full pagination.
 */
describe("the stored row count against what the read produced", () => {
  const sync = async () => {
    const [conn] = await db.select().from(connections).where(eq(connections.id, connId));
    return syncStream(db, conn, await streamRow());
  };

  it("says nothing when the mirror is faithful", async () => {
    const res = await sync();
    expect(res.mirrorDrift).toBeUndefined();
    expect(await stored()).toHaveLength(3);
  });

  /**
   * A row the read DID produce that is still tombstoned afterwards.
   *
   * Reached through a real rule rather than a broken one: `upsertEvents` refuses
   * to resurrect a tombstone from a LOWER generation than the stored row's, so a
   * row sitting above the connection's own generation is inert — the sweep
   * writes it, the write is a no-op, and the row stays deleted while the sheet
   * plainly still has it. Every count is off by one and no row looks wrong.
   */
  it("reports a row the read produced that is still not stored", async () => {
    await sweep();
    const [victim] = await db.select().from(events).where(eq(events.connectionId, connId)).limit(1);
    await db
      .update(events)
      .set({ deletedAt: new Date(), syncGeneration: 99 })
      .where(eq(events.id, victim.id));
    MODIFIED = "2026-02-02T00:00:00.000Z";

    const res = await sync();

    expect(res.mirrorDrift).toEqual({ read: 3, stored: 2 });
    expect(await stored()).toHaveLength(2);
  });

  it("does not count another stream's rows, or another connection's", async () => {
    const other = streamConfigHash({ spreadsheetId: "DATES", range: "Other" }, "gsheets");
    await db.insert(events).values({
      eventId: `gsheets:${connId}:${other}:row:2`,
      orgId: ORG,
      connectionId: connId,
      source: "gsheets",
      eventType: "row_added",
      occurredAt: new Date(),
      streamHash: other,
      properties: {},
    });

    expect((await sync()).mirrorDrift).toBeUndefined();
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
 * The copy. Pure, and carrying the honesty rule: first-seen is a defensible
 * answer, first-seen presented as the event time is not — so every state is a
 * sentence, never silence. And a DETECTED column says it was detected, which is
 * the price of using a guess rather than merely offering one.
 */
describe("what the user is told", () => {
  const note = (dateField: string | null, state: DateColumnSettings["state"] = null) =>
    dateColumnNote({ dateField, locked: true, state });
  const at = new Date().toISOString();
  const userState = (over: Partial<NonNullable<DateColumnSettings["state"]>>) => ({
    column: "Date",
    source: "user" as const,
    presentInHeader: true,
    dated: 0,
    undated: 0,
    at,
    ...over,
  });

  it("names import time when no column is chosen, rather than saying nothing", () => {
    expect(note(null)).toContain("No date column selected");
    expect(note(null)).toContain("first imported");
  });

  it("marks a detected column as detected", () => {
    const detected = dateColumnNote({
      dateField: null,
      locked: false,
      state: { column: "Submitted at", source: "detected", presentInHeader: true, dated: 40, undated: 0, at },
    });
    expect(detected).toBe('Dating rows from "Submitted at" (detected).');
  });

  it("carries the undated count into the detected sentence too", () => {
    const detected = dateColumnNote({
      dateField: null,
      locked: false,
      state: { column: "Submitted at", source: "detected", presentInHeader: true, dated: 30, undated: 10, at },
    });
    expect(detected).toBe(
      'Dating rows from "Submitted at" (detected) — 10 of 40 rows have no usable date there and fall back to when they were first imported.',
    );
  });

  it("asks the ambiguous question by name", () => {
    const asking = dateColumnNote({
      dateField: null,
      locked: false,
      state: { column: null, source: "detected", presentInHeader: false, dated: 0, undated: 3, candidates: ["A", "B", "C"], at },
    });
    expect(asking).toBe(
      'More than one column could be the date — "A", "B" and "C". Choose one; until then timing uses when each row was first imported.',
    );
  });

  it("separates 'nothing to detect' from 'no read yet'", () => {
    const blank = { dateField: null, locked: false } as const;
    expect(dateColumnNote({ ...blank, state: null })).toBe(
      "Timing uses when each row was first imported, until a read finds a date column.",
    );
    expect(
      dateColumnNote({ ...blank, state: { column: null, source: "detected", presentInHeader: false, dated: 0, undated: 9, at } }),
    ).toBe("No column in this sheet holds usable dates — timing uses when each row was first imported.");
  });

  it("reads a state written before detection existed as a user's pick", () => {
    // No `source` — the shape shipped one migration ago, when only the picker
    // could write one.
    const old = { column: "Date", presentInHeader: true, dated: 5, undated: 0, at };
    expect(dateColumnNote({ dateField: "Date", locked: true, state: old })).toBe('Timing uses "Date".');
  });

  it("does not claim a column works before a read has happened under it", () => {
    expect(note("Booked on")).toBe('Timing will use "Booked on" from the next read.');
    expect(note("Closed on", userState({ column: "Booked on", dated: 5 }))).toContain("from the next read");
  });

  it("separates a renamed column from a column of unusable values", () => {
    const renamed = note("Date", userState({ presentInHeader: false, undated: 500 }));
    const unusable = note("Date", userState({ undated: 500 }));
    expect(renamed).toContain("no longer in this sheet");
    expect(unusable).toContain("No row has a usable date");
    // Both end at import time, and the numbers alone cannot tell them apart —
    // which is the entire reason `presentInHeader` is recorded.
    expect(renamed).not.toBe(unusable);
  });

  it("reports the partial case with both numbers", () => {
    expect(note("Date", userState({ dated: 412, undated: 88 }))).toBe(
      'Timing uses "Date" — 88 of 500 rows have no usable date there and fall back to when they were first imported.',
    );
  });

  /**
   * The gap between choosing and sweeping is real, and it is the interval a user
   * would otherwise read as a broken picker: they change the column, look at the
   * rows, and see the old times. Both ends of the change say so.
   */
  it("promises the rows already imported, while the restamp is pending", () => {
    const pending = (dateField: string | null) => dateColumnNote({ dateField, locked: true, state: null, restampPending: true });
    expect(pending("Booked on")).toBe('Timing will use "Booked on" from the next read, including rows already imported.');
    expect(pending(null)).toBe("No date column selected — from the next read, timing goes back to when each row was first imported.");
    // Once the sweep has run there is nothing pending, and nothing to promise.
    expect(note("Booked on")).not.toContain("already imported");
  });

  it("says the plain thing when every row is dated", () => {
    expect(note("Date", userState({ dated: 500 }))).toBe('Timing uses "Date".');
  });
});

describe("the picker writes to the stream, not to a flow", () => {
  const set = (choice: Parameters<typeof setDateColumn>[4], org = ORG) => setDateColumn(db, org, connId, HASH, choice);

  it("is org-scoped, and reports whether anything changed", async () => {
    expect(await set({ kind: "column", column: "Booked on" })).toEqual({ changed: true });
    // Re-picking the same answer is not a change — an unchanged pick must not
    // look like a reason to re-read a settled sheet.
    expect(await set({ kind: "column", column: "Booked on" })).toEqual({ changed: false });
    expect(await set({ kind: "none" })).toEqual({ changed: true });
    expect(await set({ kind: "none" })).toEqual({ changed: false });

    // Another org naming this stream exactly gets nothing.
    expect(await set({ kind: "column", column: "Booked on" }, "org_other")).toEqual({ changed: false });
    expect((await dateColumnSettings(db, ORG, connId, HASH))!.dateField).toBeNull();
  });

  /**
   * The two NULL states are different answers, and the write has to see that.
   * Treating them as one is the defect: "stop looking" would read as "nobody has
   * answered" and the detector would overrule it on the next sweep.
   */
  it("tells 'use import time' apart from 'detect for me'", async () => {
    expect(await set({ kind: "none" })).toEqual({ changed: true });
    expect(await set({ kind: "auto" })).toEqual({ changed: true });
    expect(await set({ kind: "auto" })).toEqual({ changed: false });

    const settings = (await dateColumnSettings(db, ORG, connId, HASH))!;
    expect(settings.dateField).toBeNull();
    expect(settings.locked).toBe(false);
    expect(dateColumnChoice(settings)).toEqual({ kind: "auto" });
  });

  it("treats an empty pick as import time, not as a column named empty string", async () => {
    await set({ kind: "column", column: "Booked on" });
    await set({ kind: "column", column: "   " });
    const settings = (await dateColumnSettings(db, ORG, connId, HASH))!;
    expect(settings.dateField).toBeNull();
    expect(dateColumnChoice(settings)).toEqual({ kind: "none" });
  });
});
