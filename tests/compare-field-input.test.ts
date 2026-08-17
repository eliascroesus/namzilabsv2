import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, tileByRange, type NodeExecOk, type TilePresentation } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * A COMPARE INPUT CAN READ A COLUMN, not only a step's record count.
 *
 * "Count this" used to offer exactly one thing per step — its Output number —
 * so a spreadsheet cell holding a precomputed total was unreachable from a
 * Calculate. `aField`/`bField` name a column on the wired step; the engine
 * reads it off the step's NEWEST record (for the one-row summary tab this
 * exists for, that is simply the cell) through the same `toNumber` reader the
 * aggregations use, so a text cell holding "20" counts as 20 exactly as it
 * would in a Sum.
 *
 * REVERT THE fieldPath BRANCH IN scalarAt AND EVERY TEST HERE FAILS: the slot
 * falls back to the record count, and "3 booked out of a total of 20" silently
 * becomes "3 out of 1" — a plausible number with nothing behind it.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_cmpfield";
const CONN = randomUUID();

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "gsheets", name: "Sheet", status: "active", authType: "none" });
});
afterEach(async () => {
  await close();
});

async function ev(o: { eventType: string; atMin: number; props?: Record<string, unknown> }) {
  await db.insert(events).values({
    eventId: `cf:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "gsheets",
    eventType: o.eventType,
    subject: null,
    occurredAt: new Date(Date.parse("2026-07-01T12:00:00Z") + o.atMin * 60_000),
    properties: o.props ?? {},
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string, targetHandle?: string) => ({ id: `${s}->${t}${targetHandle ?? ""}`, source: s, target: t, targetHandle });

/** booked rows into A (count), a summary tab into B (a picked column). */
async function pct(cfg: Record<string, unknown>) {
  const g = parseGraph({
    nodes: [
      N("booked", "app", { connectionId: CONN, source: "gsheets", eventType: "row_added" }),
      N("summary", "app", { connectionId: CONN, source: "gsheets", eventType: "summary_row" }),
      N("rate", "formula", { op: "percentage", ...cfg }),
    ],
    edges: [E("booked", "rate", "a"), E("summary", "rate", "b")],
  });
  const res = await runFlow({ db, orgId: ORG }, g);
  return res.nodes.get("rate")!;
}

describe("a compare input reading a field off its wired step", () => {
  it("reads the column instead of the record count — including a numeric text cell", async () => {
    await ev({ eventType: "row_added", atMin: 0 });
    await ev({ eventType: "row_added", atMin: 1 });
    await ev({ eventType: "row_added", atMin: 2 });
    // The summary tab: ONE row, and the cell is a string, the way Sheets
    // actually delivers numbers a user typed next to text.
    await ev({ eventType: "summary_row", atMin: 0, props: { "Total leads": "20" } });

    const exec = await pct({ bField: "properties.Total leads" });
    expect(exec.status).toBe("ok");
    // 3 booked ÷ 20 total × 100. Without bField this is 3 ÷ 1 × 100 = 300.
    expect((exec as NodeExecOk).shape).toEqual({ kind: "scalar", value: 15 });
  });

  it("reads the NEWEST record's value when the step has several", async () => {
    await ev({ eventType: "row_added", atMin: 0 });
    // An older summary says 10; the current one says 20. The current one is
    // the answer, the same way every preview shows current state.
    await ev({ eventType: "summary_row", atMin: 0, props: { total: 10 } });
    await ev({ eventType: "summary_row", atMin: 5, props: { total: 20 } });

    const exec = await pct({ bField: "properties.total" });
    expect((exec as NodeExecOk).shape).toEqual({ kind: "scalar", value: 5 });
  });

  it("names the field and the value when the cell is not a number", async () => {
    await ev({ eventType: "row_added", atMin: 0 });
    await ev({ eventType: "summary_row", atMin: 0, props: { total: "pending" } });

    const exec = await pct({ bField: "properties.total" });
    expect(exec.status).toBe("error");
    if (exec.status === "error") {
      expect(exec.error).toContain("properties.total");
      expect(exec.error).toContain("pending");
    }
  });

  it("says so when the wired step has no records to read from", async () => {
    await ev({ eventType: "row_added", atMin: 0 });
    // No summary_row records at all.
    const exec = await pct({ bField: "properties.total" });
    expect(exec.status).toBe("error");
    if (exec.status === "error") expect(exec.error).toContain("no records");
  });

  /**
   * THE BUILDER'S TEST BOX AND THE TILE ANSWER WITH THE SAME NUMBER, through
   * the real DTO path. The DTO derived its own headline and covered scalar and
   * grouped but not SERIES, so a Calculate split over time reported its BUCKET
   * COUNT in the editor while the dashboard rendered the total.
   *
   * REVERT test-run.ts's `headlineValue(exec.shape)` TO ITS OWN EXPRESSION AND
   * THIS FAILS: value comes back undefined and the editor falls through to
   * recordsOut — the number of months.
   */
  it("a trend step reports its total to the editor, not its bucket count", async () => {
    const { executeNodeTest } = await import("@/lib/flow/test-run");
    const { buildTile } = await import("@/lib/flow/engine");
    // Three rows across three different months.
    await ev({ eventType: "row_added", atMin: 0 });
    await ev({ eventType: "row_added", atMin: 60 * 24 * 40 });
    await ev({ eventType: "row_added", atMin: 60 * 24 * 80 });

    const graph = {
      nodes: [
        N("rows", "app", { connectionId: CONN, source: "gsheets", eventType: "row_added" }),
        N("trend", "formula", { op: "count", groupBy: { type: "time", unit: "month" } }),
      ],
      edges: [E("rows", "trend")],
    };
    const dto = await executeNodeTest(db, ORG, graph, "trend");
    expect(dto.status).toBe("ok");
    // Three months of one row each: the metric is 3, the bucket count is also
    // 3 — so the run must distinguish them. recordsOut IS the bucket count.
    expect(dto.recordsOut).toBe(3);
    expect(dto.value).toBe(3);

    // And the tile agrees, because both call headlineValue.
    const g = parseGraph(graph);
    const run = await runFlow({ db, orgId: ORG }, g);
    const exec = run.nodes.get("trend") as NodeExecOk;
    const tile = buildTile({ name: "T", viz: "line", format: "number", precision: 0, target: null }, exec.shape, []);
    expect(tile.value).toBe(dto.value);
  });

  /**
   * A FIELD-READ INPUT IS CURRENT STATE — the dashboard range must not window
   * it. The summary row is dated whenever it was written, so windowing that
   * dataset to "Today" empties it; every pill but All time then read "no data"
   * for a tile whose denominator is a constant. The numerator still windows —
   * that is the whole point: booked TODAY, out of the sheet's total.
   *
   * REVERT THE fieldRead EXEMPTION IN tileByRange AND THIS FAILS with
   * `unavailable` on the today slot.
   */
  it("a dashboard range windows the counted side, never the picked cell", async () => {
    const startOfToday = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const at = async (eventType: string, ms: number, props: Record<string, unknown> = {}) =>
      db.insert(events).values({
        eventId: `cf:${randomUUID()}`,
        orgId: ORG,
        connectionId: CONN,
        source: "gsheets",
        eventType,
        subject: null,
        occurredAt: new Date(ms),
        properties: props,
      });
    // Two bookings today, one last week; the summary cell written last month.
    await at("row_added", startOfToday + 3_600_000);
    await at("row_added", startOfToday + 7_200_000);
    await at("row_added", startOfToday - 7 * 86_400_000);
    await at("summary_row", startOfToday - 30 * 86_400_000, { total: 20 });

    const g = parseGraph({
      nodes: [
        N("booked", "app", { connectionId: CONN, source: "gsheets", eventType: "row_added" }),
        N("summary", "app", { connectionId: CONN, source: "gsheets", eventType: "summary_row" }),
        N("rate", "formula", { op: "percentage", bField: "properties.total" }),
      ],
      edges: [E("booked", "rate", "a"), E("summary", "rate", "b")],
    });
    const run = await runFlow({ db, orgId: ORG }, g);
    const spec: TilePresentation = { name: "Rate", viz: "number", format: "percent", precision: 0, target: null };
    const { byRange } = tileByRange(g, run.nodes, "rate", spec, [
      { key: "today", start: startOfToday, end: Date.now() },
      { key: "all", start: 0, end: Date.now(), all: true },
    ]);

    // 2 booked today ÷ the cell's 20 — not unavailable, not 2 ÷ 1.
    expect(byRange.today.unavailable).toBeUndefined();
    expect(byRange.today.value).toBe(10);
    expect(byRange.all.value).toBe(15);
  });
});
