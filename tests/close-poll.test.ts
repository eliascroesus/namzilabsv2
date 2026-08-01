import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeConnector } from "@/connectors/close";
import type { CanonicalEvent } from "@/connectors/types";

/**
 * Two contracts are pinned here, and they were broken in opposite ways.
 *
 * DEFECT #2 (fixed earlier): the old poll read ONE page and jumped the cursor to
 * the newest record it saw, so a burst deeper than a page stranded everything
 * older — no later sweep ever queried it. The walk now pages the window to its
 * END and only advances the high-water mark once drained.
 *
 * THE WRONG FIELD (fixed here): every request was bounded with
 * `date_created__gte`, and this endpoint filters on `date_updated`. Close drops
 * unknown parameters silently, so the bound did nothing and every request was
 * unbounded — invisible, because Close's own 30-day retention was doing the
 * bounding at exactly the depth we intended.
 *
 * Correcting the parameter name ALONE would have introduced a data-loss bug that
 * did not exist before: the watermark was taken from `date_created`, and a
 * watermark on one field cannot bound a window filtered on another. So the tests
 * below check the two axes together, because the two halves only make sense
 * together.
 */

const T0 = Date.parse("2026-07-01T00:00:00Z");
const DAY = 86_400_000;

type Ev = Record<string, unknown>;

/**
 * Provider-side fixture: `total` events, ids e1 (oldest) … eN (newest), 1s apart.
 *
 * `date_updated` defaults to `date_created` — an unedited record, which is most
 * of them. The interesting case is where they differ, and that has its own
 * fixture (`consolidated`) rather than being folded in here, because a fixture
 * where the two fields are always equal cannot tell a correct implementation
 * from one that reads the wrong field.
 */
function makeLog(total: number): Ev[] {
  const all = Array.from({ length: total }, (_, i) => {
    const at = new Date(T0 + (i + 1) * 1000).toISOString().replace("Z", "+00:00");
    return { id: `e${i + 1}`, object_type: "activity.sms", action: "created", date_created: at, date_updated: at };
  });
  return [...all].reverse(); // latest-first by date_updated, like the real Event Log
}

/**
 * A CONSOLIDATED event: created long ago, edited recently.
 *
 * Close's documented behaviour — several updates to one object merge into a
 * single event that keeps its original `date_created` and takes a new
 * `date_updated`. This is the record that separates the two axes, so it is the
 * record every two-axis assertion below is about.
 */
function consolidated(id: string, createdDaysAgo: number, updatedAt: number): Ev {
  return {
    id,
    object_type: "lead",
    action: "created",
    date_created: new Date(T0 - createdDaysAgo * DAY).toISOString().replace("Z", "+00:00"),
    date_updated: new Date(updatedAt).toISOString().replace("Z", "+00:00"),
  };
}

/**
 * Mock the Event Log endpoint.
 *
 * Filters on `date_updated__gte` and NOTHING ELSE — deliberately, because that is
 * what the real endpoint does. A mock that also honoured `date_created__gte`
 * would have let the old connector pass every test in this file while sending a
 * parameter the provider discards, which is exactly how the bug survived.
 */
function mockEventLog(ordered: Ev[]) {
  const calls: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    calls.push(params);
    const limit = Number(params.get("_limit") ?? "50");
    const gte = params.get("date_updated__gte");
    const filtered = gte ? ordered.filter((e) => Date.parse(String(e.date_updated)) >= Date.parse(gte)) : ordered;
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
const idsOf = (rs: CanonicalEvent[]) => rs.map((r) => r.eventId.split(":").pop()!);
const bound = (c: URLSearchParams) => c.get("date_updated__gte");

/**
 * THE CLOCK IS PINNED TO THE FIXTURES' ERA, for the whole file.
 *
 * `makeLog` builds its timeline from a hard-coded `T0`, and the connector bounds
 * every request to the last `FIRST_SYNC_DAYS` — so with a real clock these
 * fixtures age out of the window the code asks for, and the suite starts failing
 * on a DATE, for a reason that has nothing to do with the behaviour under test.
 *
 * Only `Date` is faked. Timers, promises and the fetch stubs are untouched, and
 * nothing here talks to a database.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0 + 5 * 60_000));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The field the endpoint filters on, and the field a record is dated by. They
 * are different fields with different jobs, and every test in this block is
 * about a way that reading one for the other goes wrong.
 */
describe("Close — date_updated bounds the window, date_created dates the row", () => {
  it("bounds every request on date_updated, and never sends date_created__gte", async () => {
    const { calls } = mockEventLog(makeLog(10));
    await closeConnector.poll!(pollArgs(null));

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(bound(c), "a request went out with no window bound at all").not.toBeNull();
      // The old name is not merely unused — it must not be sent, because Close
      // accepts and discards it, which is indistinguishable from it working.
      expect(c.get("date_created__gte"), "the discarded parameter is being sent again").toBeNull();
    }
  });

  /**
   * THE RECORD THAT ONLY THE CORRECT PAIRING FINDS.
   *
   * A lead created 60 days ago and edited a minute ago is inside the window by
   * `date_updated` and far outside it by `date_created`. An incremental sweep has
   * to return it — that edit is the change being synced — and it has to be dated
   * to when the lead was created, not to when somebody tidied it up.
   */
  it("returns a record created outside the window but edited inside it, dated by creation", async () => {
    const edited = consolidated("old1", 60, T0 + 4 * 60_000);
    mockEventLog([edited, ...makeLog(5)]);
    // An incremental sweep: high-water mark two minutes ago, so the window is
    // small and only the recent EDIT can bring this record back.
    const hw = new Date(T0 + 3 * 60_000).toISOString().replace("Z", "+00:00");
    const res = await closeConnector.poll!(pollArgs(hw));

    const got = res.records.find((r) => r.eventId.endsWith("old1"));
    expect(got, "a record edited inside the window was not returned").toBeTruthy();
    // Dated to when the lead was CREATED. Dating it by the edit would move a
    // 60-day-old lead into today and restate every "leads per day" metric
    // whenever somebody touched an old record.
    expect(Math.round((T0 - got!.occurredAt.getTime()) / DAY)).toBe(60);
  });

  /**
   * The watermark must be a frontier of the field being FILTERED.
   *
   * Taken from `date_created`, the mark would be dragged 60 days backwards by
   * the record above — and the next window would re-request two months of
   * changes, every sweep, forever. Taken from `date_updated` it lands on the
   * edit, which is where the next window should start.
   */
  it("advances the high-water mark on date_updated, not on date_created", async () => {
    const edited = consolidated("old1", 60, T0 + 4 * 60_000);
    mockEventLog([edited]);
    const hw = new Date(T0 + 3 * 60_000).toISOString().replace("Z", "+00:00");
    const res = await closeConnector.poll!(pollArgs(hw));

    // Drained → the plain high-water form, and it is the EDIT time.
    expect(res.nextCursor).toBe(new Date(T0 + 4 * 60_000).toISOString().replace("Z", "+00:00"));
  });

  /**
   * The mark going the other way is the one that loses data, so it is pinned
   * separately: a record whose `date_created` is NEWER than its neighbours'
   * `date_updated` must not push the mark past changes not yet read.
   */
  it("never lets a creation date push the mark past an unread change", async () => {
    // Created "now", edited a while back — the reverse skew.
    const skewed = {
      id: "skew",
      object_type: "lead",
      action: "created",
      date_created: new Date(T0 + 5 * 60_000).toISOString().replace("Z", "+00:00"),
      date_updated: new Date(T0 + 1 * 60_000).toISOString().replace("Z", "+00:00"),
    };
    mockEventLog([skewed]);
    const res = await closeConnector.poll!(pollArgs(null));

    const mark = Date.parse(res.nextCursor!);
    expect(mark).toBe(T0 + 1 * 60_000);
    // The failure this prevents: a mark at the CREATION time would sit four
    // minutes ahead of the newest change actually read, and everything edited in
    // that gap would fall below the next window's floor and never be requested
    // again.
    expect(mark, "the mark ran ahead of the newest change read").toBeLessThan(T0 + 5 * 60_000);
  });

  /**
   * MIGRATION, and why there is none.
   *
   * Every cursor stored before this change holds a `date_created` value, and it
   * is now read as a `date_updated` floor. Since a record's creation never
   * post-dates its last edit, such a mark sits at or below the true frontier —
   * so the first sweep after deploy over-reads and `event_id` dedup absorbs it.
   * The direction is what matters: the other way round would skip.
   */
  it("reads a pre-change cursor as a floor that over-reads rather than skips", async () => {
    const log = [consolidated("old1", 60, T0 + 4 * 60_000), ...makeLog(5)];
    const { calls } = mockEventLog(log);
    // What the old code would have stored: the newest date_created it saw. For
    // the consolidated record that is 60 days old.
    const legacy = new Date(T0 - 60 * DAY).toISOString().replace("Z", "+00:00");
    const res = await closeConnector.poll!(pollArgs(legacy));

    expect(Date.parse(bound(calls[0])!)).toBeLessThanOrEqual(Date.parse(legacy));
    // Everything is re-read, nothing is skipped.
    expect(res.records).toHaveLength(6);
  });
});

describe("Close Event Log poll (Defect #2)", () => {
  it("a 200-event burst lands in full within one poll (4 pages walked to the end)", async () => {
    mockEventLog(makeLog(200));
    const res = await closeConnector.poll!(pollArgs(null));
    expect(res.records).toHaveLength(200);
    expect(ids(res.records)).toEqual(Array.from({ length: 200 }, (_, i) => `e${i + 1}`));
    // Drained → plain high-water cursor = the newest date_updated ingested.
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
    expect(second.nextCursor).toBe(new Date(T0 + 260 * 1000).toISOString().replace("Z", "+00:00"));
  });

  it("incremental poll from a plain-date cursor keeps boundary ties via the overlap window", async () => {
    const log = makeLog(80);
    const { calls } = mockEventLog(log);
    const hw = new Date(T0 + 50 * 1000).toISOString().replace("Z", "+00:00"); // e50 already ingested
    const res = await closeConnector.poll!(pollArgs(hw));

    // Requested window starts BELOW the high-water mark (overlap), not above it.
    expect(Date.parse(bound(calls[0])!)).toBeLessThan(Date.parse(hw));
    expect(calls[0].get("_cursor")).toBeNull();

    // Five minutes of cushion — Close's own documented recommendation for not
    // missing recent events during pagination, which here spans the whole
    // fixture. Nothing above the mark is missed, ties are kept, and the
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

  /**
   * The preview is ONE request now.
   *
   * It used to be a six-request search that narrowed and widened a window until
   * it could prove which end of the log it held. Every one of those requests
   * carried the discarded `date_created__gte`, so the window never moved and the
   * search could only spend six calls agreeing with itself.
   *
   * What replaced the proof is a citation: Close documents that events are always
   * ordered latest-first by `date_updated`. That is a claim about the provider
   * rather than something this fixture can establish — see the block at the
   * bottom of this file for what it costs if the claim is ever wrong, and
   * `scripts/verify-close-pagination.ts` for the check that keeps it honest.
   */
  it("previews the newest N in a single request, sorted by when things happened", async () => {
    const { calls } = mockEventLog(makeLog(10));
    const latest = await closeConnector.testFetchLatest!(5, pollArgs(null));
    expect(latest).toHaveLength(5);
    expect(idsOf(latest)).toEqual(["e10", "e9", "e8", "e7", "e6"]);
    expect(calls).toHaveLength(1);
    expect(bound(calls[0])).not.toBeNull();
    expect(calls[0].get("_limit")).toBe("50");
    expect(calls[0].get("_cursor")).toBeNull();
  });

  /**
   * The provider sorts by `date_updated`; a person reading "latest records"
   * means what happened most recently. On a consolidated log those disagree, and
   * the person is right.
   */
  it("sorts the preview by creation, not by the order the provider returned", async () => {
    // Edited most recently, so the provider puts it first — but it happened
    // 60 days ago and must not head a list of "latest records".
    const log = [consolidated("old1", 60, T0 + 4 * 60_000), ...makeLog(3)];
    mockEventLog(log);
    const latest = await closeConnector.testFetchLatest!(4, pollArgs(null));
    expect(idsOf(latest)).toEqual(["e3", "e2", "e1", "old1"]);
  });
});

/**
 * A first sync used to send a bound the provider discards, so "the first window"
 * was the whole retained log every time. Close's own 30-day retention meant that
 * cost reads rather than correctness — but a walk that is unbounded by accident
 * is one nobody can reason about.
 */
describe("Close first-sync bound", () => {
  it("bounds a fresh sync at the retention depth, in one window", async () => {
    const { calls } = mockEventLog(makeLog(10));
    await closeConnector.poll!(pollArgs(null));
    const backOf = (i: number) => Math.round((Date.now() - Date.parse(bound(calls[i])!)) / DAY);
    for (const c of calls) expect(bound(c)).not.toBeNull();
    expect(backOf(0)).toBe(30);
    // ONE window for the whole walk. There used to be a shallower opening
    // request hedging against an unknown sort order; it differed from this one
    // only in the parameter Close discards, so it was the same request twice.
    expect(new Set(calls.map(bound)).size).toBe(1);
  });

  it("spends no request on a hedge, and returns each record once", async () => {
    const { calls } = mockEventLog(makeLog(120));
    const res = await closeConnector.poll!(pollArgs(null));
    const got = idsOf(res.records);
    expect(new Set(got).size).toBe(got.length);
    expect(got).toHaveLength(120);
    // 3 pages at 50 a page, and nothing else.
    expect(calls).toHaveLength(3);
    expect(res.nextCursor!.startsWith("{")).toBe(false);
    expect(res.incomplete).toBeFalsy();
  });

  it("pins that floor for the life of the walk, so depth does not depend on how long it takes", async () => {
    mockEventLog(makeLog(260));
    const first = await closeConnector.poll!(pollArgs(null));
    const { calls } = mockEventLog(makeLog(260));
    await closeConnector.poll!(pollArgs(first.nextCursor));
    // Recomputing `now - 30d` each sweep would creep the boundary forward while
    // the walk pages BACKWARDS — the deeper the account, the shallower it lands.
    expect(JSON.parse(first.nextCursor!).floor).toBe(bound(calls[0]));
  });

  it("drops the floor once the window drains — from then on the high-water mark governs", async () => {
    const OVERLAP_MS = 5 * 60_000; // mirrors close.ts
    mockEventLog(makeLog(200));
    const drained = await closeConnector.poll!(pollArgs(null));
    expect(drained.nextCursor!.startsWith("{")).toBe(false); // plain hw string

    // The next sweep's bound is derived from the MARK, exactly. Pinned as an
    // identity rather than as a day count: a range check passes for a bound
    // computed any number of wrong ways.
    const { calls } = mockEventLog(makeLog(200));
    await closeConnector.poll!(pollArgs(drained.nextCursor));
    expect(Date.parse(bound(calls[0])!)).toBe(Date.parse(drained.nextCursor!) - OVERLAP_MS);
  });

  it("bounds an unbounded walk that was already in flight", async () => {
    // A cursor stored before the floor existed: mid-walk, no hw, no floor.
    const legacy = JSON.stringify({ hw: null, cont: "200", maxSeen: null });
    const { calls } = mockEventLog(makeLog(400));
    await closeConnector.poll!(pollArgs(legacy));
    expect(Math.round((Date.now() - Date.parse(bound(calls[0])!)) / DAY)).toBe(30);
  });

  it("treats an unparseable first-sync floor as a fresh 30-day window", async () => {
    const corrupt = JSON.stringify({ hw: null, cont: null, maxSeen: null, floor: "not a date" });
    const { calls } = mockEventLog(makeLog(10));
    await closeConnector.poll!(pollArgs(corrupt));
    // `Date.parse(x) || 0` would have given 1970 — the unbounded walk this bound
    // exists to prevent, arriving through a bad stored value.
    expect(Math.round((Date.now() - Date.parse(bound(calls[0])!)) / DAY)).toBe(30);
  });

  it("discards an unparseable high-water mark and pins a fresh 30-day floor", async () => {
    const corrupt = JSON.stringify({ hw: "not a date", cont: null, maxSeen: null });
    const { calls } = mockEventLog(makeLog(260));
    const res = await closeConnector.poll!(pollArgs(corrupt));
    expect(Math.round((Date.now() - Date.parse(bound(calls[0])!)) / DAY)).toBe(30);
    // …and it is PINNED, so the depth does not slide on the next sweep.
    expect(JSON.parse(res.nextCursor!).floor).toBe(bound(calls[0]));
  });

  it("says it is mid-import, as the SPAN ingested against the span aimed at", async () => {
    mockEventLog(makeLog(260));
    const first = await closeConnector.poll!(pollArgs(null));
    expect(first.incomplete).toBe(true);
    // 260 events one second apart, 200 ingested → e260 down to e61, a span of
    // 199 seconds. Two spans and not two instants: "the oldest record reached,
    // versus the floor" measures progress only on a latest-first log, and a
    // number that is right by coincidence is one nobody can check.
    expect(first.importProgress!.coveredMs).toBe(199 * 1000);
    expect(Math.round(first.importProgress!.targetMs / DAY)).toBe(30);

    mockEventLog(makeLog(260));
    const second = await closeConnector.poll!(pollArgs(first.nextCursor));
    expect(second.incomplete).toBeUndefined(); // drained
  });
});

/**
 * COVERAGE IS ON THE OTHER AXIS FROM THE CURSOR, and this block is why.
 *
 * "Covering 12 of 30 days" is read as *how much of my history do I have* — a
 * question about when things happened. Measured on `date_updated` the same
 * sentence would mean *how much of the change stream have I walked*, and on a
 * workspace where old records get edited those two answers diverge in both
 * directions with nothing on screen to say which one is being shown.
 */
describe("Close import coverage", () => {
  it("measures coverage on creation dates while the cursor tracks change dates", async () => {
    // Three records edited within one minute of each other — a one-minute span
    // of CHANGES — but created across three weeks.
    const log = [
      consolidated("c3", 1, T0 + 4 * 60_000),
      consolidated("c2", 8, T0 + 3 * 60_000),
      consolidated("c1", 15, T0 + 2 * 60_000),
    ];
    mockEventLog([...log, ...makeLog(260)]); // enough to stay mid-walk
    const res = await closeConnector.poll!(pollArgs(null));

    const stored = JSON.parse(res.nextCursor!);
    // Asserted as orders of magnitude rather than exact spans, because that is
    // the actual claim: these two marks are not two views of one timeline, they
    // are different quantities. Every record here was edited within minutes and
    // created across weeks, so a single number covering both would have to be
    // wrong about one of them.
    //
    // The cursor's mark is a CHANGE time: minutes wide, near now.
    expect(Date.now() - Date.parse(stored.maxSeen)).toBeLessThan(10 * 60_000);
    // The coverage marks are CREATION times: at least two weeks wide.
    expect(Date.parse(stored.covHi) - Date.parse(stored.covLo)).toBeGreaterThanOrEqual(14 * DAY);
    // …and that is what the user-facing number reports.
    expect(res.importProgress!.coveredMs).toBeGreaterThanOrEqual(14 * DAY);
  });

  /**
   * The clamp, and the sentence it stops.
   *
   * Consolidation means a record inside the 30-day CHANGE window can have been
   * created years ago. Measured raw, the creation span exceeds the window being
   * reported against and the tile reads "covering 700 of 30 days". The records
   * are genuine extra history and are kept; they just do not count toward a
   * fraction they would make nonsense of.
   */
  it("never reports covering more of the window than the window holds", async () => {
    const ancient = consolidated("ancient", 700, T0 + 4 * 60_000);
    mockEventLog([ancient, ...makeLog(260)]);
    const res = await closeConnector.poll!(pollArgs(null));

    expect(res.records.find((r) => r.eventId.endsWith("ancient")), "the old record was dropped").toBeTruthy();
    const { coveredMs, targetMs } = res.importProgress!;
    expect(coveredMs).toBeLessThanOrEqual(targetMs);
    expect(Math.round(targetMs / DAY)).toBe(30);
  });

  it("never reports coverage that falls between sweeps", async () => {
    // 600 deep so BOTH sweeps are mid-walk. A drained sweep reports no progress
    // at all — the import is over, and "covering 30 of 30" on the last page is a
    // number nobody needs — so comparing against one would be comparing against
    // nothing and would pass however the marks behaved.
    mockEventLog(makeLog(600));
    const first = await closeConnector.poll!(pollArgs(null));
    const firstCovered = first.importProgress!.coveredMs;
    expect(firstCovered).toBeGreaterThan(0);

    mockEventLog(makeLog(600));
    const second = await closeConnector.poll!(pollArgs(first.nextCursor));
    expect(second.incomplete, "the second sweep drained, so this proves nothing").toBe(true);
    // The marks persist in the cursor and only ever widen, so a later sweep
    // cannot show progress and then take it away — an import reading as if it
    // went backwards.
    expect(second.importProgress!.coveredMs).toBeGreaterThanOrEqual(firstCovered);
  });
});

/**
 * THE OTHER ORDERING — what still holds if the documented sort is ever wrong.
 *
 * Close documents latest-first by `date_updated`, and after dropping the peek
 * the PREVIEW now depends on that being true: it takes page 1 and sorts what it
 * gets. If the provider ever reversed, the preview would show the oldest
 * records in the window. That is a deliberate trade — the machinery that used to
 * prove it was spending six requests to narrow a window with a parameter the
 * provider discards, so it proved nothing — and what replaced it is the live
 * control check in `scripts/verify-close-pagination.ts`, which compares a bounded
 * request against an unbounded one rather than trusting either the docs or us.
 *
 * THE DATA is a different matter, and none of it depends on ordering. The walk
 * ingests every record on every page and stops only on cursor exhaustion, and
 * progress is measured as a SPAN of what landed rather than as a distance from a
 * floor. Both are pinned here against a reversed log, because a fixture that
 * satisfies an assumption cannot test it.
 */
describe("Close if the Event Log ran oldest-first", () => {
  const HOUR = 3_600_000;

  /** `total` events spread evenly over the last `spanDays`, OLDEST first. */
  function spreadLog(total: number, spanDays: number): Ev[] {
    const end = Date.now() - HOUR;
    const step = (spanDays * DAY) / total;
    return Array.from({ length: total }, (_, i) => {
      const at = new Date(end - (total - 1 - i) * step).toISOString();
      return { id: `s${i + 1}`, object_type: "activity.sms", action: "created", date_created: at, date_updated: at };
    });
  }

  it("still ingests every event in the window — a drained walk is complete either way", async () => {
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
    expect(covered).toBeLessThan(target / 2);
  });

  it("keeps the high-water mark below the newest record it has not reached", async () => {
    mockEventLog(spreadLog(600, 30));
    const res = await closeConnector.poll!(pollArgs(null));
    const stored = JSON.parse(res.nextCursor!);
    // Mid-walk: the mark must sit at the newest CHANGE actually ingested (the
    // oldest fifth of the log, on this ordering), nowhere near now. A mark that
    // ran ahead is Defect #2 arriving through the cursor.
    expect(Date.now() - Date.parse(stored.maxSeen)).toBeGreaterThan(15 * DAY);
  });
});
