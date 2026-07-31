import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeConnector } from "@/connectors/close";
import type { CanonicalEvent } from "@/connectors/types";

/**
 * Defect #2 regression: the Close Event Log is newest-first. The old poll read
 * ONE page of 50 and jumped the cursor to the newest record, so a burst > 50
 * permanently stranded everything older — no later sweep ever queried it. The
 * fixed poll walks the window above the high-water mark to its END via the
 * provider's cursor_next, only advancing the high-water mark once drained, and
 * persists a continuation when a window is deeper than one sweep's page budget.
 */

const T0 = Date.parse("2026-07-01T00:00:00Z");

/** Provider-side fixture: `total` events, ids e1 (oldest) … eN (newest), 1s apart. */
function makeLog(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: `e${i + 1}`,
    object_type: "activity.sms",
    action: "created",
    date_created: new Date(T0 + (i + 1) * 1000).toISOString().replace("Z", "+00:00"),
  }));
  return [...all].reverse(); // newest-first, like the real Event Log
}

/**
 * Mock the Event Log endpoint: pages of `_limit` in whatever order the fixture
 * was built in, filtered by date_created__gte, paginated via an opaque `_cursor`
 * = the next page offset.
 */
function mockEventLog(ordered: Array<Record<string, unknown>>) {
  const calls: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    calls.push(params);
    const limit = Number(params.get("_limit") ?? "50");
    const gte = params.get("date_created__gte");
    const filtered = gte ? ordered.filter((e) => Date.parse(String(e.date_created)) >= Date.parse(gte)) : ordered;
    const offset = params.get("_cursor") ? Number(params.get("_cursor")) : 0;
    const page = filtered.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const body = { data: page, cursor_next: nextOffset < filtered.length ? String(nextOffset) : null };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const pollArgs = (cursor: string | null) => ({ connectionId: "c1", cursor, credentials: { apiKey: "k" } });

function ids(records: CanonicalEvent[]): string[] {
  return records.map((r) => r.eventId.split(":").pop()!).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/**
 * THE CLOCK IS PINNED TO THE FIXTURES' ERA, for the whole file.
 *
 * `makeLog` builds its timeline from a hard-coded `T0`, and the connector bounds
 * every request to the last `FIRST_SYNC_DAYS` — so with a real clock these
 * fixtures age out of the window the code asks for, and the suite starts failing
 * on a DATE, for a reason that has nothing to do with the behaviour under test.
 * That is not hypothetical: T0 is 2026-07-01 and the bound is 30 days.
 *
 * Only `Date` is faked. Timers, promises and the fetch stubs are untouched, and
 * nothing here talks to a database.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Far enough past T0 that every fixture record is in the past, close enough
  // that all of them sit inside the connector's own first-sync window.
  vi.setSystemTime(new Date(T0 + 5 * 60_000));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Close Event Log poll (Defect #2)", () => {
  it("a 200-event burst lands in full within one poll (4 pages walked to the end)", async () => {
    mockEventLog(makeLog(200));
    const res = await closeConnector.poll!(pollArgs(null));
    expect(res.records).toHaveLength(200);
    expect(ids(res.records)).toEqual(Array.from({ length: 200 }, (_, i) => `e${i + 1}`));
    // Drained → plain high-water cursor = the NEWEST date_created ingested.
    expect(res.nextCursor).toBe(new Date(T0 + 200 * 1000).toISOString().replace("Z", "+00:00"));
  });

  it("a burst deeper than the page budget resumes next sweep — nothing stranded", async () => {
    mockEventLog(makeLog(260)); // 6 pages: 4 this sweep + 2 next
    const first = await closeConnector.poll!(pollArgs(null));
    expect(first.records).toHaveLength(200);
    // Mid-walk → continuation cursor; high-water NOT advanced yet.
    expect(first.nextCursor!.startsWith("{")).toBe(true);

    const { calls } = mockEventLog(makeLog(260));
    const second = await closeConnector.poll!(pollArgs(first.nextCursor));
    expect(second.records).toHaveLength(60);
    // The resume passed the provider continuation through.
    expect(calls[0].get("_cursor")).toBe("200");
    // Union of both sweeps = every event exactly once.
    const union = new Set([...first.records, ...second.records].map((r) => r.eventId));
    expect(union.size).toBe(260);
    // Drained → high-water advances to the newest.
    expect(second.nextCursor).toBe(new Date(T0 + 260 * 1000).toISOString().replace("Z", "+00:00"));
  });

  it("incremental poll from a legacy plain-date cursor keeps boundary ties via the overlap window", async () => {
    const log = makeLog(80);
    const { calls } = mockEventLog(log);
    const hw = new Date(T0 + 50 * 1000).toISOString().replace("Z", "+00:00"); // e50 already ingested
    const res = await closeConnector.poll!(pollArgs(hw));

    // Requested window starts BELOW the high-water mark (overlap), not above it.
    const gte = calls[0].get("date_created__gte")!;
    expect(Date.parse(gte)).toBeLessThan(Date.parse(hw));
    expect(calls[0].get("_cursor")).toBeNull();

    // Everything at/after the overlap floor is (re)fetched (5-minute cushion,
    // per Close's own out-of-order guidance — here that spans the whole
    // fixture), so nothing above the mark is missed and ties are kept; the
    // pipeline's event_id dedup absorbs the re-reads.
    const got = new Set(res.records.map((r) => r.eventId));
    for (let i = 51; i <= 80; i++) expect(got.has(`close:c1:e${i}`)).toBe(true);
    expect(res.nextCursor).toBe(new Date(T0 + 80 * 1000).toISOString().replace("Z", "+00:00"));
  });

  it("the cursor is monotonic: an empty window never regresses the high-water mark", async () => {
    mockEventLog(makeLog(0));
    const hw = new Date(T0 + 99 * 1000).toISOString().replace("Z", "+00:00");
    const res = await closeConnector.poll!(pollArgs(hw));
    expect(res.records).toHaveLength(0);
    expect(res.nextCursor).toBe(hw);
  });

  it("an expired provider continuation resets instead of wedging the stream", async () => {
    const body = { error: "invalid cursor" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as unknown as Response),
    );
    const hw = new Date(T0).toISOString();
    const stuck = JSON.stringify({ hw, cont: "999", maxSeen: null });
    const res = await closeConnector.poll!(pollArgs(stuck));
    // Continuation dropped → next sweep restarts the window from the high-water mark.
    expect(res.records).toHaveLength(0);
    expect(res.nextCursor).toBe(hw);
  });

  it("testFetchLatest previews the newest N without touching cursors", async () => {
    const { calls } = mockEventLog(makeLog(10));
    const latest = await closeConnector.testFetchLatest!(5, pollArgs(null));
    expect(latest).toHaveLength(5);
    expect(latest[0].eventId).toBe("close:c1:e10"); // newest of the ten
    // Bounded, and asking for a full page rather than for `n`: the search needs
    // to see whether a window fits in one request before it can conclude
    // anything about which events are newest.
    expect(calls[0].get("date_created__gte")).not.toBeNull();
    expect(calls[0].get("_limit")).toBe("50");
    expect(calls[0].get("_cursor")).toBeNull();
  });
});

/**
 * A first sync used to send NO `date_created__gte` at all — and because `hw`
 * only advances once a window drains, "the first window" was the entire
 * workspace event log. A mature account walked it 200 records per sweep,
 * indefinitely, and since every sweep inserted rows the cadence ladder never
 * demoted it: it just ran for days while the editor showed a climbing number
 * with nothing to explain it.
 */
describe("Close first-sync bound", () => {
  const DAY = 86_400_000;

  it("bounds a fresh sync — opening on the last day, targeting 30", async () => {
    const { calls } = mockEventLog(makeLog(10));
    await closeConnector.poll!(pollArgs(null));
    const backOf = (i: number) => Math.round((Date.now() - Date.parse(calls[i].get("date_created__gte")!)) / DAY);
    // Every request is bounded — unbounded was "the whole workspace event log".
    for (const c of calls) expect(c.get("date_created__gte")).not.toBeNull();
    // The OPENING request is the shallow rung, so the first thing an editor
    // shows is recent whichever end the provider sorts from (see FIRST_RUNG_DAYS)...
    expect(backOf(0)).toBe(1);
    // ...and the target is still 30 days, reached in the same poll once the rung
    // drains, so a shallow rung never costs a whole sweep.
    expect(backOf(1)).toBe(30);
  });

  it("pins that floor for the life of the walk, so depth does not depend on how long it takes", async () => {
    mockEventLog(makeLog(260));
    const first = await closeConnector.poll!(pollArgs(null));
    const { calls } = mockEventLog(makeLog(260));
    await closeConnector.poll!(pollArgs(first.nextCursor));
    // Recomputing `now - 30d` each sweep would creep the boundary forward while
    // the walk pages BACKWARDS — the deeper the account, the shallower it lands.
    const floorOf = (c: URLSearchParams) => c.get("date_created__gte");
    expect(JSON.parse(first.nextCursor!).floor).toBe(floorOf(calls[0]));
  });

  it("drops the floor once the window drains — from then on the high-water mark governs", async () => {
    const OVERLAP_MS = 5 * 60_000; // mirrors close.ts
    mockEventLog(makeLog(200));
    const drained = await closeConnector.poll!(pollArgs(null));
    expect(drained.nextCursor!.startsWith("{")).toBe(false); // plain hw string

    // The next sweep's bound is derived from the MARK, exactly — not from the
    // 30-day floor, and not from a shallow peek either. Pinned as an identity
    // rather than as a day count: a range check passes for a bound computed any
    // number of wrong ways, and quietly depends on how old the fixture is.
    const { calls } = mockEventLog(makeLog(200));
    await closeConnector.poll!(pollArgs(drained.nextCursor));
    expect(Date.parse(calls[0].get("date_created__gte")!)).toBe(Date.parse(drained.nextCursor!) - OVERLAP_MS);
    // …and an incremental sweep does not re-peek: ONE window for the whole walk,
    // not a shallow bound followed by a deeper one. (It does re-read the fixture,
    // which is the 5-minute overlap working as designed — event_id dedup absorbs
    // it.)
    expect(new Set(calls.map((c) => c.get("date_created__gte"))).size).toBe(1);
  });

  it("bounds an unbounded walk that was already in flight", async () => {
    // A cursor stored before the floor existed: mid-walk, no hw, no floor.
    const legacy = JSON.stringify({ hw: null, cont: "200", maxSeen: null });
    const { calls } = mockEventLog(makeLog(400));
    await closeConnector.poll!(pollArgs(legacy));
    const back = Math.round((Date.now() - Date.parse(calls[0].get("date_created__gte")!)) / DAY);
    expect(back).toBe(30); // that walk had no end; it has one now
  });

  it("says it is mid-import, as the SPAN ingested against the span aimed at", async () => {
    mockEventLog(makeLog(260));
    const first = await closeConnector.poll!(pollArgs(null));
    expect(first.incomplete).toBe(true);
    // 260 events one second apart, 200 ingested → e260 down to e61, a span of
    // 199 seconds. Two spans and not two instants: "the oldest record reached,
    // versus the floor" measures progress only on a newest-first log, and a
    // number that is right by coincidence is one nobody can check.
    expect(first.importProgress!.coveredMs).toBe(199 * 1000);
    expect(Math.round(first.importProgress!.targetMs / DAY)).toBe(30);

    mockEventLog(makeLog(260));
    const second = await closeConnector.poll!(pollArgs(first.nextCursor));
    expect(second.incomplete).toBeUndefined(); // drained
  });
});

/**
 * THE OTHER ORDERING — a hypothetical, and deliberately still tested.
 *
 * Close's Event Log is newest-first, which is what every fixture above is built
 * from. This block was written when a run of
 * `scripts/verify-close-pagination.ts` reported oldest-first; that finding was a
 * bug in the script (`Date.parse` of one unparseable `date_created` made every
 * ordering comparison false), not a fact about the provider, and the script now
 * emits raw evidence instead of verdicts.
 *
 * The block stays, renamed to say what it actually is. The walk itself is safe
 * either way — it ingests every event on every page and stops only on cursor
 * exhaustion — but everything that reads MEANING out of a partial walk was
 * written assuming the first page is the newest one, and those assumptions are
 * invisible in a fixture that satisfies them. This is the only place the other
 * direction is exercised at all, so deleting it would leave the direction-free
 * claims in `covLo` and `testFetchLatest` asserted and unverified.
 */
describe("Close if the Event Log ran oldest-first", () => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  /** `total` events spread evenly over the last `spanDays`, OLDEST first. */
  function spreadLog(total: number, spanDays: number) {
    const end = Date.now() - HOUR;
    const step = (spanDays * DAY) / total;
    return Array.from({ length: total }, (_, i) => ({
      id: `s${i + 1}`,
      object_type: "activity.sms",
      action: "created",
      date_created: new Date(end - (total - 1 - i) * step).toISOString(),
    }));
  }

  const idsOf = (rs: CanonicalEvent[]) => rs.map((r) => r.eventId.split(":").pop()!);

  it("still ingests every event in the window — a drained walk is complete either way", async () => {
    // Confirming the harmless half before the harmful half: the loop pushes
    // every record on every page and terminates only on cursor exhaustion, so
    // ordering cannot cost data. Three polls to drain 600 events.
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let sweep = 0; sweep < 3; sweep++) {
      mockEventLog(spreadLog(600, 30));
      const res: Awaited<ReturnType<NonNullable<typeof closeConnector.poll>>> = await closeConnector.poll!(pollArgs(cursor));
      for (const id of idsOf(res.records)) seen.add(id);
      cursor = res.nextCursor;
    }
    expect(seen.size).toBe(600);
    // Drained → the plain high-water form, so the next sweep is incremental.
    expect(cursor!.startsWith("{")).toBe(false);
  });

  /**
   * THE failure the span shape exists to prevent. Progress was "the oldest
   * record ingested, versus the floor" — and on an oldest-first log the first
   * page LANDS on the floor. A first sweep holding 200 of 600 events would
   * report covering the whole 30 days: a number announcing itself as finished
   * while still climbing.
   */
  it("does not claim the whole window from a first page that starts at the floor", async () => {
    mockEventLog(spreadLog(600, 30));
    const res = await closeConnector.poll!(pollArgs(null));

    expect(res.incomplete).toBe(true);
    const covered = res.importProgress!.coveredMs / DAY;
    const target = res.importProgress!.targetMs / DAY;
    expect(Math.round(target)).toBe(30);
    // 200 of 600 events at 72-minute spacing ≈ 10 days of the 30 asked for.
    expect(Math.round(covered)).toBe(10);
    // The assertion that would have failed before: nowhere near complete.
    expect(covered).toBeLessThan(target / 2);
  });

  it("counts the shallow rung's recent events toward the cursor, never as window coverage", async () => {
    // The opening rung ingests the last day, whose newest event is an hour old.
    // Measuring coverage from EVERYTHING ingested would span floor→now after one
    // page and read as 30 of 30 — the same overstatement by another route.
    mockEventLog(spreadLog(600, 30));
    const res = await closeConnector.poll!(pollArgs(null));

    const ids = new Set(idsOf(res.records));
    expect(ids.has("s600")).toBe(true); // the newest event IS held…
    expect(Math.round(res.importProgress!.coveredMs / DAY)).toBe(10); // …and not added on
  });

  /**
   * Coverage must never FALL, and must never JUMP to a span the walk does not
   * hold. Both directions are pinned here because both were wrong.
   *
   * The falling case: coverage is measured per bound and the target walk starts
   * its own span from scratch, so reporting the current bound alone would show
   * progress and then take it away — the import reading as if it went backwards.
   * `bankCoverage`'s running maximum is what prevents it.
   *
   * The jumping case is worse and was a live defect: a peek that RE-ARMS. An
   * expired continuation clears `cont` partway through a first sync, so the next
   * sweep peeks again — and if it inherits the previous bound's `covLo` (the
   * 30-day floor) while its own records push `covHi` to an hour ago, it banks the
   * whole window as covered. Permanently, because the bank is a maximum. The tile
   * then reads "covering 30 of 30 days" for the rest of a multi-day import while
   * two thirds of the events are missing.
   */
  it("never reports coverage that falls, and never a span it does not hold", async () => {
    const spread = spreadLog(600, 30); // ~72-minute spacing, 20 events in the last day
    mockEventLog(spread);
    const first = await closeConnector.poll!(pollArgs(null));
    const firstCovered = first.importProgress!.coveredMs;
    // The target walk holds the oldest 200 of 600 — about a third of 30 days.
    expect(Math.round(firstCovered / DAY)).toBe(10);

    // The continuation dies, which clears `cont` and leaves no high-water mark…
    const body = { error: "invalid cursor" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as unknown as Response),
    );
    const died = await closeConnector.poll!(pollArgs(first.nextCursor));
    // …and that sweep must still say it has work outstanding, or the cadence
    // ladder demotes a connection that is mid-import.
    expect(died.incomplete).toBe(true);

    // …so the NEXT sweep peeks again. This is the sweep that used to lie.
    mockEventLog(spread);
    const repeeked = await closeConnector.poll!(pollArgs(died.nextCursor));
    const covered = repeeked.importProgress!.coveredMs;
    expect(covered).toBeGreaterThanOrEqual(firstCovered); // never falls…
    // …and never claims the window. The re-peek holds the oldest 200 plus the
    // last day, with about twenty days missing in between.
    expect(Math.round(covered / DAY)).toBeLessThan(20);
    expect(Math.round(repeeked.importProgress!.targetMs / DAY)).toBe(30);
  });

  /**
   * The coverage marks describe the TARGET walk and nothing else, so what is
   * stored between sweeps must never mix the peek's dates with the target's.
   *
   * A stored cursor is the thing a later sweep reasons from, so the invariant has
   * to hold in the cursor and not merely in one poll's return value.
   */
  it("stores coverage marks that describe the target walk, never the peek", async () => {
    mockEventLog(spreadLog(600, 30));
    const res = await closeConnector.poll!(pollArgs(null));
    const stored = JSON.parse(res.nextCursor!);

    // The newest record ingested is an hour old (the peek got it) and IS the
    // high-water mark — but the coverage marks stop at the target walk's edge,
    // roughly twenty days back.
    expect(Date.now() - Date.parse(stored.maxSeen)).toBeLessThan(2 * 60 * 60_000);
    expect(Math.round((Date.now() - Date.parse(stored.covHi)) / DAY)).toBeGreaterThan(15);
    // …and the span between the marks is the ten days actually walked.
    expect(Math.round((Date.parse(stored.covHi) - Date.parse(stored.covLo)) / DAY)).toBe(10);
  });

  /**
   * The opening peek is ONE request, and a poll never hands the writer the same
   * record twice.
   *
   * Letting the peek page to exhaustion re-read everything it covered once the
   * walk stepped out to the target — on an account whose whole history fits
   * inside a day, that is the entire dataset twice plus an extra sweep before the
   * window settles. Both halves are pinned here because both were wrong once.
   */
  it("spends one request on the peek, and returns each record once", async () => {
    // Everything this account has is inside the last day, so the peek and the
    // target walk cover exactly the same records.
    const { calls } = mockEventLog(spreadLog(120, 1));
    const res = await closeConnector.poll!(pollArgs(null));

    const ids = idsOf(res.records);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates handed downstream
    expect(ids).toHaveLength(120);
    // 1 peek + 3 pages to walk 120 at 50 a page. A peek that paged to exhaustion
    // would have spent 3 on the peek and 3 more on the target.
    expect(calls).toHaveLength(4);
    // …and the window SETTLED: a drained target advances the high-water mark.
    expect(res.nextCursor!.startsWith("{")).toBe(false);
    expect(res.incomplete).toBeFalsy();
  });

  it("previews the NEWEST events, not the first page the provider offers", async () => {
    // 200 events in the last day: a one-day window needs paging, so page one is
    // the oldest 50 of the day. That page used to be the entire preview.
    const { calls } = mockEventLog(spreadLog(200, 1));
    const latest = await closeConnector.testFetchLatest!(3, pollArgs(null));

    expect(idsOf(latest)).toEqual(["s200", "s199", "s198"]);
    // It got there by narrowing the window until one request could hold it —
    // a fully-held window ending at `now` contains the newest events by
    // construction, whichever order they arrive in.
    expect(calls.length).toBeGreaterThan(1);
    const bounds = calls.map((c) => Date.parse(c.get("date_created__gte")!));
    expect(bounds[1]).toBeGreaterThan(bounds[0]);
  });

  it("answers in one request when the page IS newest-first", async () => {
    // Close's real ordering, and therefore the path that actually runs. A
    // descending page proves itself, so there is nothing to search for.
    const newestFirst = [...spreadLog(200, 1)].reverse();
    const { calls } = mockEventLog(newestFirst);
    const latest = await closeConnector.testFetchLatest!(3, pollArgs(null));

    expect(idsOf(latest)).toEqual(["s200", "s199", "s198"]);
    expect(calls).toHaveLength(1);
  });

  /**
   * A first sync's cursor must NEVER degrade to the plain high-water form.
   *
   * The plain form means "hw = this instant", so if an expired continuation
   * serialized that way mid-first-sync, the next sweep would take the newest
   * thing it happened to have seen as its floor and the rest of the 30-day
   * window would never be requested by anything again. That is the Defect #2
   * failure, arriving through the cursor rather than through the walk.
   */
  it("keeps the first sync's window when a continuation expires", async () => {
    const spread = spreadLog(600, 30);
    mockEventLog(spread);
    const first = await closeConnector.poll!(pollArgs(null));
    const mid = JSON.parse(first.nextCursor!);
    expect(mid.cont).not.toBeNull();

    // Now the provider rejects that continuation.
    const body = { error: "invalid cursor" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as unknown as Response),
    );
    const res = await closeConnector.poll!(pollArgs(first.nextCursor));

    const after = JSON.parse(res.nextCursor!);
    expect(after.cont).toBeNull(); // dropped, so the window restarts
    expect(after.hw).toBeNull(); // NOT promoted to a high-water mark
    expect(after.floor).toBe(mid.floor); // still aiming at the same 30 days
  });
});

/**
 * A corrupt stored cursor must degrade to the FIRST-SYNC bound, not to 1970.
 *
 * `Date.parse(x) || 0` read an unparseable mark as the epoch, which is not a
 * cautious reading of a bad value — it is the unbounded walk of the entire
 * workspace event log that `FIRST_SYNC_DAYS` exists to prevent, reached through
 * a corrupt stored value instead of a missing one. A cursor can be garbage for
 * ordinary reasons: a truncated write, a hand-edited row, a format that changed.
 */
describe("Close bounds itself even from a corrupt cursor", () => {
  const DAY = 86_400_000;
  const backOf = (c: URLSearchParams) => Math.round((Date.now() - Date.parse(c.get("date_created__gte")!)) / DAY);

  it("treats an unparseable first-sync floor as a fresh 30-day window", async () => {
    const { calls } = mockEventLog(makeLog(10));
    await closeConnector.poll!(pollArgs(JSON.stringify({ hw: null, cont: "5", maxSeen: null, floor: "not-a-date" })));
    // `cont` is set, so no shallow rung is imposed on an in-flight walk — the
    // bound is the target, and the target is 30 days rather than the epoch.
    expect(backOf(calls[0])).toBe(30);
  });

  it("discards an unparseable high-water mark and pins a fresh 30-day floor", async () => {
    // 260 events, so the target walk does NOT drain and the cursor stays in its
    // JSON form — the drained form is a bare date and carries no floor to check.
    const { calls } = mockEventLog(makeLog(260));
    const res = await closeConnector.poll!(pollArgs("garbage-not-a-date"));

    // Treated as a FRESH first sync: the peek, then the full target.
    expect(backOf(calls[0])).toBe(1);
    expect(backOf(calls[1])).toBe(30);
    // And the floor is PINNED. Keeping the corrupt mark left `cur.hw` truthy, so
    // the pin was skipped and the fallback recomputed `now - 30d` every sweep —
    // the window sliding forward while the walk paged through it, making the
    // depth reached depend on how long it took.
    const stored = JSON.parse(res.nextCursor!);
    expect(stored.hw).toBeNull();
    expect(stored.floor).toBe(calls[1].get("date_created__gte"));
  });
});
