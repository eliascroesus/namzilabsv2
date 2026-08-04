import { describe, it, expect, vi, afterEach } from "vitest";
import { calendlyConnector } from "@/connectors/calendly";
import { googleSheetsConnector } from "@/connectors/google-sheets";
import { isStreamScoped, catalogEntry } from "@/connectors/catalog";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

/** Route mocked fetch by URL substring. */
function mockFetch(routes: Array<[string, unknown]>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [needle, data] of routes) {
      if (url.includes(needle)) return jsonResponse(data);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Calendly polling", () => {
  it("lists scheduled events and maps them to canonical booked events", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        ["/users/me", { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } }],
        [
          "/scheduled_events",
          {
            collection: [
              { uri: "https://api.calendly.com/scheduled_events/EVT1", name: "Demo call", start_time: "2026-02-01T10:00:00Z" },
              { uri: "https://api.calendly.com/scheduled_events/EVT2", name: "Intro", start_time: "2026-01-30T09:00:00Z" },
            ],
          },
        ],
      ]),
    );

    const events = await calendlyConnector.testFetchLatest!(2, {
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "tok" },
    });

    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe("booked");
    expect(events[0].eventId).toBe("calendly:c1:https://api.calendly.com/scheduled_events/EVT1");
    expect(events[0].occurredAt.toISOString()).toBe("2026-02-01T10:00:00.000Z");
  });

  /** Capture the /scheduled_events request URL for a given scope config. */
  async function pollWith(config: Record<string, unknown> | undefined): Promise<string> {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/users/me"))
          return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "https://api.calendly.com/organizations/O1" } });
        if (url.includes("/scheduled_events")) return jsonResponse({ collection: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    await calendlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { accessToken: "tok" }, config });
    return calls.find((u) => u.includes("/scheduled_events"))!;
  }

  it("defaults to the user's own meetings", async () => {
    const url = await pollWith(undefined);
    expect(url).toContain("user=");
    expect(url).not.toContain("organization=");
  });

  it("fetches organization meetings when scope=organization", async () => {
    const url = await pollWith({ scope: "organization" });
    expect(url).toContain("organization=");
    expect(url).not.toContain("user=");
  });

  it("fetches group meetings when scope=group with a group URI", async () => {
    const url = await pollWith({ scope: "group", groupUri: "https://api.calendly.com/groups/G1" });
    expect(url).toContain("group=");
    expect(url).toContain("organization=");
  });
});

/** A cursor over the connector's own 30-back/90-forward window, plus overrides. */
const window = (over: Record<string, unknown>) =>
  JSON.stringify({
    floor: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    ceil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    pivot: new Date().toISOString(),
    ...over,
  });

/**
 * RESUME BY DATE BOUND — NOTHING PERISHABLE CROSSES A SWEEP.
 *
 * Two continuation generations died here. The rebuilt `page_token` was rejected
 * in every form (CL10/CL12). Its replacement, Calendly's own `next_page` URL,
 * was accepted — and CL13 then measured it surviving 600s and being refused at
 * 1200s, against a sweep gap of 600-1200s. The brackets intersect: some sweeps
 * restarted at page 1 silently, because the restart succeeds. No continuation
 * lifetime fixes that, so the cursor now stores DATE WATERMARKS — the boundary
 * `start_time` of ground actually ingested — and every request is a fresh
 * first-page request bounded by the mark. A date cannot expire.
 *
 * CL15 measured both `min_start_time` and `max_start_time` as INCLUSIVE, so
 * the bound is the exact mark: the tie group AT the mark is re-read on resume
 * and `event_id` dedup absorbs it. The residual risk is a tie group larger
 * than one page pinning the mark inside a single second — counted by the
 * repurposed `restarts` alarm below.
 */
describe("Calendly: the scan resumes by narrowing the bound, and the union is complete", () => {
  const T = (iso: string) => Date.parse(iso);
  const EV = (id: string, start: string) => ({
    uri: `https://api.calendly.com/scheduled_events/${id}`,
    name: "Demo",
    start_time: start,
  });

  /**
   * A provider serving a PAST side deeper than one page: meetings at 10:00,
   * 09:00, 08:00... served strictly by the request's own bounds, the way the
   * live API does (CL5: both bounds bound; CL15: inclusively). `next_page` is
   * offered whenever more remain below the requested window — but as a lure:
   * following or storing it is the bug, so the URL 400s if ever requested.
   */
  const MEETINGS = [
    EV("E1", "2026-07-30T10:00:00Z"),
    EV("E2", "2026-07-29T10:00:00Z"),
    EV("E3", "2026-07-28T10:00:00Z"),
    EV("E4", "2026-07-27T10:00:00Z"),
  ];
  const boundedProvider = (pageSize: number, meetings = MEETINGS) =>
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users/me")) {
        return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
      }
      if (url.searchParams.has("page_token")) throw new Error("HTTP 400: a continuation was followed or stored");
      const min = T(url.searchParams.get("min_start_time")!);
      const max = T(url.searchParams.get("max_start_time")!);
      const asc = url.searchParams.get("sort") === "start_time:asc";
      const inWindow = meetings
        .filter((m) => T(m.start_time) >= min && T(m.start_time) <= max) // inclusive both ends (CL15)
        .sort((a, b) => (asc ? T(a.start_time) - T(b.start_time) : T(b.start_time) - T(a.start_time)));
      const page = inWindow.slice(0, pageSize);
      return jsonResponse({
        collection: page,
        pagination: { next_page: inWindow.length > page.length ? "https://api.calendly.com/scheduled_events?page_token=LURE" : null },
      });
    });

  const poll = (cursor: string | null) =>
    calendlyConnector.poll!({ connectionId: "c1", cursor, credentials: { accessToken: "tok" } });

  it("walks a burst deeper than the page budget across polls, with a complete union", async () => {
    const fetchMock = boundedProvider(2);
    vi.stubGlobal("fetch", fetchMock);

    const seen = new Set<string>();
    let cursor: string | null = null;
    // past page (E1,E2) → future (empty, drains) → past page (E3,E4) → past drains
    for (let i = 0; i < 4 && (i === 0 || cursor); i++) {
      const res = await poll(cursor);
      for (const r of res.records) seen.add(r.eventId.split("/").pop()!);
      cursor = res.nextCursor;
    }

    // Every meeting arrived exactly through narrowed bounds — no continuation
    // was ever requested (the provider throws on one) or stored.
    expect([...seen].sort()).toEqual(["E1", "E2", "E3", "E4"]);
    expect(cursor).toBeNull();
    for (const call of fetchMock.mock.calls) expect(String(call[0])).not.toContain("page_token");
  });

  it("banks a date watermark, not a URL, and narrows the next request to it", async () => {
    const fetchMock = boundedProvider(2);
    vi.stubGlobal("fetch", fetchMock);

    const first = await poll(null);
    const banked = JSON.parse(first.nextCursor!).past;
    // The lowest start_time ingested — a date, which cannot expire.
    expect(banked).toBe("2026-07-29T10:00:00.000Z");

    // Drive the past side again; its request must be bounded at the mark.
    const again = JSON.stringify({ ...JSON.parse(first.nextCursor!), next: "past" });
    await poll(again);
    const pastCalls = fetchMock.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.searchParams.get("sort") === "start_time:desc");
    expect(pastCalls[1].searchParams.get("max_start_time")).toBe(banked);
  });

  /**
   * The tie group at the boundary is RE-READ, never skipped. The bound is the
   * exact mark and CL15 measured it inclusive, so a resume's page includes the
   * meetings AT the mark again; dedup absorbs them. Skipping would need an
   * exclusive bound — under which a tie group spanning the page edge would be
   * lost forever, silently.
   */
  it("re-reads the boundary tie group on resume rather than skipping it", async () => {
    const tied = [
      EV("A1", "2026-07-30T10:00:00Z"),
      EV("A2", "2026-07-29T10:00:00Z"),
      EV("A3", "2026-07-29T10:00:00Z"), // shares the boundary second with A2
      EV("A4", "2026-07-28T10:00:00Z"),
    ];
    // Page size 3: the tie group (2) is SMALLER than the page, so the resume
    // page reaches past it and the mark advances. A tie group >= the page is
    // the residual risk, pinned by the alarm test below, not by this one.
    const fetchMock = boundedProvider(3, tied);
    vi.stubGlobal("fetch", fetchMock);

    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 6 && (i === 0 || cursor); i++) {
      const res = await poll(cursor);
      for (const r of res.records) seen.add(r.eventId.split("/").pop()!);
      cursor = res.nextCursor;
    }
    // A2/A3 share the boundary second after page 1 (A1, A2, A3). The inclusive
    // resume re-reads them and still reaches A4; an exclusive bound would have
    // skipped whichever tie member fell past the page edge.
    expect([...seen].sort()).toEqual(["A1", "A2", "A3", "A4"]);
  });

  /**
   * The tie group SPLIT ACROSS THE PAGE EDGE — the case that separates the two
   * bound semantics for real. Page 1 ends at A2; A3 shares A2's exact second
   * and sits on the next page. An INCLUSIVE resume re-reads the boundary and
   * either reaches A3 or pins loudly (the alarm). An EXCLUSIVE resume skips
   * past the second entirely: the scan completes, the union is silently short
   * one meeting, and nothing anywhere says so. Silent loss is the one outcome
   * this design must never produce, so the assertion is: the scan may finish
   * only if A3 was seen.
   */
  it("never completes silently past a tie member split across the page edge", async () => {
    const split = [
      EV("A1", "2026-07-30T10:00:00Z"),
      EV("A2", "2026-07-29T10:00:00Z"),
      EV("A3", "2026-07-29T10:00:00Z"), // beyond page 1, sharing A2's second
      EV("A4", "2026-07-28T10:00:00Z"),
    ];
    vi.stubGlobal("fetch", boundedProvider(2, split));

    const seen = new Set<string>();
    let cursor: string | null = null;
    let finished = false;
    for (let i = 0; i < 8; i++) {
      const res = await poll(cursor);
      for (const r of res.records) seen.add(r.eventId.split("/").pop()!);
      cursor = res.nextCursor;
      if (cursor == null) {
        finished = true;
        break;
      }
    }
    if (finished) expect([...seen]).toContain("A3");
    // With a page-sized tie the inclusive bound pins instead — loudly.
    if (!finished) expect(JSON.parse(cursor!).restarts).toBeGreaterThanOrEqual(1);
  });

  /**
   * The repurposed alarm: a side that ingests a page, is offered more, and
   * cannot move its mark is pinned — the tie-group-larger-than-a-page case.
   * Two polls of that in a row is not a coincidence, and `incomplete` keeps
   * the connection at base cadence while it lasts.
   */
  it("counts polls that cannot advance the mark, and reports the side incomplete", async () => {
    // Every meeting ON EACH SIDE shares one start second and there is always
    // another page — the tie-group-bigger-than-the-page shape. Served per side
    // (past ties in the past, future ties in the future), because the live API
    // honours the window bounds and a future request cannot return July.
    const pastTie = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const futureTie = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const pinned = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users/me")) {
        return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
      }
      const tie = url.searchParams.get("sort") === "start_time:desc" ? pastTie : futureTie;
      return jsonResponse({
        collection: [EV("T1", tie), EV("T2", tie)],
        pagination: { next_page: "https://api.calendly.com/scheduled_events?page_token=MORE" },
      });
    });
    vi.stubGlobal("fetch", pinned);

    const sweeps: Array<{ restarts?: number; incomplete?: boolean }> = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const res = await poll(cursor);
      cursor = res.nextCursor;
      sweeps.push({ restarts: JSON.parse(cursor!).restarts, incomplete: res.incomplete });
    }

    // Poll 1 (past): first page, mark moves from pivot to the tie second — progress.
    expect(sweeps[0].restarts).toBeUndefined();
    // Poll 2 (future): same, on its own side.
    expect(sweeps[1].restarts).toBeUndefined();
    // Poll 3 (past again): bounded at the mark, same page back, mark cannot move.
    expect(sweeps[2].restarts).toBe(1);
    expect(sweeps[2].incomplete).toBeFalsy(); // one pin could still be coincidence
    // Poll 4: pinned again. Two in a row is a stuck side, and it says so.
    expect(sweeps[3].restarts).toBe(2);
    expect(sweeps[3].incomplete, "a side re-reading the same tie group reported itself as fine").toBe(true);
  });

  it("clears the count as soon as the mark moves or the side drains", async () => {
    vi.stubGlobal("fetch", boundedProvider(2));
    const stuck = JSON.stringify({
      floor: "2026-07-01T00:00:00.000Z",
      ceil: "2026-10-01T00:00:00.000Z",
      pivot: "2026-08-01T00:00:00.000Z",
      past: "2026-07-31T00:00:00.000Z",
      next: "past",
      restarts: 5,
    });
    const res = await poll(stuck);
    // The page under the mark advanced it — a run of pins that ended is not
    // worth carrying forward.
    expect(JSON.parse(res.nextCursor!).restarts).toBeUndefined();
    expect(res.incomplete).toBeFalsy();
  });

  it("drains both sides and then starts over, which is what nextCursor: null means", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        return jsonResponse({ collection: [EV("E1", "2026-07-30T10:00:00Z")], pagination: { next_page: null } });
      }),
    );
    const first = await poll(null); // past drains
    expect(first.nextCursor).not.toBeNull();
    const second = await poll(first.nextCursor); // future drains → both done
    expect(second.nextCursor, "both sides drained must re-open the window, not carry on").toBeNull();
  });
});

/**
 * MIGRATING THE CURSORS THAT ARE ALREADY OUT THERE.
 *
 * Every live Calendly stream stores a continuation — a `next_page` URL, or a
 * `page_token` from the generation before. Both are dead weight now: a URL may
 * be expired (CL13) and neither says what was INGESTED, so no mark can be
 * derived from them. The cursor is discarded whole and the window re-opened,
 * for the same reason as the last migration: `done` never fired while
 * continuations were failing, so the stored window may be frozen at whenever
 * the scan first started.
 */
describe("Calendly: a cursor from the continuation era", () => {
  const firstPageOnly = () =>
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/users/me")) {
        return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
      }
      if (url.includes("page_token=")) throw new Error("HTTP 400: page_token is invalid");
      return jsonResponse({
        collection: [{ uri: "https://api.calendly.com/scheduled_events/E1", name: "Demo", start_time: "2026-02-01T10:00:00Z" }],
        pagination: { next_page: null },
      });
    });

  const poll = (cursor: string | null) =>
    calendlyConnector.poll!({ connectionId: "c1", cursor, credentials: { accessToken: "tok" } });

  it("discards a stored next_page URL without requesting it", async () => {
    const fetchMock = firstPageOnly();
    vi.stubGlobal("fetch", fetchMock);

    await poll(window({ past: "https://api.calendly.com/scheduled_events?page_token=P2", next: "past", restarts: 5 }));

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("page_token=P2"))).toBe(false);
  });

  it("discards a page_token cursor the same way", async () => {
    const fetchMock = firstPageOnly();
    vi.stubGlobal("fetch", fetchMock);
    await poll(window({ past: "TOK-OLD", next: "past" }));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("TOK-OLD"))).toBe(false);
  });

  it("re-opens the window at now rather than keeping the frozen one", async () => {
    vi.stubGlobal("fetch", firstPageOnly());
    const stale = new Date(Date.now() - 200 * 86_400_000).toISOString();

    const res = await poll(
      JSON.stringify({ floor: stale, ceil: stale, pivot: stale, past: "https://api.calendly.com/x?page_token=P", next: "past" }),
    );

    const after = JSON.parse(res.nextCursor!);
    expect(after.pivot).not.toBe(stale);
    expect(Date.parse(after.ceil)).toBeGreaterThan(Date.now());
  });

  it("leaves a not-started side, a drained side and a date mark alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        return jsonResponse({
          collection: [{ uri: "https://api.calendly.com/scheduled_events/E1", name: "Demo", start_time: "2026-02-01T10:00:00Z" }],
          pagination: { next_page: "https://api.calendly.com/scheduled_events?page_token=NEXT" },
        });
      }),
    );

    // `undefined` (never ran), `null` (drained) and a parseable date (the new
    // shape) are all valid. If any were mistaken for the old shape, every
    // healthy cursor in the fleet would be discarded on the first sweep.
    const pinned = window({ past: null, future: "2026-08-01T00:00:00.000Z", next: "future" });
    const kept = JSON.parse((await poll(pinned))!.nextCursor!);
    expect(kept.past, "a drained side was thrown away as if it held a stale token").toBeNull();
    expect(kept.pivot, "a healthy cursor had its window re-opened").toBe(JSON.parse(pinned).pivot);
  });
});

describe("Calendly is stream-scoped (scope config lives on the flow node)", () => {
  it("is stream-scoped, and scope is a per-flow field, not a connect-time one", () => {
    expect(isStreamScoped("calendly")).toBe(true);
    const entry = catalogEntry("calendly")!;
    // Scope, group and status change the REQUEST; meeting type cannot (no
    // event_type parameter) and is labelled storage-only in its hint.
    expect(entry.flowFields?.map((f) => f.key)).toEqual(["scope", "groupUri", "status", "meetingType"]);
    expect((entry as { configFields?: unknown }).configFields).toBeUndefined();
    // Poll-based reconciliation, no connect-time webhook.
    expect(entry.autoWebhook).toBe(false);
  });

  it("tags event ids with the stream hash so overlapping scopes stay distinct", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        ["/users/me", { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } }],
        ["/scheduled_events", { collection: [{ uri: "https://api.calendly.com/scheduled_events/EVT1", name: "Demo", start_time: "2026-02-01T10:00:00Z" }] }],
      ]),
    );
    const rows = await calendlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { accessToken: "tok" }, config: { scope: "organization" }, streamHash: "abc123" });
    expect(rows.records[0].eventId).toBe("calendly:c1:abc123:https://api.calendly.com/scheduled_events/EVT1");
  });

  it("emits booked + canceled, dates both by meeting time, and alternates sides until both drain", async () => {
    const pastAt = new Date(Date.now() - 3 * 86_400_000);
    const futureAt = new Date(Date.now() + 3 * 86_400_000);
    const meeting = (id: string, at: Date, extra: Record<string, unknown> = {}) => ({
      uri: `https://api.calendly.com/scheduled_events/${id}`,
      name: id,
      status: "active",
      start_time: at.toISOString(),
      created_at: "2026-02-01T08:00:00Z",
      ...extra,
    });
    /**
     * Two meetings per side. Page size is COUNT_PER_PAGE (100), so each side
     * would drain in one page — the mock offers a `next_page` on the first
     * request of each side anyway, forcing a SECOND bounded request per side,
     * which is what lets this test see the alternation and the narrowed bound
     * rather than a single-shot drain.
     */
    const sides: string[] = [];
    const served = new Set<string>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/me")) return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        const side = url.searchParams.get("sort") === "start_time:desc" ? "past" : "future";
        sides.push(side);
        const first = !served.has(side);
        served.add(side);
        const rows =
          side === "past"
            ? [
                meeting("EVTa", pastAt),
                meeting("EVTc", pastAt, { status: "canceled", updated_at: "2026-02-15T09:00:00Z" }),
              ]
            : [meeting("EVTf", futureAt)];
        return jsonResponse({
          collection: rows,
          pagination: { next_page: first ? "https://api.calendly.com/scheduled_events?page_token=MORE" : null },
        });
      }),
    );
    const base = { connectionId: "c1", credentials: { accessToken: "t" }, config: { scope: "user" }, streamHash: "h" };

    const first = await calendlyConnector.poll!({ ...base, cursor: null });
    // Active → 1 booked; canceled → booked + canceled = 3 records.
    expect(first.records.map((r) => r.eventType).sort()).toEqual(["booked", "booked", "canceled"]);
    // Dated by WHEN THE MEETING IS — the same axis Calendly's window filters on,
    // and the axis the retire depends on. Booking time lives in `booked_at`.
    const booked = first.records.find((r) => r.eventId.endsWith("EVTa"))!;
    expect(booked.occurredAt.toISOString()).toBe(pastAt.toISOString());
    expect((booked.properties as Record<string, unknown>).booked_at).toBe("2026-02-01T08:00:00Z");
    const canceled = first.records.find((r) => r.eventType === "canceled")!;
    expect(canceled.eventId).toContain(":canceled:");
    // The cancellation sits in the slot it freed, so both rows fall inside the
    // window that fetched them — otherwise the retire would tombstone one.
    expect(canceled.occurredAt.toISOString()).toBe(pastAt.toISOString());
    expect((canceled.properties as Record<string, unknown>).canceled_at).toBe("2026-02-15T09:00:00Z");
    // More pages → the cursor banks a DATE WATERMARK, never a URL.
    expect(JSON.parse(first.nextCursor!).past).toBe(pastAt.toISOString());

    // Walk it out. Each call takes one page from whichever side is due, and the
    // cursor only clears once BOTH have run out — a scan that stopped when the
    // first side finished would leave the other half of the window unread.
    let cursor = first.nextCursor;
    for (let i = 0; i < 3 && cursor; i++) {
      const next = await calendlyConnector.poll!({ ...base, cursor });
      cursor = next.nextCursor;
    }
    expect(cursor).toBeNull();
    // Recent past first (the question a preview answers), then upcoming, then
    // back again — never four pages of one end of the window.
    expect(sides).toEqual(["past", "future", "past", "future"]);
  });

  it("listOptions('groupUri') lists the token's Calendly groups", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        ["/users/me", { resource: { current_organization: "https://api.calendly.com/organizations/O1" } }],
        ["/groups", { collection: [{ uri: "https://api.calendly.com/groups/G1", name: "Sales" }, { uri: "https://api.calendly.com/groups/G2", name: "Success" }] }],
      ]),
    );
    const opts = await calendlyConnector.listOptions!("groupUri", { connectionId: "c1", credentials: { accessToken: "tok" } });
    expect(opts).toEqual([
      { value: "https://api.calendly.com/groups/G1", label: "Sales" },
      { value: "https://api.calendly.com/groups/G2", label: "Success" },
    ]);
  });
});

describe("Google Sheets polling", () => {
  it("reads rows and maps header+cells into row_added events", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        [
          "/values/",
          {
            values: [
              ["name", "email"],
              ["Alice", "alice@acme.com"],
              ["Bob", "bob@acme.com"],
            ],
          },
        ],
      ]),
    );

    const result = await googleSheetsConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "tok" },
      config: { spreadsheetId: "SHEET1", range: "Sheet1" },
    });

    expect(result.records).toHaveLength(2);
    // The cursor carries a change-detection marker now, not a row count. Drive
    // is not served by this mock, so no marker is produced and the next poll
    // reads unconditionally — the old behaviour, degraded to safely.
    expect(result.nextCursor).toBeNull();
    expect(result.records[0].eventType).toBe("row_added");
    expect(result.records[0].eventId).toBe("gsheets:c1:row:2");
    expect(result.records[0].subject).toBe("alice@acme.com");
    expect(result.records[0].properties).toEqual({ name: "Alice", email: "alice@acme.com" });
  });

  it("mirror semantics: every poll re-reads the whole tab regardless of cursor", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        [
          "/values/",
          { values: [["name"], ["Alice"], ["Bob"]] },
        ],
      ]),
    );
    const second = await googleSheetsConnector.poll!({
      connectionId: "c1",
      cursor: "2", // a legacy row-count cursor from before the marker existed
      credentials: { accessToken: "tok" },
      config: { spreadsheetId: "SHEET1" },
    });
    // The full current sheet comes back; the WRITER dedups/refreshes in place.
    // An unrecognised cursor is not a marker, so nothing is skipped.
    expect(second.records).toHaveLength(2);
    expect(second.unchanged).toBeFalsy();
  });

  it("skips fully blank rows (a cleared row mirrors as deleted, not as empty data)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        [
          "/values/",
          { values: [["name", "email"], ["Alice", "a@b.com"], ["", "  "], ["Cara", "c@d.com"]] },
        ],
      ]),
    );
    const res = await googleSheetsConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "tok" },
      config: { spreadsheetId: "SHEET1" },
    });
    // Row 3 (blank) produces nothing; row numbers of later rows are unshifted.
    expect(res.records.map((r) => r.eventId)).toEqual(["gsheets:c1:row:2", "gsheets:c1:row:4"]);
  });
});

/**
 * `/scheduled_events` accepts organization | user | group, a start-time window,
 * status, invitee_email, sort, count and page_token. There is no event_type
 * parameter — so meeting type could never reduce what we PULL, only what we
 * kept, while splitting one account into a stream per type. These pin what is
 * left: the settings that change the request, and nothing else.
 */
describe("Calendly asks Calendly only for what Calendly can narrow", () => {
  const ME = ["/users/me", { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } }] as [string, unknown];

  const meeting = (uri: string, name: string, host = "idris@namzi.com") => ({
    uri,
    name,
    status: "active",
    event_type: `${uri}-type`,
    start_time: "2026-07-20T10:00:00Z",
    created_at: "2026-07-01T10:00:00Z",
    event_memberships: [{ user: "https://api.calendly.com/users/U9", user_email: host, user_name: "Idris Bulduk" }],
  });

  async function pollUrl(config: Record<string, unknown>, cursor: string | null = null): Promise<string> {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) return jsonResponse(ME[1]);
        seen = url;
        return jsonResponse({ collection: [], pagination: { next_page: null } });
      }),
    );
    await calendlyConnector.poll!({ connectionId: `c-${Math.random()}`, cursor, credentials: { accessToken: "t" }, config });
    return seen;
  }

  it("declares a budget for every endpoint it can call", () => {
    const entry = catalogEntry("calendly")!;
    for (const op of calendlyConnector.operations ?? []) {
      expect(entry.rateLimits?.[op]?.requestsPerMinute).toBe(60);
    }
    expect(calendlyConnector.operationFor!({ scope: "organization" })).toBe("scheduled_events.list");
  });

  /**
   * The first page of a fresh scan is the MOST RECENT past meetings — bounded
   * below by the 30-day floor and above by now.
   *
   * This ran `start_time:asc` from the floor, so the first pages were the oldest
   * meetings in the window. On a busy account a 4-page Test returned 400
   * meetings from a month ago and nothing else: "Latest 3 records" showed
   * appointments two weeks stale, and every upcoming meeting was missing.
   */
  it("starts at now and walks backwards, over a 30-day floor", async () => {
    const url = new URL(await pollUrl({ scope: "user" }));
    expect(url.searchParams.get("sort")).toBe("start_time:desc");
    const back = Math.round((Date.now() - Date.parse(url.searchParams.get("min_start_time")!)) / 86_400_000);
    const toNow = Math.round((Date.parse(url.searchParams.get("max_start_time")!) - Date.now()) / 86_400_000);
    expect(back).toBe(30);
    expect(Math.abs(toNow)).toBe(0); // the pivot is now, not the far end of the window
  });

  /** The other side of the same window: upcoming meetings, soonest first. */
  it("takes the upcoming side next, soonest first, out to 90 days", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) return jsonResponse(ME[1]);
        urls.push(url);
        return jsonResponse({ collection: [], pagination: { next_page: "https://api.calendly.com/scheduled_events?page_token=MORE" } });
      }),
    );
    const base = { connectionId: "c-sides", credentials: { accessToken: "t" }, config: { scope: "user" } };
    const first = await calendlyConnector.poll!({ ...base, cursor: null });
    await calendlyConnector.poll!({ ...base, cursor: first.nextCursor });

    const url = new URL(urls[1]);
    expect(url.searchParams.get("sort")).toBe("start_time:asc");
    const from = Math.round((Date.parse(url.searchParams.get("min_start_time")!) - Date.now()) / 86_400_000);
    const fwd = Math.round((Date.parse(url.searchParams.get("max_start_time")!) - Date.now()) / 86_400_000);
    expect(Math.abs(from)).toBe(0); // the pivot: the two sides meet at now
    expect(fwd).toBe(90); // a year forward was a scan a busy org never finished
  });

  it("sends status only when the flow narrowed it — omitted, cancellations stay visible", async () => {
    expect(new URL(await pollUrl({ scope: "user" })).searchParams.get("status")).toBeNull();
    expect(new URL(await pollUrl({ scope: "user", status: "active" })).searchParams.get("status")).toBe("active");
  });

  /**
   * Scope and status change the REQUEST, so they cut API usage and their hints
   * say so. Meeting type cannot — there is no event_type parameter — so it is
   * declared a `readFilter` instead: not part of the stream identity, applied by
   * the engine over a sync every flow on the connection shares.
   *
   * The declaration is the contract. While it was an ordinary key it silently
   * entered `streamConfigHash`, so picking a type pointed the step at a stream
   * with no rows in it and the Test read 0.
   */
  it("declares meeting type as a read filter, and the request-shaping settings as such", () => {
    const fields = catalogEntry("calendly")!.flowFields ?? [];
    const field = (k: string) => fields.find((f) => f.key === k)!;
    expect(field("scope").hint).toMatch(/Fewer API calls/i);
    expect(field("status").hint).toMatch(/Fewer API calls/i);
    // Scope and status shape the request, so they MUST stay stream identity.
    expect(field("scope").readFilter).toBeUndefined();
    expect(field("status").readFilter).toBeUndefined();
    expect(field("groupUri").readFilter).toBeUndefined();
    // Both paths, so a config saved when the value was the type's NAME still
    // matches — a URI never equals a name, so the OR needs no disambiguation.
    expect(field("meetingType").readFilter?.paths).toEqual(["properties.event_type", "properties.meeting_type"]);
  });

  /**
   * The poll keeps EVERY meeting type, whatever the step picked.
   *
   * Narrowing here saved nothing — `/scheduled_events` has no event_type
   * parameter, so the same pages are fetched either way — and cost a stream, a
   * cursor and a duplicate row per type. A freshly-picked type therefore started
   * a scan from zero and read 0 until it caught up, which is how this was
   * reported. Meeting type is a `readFilter` now; `tests/flow-engine.test.ts`
   * covers the narrowing itself.
   */
  it("stores every meeting type, so one shared sync serves every flow on the connection", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        ME,
        [
          "/scheduled_events",
          {
            collection: [
              { ...meeting("E1", "NAMZI Invite Only Creator Program"), event_type: "https://api.calendly.com/event_types/AAA" },
              { ...meeting("E2", "NAMZI Invite Only Creator Program"), event_type: "https://api.calendly.com/event_types/BBB" },
              { ...meeting("E3", "Call with Tristan - Personal Calendar"), event_type: "https://api.calendly.com/event_types/CCC" },
            ],
            pagination: {},
          },
        ],
      ]),
    );
    const { records } = await calendlyConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "t" },
      config: { scope: "organization", meetingType: "https://api.calendly.com/event_types/BBB" },
    });
    expect(records).toHaveLength(3);
    // …and every record carries what the read filter matches on, both ways.
    const props = records.map((r) => r.properties as Record<string, unknown>);
    expect(props.map((p) => p.event_type)).toEqual([
      "https://api.calendly.com/event_types/AAA",
      "https://api.calendly.com/event_types/BBB",
      "https://api.calendly.com/event_types/CCC",
    ]);
    expect(props[0].meeting_type).toBe("NAMZI Invite Only Creator Program");
  });

  /**
   * THE bug behind "it is still getting events from August 2025".
   *
   * Calendly filters `/scheduled_events` by start_time, so the window is a
   * MEETING-time window — but `occurred_at` used to be `created_at`, the booking
   * time. A standing meeting booked in August 2025 whose next occurrence is this
   * week is correctly inside a 30-day window and was displayed as August 2025.
   * Nothing was over-fetching; two axes were being read as one.
   */
  it("dates a meeting by when it happens, not when it was booked", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        ME,
        [
          "/scheduled_events",
          {
            collection: [
              {
                uri: "E1",
                name: "Personal Call With Zack",
                status: "active",
                start_time: "2026-07-24T10:00:00Z", // this week
                created_at: "2025-08-03T09:00:00Z", // booked a year ago
              },
            ],
            pagination: {},
          },
        ],
      ]),
    );
    const { records } = await calendlyConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "t" },
      config: { scope: "user" },
    });
    expect(records[0].occurredAt.toISOString()).toBe("2026-07-24T10:00:00.000Z");
    // Booking time is not lost — it is a field anyone can build a metric on.
    expect((records[0].properties as Record<string, unknown>).booked_at).toBe("2025-08-03T09:00:00Z");
  });

  /**
   * Stored data tracks the window rather than only growing past it. Without this
   * the older import sat stranded behind a narrowed floor, with a gap between it
   * and the current window — matching neither.
   */
  it("declares the window it covers, so rows outside it can be retired", async () => {
    vi.stubGlobal("fetch", mockFetch([ME, ["/scheduled_events", { collection: [], pagination: {} }]]));
    const res = await calendlyConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "t" },
      config: { scope: "user" },
    });
    expect(res.retireOutsideWindow).toBeDefined();
    const back = Math.round((Date.now() - res.retireOutsideWindow!.from.getTime()) / 86_400_000);
    expect(back).toBe(30);
    // Same axis as occurredAt, or the retire would tombstone real records.
    expect(res.retireOutsideWindow!.to.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * Narrowing moved to the Filter step, which only works if the axes are
   * pickable. `meeting_type` was reachable only as the ambiguous `name`; host was
   * buried in `event_memberships`, an array a picker can offer only positionally.
   */
  it("flattens the axes a flow narrows by onto every record", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([ME, ["/scheduled_events", { collection: [meeting("E1", "NAMZI Invite Only Creator Program")], pagination: {} }]]),
    );
    const { records } = await calendlyConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "t" },
      config: { scope: "organization" },
    });
    const p = records[0].properties as Record<string, unknown>;
    expect(p.meeting_type).toBe("NAMZI Invite Only Creator Program");
    expect(p.host_email).toBe("idris@namzi.com");
    expect(p.host_name).toBe("Idris Bulduk");
    // The raw payload is untouched alongside the derived fields.
    expect(p.event_memberships).toBeDefined();
  });

  /**
   * The poll and the connect-time preview must agree about one config. They
   * drifted once — the preview matched on one field after the poll had moved to
   * another — so the same config previewed one set of meetings and synced a
   * different one. Neither filters at all now, which is the strongest form of
   * agreement available.
   */
  it("poll and testFetchLatest keep the same records for the same config", async () => {
    const collection = [
      meeting("E1", "NAMZI Invite Only Creator Program"),
      meeting("E2", "Call with Tristan - Personal Calendar"),
      meeting("E3", "30 Minute Meeting"),
    ];
    // A config WITH a meeting type set — the drift only showed when one was.
    const config = { scope: "organization", meetingType: "https://api.calendly.com/event_types/AAA" };

    vi.stubGlobal("fetch", mockFetch([ME, ["/scheduled_events", { collection, pagination: {} }]]));
    const { records } = await calendlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { accessToken: "t" }, config });

    vi.stubGlobal("fetch", mockFetch([ME, ["/scheduled_events", { collection, pagination: {} }]]));
    const preview = await calendlyConnector.testFetchLatest!(10, { connectionId: "c1", cursor: null, credentials: { accessToken: "t" }, config });

    expect(records.map((r) => r.eventId)).toEqual(preview.map((r) => r.eventId));
    expect(preview).toHaveLength(3);
  });

  it("asks who the token belongs to once per connection, not once per poll", async () => {
    let meCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          meCalls += 1;
          return jsonResponse(ME[1]);
        }
        return jsonResponse({ collection: [], pagination: { next_page: null } });
      }),
    );
    const args = { connectionId: "c-memo", cursor: null, credentials: { accessToken: "t" }, config: { scope: "user" } };
    await calendlyConnector.poll!(args);
    await calendlyConnector.poll!(args);
    await calendlyConnector.poll!(args);
    expect(meCalls).toBe(1);
  });
});
