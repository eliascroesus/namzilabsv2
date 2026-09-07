import { describe, it, expect } from "vitest";
import { HttpError } from "@/lib/http-client";
import { holdsWindowContinuation } from "@/connectors/field-utils";
import {
  windowedWalk,
  parseWalkCursor,
  serializeWalkCursor,
  walkImportProgress,
  type WindowedWalkOpts,
} from "@/connectors/kit/walk";
import type { CanonicalEvent, PollResult } from "@/connectors/types";

const DAY = 86_400_000;
const MIN = 60_000;
type Row = { id: string; updated: string; created: string };

/** A provider that filters on `updated >= since`, returns newest-first, and pages by offset in `next`. */
function server(rows: Row[], pageSize = 50) {
  const calls: Array<{ since: string; cont: string | null }> = [];
  const fetchPage: WindowedWalkOpts<Row>["fetchPage"] = async ({ since, cont }) => {
    calls.push({ since: since.toISOString(), cont });
    const kept = rows.filter((r) => Date.parse(r.updated) >= since.getTime());
    const offset = cont ? Number(cont) : 0;
    const page = kept.slice(offset, offset + pageSize);
    return { rows: page, next: offset + page.length < kept.length ? String(offset + page.length) : null };
  };
  return { calls, fetchPage };
}

const DEFAULTS = { pagesPerPoll: 4, maxPagesPerPoll: 40, firstSyncDays: 30, overlapMs: 5 * MIN };
const map = (r: Row): CanonicalEvent => ({ eventId: `t:c1:${r.id}`, eventType: "row", occurredAt: new Date(r.created) });
const changedAt = (r: Row) => r.updated;
const happenedAt = (r: Row) => r.created;

/** n rows, updated one minute apart ending an hour ago, created a day earlier each — newest first. */
function burst(n: number, now: number): Row[] {
  const end = now - 3_600_000;
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i + 1}`,
    updated: new Date(end - i * MIN).toISOString(),
    created: new Date(end - DAY - i * MIN).toISOString(),
  }));
}

describe("windowedWalk", () => {
  const NOW = Date.parse("2026-09-07T12:00:00Z");
  const now = () => NOW;

  it("drains a burst larger than one poll's page cap without stranding a record", async () => {
    const rows = burst(260, NOW);
    const { fetchPage } = server(rows);
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res: PollResult = await windowedWalk<Row>({ cursor, now, defaults: DEFAULTS, fetchPage, changedAt, happenedAt, map });
      for (const e of res.records) seen.add(e.eventId.split(":").pop()!);
      cursor = res.nextCursor;
      if (!res.incomplete) break;
    }
    expect(seen.size).toBe(260);
    expect(cursor).toBe(rows[0].updated); // settled: a bare high-water mark = the newest `updated`
    expect(holdsWindowContinuation(cursor)).toBe(false);
  });

  it("stops at the page cap, says so, and reports coverage on the happened-at axis", async () => {
    const rows = burst(260, NOW);
    const { calls, fetchPage } = server(rows);
    const res = await windowedWalk({ cursor: null, now, defaults: DEFAULTS, fetchPage, changedAt, happenedAt, map });
    expect(calls).toHaveLength(4);
    expect(res.records).toHaveLength(200);
    expect(res.incomplete).toBe(true);
    expect(res.providerCalls).toBe(4);
    expect(holdsWindowContinuation(res.nextCursor)).toBe(true);
    expect(res.importProgress).toBeDefined();
    expect(res.importProgress!.targetMs).toBe(30 * DAY);
    // 200 rows created a minute apart = 199 minutes of the created axis, not the updated one.
    expect(res.importProgress!.coveredMs).toBe(199 * MIN);
  });

  it("a budget caps the pages below the default; a deadline stops between pages", async () => {
    const rows = burst(260, NOW);
    const a = server(rows);
    await windowedWalk({ cursor: null, budget: { maxCalls: 2, nowMs: now }, defaults: DEFAULTS, fetchPage: a.fetchPage, changedAt, map });
    expect(a.calls).toHaveLength(2);

    let clock = NOW;
    const b = server(rows);
    const res = await windowedWalk({
      cursor: null,
      budget: { maxCalls: 10, deadlineMs: NOW + 1, nowMs: () => (clock += 1000) },
      defaults: DEFAULTS,
      fetchPage: b.fetchPage,
      changedAt,
      map,
    });
    expect(b.calls).toHaveLength(1);
    expect(res.incomplete).toBe(true);
  });

  it("an expired continuation restarts from the high-water mark without losing what was read", async () => {
    const rows = burst(120, NOW);
    const base = server(rows);
    const fetchPage: WindowedWalkOpts<Row>["fetchPage"] = async (q) => {
      if (q.cont) throw new HttpError({ status: 400, statusText: "Bad Request", url: "x", body: "cursor expired", retryAfterMs: null });
      return base.fetchPage(q);
    };
    const res = await windowedWalk({
      cursor: JSON.stringify({ hw: rows[60].updated, cont: "50", maxSeen: rows[0].updated }),
      now,
      defaults: DEFAULTS,
      fetchPage,
      changedAt,
      map,
      expiredContinuation: (e) => e instanceof HttpError && e.status === 400,
    });
    expect(res.incomplete).toBe(true);
    expect(res.records).toHaveLength(0);
    expect(res.nextCursor).toBe(rows[60].updated); // cont dropped, hw kept, maxSeen discarded
  });

  it("re-reads from the mark minus the overlap, and bounds a first sync at firstSyncDays or windowFloor", async () => {
    const rows = burst(10, NOW);
    const hw = rows[0].updated;
    const a = server(rows);
    await windowedWalk({ cursor: hw, now, defaults: DEFAULTS, fetchPage: a.fetchPage, changedAt, map });
    expect(a.calls[0].since).toBe(new Date(Date.parse(hw) - 5 * MIN).toISOString());

    const b = server(rows);
    await windowedWalk({ cursor: null, now, defaults: DEFAULTS, fetchPage: b.fetchPage, changedAt, map });
    expect(b.calls[0].since).toBe(new Date(NOW - 30 * DAY).toISOString());

    const c = server(rows);
    const deep = new Date(NOW - 90 * DAY);
    await windowedWalk({ cursor: null, now, windowFloor: deep, defaults: DEFAULTS, fetchPage: c.fetchPage, changedAt, map });
    expect(c.calls[0].since).toBe(deep.toISOString());
  });

  it("dedupes within a poll, skips rows map() refuses, and still advances the mark for them", async () => {
    const rows = burst(3, NOW);
    const dup = { ...rows[1], id: "r2" };
    const { fetchPage } = server([rows[0], rows[1], dup, rows[2]]);
    const res = await windowedWalk({
      cursor: null,
      now,
      defaults: DEFAULTS,
      fetchPage,
      changedAt,
      map: (r) => (r.id === "r1" ? null : map(r)),
    });
    expect(res.records.map((e) => e.eventId)).toEqual(["t:c1:r2", "t:c1:r3"]);
    expect(res.nextCursor).toBe(rows[0].updated); // r1 was skipped by map() but its `updated` still moved the mark
  });

  it("reports the last observed rate limit", async () => {
    const rows = burst(3, NOW);
    const res = await windowedWalk({
      cursor: null,
      now,
      defaults: DEFAULTS,
      fetchPage: async () => ({ rows, next: null, rateLimit: { limit: 100, remaining: 7, resetSeconds: 30 } }),
      changedAt,
      map,
    });
    expect(res.rateLimit).toEqual({ limit: 100, remaining: 7, resetSeconds: 30 });
  });
});

describe("walk cursors", () => {
  it("round-trips, reads a bare string as a mark, and treats bad JSON as a fresh start", () => {
    expect(parseWalkCursor(null)).toEqual({ hw: null, cont: null, maxSeen: null });
    expect(parseWalkCursor("2026-08-01T00:00:00Z")).toEqual({ hw: "2026-08-01T00:00:00Z", cont: null, maxSeen: null });
    expect(parseWalkCursor("{nope")).toEqual({ hw: null, cont: null, maxSeen: null });
    const c = { hw: "2026-08-01T00:00:00Z", cont: "tok", maxSeen: "2026-08-02T00:00:00Z", floor: null, covLo: null, covHi: null };
    expect(parseWalkCursor(serializeWalkCursor(c))).toEqual(c);
    expect(serializeWalkCursor({ hw: "a", cont: null, maxSeen: "b" })).toBe("b");
    expect(serializeWalkCursor({ hw: "a", cont: null, maxSeen: null })).toBe("a");
  });

  it("walkImportProgress answers only for a first sync still walking", () => {
    const now = Date.parse("2026-09-07T12:00:00Z");
    expect(walkImportProgress(null, now)).toBeNull();
    expect(walkImportProgress("2026-08-01T00:00:00Z", now)).toBeNull();
    expect(walkImportProgress(JSON.stringify({ hw: "2026-08-01T00:00:00Z", cont: "t", floor: "2026-07-01T00:00:00Z" }), now)).toBeNull();
    const floor = new Date(now - 30 * DAY).toISOString();
    const covLo = new Date(now - 10 * DAY).toISOString();
    const covHi = new Date(now - 1 * DAY).toISOString();
    expect(walkImportProgress(JSON.stringify({ hw: null, cont: "t", maxSeen: null, floor, covLo, covHi }), now)).toEqual({
      coveredMs: 9 * DAY,
      targetMs: 30 * DAY,
    });
  });
});
