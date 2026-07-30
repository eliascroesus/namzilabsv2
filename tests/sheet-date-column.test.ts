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

const ORG = "org_datecol";
const KEY = randomBytes(32).toString("base64");
const CFG = { spreadsheetId: "DATES", range: "Leads" };
const HASH = streamConfigHash(CFG, "gsheets");

let db: DB;
let close: () => Promise<void>;
let connId: string;
let SHEET: string[][] = [];

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/values/")) throw new Error(`unexpected fetch: ${url}`);
      const body = { values: SHEET };
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

const setColumn = (column: string | null) =>
  db.update(sourceStreams).set({ dateField: column }).where(eq(sourceStreams.configHash, HASH));

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

const state = async () => (await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, HASH)))[0].dateFieldState;

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

    SHEET[0][1] = "Booking date"; // the user renamed the header
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
 * The pin still holds for rows that already exist. Choosing a column fixes what
 * arrives NEXT; the rows already stamped with an import time need the restamp,
 * which is a separate, explicit step. Pinned here so that change is visible when
 * it lands rather than being mistaken for something this commit already did.
 */
describe("existing rows are not restamped by choosing a column", () => {
  it("leaves already-stored occurred_at alone", async () => {
    await sweep(); // stored at import time, no column chosen
    const first = (await stored()).map((r) => r.occurredAt.getTime());

    await setColumn("Booked on");
    await sweep();

    expect((await stored()).map((r) => r.occurredAt.getTime())).toEqual(first);
    // …while the read itself DID resolve the column, so the state is honest
    // about what the sheet holds even though no row moved.
    expect(await state()).toMatchObject({ presentInHeader: true, dated: 3, undated: 0 });
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
