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

describe("Calendly is stream-scoped (scope config lives on the flow node)", () => {
  it("is stream-scoped, and scope is a per-flow field, not a connect-time one", () => {
    expect(isStreamScoped("calendly")).toBe(true);
    const entry = catalogEntry("calendly")!;
    // Only settings Calendly can act on server-side. Meeting type is absent by
    // design: there is no event_type parameter, so it could never change the
    // request — it belongs in a Filter step.
    expect(entry.flowFields?.map((f) => f.key)).toEqual(["scope", "groupUri", "status"]);
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

  it("emits booked + canceled, buckets bookings by created_at, and follows pagination", async () => {
    const page1 = {
      collection: [
        { uri: "https://api.calendly.com/scheduled_events/EVTa", name: "Active", status: "active", start_time: "2026-03-01T10:00:00Z", created_at: "2026-02-01T08:00:00Z" },
        { uri: "https://api.calendly.com/scheduled_events/EVTc", name: "Gone", status: "canceled", start_time: "2026-03-02T10:00:00Z", created_at: "2026-02-02T08:00:00Z", updated_at: "2026-02-15T09:00:00Z" },
      ],
      pagination: { next_page_token: "TOK2" },
    };
    const page2 = { collection: [], pagination: { next_page_token: null } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) return jsonResponse({ resource: { uri: "https://api.calendly.com/users/U1", current_organization: "O1" } });
        if (url.includes("/scheduled_events")) return jsonResponse(url.includes("page_token=TOK2") ? page2 : page1);
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const base = { connectionId: "c1", credentials: { accessToken: "t" }, config: { scope: "user" }, streamHash: "h" };

    const first = await calendlyConnector.poll!({ ...base, cursor: null });
    // Active → 1 booked; canceled → booked + canceled = 3 records.
    expect(first.records.map((r) => r.eventType).sort()).toEqual(["booked", "booked", "canceled"]);
    // A booking is bucketed by when it was booked (created_at), not the meeting time.
    expect(first.records.find((r) => r.eventId.endsWith("EVTa"))!.occurredAt.toISOString()).toBe("2026-02-01T08:00:00.000Z");
    const canceled = first.records.find((r) => r.eventType === "canceled")!;
    expect(canceled.eventId).toContain(":canceled:");
    expect(canceled.occurredAt.toISOString()).toBe("2026-02-15T09:00:00.000Z"); // updated_at
    expect(first.nextCursor).toContain("TOK2"); // more pages → cursor advances

    // Following the cursor exhausts the scan → cursor resets so the next sweep rescans.
    const second = await calendlyConnector.poll!({ ...base, cursor: first.nextCursor });
    expect(second.records).toHaveLength(0);
    expect(second.nextCursor).toBeNull();
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
    expect(result.nextCursor).toBe("2");
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
      cursor: "2", // stored by a previous sweep — informational only
      credentials: { accessToken: "tok" },
      config: { spreadsheetId: "SHEET1" },
    });
    // The full current sheet comes back; the WRITER dedups/refreshes in place.
    expect(second.records).toHaveLength(2);
    expect(second.nextCursor).toBe("2");
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

  async function pollUrl(config: Record<string, unknown>): Promise<string> {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/users/me")) return jsonResponse(ME[1]);
        seen = url;
        return jsonResponse({ collection: [], pagination: { next_page_token: null } });
      }),
    );
    await calendlyConnector.poll!({ connectionId: `c-${Math.random()}`, cursor: null, credentials: { accessToken: "t" }, config });
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
   * 30 days back, not a year. With no event-type filter, pages walked is decided
   * by scope × window and nothing else — this is the only real lever on volume,
   * and it is a twelvefold cut per sweep.
   */
  it("reads 30 days back and a year forward", async () => {
    const url = new URL(await pollUrl({ scope: "user" }));
    const back = Math.round((Date.now() - Date.parse(url.searchParams.get("min_start_time")!)) / 86_400_000);
    const fwd = Math.round((Date.parse(url.searchParams.get("max_start_time")!) - Date.now()) / 86_400_000);
    expect(back).toBe(30);
    expect(fwd).toBe(365);
  });

  it("sends status only when the flow narrowed it — omitted, cancellations stay visible", async () => {
    expect(new URL(await pollUrl({ scope: "user" })).searchParams.get("status")).toBeNull();
    expect(new URL(await pollUrl({ scope: "user", status: "active" })).searchParams.get("status")).toBe("active");
  });

  it("offers no meeting-type setting, and lists no meeting types", async () => {
    const entry = catalogEntry("calendly")!;
    expect(entry.flowFields?.some((f) => f.key === "meetingType" || f.key === "eventTypeUri")).toBe(false);
    // The listing is gone too — it backed a setting that could not change the
    // request and could not be presented honestly (one label per host).
    const opts = await calendlyConnector.listOptions!("meetingType", {
      connectionId: "c1",
      credentials: { accessToken: "t" },
      config: { scope: "organization" },
    });
    expect(opts).toEqual([]);
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
   * drifted: testFetchLatest kept reading `eventTypeUri` and matching
   * `event_type` after the poll had moved to `meetingType` matched on `name`, so
   * the same config could preview one set of meetings and sync another.
   */
  it("poll and testFetchLatest keep the same records for the same config", async () => {
    const collection = [
      meeting("E1", "NAMZI Invite Only Creator Program"),
      meeting("E2", "Call with Tristan - Personal Calendar"),
      meeting("E3", "30 Minute Meeting"),
    ];
    const config = { scope: "organization" };

    vi.stubGlobal("fetch", mockFetch([ME, ["/scheduled_events", { collection, pagination: {} }]]));
    const { records } = await calendlyConnector.poll!({ connectionId: "c1", cursor: null, credentials: { accessToken: "t" }, config });

    vi.stubGlobal("fetch", mockFetch([ME, ["/scheduled_events", { collection, pagination: {} }]]));
    const preview = await calendlyConnector.testFetchLatest!(10, { connectionId: "c1", cursor: null, credentials: { accessToken: "t" }, config });

    // Neither filters, so both keep all three — and neither can drift from the
    // other by reading a key the other stopped using.
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
        return jsonResponse({ collection: [], pagination: { next_page_token: null } });
      }),
    );
    const args = { connectionId: "c-memo", cursor: null, credentials: { accessToken: "t" }, config: { scope: "user" } };
    await calendlyConnector.poll!(args);
    await calendlyConnector.poll!(args);
    await calendlyConnector.poll!(args);
    expect(meCalls).toBe(1);
  });
});
