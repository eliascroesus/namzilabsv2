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
    expect(entry.flowFields?.map((f) => f.key)).toEqual(["scope", "groupUri"]);
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

describe("Google Sheets polling (mirror: every poll is a full tab read)", () => {
  it("reads rows and maps header+cells into row_added events, with no cursor", async () => {
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
    // Mirror source: no incremental cursor — the sync layer reconciles the full set.
    expect(result.nextCursor).toBeNull();
    expect(result.records[0].eventType).toBe("row_added");
    expect(result.records[0].eventId).toBe("gsheets:c1:row:2");
    expect(result.records[0].subject).toBe("alice@acme.com");
    expect(result.records[0].properties).toEqual({ name: "Alice", email: "alice@acme.com" });
  });

  it("ignores any stored cursor: a repeat poll re-reads EVERY row (cell edits are always seen)", async () => {
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
      cursor: "2", // a legacy row-count cursor from the old model
      credentials: { accessToken: "tok" },
      config: { spreadsheetId: "SHEET1" },
    });
    // The old model returned [] here — freezing rows at first capture forever.
    expect(second.records).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("skips fully-blank rows WITHOUT shifting the sheet row numbers below them", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        [
          "/values/",
          {
            values: [
              ["name", "email"],
              ["Alice", "alice@acme.com"], // sheet row 2
              ["", ""], //                    sheet row 3: blank → no record
              ["Bob", "bob@acme.com"], //     sheet row 4 keeps its number
            ],
          },
        ],
      ]),
    );
    const result = await googleSheetsConnector.poll!({
      connectionId: "c1",
      cursor: null,
      credentials: { accessToken: "tok" },
      config: { spreadsheetId: "SHEET1" },
      streamHash: "h1",
    });
    expect(result.records.map((r) => r.eventId)).toEqual(["gsheets:c1:h1:row:2", "gsheets:c1:h1:row:4"]);
  });
});
