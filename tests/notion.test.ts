import { describe, it, expect, vi, afterEach } from "vitest";
import { notionConnector, NOTION_API_VERSION } from "@/connectors/notion";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";
import { SOURCE_LOGOS } from "@/connectors/logos";

/**
 * Notion — the rows of one database, mirrored.
 *
 * Every behaviour pinned here was read off Notion's own documentation on
 * 19 Sep 2026 (the catalog entry cites the pages). Two of these tests exist
 * because of failures this codebase has already had and paid for: the version
 * header (Whop, twice) and the mirror's refusal to declare a truncated read
 * complete (Airtable's cap, Google Calendar's cancelled meetings).
 */

afterEach(() => vi.unstubAllGlobals());

const CONN = "conn_1";
const CREDS = { apiKey: "ntn_test" };

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

/** A Notion page (database row) as the query endpoint returns one. */
const row = (id: string, properties: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  object: "page",
  id,
  created_time: "2026-09-01T10:00:00.000Z",
  last_edited_time: "2026-09-02T10:00:00.000Z",
  url: `https://notion.so/${id}`,
  properties,
  ...over,
});

const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] });
const number = (n: number) => ({ type: "number", number: n });
const date = (d: string) => ({ type: "date", date: { start: d } });
const select = (name: string) => ({ type: "select", select: { id: "x", color: "blue", name } });

/**
 * Serves query pages and records what was asked for, headers included — the
 * headers are the point of half this file, and a stub that drops them cannot
 * tell a pinned request from an unpinned one.
 */
function serve(pages: Array<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const page = pages[Math.min(n, pages.length - 1)];
      n += 1;
      return jsonResponse({ results: page.results, has_more: page.has_more ?? false, next_cursor: page.next_cursor ?? null });
    }),
  );
  return calls;
}

const poll = (over: Record<string, unknown> = {}) =>
  notionConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: { dataSourceId: "ds_1" }, ...over });

describe("Notion API version — the Whop lesson, applied before it costs anything", () => {
  it("sends Notion-Version on EVERY request", async () => {
    const calls = serve([{ results: [row("p1")] }]);
    await poll();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.headers["Notion-Version"]).toBe(NOTION_API_VERSION);
  });

  it("pins at or after the release that introduced data sources", () => {
    // Earlier than this and Notion FAILS the call outright once a database has
    // a second data source — the endpoint this connector uses does not exist.
    expect(NOTION_API_VERSION >= "2025-09-03").toBe(true);
  });

  it("queries the data-source endpoint, not the retired database one", async () => {
    const calls = serve([{ results: [] }]);
    await poll();
    expect(calls[0].url).toContain("/data_sources/ds_1/query");
    expect(calls.some((c) => /\/databases\/[^/]+\/query/.test(c.url))).toBe(false);
  });
});

describe("Notion mirror — what makes a deletion observable", () => {
  it("declares mirrorScope when the read finished, so absent rows retire", async () => {
    serve([{ results: [row("p1"), row("p2")] }]);
    const res = await poll();
    expect(res.records).toHaveLength(2);
    expect(res.mirrorScope).toBeDefined();
    // Bounds must span every date a row of ours can carry — a scope ending at
    // `now` would exempt future-dated rows from retirement for ever.
    expect(res.mirrorScope!.from.getUTCFullYear()).toBe(1900);
    expect(res.mirrorScope!.to.getUTCFullYear()).toBe(2100);
    expect(res.incomplete).toBe(false);
    // A mirror has no resume point: null means START OVER.
    expect(res.nextCursor).toBeNull();
  });

  it("WITHHOLDS mirrorScope when the read was truncated", async () => {
    // A prefix of a database is not complete for anything, and declaring it
    // complete would tombstone every row the walk never reached.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    serve([{ results: [row("p1")], has_more: true, next_cursor: "c2" }]);
    const res = await poll();
    expect(res.mirrorScope).toBeUndefined();
    expect(res.incomplete).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  }, 30_000);

  it("pages through until the source is drained", async () => {
    const calls = serve([
      { results: [row("p1")], has_more: true, next_cursor: "c2" },
      { results: [row("p2")], has_more: false },
    ]);
    const res = await poll();
    expect(res.records.map((r) => r.properties!._notion).map((n) => (n as { id: string }).id)).toEqual(["p1", "p2"]);
    expect((calls[1].body as { start_cursor?: string }).start_cursor).toBe("c2");
    expect(res.providerCalls).toBe(2);
  }, 30_000);

  it("reads nothing, and spends nothing, without a chosen database", async () => {
    const calls = serve([{ results: [row("p1")] }]);
    const res = await notionConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: {} });
    expect(res.records).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("Notion properties — the tagged union, unwrapped", () => {
  it("stores the value a person would say, not Notion's envelope", async () => {
    serve([
      {
        results: [
          row("p1", {
            Name: title("Acme Corp"),
            Stage: select("Won"),
            Tags: { type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] },
            Seats: number(12),
            Done: { type: "checkbox", checkbox: true },
            Closed: date("2026-08-15"),
          }),
        ],
      },
    ]);
    const [rec] = (await poll()).records;
    expect(rec.properties!.Name).toBe("Acme Corp");
    // Not {id,color,name} — the thing a filter should be able to match on.
    expect(rec.properties!.Stage).toBe("Won");
    expect(rec.properties!.Tags).toEqual(["a", "b"]);
    expect(rec.properties!.Seats).toBe(12);
    expect(rec.properties!.Done).toBe(true);
    expect(rec.properties!.Closed).toBe("2026-08-15");
  });

  it("reads a formula through to the value it displays", async () => {
    serve([{ results: [row("p1", { Revenue: { type: "formula", formula: { type: "number", number: 250 } } })] }]);
    const [rec] = (await poll()).records;
    expect(rec.properties!.Revenue).toBe(250);
  });

  it("returns null for a type with no scalar meaning rather than inventing one", async () => {
    serve([{ results: [row("p1", { Go: { type: "button", button: {} } })] }]);
    const [rec] = (await poll()).records;
    expect(rec.properties!.Go).toBeNull();
  });

  it("keeps the raw envelope where anything that needs it can still reach it", async () => {
    serve([{ results: [row("p1", { Stage: select("Won") })] }]);
    const [rec] = (await poll()).records;
    const meta = rec.properties!._notion as { properties: Record<string, unknown>; url: string };
    expect(meta.properties.Stage).toEqual({ type: "select", select: { id: "x", color: "blue", name: "Won" } });
    expect(meta.url).toBe("https://notion.so/p1");
  });

  it("a database property named _notion cannot shadow the row's identity", async () => {
    serve([{ results: [row("p1", { _notion: title("hijack") })] }]);
    const [rec] = (await poll()).records;
    expect((rec.properties!._notion as { id: string }).id).toBe("p1");
  });
});

describe("Notion dating — three answers, same as Airtable's", () => {
  it("uses Notion's created_time when nobody has nominated a property", async () => {
    serve([{ results: [row("p1", { Closed: date("2026-08-15") })] }]);
    const res = await poll();
    expect(res.records[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(res.dateFieldState!.column).toBe("created_time");
    expect(res.dateFieldState!.source).toBe("detected");
  });

  it("uses the nominated property when there is one", async () => {
    serve([{ results: [row("p1", { Closed: date("2026-08-15") })] }]);
    const res = await poll({ dateField: "Closed" });
    expect(res.records[0].occurredAt.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(res.dateFieldState!.column).toBe("Closed");
    expect(res.dateFieldState!.presentInHeader).toBe(true);
  });

  it("offers the real date columns as candidates — Notion's properties are TYPED", async () => {
    // A spreadsheet has to guess; here the schema says which columns are dates,
    // so making the user guess would be throwing away what we were told.
    serve([{ results: [row("p1", { Closed: date("2026-08-15"), Name: title("x"), Seats: number(1) })] }]);
    const res = await poll();
    expect(res.dateFieldState!.candidates).toContain("Closed");
    expect(res.dateFieldState!.candidates).not.toContain("Seats");
  });

  it("counts a row its chosen property cannot date as UNDATED, stamped with the read", async () => {
    serve([{ results: [row("p1", { Closed: { type: "date", date: null } })] }]);
    const res = await poll({ dateField: "Closed" });
    expect(res.dateFieldState!.undated).toBe(1);
    expect(res.dateFieldState!.dated).toBe(0);
    expect(res.undatedEventIds!.has(res.records[0].eventId)).toBe(true);
  });

  it("honours an explicit 'use import time' instead of quietly dating by created_time", async () => {
    serve([{ results: [row("p1")] }]);
    const res = await poll({ detectDateField: false });
    expect(res.dateFieldState!.column).toBeNull();
    expect(res.dateFieldState!.undated).toBe(1);
  });
});

describe("Notion value and subject", () => {
  it("takes a value only from a column that plainly says it is one", async () => {
    // Notion's types say a property holds a number, never that the number is
    // money: a row id and a headcount are numbers too.
    serve([{ results: [row("p1", { Revenue: number(500), Seats: number(12) })] }]);
    const [rec] = (await poll()).records;
    expect(rec.value).toBe(500);
  });

  it("takes no value at all when no column claims to be one", async () => {
    serve([{ results: [row("p1", { Seats: number(12), Rank: number(3) })] }]);
    const [rec] = (await poll()).records;
    expect(rec.value).toBeNull();
  });

  it("names the row by its title, falling back to an email", async () => {
    serve([{ results: [row("p1", { Name: title("Acme Corp") })] }, { results: [] }]);
    expect((await poll()).records[0].subject).toBe("Acme Corp");

    serve([{ results: [row("p2", { Contact: { type: "email", email: "a@b.com" } })] }]);
    expect((await poll()).records[0].subject).toBe("a@b.com");
  });

  it("keys on the page id and the stream, so two databases' rows never collide", async () => {
    serve([{ results: [row("p1")] }]);
    const a = (await poll({ streamHash: "s_a" })).records[0].eventId;
    serve([{ results: [row("p1")] }]);
    const b = (await poll({ streamHash: "s_b" })).records[0].eventId;
    expect(a).not.toBe(b);
    expect(a).toContain("p1");
  });
});

describe("Notion listOptions — the databases this token can actually see", () => {
  it("asks search for data sources and names them", async () => {
    const calls = serve([{ results: [{ id: "ds_1", title: [{ plain_text: "Pipeline" }] }] }]);
    const opts = await notionConnector.listOptions!("dataSourceId", { connectionId: CONN, credentials: CREDS, config: {} });
    expect(opts).toEqual([{ value: "ds_1", label: "Pipeline" }]);
    expect(calls[0].url).toContain("/search");
    expect(calls[0].body).toMatchObject({ filter: { property: "object", value: "data_source" } });
  });

  it("returns nothing for a key it does not own", async () => {
    const calls = serve([{ results: [] }]);
    expect(await notionConnector.listOptions!("baseId", { connectionId: CONN, credentials: CREDS, config: {} })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("Notion is wired into the product", () => {
  it("fails webhook verification CLOSED — there is no inbound path", () => {
    // A `true` here would turn POST /api/webhooks/<connection-id> into an
    // anonymous "sweep this connection now" primitive against a 3/second budget.
    expect(notionConnector.verifySignature({ rawBody: "{}", headers: {}, secret: "s" })).toBe(false);
  });

  it("is registered, catalogued, and declares the budget it spends against", () => {
    expect(getConnector("notion")).toBe(notionConnector);
    const e = catalogEntry("notion")!;
    expect(e.connect).toBe("apiKey");
    expect(e.sync).toBe("mirror");
    expect(e.instant).toBe(false);
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    // Declared on the LOWER published limit — the one most customers have.
    expect(e.rateLimits?.["api.request"]?.requestsPerMinute).toBe(180);
    expect(notionConnector.operations).toContain("api.request");
  });

  it("asks for the one credential it cannot work without, and the database per flow", () => {
    const e = catalogEntry("notion")!;
    expect(e.credentialFields?.map((f) => f.key)).toEqual(["apiKey"]);
    expect(e.flowFields?.map((f) => f.key)).toEqual(["dataSourceId"]);
    expect(e.flowFields?.[0].dynamic).toBe(true);
  });

  it("does not promise instant updates it cannot deliver", () => {
    // The docs page renders `guide.webhook` under a hard-coded "Instant
    // updates" heading. Notion's poll is the only path there is, so anything
    // in that slot would advertise a feature this source does not have.
    const e = catalogEntry("notion")!;
    expect(e.instant).toBe(false);
    expect(e.guide?.webhook).toBeUndefined();
  });

  it("tells the user the step that makes the database list non-empty", () => {
    // A Notion integration starts able to see NOTHING; a guide that stops at
    // "paste the token" ships a connection that looks broken.
    const guide = catalogEntry("notion")!.guide!;
    const prose = JSON.stringify(guide).toLowerCase();
    expect(prose).toContain("connections");
    expect(prose).toMatch(/share|add/);
  });

  it("carries Notion's own mark, both paths, unpainted", () => {
    const logo = SOURCE_LOGOS["notion"];
    expect(logo).toBeDefined();
    expect(logo.paths).toHaveLength(2);
    // Official, not painted: flooding both paths with one fill loses the N.
    expect(logo.paths.every((p) => p.fill !== "currentColor")).toBe(true);
  });
});
