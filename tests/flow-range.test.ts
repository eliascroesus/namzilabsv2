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
/**
 * A FIXED CLOCK. Every range ends at "now", so fixtures pinned to a real
 * wall-clock day are a trap: a record placed at 09:00 UTC is in the FUTURE for
 * any run started before 09:00, and these tests passed all afternoon and then
 * failed at 00:46. Nothing under test reads the system clock — `tileByRange`
 * takes "now" as the largest range end — so the whole file can simply state
 * what time it is.
 */
const NOW = Date.parse("2026-08-18T14:00:00Z");
/** Midnight UTC of "today", the boundary every pill is defined against. */
const START_OF_TODAY = Date.parse("2026-08-18T00:00:00Z");
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

/** Mirrors the bound in range.ts; pinned there against its ISO spelling. */
const FAR_FUTURE = Date.parse("9999-12-31T23:59:59.999Z");

/** The pills these tests care about, resolved the way the dashboard does. */
const RANGES = [
  { key: "today", start: START_OF_TODAY, end: NOW },
  { key: "yesterday", start: START_OF_TODAY - DAY, end: START_OF_TODAY - 1 },
  { key: "7d", start: NOW - 7 * DAY, end: NOW, rollingMs: 7 * DAY },
  { key: "all", start: 0, end: NOW, all: true },
  /**
   * The forward pill. Its end is range.ts's sentinel rather than the clock, and
   * `future` is what tells `tileByRange` so. DROP THAT FLAG AND EVERY
   * ASSERTION IN THE nextChangeMs BLOCK BELOW GOES TO YEAR 9999's MIDNIGHT —
   * "now" is taken as the largest range end, so the sentinel would silently
   * become the present and no crossing could ever be in the future.
   */
  { key: "upcoming", start: NOW + 1, end: FAR_FUTURE, future: true },
];

async function derive(graph: unknown, nodeId: string, spec: TilePresentation = SPEC()) {
  const g = parseGraph(graph);
  const run = await runFlow({ db, orgId: ORG }, g);
  return tileByRange(g, run.nodes, nodeId, spec, RANGES);
}

async function slots(graph: unknown, nodeId: string, spec: TilePresentation = SPEC()) {
  return (await derive(graph, nodeId, spec)).byRange;
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
   * C5: `undated` must count RECORDS, not node visits. A compare node reaches
   * the very same record through two different node ids in one range — the
   * Get data step directly (handle a) and that same step's Filter output
   * (handle b) — and the old counter incremented once per node visited, so
   * one undated record read as two.
   */
  it("counts one undated record once, even when a compare node reaches it through two node ids", async () => {
    await ev({ eventType: "meeting_booked", at: START_OF_TODAY + HOUR, key: "L1", props: { starts_at: null } });
    await ev({
      eventType: "meeting_booked",
      at: START_OF_TODAY + HOUR,
      key: "L2",
      props: { starts_at: new Date(START_OF_TODAY + 5 * HOUR).toISOString() },
    });

    const graph = {
      nodes: [
        N("m", "app", { connectionId: CONN, source: "close", eventType: "meeting_booked" }),
        N("f", "filter", { rules: [], combinator: "and" }),
        N("rate", "calculate", { mode: "compare", op: "percentage" }),
      ],
      edges: [E("m", "f"), E("m", "rate", "a"), E("f", "rate", "b")],
    };

    const by = await slots(graph, "rate", SPEC({ timeField: "properties.starts_at" }));
    // Sabotage: revert the Set and this reads 2 — L1 counted once as "m"'s
    // own record and again as "f"'s copy of the same record.
    expect(by.today.undated).toBe(1);
  });

  /**
   * C6: `records` behind a compare node is meaningless — its two operands are
   * usually different populations (leads vs. calls), and the old code summed
   * the dataset sizes behind BOTH the a and b handles into one number that no
   * single population produced.
   */
  it("a percentage of two Filters reports no records — its operands are not one population", async () => {
    await ev({ eventType: "lead_created", at: START_OF_TODAY + HOUR, key: "L1" });
    await ev({ eventType: "lead_created", at: START_OF_TODAY + HOUR, key: "L2" });
    await ev({ eventType: "call_logged", at: START_OF_TODAY + HOUR, key: "L1" });

    const graph = {
      nodes: [
        N("leadsApp", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("callsApp", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("leadsF", "filter", { rules: [], combinator: "and" }),
        N("callsF", "filter", { rules: [], combinator: "and" }),
        N("rate", "calculate", { mode: "compare", op: "percentage" }),
      ],
      edges: [E("leadsApp", "leadsF"), E("callsApp", "callsF"), E("callsF", "rate", "a"), E("leadsF", "rate", "b")],
    };

    const by = await slots(graph, "rate");
    expect(by.today.value).toBe(50);
    // Sabotage: stop skipping the a/b handles and this reports 3 — the one
    // call's filter output plus the two leads' filter output, under a
    // percentage neither population alone produced.
    expect(by.today.records).toBeUndefined();
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

/**
 * UPCOMING — the range that looks forward.
 *
 * Every other pill caps at now, so a meeting that has not happened yet was
 * visible in exactly one place: "All time", which is returned unfiltered and
 * therefore counted it silently. One workspace read 29.4% all-time against
 * 21.4% over the last 7 days with nothing on the board to account for the gap.
 * These tests pin the gap's contents as a range of its own.
 */
describe("Upcoming — the records that have not happened yet", () => {
  const graph = {
    nodes: [N("m", "app", { connectionId: CONN, source: "close", eventType: "meeting_booked" })],
    edges: [],
  };

  it("holds a future meeting that no backward range can see, and that All time was counting silently", async () => {
    await ev({ eventType: "meeting_booked", at: NOW + 3 * DAY, key: "L1" });

    const by = await slots(graph, "m");
    expect(by.upcoming.value).toBe(1);
    expect(by.today.value).toBe(0);
    expect(by["7d"].value).toBe(0);
    expect(by.all.value).toBe(1);
  });

  it("holds nothing that has already happened", async () => {
    await ev({ eventType: "meeting_booked", at: NOW - 2 * HOUR, key: "L1" });

    const by = await slots(graph, "m");
    expect(by.upcoming.value).toBe(0);
    expect(by.today.value).toBe(1);
  });

  /**
   * The customer's chosen time reference decides what "upcoming" means, exactly
   * as it decides which day a record belongs to. A booking that ARRIVED last
   * week for a meeting in two days is upcoming; the row's arrival is not.
   */
  it("is upcoming by when the meeting happens, not by when the booking arrived", async () => {
    await ev({
      eventType: "meeting_booked",
      at: NOW - 7 * DAY,
      key: "L1",
      props: { starts_at: new Date(NOW + 2 * DAY).toISOString() },
    });

    expect((await slots(graph, "m")).upcoming.value).toBe(0);
    const booked = await slots(graph, "m", SPEC({ timeField: "properties.starts_at" }));
    expect(booked.upcoming.value).toBe(1);
  });

  /**
   * NOTHING AHEAD IS NOT ZERO PER CENT. A rate whose denominator empties has no
   * answer, and the range must store that rather than a number — it is what
   * makes the tile render its em-dash and the stored REASON instead of falling
   * back to the flow's own all-time figure under a forward pill.
   */
  it("says a rate has no answer for an empty upcoming window", async () => {
    await ev({ eventType: "lead_created", at: NOW - 3 * DAY, key: "L1" });
    await ev({ eventType: "call_logged", at: NOW - 3 * DAY, key: "L1" });

    const rate = {
      nodes: [
        N("leads", "app", { connectionId: CONN, source: "close", eventType: "lead_created" }),
        N("calls", "app", { connectionId: CONN, source: "close", eventType: "call_logged" }),
        N("rate", "calculate", { mode: "compare", op: "percentage" }),
      ],
      edges: [E("calls", "rate", "a"), E("leads", "rate", "b")],
    };

    const by = await slots(rate, "rate");
    expect(by.all.value).toBe(100);
    expect(by.upcoming.value).toBeUndefined();
    expect(by.upcoming.unavailable).toMatch(/denominator/i);
  });

  /**
   * THE SENTINEL MUST NOT BECOME THE PRESENT. A record leaves Upcoming and
   * enters every now-ended range at the same instant, so the stored crossing is
   * the meeting itself — never the range's own far-future end, which would
   * freeze the tile behind a green dot until the age backstop caught it.
   */
  it("books the crossing at the meeting, not at the range's far-future end", async () => {
    const meeting = NOW + 90 * 60_000;
    await ev({ eventType: "meeting_booked", at: meeting, key: "L1" });

    const { nextChangeMs } = await derive(graph, "m");
    expect(nextChangeMs).toBe(Math.min(meeting, START_OF_TODAY + DAY));
    expect(nextChangeMs).toBeLessThan(FAR_FUTURE);
  });
});

/**
 * THE READ SHIPS NINE COLUMNS, because nine is what `eventToRecord` consumes.
 * `select *` also shipped `event_id`, the harvested `identifiers` jsonb and
 * the row's bookkeeping out of the database with every record of every
 * materialize — paid for by the byte, discarded on arrival. REVERT TO
 * `select()` AND THIS FAILS on the first excluded column.
 */
describe("the app read's SQL", () => {
  it("selects the engine's columns and none of the bookkeeping", async () => {
    await ev({ eventType: "lead_created", at: START_OF_TODAY, key: "L1" });
    const g = parseGraph({
      nodes: [N("m", "app", { connectionId: CONN, source: "close", eventType: "lead_created" })],
      edges: [],
    });
    const provenance: import("@/lib/flow/engine").CompileProvenance[] = [];
    await runFlow({ db, orgId: ORG, provenance }, g);
    const sql = provenance[0]?.sql ?? "";
    expect(sql).toContain('"properties"');
    expect(sql).toContain('"occurred_at"');
    for (const dropped of ['"identifiers"', '"event_id"', '"raw_event_id"', '"sync_generation"', '"received_at"']) {
      expect(sql).not.toContain(dropped);
    }
  });
});

/**
 * WHEN A TILE CAN NEXT CHANGE WITHOUT NEW DATA — the number that replaced the
 * blind ten-minute recompute. The clock only moves a stored number three ways:
 * a record falls out of a rolling window at exactly `t + length`, a
 * future-dated record reaches "Today" at exactly `t`, and everything
 * day-anchored shifts at UTC midnight. `tileByRange` computes the earliest of
 * these from the records in hand; the refresh loop recomputes then and not
 * before. REVERT THE CROSSING TRACKING AND EVERY ASSERTION HERE RETURNS THE
 * MIDNIGHT DEFAULT — and the dashboard goes back to re-reading each flow's
 * whole history 144 times a day against a database billed by the byte.
 */
describe("nextChangeMs — the exact moment a tile's numbers can move", () => {
  const graph = {
    nodes: [N("m", "app", { connectionId: CONN, source: "close", eventType: "meeting_booked" })],
    edges: [],
  };
  const NEXT_MIDNIGHT = START_OF_TODAY + DAY;

  it("is capped at the next UTC midnight for a flow with nothing nearer", async () => {
    // Dated long ago: its 7d exit is long past, nothing is upcoming.
    await ev({ eventType: "meeting_booked", at: START_OF_TODAY - 40 * DAY, key: "L1" });
    const { nextChangeMs } = await derive(graph, "m");
    expect(nextChangeMs).toBe(NEXT_MIDNIGHT);
  });

  it("is the moment a record falls out of a rolling window, when that comes first", async () => {
    // Entered the 7d window 6d23h ago — it leaves within the hour, before midnight.
    const t = NOW - 7 * DAY + 30 * 60_000;
    await ev({ eventType: "meeting_booked", at: t, key: "L1" });
    const { nextChangeMs } = await derive(graph, "m");
    // min() with midnight so a run started just before 00:00 UTC stays green.
    expect(nextChangeMs).toBe(Math.min(t + 7 * DAY, NEXT_MIDNIGHT));
  });

  it("is the start of a future-dated record, when the meeting comes first", async () => {
    // A meeting later today enters "Today" the moment the clock reaches it —
    // sooner than the old record's window exits and sooner than midnight.
    const meeting = NOW + 60 * 60_000;
    await ev({ eventType: "meeting_booked", at: NOW - 40 * DAY, key: "L1" });
    await ev({ eventType: "meeting_booked", at: meeting, key: "L2" });
    const { nextChangeMs } = await derive(graph, "m");
    expect(nextChangeMs).toBe(Math.min(meeting, NEXT_MIDNIGHT));
  });

  it("reads the metric's own time reference, not just occurredAt", async () => {
    // The row arrived days ago; what is upcoming is the BOOKED time.
    const starts = NOW + 2 * 60 * 60_000;
    await ev({
      eventType: "meeting_booked",
      at: START_OF_TODAY - 3 * DAY,
      key: "L1",
      props: { starts_at: new Date(starts).toISOString() },
    });
    const { nextChangeMs } = await derive(graph, "m", SPEC({ timeField: "properties.starts_at" }));
    expect(nextChangeMs).toBe(Math.min(starts, NEXT_MIDNIGHT));
  });
});
