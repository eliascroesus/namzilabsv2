import type { ObservedRateLimit } from "@/lib/http-client";
import { spanCovered } from "../field-utils";
import type { CanonicalEvent, ImportCoverage, PollBudget, PollResult } from "../types";

const DAY_MS = 86_400_000;

/**
 * The cursor of a windowed walk — the same grammar Close, Instantly and Whop
 * each hand-rolled, written once. A BARE STRING is a settled high-water mark
 * (the newest `changedAt` seen). JSON means mid-walk: `cont` is the provider's
 * continuation, `maxSeen` the newest mark seen so far in this window, and
 * `floor`/`covLo`/`covHi` exist only during a first sync, for coverage.
 * `holdsWindowContinuation` (field-utils) and `cursorSaysImporting`
 * (import-status) already read this grammar.
 */
export type WalkCursor = {
  hw: string | null;
  cont: string | null;
  maxSeen: string | null;
  floor?: string | null;
  covLo?: string | null;
  covHi?: string | null;
};

export function parseWalkCursor(raw: string | null): WalkCursor {
  if (!raw) return { hw: null, cont: null, maxSeen: null };
  if (raw.startsWith("{")) {
    try {
      const p = JSON.parse(raw) as Partial<WalkCursor>;
      return {
        hw: p.hw ?? null,
        cont: p.cont ?? null,
        maxSeen: p.maxSeen ?? null,
        floor: p.floor ?? null,
        covLo: p.covLo ?? null,
        covHi: p.covHi ?? null,
      };
    } catch {
      return { hw: null, cont: null, maxSeen: null };
    }
  }
  return { hw: raw, cont: null, maxSeen: null };
}

export function serializeWalkCursor(c: WalkCursor): string | null {
  if (c.cont || (!c.hw && c.floor)) return JSON.stringify(c);
  return c.maxSeen ?? c.hw;
}

function coverage(c: WalkCursor, targetMs: number, now: number): ImportCoverage {
  const loMs = c.covLo ? Date.parse(c.covLo) || 0 : 0;
  // Records inside the change window can have HAPPENED long before it (an
  // edit to an old record); clamp so "covering 700 of 30 days" cannot appear.
  const lo = loMs > 0 && loMs < targetMs ? new Date(targetMs).toISOString() : (c.covLo ?? null);
  return spanCovered(lo, c.covHi ?? null, targetMs, now);
}

/** Coverage of a FIRST sync still walking; null once a mark exists or for a bare cursor. */
export function walkImportProgress(raw: string | null, now = Date.now()): ImportCoverage | null {
  const c = parseWalkCursor(raw);
  if (!raw || c.hw || !c.floor) return null;
  const floorMs = Date.parse(c.floor);
  if (!Number.isFinite(floorMs)) return null;
  return coverage(c, floorMs, now);
}

const later = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return (Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a;
};
const earlier = (a: string | null, b: string | null): string | null => {
  const ta = a ? Date.parse(a) || null : null;
  const tb = b ? Date.parse(b) || null : null;
  if (ta == null) return b;
  if (tb == null) return a;
  return tb < ta ? b : a;
};

export type WalkPage<Row> = { rows: Row[]; next: string | null; rateLimit?: ObservedRateLimit | null };

export type WalkDefaults = {
  /** Pages per poll when no budget is handed down (legacy callers, tests). */
  pagesPerPoll: number;
  /** Memory ceiling on pages even when the budget allows more. */
  maxPagesPerPoll: number;
  /** How far back a first sync reaches when nothing deepens it. */
  firstSyncDays: number;
  /** Re-read this much behind the mark, so a late-arriving edit is not missed. */
  overlapMs: number;
};

export type WindowedWalkOpts<Row> = {
  cursor: string | null;
  budget?: PollBudget;
  windowFloor?: Date | null;
  /** Injectable clock; `budget.nowMs` wins when both are given. */
  now?: () => number;
  defaults: WalkDefaults;
  /** One provider request: rows changed at or after `since`, from `cont` when set. */
  fetchPage: (q: { since: Date; cont: string | null }) => Promise<WalkPage<Row>>;
  /** The field the provider FILTERS on — the watermark axis. */
  changedAt: (row: Row) => string | null;
  /** The field that says when the thing HAPPENED — the coverage axis. Defaults to `changedAt`. */
  happenedAt?: (row: Row) => string | null;
  /** Null skips the row; its `changedAt` still advances the mark so it is not re-read forever. */
  map: (row: Row) => CanonicalEvent | null;
  /** Recognise "this continuation is dead" — the walk drops it and resumes from the mark. */
  expiredContinuation?: (err: unknown) => boolean;
};

/**
 * Cursor-forward polling with overlap, bounded by budget and deadline, that
 * never strands a record: a window is drained to its end across polls, a
 * deeper first sync resumes where it stopped, and the mark only advances
 * once a window has settled.
 */
export async function windowedWalk<Row>(o: WindowedWalkOpts<Row>): Promise<PollResult> {
  const nowMs = o.budget?.nowMs ?? o.now ?? Date.now;
  const started = nowMs();
  const cur = parseWalkCursor(o.cursor);
  if (cur.hw && !Number.isFinite(Date.parse(cur.hw))) cur.hw = null;

  const defaultFloor = started - o.defaults.firstSyncDays * DAY_MS;
  const requestedFloor = o.windowFloor ? o.windowFloor.getTime() : null;
  const storedFloor = cur.floor ? Date.parse(cur.floor) : NaN;
  let targetMs: number;
  if (cur.hw) targetMs = Date.parse(cur.hw) - o.defaults.overlapMs;
  else if (Number.isFinite(storedFloor)) targetMs = requestedFloor != null ? Math.min(storedFloor, requestedFloor) : storedFloor;
  else targetMs = requestedFloor != null ? Math.min(defaultFloor, requestedFloor) : defaultFloor;
  if (!cur.hw) cur.floor = new Date(targetMs).toISOString();
  const since = new Date(targetMs);

  const pageCap = o.budget ? Math.min(o.defaults.maxPagesPerPoll, Math.max(1, o.budget.maxCalls)) : o.defaults.pagesPerPoll;
  const deadline = o.budget?.deadlineMs;
  const records = new Map<string, CanonicalEvent>();
  const happenedAt = o.happenedAt ?? o.changedAt;
  let providerCalls = 0;
  let rateLimit: ObservedRateLimit | null = null;

  const partial = (): PollResult => ({
    records: [...records.values()],
    nextCursor: serializeWalkCursor(cur),
    providerCalls,
    rateLimit: rateLimit ?? undefined,
    incomplete: true,
    importProgress: cur.hw ? undefined : coverage(cur, targetMs, nowMs()),
  });

  for (let pages = 0; pages < pageCap; pages++) {
    if (pages > 0 && deadline != null && nowMs() >= deadline) return partial();
    let page: WalkPage<Row>;
    try {
      providerCalls += 1;
      page = await o.fetchPage({ since, cont: cur.cont });
    } catch (e) {
      if (cur.cont && o.expiredContinuation?.(e)) {
        cur.cont = null;
        cur.maxSeen = null;
        return partial();
      }
      throw e;
    }
    if (page.rateLimit) rateLimit = page.rateLimit;
    for (const row of page.rows) {
      const ev = o.map(row);
      if (ev) records.set(ev.eventId, ev);
      cur.maxSeen = later(cur.maxSeen, o.changedAt(row));
      const h = happenedAt(row);
      cur.covLo = earlier(cur.covLo ?? null, h);
      cur.covHi = later(cur.covHi ?? null, h);
    }
    if (!page.next || page.rows.length === 0) {
      return {
        records: [...records.values()],
        nextCursor: serializeWalkCursor({ hw: cur.maxSeen ?? cur.hw, cont: null, maxSeen: null }),
        providerCalls,
        rateLimit: rateLimit ?? undefined,
      };
    }
    cur.cont = page.next;
  }
  return partial();
}
