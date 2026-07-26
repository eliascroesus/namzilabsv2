import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";
import { streamConfigHash, normalizeStreamConfig } from "@/lib/sync/stream-hash";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * LIVING-SPREADSHEET ACCEPTANCE SUITE — the P0/P1 gate.
 *
 * A spreadsheet is a living document: rows are appended, edited in place,
 * deleted, re-sorted, blanked and re-headed. After EVERY sweep of the real
 * reconcile path, the stored live rows must equal the sheet 1:1 — that is the
 * product promise ("accurate numbers that match the source, always").
 *
 * Runs the genuine machinery end-to-end: gsheets connector (mocked provider
 * fetch only) → reconcileConnection → unified writer → mirror soft-delete →
 * flow engine over the synced stream.
 */

const ORG = "org_accept";
const KEY = randomBytes(32).toString("base64");
const CFG = { spreadsheetId: "LIVING", range: "Leads" };
const HASH = streamConfigHash(CFG, "gsheets");

let db: DB;
let close: () => Promise<void>;
let connId: string;

/** The living sheet: header row + data rows, mutated by each scenario. */
let SHEET: string[][] = [];

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  SHEET = [
    ["Name", "Source", "Booked"],
    ["Ana", "ig", "Yes"],
    ["Ben", "fb", "No"],
    ["Cal", "ig", "Yes"],
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/values/")) throw new Error(`unexpected fetch: ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => ({ values: SHEET }),
        text: async () => JSON.stringify({ values: SHEET }),
      } as unknown as Response;
    }),
  );
  const [conn] = await db
    .insert(connections)
    .values({
      orgId: ORG,
      source: "gsheets",
      name: "Living sheet",
      status: "active",
      authType: "oauth2",
      credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
    })
    .returning({ id: connections.id });
  connId = conn.id;
  await db.insert(sourceStreams).values({ orgId: ORG, connectionId: connId, configHash: HASH, config: normalizeStreamConfig(CFG, "gsheets") });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

const sweep = () => reconcileConnection(db, connId);

/** Live mirrored rows, in sheet order, as {header: cell} objects. */
async function liveRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connId), eq(events.streamHash, HASH), isNull(events.deletedAt)));
  return rows
    .sort((a, b) => Number(a.eventId.split(":row:").pop()) - Number(b.eventId.split(":row:").pop()))
    .map((r) => r.properties as Record<string, unknown>);
}

/** What the sheet fixture says the mirror should hold (blank rows skipped). */
function sheetTruth(): Array<Record<string, unknown>> {
  const [header, ...data] = SHEET;
  return data
    .filter((cells) => cells.some((c) => c != null && String(c).trim() !== ""))
    .map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? null])));
}

/** The acceptance invariant: stored live rows ≡ current sheet, 1:1. */
async function expectMirror() {
  expect(await liveRows()).toEqual(sheetTruth());
}

describe("living spreadsheet — live rows equal the sheet after every sweep", () => {
  it("initial import, append, mid-sheet edit, delete, re-sort, blank-out, header rename", async () => {
    await sweep();
    await expectMirror();

    // APPEND a row.
    SHEET.push(["Dee", "ig", "No"]);
    await sweep();
    await expectMirror();

    // MID-SHEET EDIT (below any append high-water mark — the classic stale spot).
    SHEET[2] = ["Ben", "fb", "Yes"];
    const editSweep = await sweep();
    await expectMirror();
    // The edit arrived as an in-place update, not a new row.
    expect(editSweep.inserted).toBe(0);
    expect(editSweep.updated).toBeGreaterThan(0);

    // DELETE a middle row (rows below shift up; the tail id disappears).
    SHEET.splice(1, 1); // remove Ana
    const delSweep = await sweep();
    await expectMirror();
    expect(delSweep.softDeleted).toBeGreaterThan(0);

    // RE-SORT the sheet.
    SHEET = [SHEET[0], ...SHEET.slice(1).reverse()];
    await sweep();
    await expectMirror();

    // BLANK OUT a row (cleared, not removed — later rows keep their numbers).
    SHEET[1] = ["", "", ""];
    await sweep();
    await expectMirror();

    // HEADER RENAME: every row's properties speak the new schema immediately.
    SHEET[0] = ["Name", "Channel", "Booked"];
    await sweep();
    await expectMirror();
    expect((await liveRows()).every((r) => "Channel" in r && !("Source" in r))).toBe(true);
  });

  it("legacy generation-0 stream rows are swept: a pre-unification leftover whose sheet row is gone gets tombstoned by the first sweep", async () => {
    // The pre-unified writer stamped stream rows with generation 0 (the
    // webhook class). Simulate one whose sheet row was deleted upstream before
    // any new-style sweep ran: row 99 doesn't exist in the fixture.
    await db.insert(events).values({
      eventId: `gsheets:${connId}:${HASH}:row:99`,
      orgId: ORG,
      connectionId: connId,
      source: "gsheets",
      eventType: "row_added",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      properties: { Name: "Ghost", Source: "ig", Booked: "Yes" },
      streamHash: HASH,
      syncGeneration: 0, // legacy class
    });
    // A webhook push row (NULL stream_hash) must survive every sweep — the
    // exemption is structural, not numeric.
    await db.insert(events).values({
      eventId: `gsheets:${connId}:row:push-1`,
      orgId: ORG,
      connectionId: connId,
      source: "gsheets",
      eventType: "row_added",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      properties: { Name: "Push" },
      streamHash: null,
      syncGeneration: 0,
    });

    const first = await sweep();
    expect(first.softDeleted).toBeGreaterThan(0);
    await expectMirror(); // the ghost is gone from live rows

    const [ghost] = await db.select().from(events).where(eq(events.eventId, `gsheets:${connId}:${HASH}:row:99`));
    expect(ghost.deletedAt).not.toBeNull();
    const [push] = await db.select().from(events).where(eq(events.eventId, `gsheets:${connId}:row:push-1`));
    expect(push.deletedAt).toBeNull();
  });

  it("occurredAt is stable across refreshes (first-seen time survives edits)", async () => {
    await sweep();
    const before = await db.select().from(events).where(eq(events.eventId, `gsheets:${connId}:${HASH}:row:2`));
    const t0 = before[0].occurredAt.toISOString();

    SHEET[1] = ["Ana", "ig", "No"]; // edit row 2
    await sweep();
    const after = await db.select().from(events).where(eq(events.eventId, `gsheets:${connId}:${HASH}:row:2`));
    expect((after[0].properties as Record<string, unknown>).Booked).toBe("No");
    expect(after[0].occurredAt.toISOString()).toBe(t0);
  });

  it("staleness accounting: edits and deletions count as changes; a no-op sweep counts nothing", async () => {
    await sweep();

    // No changes upstream → nothing to recompute.
    const idle = await sweep();
    expect(idle.inserted + idle.updated + idle.softDeleted).toBe(0);

    // Edit-only sweep → updated (dashboards must refresh even with 0 inserts).
    SHEET[1] = ["Ana", "ig", "No"];
    const edited = await sweep();
    expect(edited.inserted).toBe(0);
    expect(edited.updated).toBeGreaterThan(0);

    // Delete-only sweep → softDeleted (dashboards must refresh on removals too).
    SHEET.splice(3, 1); // drop Cal (the last row: no re-key churn, pure removal)
    const removed = await sweep();
    expect(removed.inserted).toBe(0);
    expect(removed.updated).toBe(0);
    expect(removed.softDeleted).toBe(1);
  });

  it("end-to-end: '15 of 25 Yes' and 'ig AND booked' compute over the mirror and track edits", async () => {
    // Build a 25-row sheet: 15 Booked=Yes; exactly 2 of them are Source=ig.
    const rows: string[][] = [];
    for (let i = 1; i <= 25; i++) {
      const booked = i <= 15 ? "Yes" : "No";
      const source = i <= 2 ? "ig" : i % 2 === 0 ? "fb" : "tt";
      rows.push([`P${i}`, source, booked]);
    }
    SHEET = [["Name", "Source", "Booked"], ...rows];
    await sweep();
    await expectMirror();

    const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
    const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
    const graph = (rules: Array<{ field: string; op: string; value: string }>) =>
      parseGraph({
        nodes: [
          N("get", "app", { connectionId: connId, source: "gsheets", sourceConfig: CFG }),
          N("f", "filter", { combinator: "and", rules }),
          N("agg", "aggregate", { aggregation: "count" }),
          N("out", "output", { name: "Count" }),
        ],
        edges: [E("get", "f"), E("f", "agg"), E("agg", "out")],
      });

    const yes = await runFlow({ db, orgId: ORG }, graph([{ field: "Booked", op: "equals", value: "Yes" }]));
    expect(yes.outputs[0].tile.value).toBe(15);

    const igBooked = graph([
      { field: "Source", op: "equals", value: "ig" },
      { field: "Booked", op: "equals", value: "Yes" },
    ]);
    expect((await runFlow({ db, orgId: ORG }, igBooked)).outputs[0].tile.value).toBe(2);

    // The user un-books one ig lead in the sheet → the number follows the sheet.
    SHEET[1] = ["P1", "ig", "No"];
    await sweep();
    await expectMirror();
    expect((await runFlow({ db, orgId: ORG }, igBooked)).outputs[0].tile.value).toBe(1);
  });
});
