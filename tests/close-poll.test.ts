import { describe, it, expect, vi, afterEach } from "vitest";
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
 * Mock the Event Log endpoint: newest-first pages of `_limit`, filtered by
 * date_created__gte, paginated via an opaque `_cursor` = the next page offset.
 */
function mockEventLog(newestFirst: Array<Record<string, unknown>>) {
  const calls: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    calls.push(params);
    const limit = Number(params.get("_limit") ?? "50");
    const gte = params.get("date_created__gte");
    const filtered = gte ? newestFirst.filter((e) => Date.parse(String(e.date_created)) >= Date.parse(gte)) : newestFirst;
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

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(latest[0].eventId).toBe("close:c1:e10"); // newest first
    expect(calls[0].get("_limit")).toBe("5");
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

  it("bounds a fresh sync to 30 days instead of the whole event log", async () => {
    const { calls } = mockEventLog(makeLog(10));
    await closeConnector.poll!(pollArgs(null));
    const gte = calls[0].get("date_created__gte");
    expect(gte).not.toBeNull();
    const back = Math.round((Date.now() - Date.parse(gte!)) / DAY);
    expect(back).toBe(30);
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
    mockEventLog(makeLog(200));
    const drained = await closeConnector.poll!(pollArgs(null));
    expect(drained.nextCursor!.startsWith("{")).toBe(false); // plain hw string
    // …and the next sweep's bound is hw - overlap, not the 30-day floor.
    const { calls } = mockEventLog(makeLog(200));
    await closeConnector.poll!(pollArgs(drained.nextCursor));
    const back = Math.round((Date.now() - Date.parse(calls[0].get("date_created__gte")!)) / DAY);
    expect(back).toBeGreaterThan(20); // the fixture's hw is ~26 days old, not 30
    expect(back).toBeLessThan(30);
  });

  it("bounds an unbounded walk that was already in flight", async () => {
    // A cursor stored before the floor existed: mid-walk, no hw, no floor.
    const legacy = JSON.stringify({ hw: null, cont: "200", maxSeen: null });
    const { calls } = mockEventLog(makeLog(400));
    await closeConnector.poll!(pollArgs(legacy));
    const back = Math.round((Date.now() - Date.parse(calls[0].get("date_created__gte")!)) / DAY);
    expect(back).toBe(30); // that walk had no end; it has one now
  });

  it("says it is mid-import, and how far back it has reached", async () => {
    mockEventLog(makeLog(260));
    const first = await closeConnector.poll!(pollArgs(null));
    expect(first.incomplete).toBe(true);
    // `covered.from` is the OLDEST record ingested so far, not the window floor —
    // that difference is what "covering 12 of 30 days" is measuring.
    // 260 events newest-first, 200 ingested → e260 down to e61.
    expect(first.covered!.from.toISOString()).toBe(new Date(T0 + 61 * 1000).toISOString());

    const { } = mockEventLog(makeLog(260));
    const second = await closeConnector.poll!(pollArgs(first.nextCursor));
    expect(second.incomplete).toBeUndefined(); // drained
  });
});
