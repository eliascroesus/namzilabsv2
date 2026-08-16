import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, tileByRange, type TilePresentation } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

/**
 * THE DASHBOARD'S DATE RANGES.
 *
 * A published tile is a stored snapshot, so the range pills used to sit above
 * numbers they could not touch — every pill showed the same figure. The first
 * fix re-ran the whole flow once per range with `occurred_at` bounded at each
 * Get-data read, and that was worse than doing nothing, because it truncated
 * every lane BEFORE the flow's own logic ran:
 *
 *   - "keep one row per email, earliest" kept the earliest of the WINDOW;
 *   - a lead that arrived yesterday and was called this morning was counted in
 *     neither day, and no measured gap could exceed the window's own length;
 *   - a percentage whose denominator emptied threw, stored no entry for that
 *     range, and the dashboard silently rendered the all-time number under the
 *     "Today" pill with a green "Up to date" badge.
 *
 * `tileByRange` runs the flow ONCE over the whole history and windows the
 * finished metric's records. These tests pin that ordering — each one fails if
 * the window moves back to the read.
 */

let db: DB;
let close: () => Promise<void>;

const ORG = "org_range";
const CONN = randomUUID();
/** Midnight UTC of "today", the boundary every pill is defined against. */
const START_OF_TODAY = (() => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
})();
const DAY = 86_400_000;
const HOUR = 3_600_000;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
});
afterEach(async () => {
  await close();
});

async function ev(o: { eventType: string; at: number; key?: string; props?: Record<string, unknown> }) {
  await db.insert(events).values({
    eventId: `range:${randomUUID()}`,
    orgId: ORG,
    connectionId: CONN,
    source: "close",
    eventType: o.eventType,
    subject: o.key ?? null,
    occurredAt: new Date(o.at),
    properties: { lead_id: o.key ?? "L1", ...(o.props ?? {}) },
  });
}

const N = (id: string, type: string, config: unknown) => ({ id, type, data: { config } });
const E = (s: string, t: string, targetHandle?: string) => ({ id: `${s}->${t}${targetHandle ?? ""}`, source: s, target: t, targetHandle });

const SPEC = (over: Partial<TilePresentation> = {}): TilePresentation => ({
  name: "Metric",
  viz: "number",
  format: "number",
  precision: 0,
  target: null,
  ...over,
});

/** The three pills these tests care about, resolved the way the dashboard does. */
const RANGES = [
  { key: "today", start: START_OF_TODAY, end: Date.now() },
  { key: "yesterday", start: START_OF_TODAY - DAY, end: START_OF_TODAY - 1 },
  { key: "all", start: 0, end: Date.now(), all: true },
];

async function slots(graph: unknown, nodeId: string, spec: TilePresentation = SPEC()) {
  const g = parseGraph(graph);
  const run = await runFlow({ db, orgId: ORG }, g);
  return tileByRange(g, run.nodes, nodeId, spec, RANGES);
}

describe("a range selects records; it does not re-run the flow against a truncated read", () => {
  /**
   * THE PAIRING CASE, which is the one that reported 0m 0s.
   *
   * Windowing the READ truncates both of Time between's lanes, so this lead is
   * absent from "today" (it arrived yesterday) and its call is absent from
   * "yesterday" — the pair vanishes from both. Windowing the RESULT keeps the
   * pair whole and files it under the day its lead arrived, which is also the
   * only way the gap can be longer than the range that reports it.
   */
  it("keeps a pair that straddles midnight, in the day its lead arrived, with a gap longer than the range", async () => {
    await ev({ eventType: "lead_created", at: START_OF_TODAY - 6 * HOUR, key: "L1" });
    await ev({ eventType: "call_logged", at: START_OF_TODAY + 9 * HOUR, key: "L1" });

    const graph = {
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("u", "unite", {}),
        N("t", "time_between", {
          keyField: "properties.lead_id",
          startField: "occurredAt",
          startStep: "leads",
          endField: "occurredAt",
          endStep: "calls",
        }),
        N("avg", "calculate", { mode: "number", aggregation: "avg", field: "properties.time_between.hours" }),
      ],
      edges: [E("leads", "u"), E("calls", "u"), E("u", "t"), E("t", "avg")],
    };

    const by = await slots(graph, "avg");
    // 15 hours, reported under YESTERDAY — the cohort the lead belongs to —
    // even though "yesterday" is a 24h window and the pair ends inside today.
    expect(by.yesterday.value).toBe(15);
    expect(by.all.value).toBe(15);
    // Nothing arrived today, so today's cohort is genuinely empty.
    expect(by.today.value).toBe(0);
  });

  /**
   * THE DE-DUPLICATION CASE. "Keep one row per lead, the earliest" has to mean
   * the earliest that ever existed. Truncating the read to today would make
   * this morning's row the earliest one visible, so a lead first seen last week
   * would be counted as new today — inflating every "new leads today" number a
   * customer looks at first.
   */
  it("counts a returning lead in the day it genuinely first arrived, not the day it was re-read", async () => {
    await ev({ eventType: "lead_created", at: START_OF_TODAY - 5 * DAY, key: "L1" });
    await ev({ eventType: "lead_created", at: START_OF_TODAY + 2 * HOUR, key: "L1" });

    const graph = {
      nodes: [
        N("leads", "app", {
          connectionId: CONN,
          source: "close",
          eventType: "lead_created",
          dedupe: true,
          dedupeField: "properties.lead_id",
          dedupeKeep: "earliest",
        }),
      ],
      edges: [],
    };

    const by = await slots(graph, "leads");
    expect(by.all.value).toBe(1);
    // The survivor is the five-day-old record, so today has no new lead.
    expect(by.today.value).toBe(0);
  });

  /**
   * THE SILENT-FALLBACK CASE, and the reason every range gets an entry.
   *
   * A percentage divides, and a denominator of zero throws. Under the old
   * implementation that range simply had no stored entry, which the tile could
   * not tell apart from "written before ranges existed" — so it rendered the
   * flow's own all-time percentage under the "Today" pill, behind a green
   * badge. Now the range says it has no answer, and the tile shows an em-dash.
   */
  it("says a range has no answer instead of leaving it out for the tile to guess at", async () => {
    await ev({ eventType: "lead_created", at: START_OF_TODAY - 3 * DAY, key: "L1" });
    await ev({ eventType: "call_logged", at: START_OF_TODAY - 3 * DAY, key: "L1" });

    const graph = {
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("rate", "calculate", { mode: "compare", op: "percentage" }),
      ],
      edges: [E("calls", "rate", "a"), E("leads", "rate", "b")],
    };

    const by = await slots(graph, "rate");
    expect(by.all.value).toBe(100);
    // Nothing at all happened today, so the rate is undefined rather than 0 —
    // and, critically, rather than 100.
    expect(by.today.value).toBeUndefined();
    expect(by.today.unavailable).toMatch(/denominator/i);
  });

  /**
   * THE TIME-REFERENCE CASE. The customer's own choice at Review & publish
   * decides which date a record is filed under — "when the call is booked for"
   * rather than "when the booking arrived".
   */
  it("files a record by the metric's chosen time reference, not by when it arrived", async () => {
    // Arrived three days ago; the meeting it books is today.
    await ev({
      eventType: "meeting_booked",
      at: START_OF_TODAY - 3 * DAY,
      key: "L1",
      props: { starts_at: new Date(START_OF_TODAY + 5 * HOUR).toISOString() },
    });

    const graph = {
      nodes: [N("m", "app", { connectionId: CONN, source: "close", eventType: "meeting_booked" })],
      edges: [],
    };

    const arrival = await slots(graph, "m");
    expect(arrival.today.value).toBe(0);

    const booked = await slots(graph, "m", SPEC({ timeField: "properties.starts_at" }));
    // REVERT THE TIME REFERENCE AND THIS READS 0: the meeting is on today's
    // dashboard because of when it happens, which is the whole question.
    expect(booked.today.value).toBe(1);
  });

  /**
   * Records with no date under the chosen reference belong to no period. They
   * must still be in "All time" — and the tile has to be told, or the missing
   * rows read as an answer.
   */
  it("counts an undated record in All time only, and reports how many", async () => {
    await ev({ eventType: "meeting_booked", at: START_OF_TODAY + HOUR, key: "L1", props: { starts_at: null } });
    await ev({
      eventType: "meeting_booked",
      at: START_OF_TODAY + HOUR,
      key: "L2",
      props: { starts_at: new Date(START_OF_TODAY + 5 * HOUR).toISOString() },
    });

    const graph = {
      nodes: [N("m", "app", { connectionId: CONN, source: "close", eventType: "meeting_booked" })],
      edges: [],
    };

    const by = await slots(graph, "m", SPEC({ timeField: "properties.starts_at" }));
    expect(by.all.value).toBe(2);
    expect(by.today.value).toBe(1);
    expect(by.today.undated).toBe(1);
  });

  /**
   * "All time" is returned untouched, and that is not an optimisation.
   * Its upper bound is NOW, while Calendly and Calendar date records by when
   * they WILL happen — so filtering it would drop every future booking out of
   * the one total that is supposed to hold everything.
   */
  it("keeps future-dated records in All time", async () => {
    await ev({ eventType: "meeting_booked", at: START_OF_TODAY + 40 * DAY, key: "L1" });

    const graph = {
      nodes: [N("m", "app", { connectionId: CONN, source: "close", eventType: "meeting_booked" })],
      edges: [],
    };

    const by = await slots(graph, "m");
    expect(by.all.value).toBe(1);
    expect(by.today.value).toBe(0);
  });
});
