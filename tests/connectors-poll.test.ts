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

/**
 * PAGINATION, AND THE CONTINUATION THAT WAS NEVER ACCEPTED.
 *
 * Until 2026-08-03 `calendly.ts` rebuilt each page request from
 * `next_page_token` instead of following the `next_page` URL Calendly returns.
 * The rebuild is refused — verified live, in every form, milliseconds after the
 * token was issued — so the catch block restarted the side at page 1, the retry
 * SUCCEEDED, and nothing reported a problem. Every scan re-read its first page
 * for ever, holding at most 100 events per side, from a window frozen at
 * whenever it started (a side that never drains never re-opens one).
 *
 * The suite did not catch it because it asserted the ALARM, never a second
 * page. So the first test below is the one that was missing, and the restart
 * counter keeps its own tests underneath: one restart is a coincidence, two in
 * a row is a scan that is not advancing.
 */

/** A cursor over the connector's own 30-back/90-forward window, plus overrides. */
const window = (over: Record<string, unknown>) =>
  JSON.stringify({
    floor: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    ceil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    pivot: new Date().toISOString(),
    ...over,
  });

describe("Calendly: the scan follows next_page and actually reaches page 2", () => {
  const EV = (id: string) => ({
    uri: `https://api.calendly.com/scheduled_events/${id}`,
    name: "Demo",
    start_time: "2026-02-01T10:00:00Z",
  });
  const PAGE_2 = "https://api.calendly.com/scheduled_events?page_token=P2";

  /**
   * A provider that paginates the way the live API does: page 1 hands back a
   * complete `next_page` URL, and that URL serves page 2.
   *
   * It also REJECTS any rebuilt request carrying `page_token` in a query it
   * assembled itself — which is what production does, and what the connector
   * used to send. A connector that rebuilds cannot pass this.
   */
  const paginates = () =>
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/users/me")) {
        return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
      }
      if (url === PAGE_2) return jsonResponse({ collection: [EV("E2")], pagination: { next_page: null } });
      if (url.includes("page_token=")) throw new Error("HTTP 400: page_token is invalid");
      return jsonResponse({ collection: [EV("E1")], pagination: { next_page: PAGE_2 } });
    });

  /** Rejects every continuation, so a side can never advance. */
  const rejectContinuations = (nextOut: string | null) =>
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/users/me")) {
        return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
      }
      if (url.includes("page_token=")) throw new Error("HTTP 400: page_token is invalid");
      return jsonResponse({ collection: [EV("E1")], pagination: { next_page: nextOut } });
    });

  const poll = (cursor: string | null) =>
    calendlyConnector.poll!({ connectionId: "c1", cursor, credentials: { accessToken: "tok" } });

  /**
   * THE ASSERTION WHOSE ABSENCE LET THIS SHIP (see the describe title).
   *
   * The previous version of this suite mocked a provider that rejected every
   * `page_token` — production, exactly — and asserted only that the connector
   * NOTICED. It passed for as long as the bug existed, because the alarm
   * working is the bug. Nothing ever asserted a second page was read.
   */
  it("reads page 2 by following the URL Calendly returned", async () => {
    const fetchMock = paginates();
    vi.stubGlobal("fetch", fetchMock);

    const first = await poll(null);
    expect(first.records.map((r) => r.eventId)).toContain("calendly:c1:https://api.calendly.com/scheduled_events/E1");
    // Page 1 banked Calendly's own URL, not a token we would have to rebuild.
    expect(JSON.parse(first.nextCursor!).past).toBe(PAGE_2);

    // Sweep 2 runs the OTHER side (the scan alternates), so drive the past side
    // again by handing back a cursor whose turn is 'past'.
    const resume = JSON.stringify({ ...JSON.parse(first.nextCursor!), next: "past" });
    const second = await poll(resume);

    expect(
      second.records.map((r) => r.eventId),
      "the second page was never fetched — the scan is stuck on page 1",
    ).toContain("calendly:c1:https://api.calendly.com/scheduled_events/E2");
    // Requested verbatim: no rebuilt query, no re-encoded token.
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === PAGE_2)).toBe(true);
    // Exhausted: no next_page means this side is drained.
    expect(JSON.parse(second.nextCursor!).past).toBeNull();
  });

  it("drains both sides and then starts over, which is what nextCursor: null means", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        return jsonResponse({ collection: [EV("E1")], pagination: { next_page: null } });
      }),
    );
    const first = await poll(null); // past drains
    expect(first.nextCursor).not.toBeNull();
    const second = await poll(first.nextCursor); // future drains → both done
    expect(second.nextCursor, "both sides drained must re-open the window, not carry on").toBeNull();
  });

  it("counts consecutive restarts in the cursor and reports the side as incomplete", async () => {
    vi.stubGlobal("fetch", rejectContinuations(PAGE_2));

    /**
     * THE SCAN ALTERNATES, so the sweeps are not what you would first guess.
     *
     * Sweep 1 runs the PAST side with no stored token and banks one. Sweep 2
     * runs the FUTURE side — also with no stored token, because that side has
     * not run yet — and banks one too. Only from sweep 3 does either side have a
     * token to be rejected. Writing this as three sweeps asserted `restarts: 1`
     * on a sweep that never sent a token at all.
     */
    const sweeps: Array<{ restarts: number | undefined; incomplete: boolean | undefined }> = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const res = await poll(cursor);
      cursor = res.nextCursor;
      sweeps.push({ restarts: JSON.parse(cursor!).restarts, incomplete: res.incomplete });
    }

    // 1 and 2 open each side; neither can restart.
    expect(sweeps[0].restarts).toBeUndefined();
    expect(sweeps[1].restarts).toBeUndefined();
    // 3 is the first sweep with a stored token, and it is refused.
    expect(sweeps[2].restarts).toBe(1);
    // One restart is still consistent with a token that simply expired.
    expect(sweeps[2].incomplete).toBeFalsy();
    // 4 is refused too. Two in a row is not a coincidence.
    expect(sweeps[3].restarts).toBe(2);
    expect(sweeps[3].incomplete, "a scan re-reading page 1 every sweep reported itself as finished").toBe(true);
  });

  it("clears the count as soon as a sweep does not have to restart", async () => {
    // A stuck cursor, then a provider that accepts continuations again.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) {
          return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        }
        return jsonResponse({ collection: [], pagination: { next_page: null } });
      }),
    );
    const res = await poll(window({ past: PAGE_2, next: "past", restarts: 5 }));
    // A run of failures that ends is not a failure worth carrying forward.
    const after = res.nextCursor ? JSON.parse(res.nextCursor).restarts : undefined;
    expect(after).toBeUndefined();
    expect(res.incomplete).toBeFalsy();
  });
});

/**
 * MIGRATING THE CURSORS THAT ARE ALREADY OUT THERE.
 *
 * Every live Calendly stream has a stored `page_token` that can only 400. The
 * fix has to recognise that shape, or each stream burns one request a sweep
 * discovering it again — and would keep reading the window frozen at whenever
 * its scan first started, because a scan that never drains never re-opens one.
 */
describe("Calendly: a cursor from before next_page", () => {
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

  it("is discarded without spending a request on the dead token", async () => {
    const fetchMock = firstPageOnly();
    vi.stubGlobal("fetch", fetchMock);

    await poll(window({ past: "TOK-OLD", next: "past", restarts: 5 }));

    // The dead token is never sent. Retrying it and catching the 400 would
    // "work", and would cost every stream a wasted call on every sweep.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("TOK-OLD"))).toBe(false);
  });

  it("re-opens the window at now rather than keeping the frozen one", async () => {
    vi.stubGlobal("fetch", firstPageOnly());
    const stale = new Date(Date.now() - 200 * 86_400_000).toISOString();

    const res = await poll(
      JSON.stringify({ floor: stale, ceil: stale, pivot: stale, past: "TOK-OLD", next: "past" }),
    );

    // A scan that could never drain never re-opened its window, so the stored
    // bounds are as old as the bug. Carrying them forward would keep reading a
    // window that stopped being true months ago.
    const after = JSON.parse(res.nextCursor!);
    expect(after.pivot).not.toBe(stale);
    expect(Date.parse(after.ceil)).toBeGreaterThan(Date.now());
  });

  it("leaves a not-started side and a drained side alone", async () => {
    // The future side keeps paginating, so the scan does not finish and there
    // is a cursor left to inspect.
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

    // `undefined` (never ran) and `null` (drained) are not continuations, so
    // neither may be mistaken for the old shape. If either were, every healthy
    // cursor in the fleet would be discarded on the first sweep after deploy.
    const pinned = window({ past: null, next: "future" });
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
    const meetings = {
      collection: [
        { uri: "https://api.calendly.com/scheduled_events/EVTa", name: "Active", status: "active", start_time: "2026-03-01T10:00:00Z", created_at: "2026-02-01T08:00:00Z" },
        { uri: "https://api.calendly.com/scheduled_events/EVTc", name: "Gone", status: "canceled", start_time: "2026-03-02T10:00:00Z", created_at: "2026-02-02T08:00:00Z", updated_at: "2026-02-15T09:00:00Z" },
      ],
      pagination: { next_page: "" }, // filled in per side below
    };
    const nextFor = (side: string) => `https://api.calendly.com/scheduled_events?page_token=TOK2&side=${side}`;
    const lastPage = { collection: [], pagination: { next_page: null } };
    const sides: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/me")) return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        /**
         * Only a FIRST request carries `sort` — every page after it is
         * Calendly's own URL, followed verbatim. So the mock tags the side onto
         * the URL it hands back, which is the only way this test can still see
         * which side each request served and keep asserting the alternation.
         */
        const sort = url.searchParams.get("sort");
        const side = sort ? (sort === "start_time:desc" ? "past" : "future") : url.searchParams.get("side")!;
        sides.push(side);
        return jsonResponse(
          url.searchParams.get("page_token") === "TOK2"
            ? lastPage
            : { ...meetings, pagination: { next_page: nextFor(side) } },
        );
      }),
    );
    const base = { connectionId: "c1", credentials: { accessToken: "t" }, config: { scope: "user" }, streamHash: "h" };

    const first = await calendlyConnector.poll!({ ...base, cursor: null });
    // Active → 1 booked; canceled → booked + canceled = 3 records.
    expect(first.records.map((r) => r.eventType).sort()).toEqual(["booked", "booked", "canceled"]);
    // Dated by WHEN THE MEETING IS — the same axis Calendly's window filters on,
    // and the axis the retire depends on. Booking time lives in `booked_at`.
    const booked = first.records.find((r) => r.eventId.endsWith("EVTa"))!;
    expect(booked.occurredAt.toISOString()).toBe("2026-03-01T10:00:00.000Z");
    expect((booked.properties as Record<string, unknown>).booked_at).toBe("2026-02-01T08:00:00Z");
    const canceled = first.records.find((r) => r.eventType === "canceled")!;
    expect(canceled.eventId).toContain(":canceled:");
    // The cancellation sits in the slot it freed, so both rows fall inside the
    // window that fetched them — otherwise the retire would tombstone one.
    expect(canceled.occurredAt.toISOString()).toBe("2026-03-02T10:00:00.000Z");
    expect((canceled.properties as Record<string, unknown>).canceled_at).toBe("2026-02-15T09:00:00Z");
    // More pages → the cursor banks Calendly's own next-page URL, verbatim.
    expect(JSON.parse(first.nextCursor!).past).toBe(nextFor("past"));

    // Walk it out. Each call takes one page from whichever side is due, and the
    // cursor only clears once BOTH have run out — a scan that stopped when the
    // first side finished would leave the other half of the window unread.
    let cursor = first.nextCursor;
    for (let i = 0; i < 3; i++) {
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
