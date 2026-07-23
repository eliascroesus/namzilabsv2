import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { sweepConnection } from "@/ingestion/reconcile";
import { encrypt } from "@/lib/crypto";
import { connections, events, sourceStreams } from "@/db/schema";
import { streamConfigHash, normalizeStreamConfig } from "@/lib/sync/stream-hash";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * THE LIVING SPREADSHEET — the acceptance suite for the 1:1 mirror restructure.
 *
 * A mutable in-memory sheet is served to the REAL Google Sheets connector via a
 * mocked fetch, and synced through the REAL production sweep path
 * (sweepConnection — what the 10-minute cron runs). Between sweeps the sheet is
 * edited, sorted, pruned and extended the way a real user works, and after
 * EVERY sweep we assert the stored live rows are exactly the current sheet.
 *
 * It reproduces the exact failures that shipped this restructure: a `booked`
 * cell flipped on an old row (invisible forever under the old row-count
 * cursor), and an `utm_source = ig AND booked not empty` filter that returned 1
 * where the sheet held 2.
 */

const KEY = randomBytes(32).toString("base64");

// The live sheet. First row is the header; mutate between sweeps.
let SHEET: string[][] = [];

const CONFIG = { spreadsheetId: "SHEET1", range: "Leads" };
const HASH = streamConfigHash(CONFIG);

let db: DB;
let close: () => Promise<void>;
let connectionId: string;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  SHEET = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/values/")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => ({ values: SHEET }), text: async () => "" } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );

  connectionId = await seedConnection(db, { source: "gsheets" });
  await db
    .update(connections)
    .set({ credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 }), Buffer.from(KEY, "base64")) })
    .where(eq(connections.id, connectionId));
  await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: HASH, config: normalizeStreamConfig(CONFIG) });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

/** The stored live rows, as plain property objects (insertion-order-free set). */
async function liveRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connectionId), eq(events.streamHash, HASH), isNull(events.deletedAt)));
  return rows.map((r) => r.properties as Record<string, unknown>);
}

/** What the sheet currently says, mapped exactly like the connector maps it. */
function sheetRows(): Array<Record<string, unknown>> {
  const [header, ...data] = SHEET;
  return data
    .filter((cells) => !cells.every((c) => c == null || String(c).trim() === ""))
    .map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? null])));
}

const sortRows = (rows: Array<Record<string, unknown>>) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Assert the 1:1 invariant: stored live rows ≡ the current sheet. */
async function expectMirror(): Promise<void> {
  expect(sortRows(await liveRows())).toEqual(sortRows(sheetRows()));
}

// graph helpers (same shapes the editor produces)
const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });
const appNode = (extra: Record<string, unknown> = {}) =>
  N("a", "app", { connectionId, source: "gsheets", sourceConfig: CONFIG, ...extra });

async function filteredCount(rules: Array<Record<string, unknown>>): Promise<number> {
  const g = parseGraph({
    nodes: [appNode(), N("f", "filter", { combinator: "and", rules })],
    edges: [E("a", "f")],
  });
  const res = await runFlow({ db, orgId: "org_test" }, g);
  const f = res.nodes.get("f")!;
  expect(f.status).toBe("ok");
  return f.recordsOut;
}

/** The user's real-world sheet: 25 lead rows, 15 booked, exactly 2 "ig AND booked". */
function userSheet(): string[][] {
  const header = ["name", "email", "utm_source", "booked"];
  const rows: string[][] = [];
  for (let i = 1; i <= 25; i++) {
    // Rows 1..15 booked=Yes; 16..25 blank. utm_source: rows 7 & 12 are "ig"
    // (booked) and row 20 is "ig" (NOT booked) — so ig AND booked = 2, ig = 3.
    const booked = i <= 15 ? "Yes" : "";
    const utm = i === 7 || i === 12 || i === 20 ? "ig" : i % 2 === 0 ? "fb" : "google";
    rows.push([`Lead ${i}`, `lead${i}@acme.com`, utm, booked]);
  }
  return [header, ...rows];
}

describe("the living spreadsheet — every sweep converges to 1:1", () => {
  it("reproduces the user's exact scenarios: 15 booked of 25, and ig+booked = 2 — even after a below-watermark edit", async () => {
    SHEET = userSheet();
    // Start with row 3's booked EMPTY: 14 booked, and sweep once (initial import).
    SHEET[3][3] = "";
    let res = await sweepConnection(db, connectionId);
    expect(res.inserted).toBe(25);
    await expectMirror();
    expect(await filteredCount([{ field: "booked", op: "is_not_empty" }])).toBe(14);

    // THE BUG THAT STARTED IT ALL: a cell edit far below the old high-water
    // mark. The legacy row-count cursor could never see this again.
    SHEET[3][3] = "Yes";
    res = await sweepConnection(db, connectionId);
    expect(res.updated).toBeGreaterThan(0);
    expect(res.changed).toBe(true); // → dependent dashboards go stale
    await expectMirror();

    // The user's numbers, exactly: 15 booked; ig AND booked = 2 (not 1).
    expect(await filteredCount([{ field: "booked", op: "is_not_empty" }])).toBe(15);
    expect(
      await filteredCount([
        { field: "utm_source", op: "equals", value: "ig" },
        { field: "booked", op: "is_not_empty" },
      ]),
    ).toBe(2);
    expect(await filteredCount([{ field: "utm_source", op: "equals", value: "ig" }])).toBe(3);
  });

  it("row deletes, re-sorts, mid-sheet inserts and blank rows all converge — no phantoms, no stale tails", async () => {
    SHEET = [
      ["name", "email"],
      ["Alice", "alice@acme.com"],
      ["Bob", "bob@acme.com"],
      ["Carol", "carol@acme.com"],
      ["Dave", "dave@acme.com"],
      ["Eve", "eve@acme.com"],
    ];
    await sweepConnection(db, connectionId);
    await expectMirror();

    // DELETE a middle row (the sheet shrinks — the old model kept a stale tail forever).
    SHEET.splice(3, 1); // Carol leaves
    const afterDelete = await sweepConnection(db, connectionId);
    expect(afterDelete.softDeleted).toBeGreaterThan(0);
    await expectMirror();
    expect(await liveRows()).toHaveLength(4);

    // RE-SORT the whole sheet (positions shuffle; the SET must stay identical).
    SHEET = [SHEET[0], ...SHEET.slice(1).reverse()];
    await sweepConnection(db, connectionId);
    await expectMirror();

    // BLANK rows appear mid-sheet: never stored as phantom records, and the
    // rows below keep their sheet row numbers.
    SHEET.splice(2, 0, ["", ""]);
    await sweepConnection(db, connectionId);
    await expectMirror();
    expect(await liveRows()).toHaveLength(4);

    // MID-SHEET INSERT of a real row lands too.
    SHEET.splice(2, 1, ["Frank", "frank@acme.com"]); // blank row becomes a real one
    await sweepConnection(db, connectionId);
    await expectMirror();
    expect(await liveRows()).toHaveLength(5);
  });

  it("keeps occurredAt stable across sweeps (first-seen), while the payload refreshes", async () => {
    SHEET = [
      ["name", "stage"],
      ["Alice", "new"],
    ];
    await sweepConnection(db, connectionId);
    const [before] = await db.select().from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)));

    SHEET[1][1] = "won";
    await sweepConnection(db, connectionId);
    const [after] = await db.select().from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)));

    expect((after.properties as Record<string, unknown>).stage).toBe("won");
    // Synthetic first-seen timestamp is preserved — mirror sweeps never churn ordering.
    expect(after.occurredAt.toISOString()).toBe(before.occurredAt.toISOString());
    expect(after.receivedAt.toISOString()).toBe(before.receivedAt.toISOString());
  });

  it("a header rename re-keys properties on the next sweep (no split personalities)", async () => {
    SHEET = [
      ["name", "email"],
      ["Alice", "alice@acme.com"],
    ];
    await sweepConnection(db, connectionId);

    SHEET[0] = ["name", "work_email"];
    await sweepConnection(db, connectionId);
    const rows = await liveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: "Alice", work_email: "alice@acme.com" });
  });

  it("dedupe on a Get data step counts the CURRENT sheet, not a stale patchwork", async () => {
    SHEET = [
      ["name", "email"],
      ["Alice", "alice@acme.com"],
      ["Alice again", "alice@acme.com"],
      ["Bob", "bob@acme.com"],
      ["Carol", "carol@acme.com"],
    ];
    await sweepConnection(db, connectionId);

    const g = parseGraph({ nodes: [appNode({ dedupe: true, dedupeField: "email" })], edges: [] });
    const res = await runFlow({ db, orgId: "org_test" }, g);
    expect(res.nodes.get("a")!.recordsOut).toBe(3); // 4 rows, 3 unique emails

    // The sheet loses its duplicate — the dedupe count follows the sheet.
    SHEET.splice(2, 1);
    await sweepConnection(db, connectionId);
    const res2 = await runFlow({ db, orgId: "org_test" }, g);
    expect(res2.nodes.get("a")!.recordsOut).toBe(3);
    expect((await liveRows()).length).toBe(3);
  });

  it("each sweep bumps the stream generation and history is preserved as soft-deletes (never hard-deletes)", async () => {
    SHEET = [
      ["name"],
      ["Alice"],
      ["Bob"],
    ];
    await sweepConnection(db, connectionId);
    SHEET = [["name"], ["Alice"]];
    await sweepConnection(db, connectionId);

    const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, HASH));
    expect(stream.syncGeneration).toBe(2);
    expect(stream.status).toBe("active");
    expect(stream.lastPolledAt).not.toBeNull();

    const all = await db.select().from(events).where(eq(events.connectionId, connectionId));
    expect(all).toHaveLength(2); // Bob's row is soft-deleted, not gone
    expect(all.filter((r) => r.deletedAt !== null)).toHaveLength(1);
  });
});
