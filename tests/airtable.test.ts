import { describe, it, expect, vi, afterAll, beforeEach, afterEach } from "vitest";
import { airtableConnector, AIRTABLE_PAGING } from "@/connectors/airtable";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

/** The shipped pace and cap, restored at the end — the tests move both. */
const SHIPPED = { ...AIRTABLE_PAGING };

beforeEach(() => {
  // No sleeping in the suite: the pace exists to stay under 5 req/s live.
  AIRTABLE_PAGING.minGapMs = 0;
  AIRTABLE_PAGING.maxPages = SHIPPED.maxPages;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => {
  Object.assign(AIRTABLE_PAGING, SHIPPED);
});

const CONN = "conn_1";
const CREDS = { apiKey: "patTEST.abc" };
const CONFIG = { baseId: "appA", tableId: "tblL" };

function stubFetch(bodies: unknown[], headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = bodies[Math.min(i++, bodies.length - 1)];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

const rec = (id: string, fields: Record<string, unknown>, createdTime = "2026-09-01T10:00:00.000Z") => ({ id, createdTime, fields });
const poll = (over: Record<string, unknown> = {}) =>
  airtableConnector.poll!({ connectionId: CONN, cursor: null, credentials: CREDS, config: CONFIG, streamHash: "h1", ...over });

describe("airtable: registration", () => {
  it("is in the catalog and the registry with dated provenance, stream-scoped on base and table, a mirror", () => {
    expect(getConnector("airtable")).toBe(airtableConnector);
    const e = catalogEntry("airtable")!;
    expect(e.sync).toBe("mirror");
    expect(e.instant).toBe(false);
    expect(e.poll).toBe(true);
    expect(e.autoWebhook).toBe(false);
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.flowFields?.map((f) => f.key)).toEqual(["baseId", "tableId"]);
    // The table field is useless until a base is chosen, and the catalog is
    // where the panel learns that.
    expect(e.flowFields?.[1].dependsOn).toEqual(["baseId"]);
    // Every operation the connector claims against has a declared limit; the
    // budget-operations suite checks the other direction across the catalog.
    expect(Object.keys(e.rateLimits ?? {})).toEqual([...(airtableConnector.operations ?? [])]);
    // 5 requests/second per base (rate-limits, read 8 Sep 2026).
    expect(e.rateLimits?.["records.list"].requestsPerMinute).toBe(300);
  });
});

describe("airtable: signature", () => {
  it("refuses every inbound request — this source has no verifiable inbound path", () => {
    const body = JSON.stringify({ base: { id: "appA" }, webhook: { id: "ach1" }, timestamp: "2026-09-08T12:00:00.000Z" });
    expect(airtableConnector.verifySignature({ rawBody: body, headers: { "x-airtable-content-mac": "hmac-sha256=abc" }, secret: "shh" })).toBe(false);
    expect(airtableConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(false);
    expect(airtableConnector.verifySignature({ rawBody: "{}", headers: {}, secret: "shh" })).toBe(false);
    // …and there is nothing to normalize, because nothing can get past that.
    expect(airtableConnector.normalize).toBeUndefined();
  });
});

describe("airtable: rows become events", () => {
  it("one row is one row_added, dated by createdTime, keyed by stream and record id, with the email and the money field lifted", async () => {
    stubFetch([{ records: [rec("recA", { Name: "Ada", Email: "a@x.io", Amount: 1200.5, Score: 7 })] }]);
    const res = await poll();
    expect(res.records).toHaveLength(1);
    const e = res.records[0];
    expect(e.eventId).toBe("airtable:conn_1:h1:recA");
    expect(e.eventType).toBe("row_added");
    expect(e.subject).toBe("a@x.io");
    expect(e.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    // Currency cells read as plain numbers in MAJOR units (field-model), so
    // nothing divides by 100 — and `Score`, a number in a column that names
    // nothing money-like, is deliberately not the value.
    expect(e.value).toBe(1200.5);
    expect(e.currency).toBeUndefined();
    expect(e.properties).toMatchObject({
      Name: "Ada",
      Score: 7,
      _airtable: { id: "recA", createdTime: "2026-09-01T10:00:00.000Z", baseId: "appA", tableId: "tblL" },
    });
  });

  it("reads a collaborator cell's email, and claims no value when no column names one", async () => {
    stubFetch([{ records: [rec("recB", { Owner: { id: "usr1", email: "owner@x.io", name: "Owner" }, Headcount: 42 })] }]);
    const [e] = (await poll()).records;
    expect(e.subject).toBe("owner@x.io");
    expect(e.value).toBeNull();
  });

  it("two streams' identical record ids stay two events", async () => {
    stubFetch([{ records: [rec("recA", {})] }]);
    const a = (await poll({ streamHash: "h1" })).records[0].eventId;
    stubFetch([{ records: [rec("recA", {})] }]);
    const b = (await poll({ streamHash: "h2" })).records[0].eventId;
    expect(a).toBe("airtable:conn_1:h1:recA");
    expect(b).toBe("airtable:conn_1:h2:recA");
  });
});

describe("airtable: poll (mirror of one table)", () => {
  it("reads the whole table across offsets and declares the mirror complete", async () => {
    const calls = stubFetch([
      { records: [rec("recA", { Email: "a@x.io" })], offset: "o1" },
      { records: [rec("recB", { Email: "b@x.io" }, "2026-09-02T10:00:00.000Z")] },
    ]);
    const res = await poll();

    expect(res.records.map((r) => r.eventId)).toEqual(["airtable:conn_1:h1:recA", "airtable:conn_1:h1:recB"]);
    expect(res.records[1].occurredAt.toISOString()).toBe("2026-09-02T10:00:00.000Z");
    // A mirror has no resume point: null means start over next sweep.
    expect(res.nextCursor).toBeNull();
    expect(res.providerCalls).toBe(2);
    expect(res.incomplete).toBe(false);
    // Complete for every instant a row of ours can carry — including the future,
    // which a scope ending at `now` would exempt from retirement forever.
    expect(res.mirrorScope!.from.toISOString()).toBe("1900-01-01T00:00:00.000Z");
    expect(res.mirrorScope!.to.toISOString()).toBe("2100-12-31T23:59:59.999Z");
    // Nobody has nominated a column, so the rows are dated from Airtable's own
    // creation time — named, not reported as "nothing dated these rows".
    expect(res.dateFieldState).toEqual({ column: "createdTime", source: "detected", presentInHeader: true, dated: 2, undated: 0 });
    expect(res.undatedEventIds?.size).toBe(0);

    const first = new URL(calls[0].url);
    expect(first.origin + first.pathname).toBe("https://api.airtable.com/v0/appA/tblL");
    expect(first.searchParams.get("pageSize")).toBe("100");
    expect(first.searchParams.get("offset")).toBeNull();
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer patTEST.abc");
    expect(new URL(calls[1].url).searchParams.get("offset")).toBe("o1");
  });

  it("dates rows by the stream's chosen column and names the ones it could not date", async () => {
    stubFetch([{ records: [rec("recA", { Email: "a@x.io", "Closed on": "2026-08-15" }), rec("recB", { Email: "b@x.io" })] }]);
    const res = await poll({ dateField: "Closed on" });

    expect(res.records[0].occurredAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(res.dateFieldState).toEqual({ column: "Closed on", source: "user", presentInHeader: true, dated: 1, undated: 1 });
    expect(res.undatedEventIds!.has("airtable:conn_1:h1:recB")).toBe(true);
    expect(res.undatedEventIds!.has("airtable:conn_1:h1:recA")).toBe(false);
  });

  it("a chosen column no row carries is reported as gone, not as values that would not parse", async () => {
    stubFetch([{ records: [rec("recA", { Email: "a@x.io" })] }]);
    const res = await poll({ dateField: "Signed at" });
    expect(res.dateFieldState).toEqual({ column: "Signed at", source: "user", presentInHeader: false, dated: 0, undated: 1 });
  });

  it("an explicit 'use import time' is obeyed: no row is dated from createdTime behind the answer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
    stubFetch([{ records: [rec("recA", { Email: "a@x.io" }), rec("recB", {})] }]);
    const res = await poll({ dateField: null, detectDateField: false });

    expect(res.records.map((r) => r.occurredAt.toISOString())).toEqual(["2026-09-08T12:00:00.000Z", "2026-09-08T12:00:00.000Z"]);
    expect(res.dateFieldState).toEqual({ column: null, source: "user", presentInHeader: false, dated: 0, undated: 2 });
    expect(res.undatedEventIds?.size).toBe(2);
  });

  it("a table larger than the page cap declares no mirror scope and says it is incomplete", async () => {
    AIRTABLE_PAGING.maxPages = 2;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubFetch([
      { records: [rec("recA", {})], offset: "o1" },
      { records: [rec("recB", {})], offset: "o2" },
      { records: [rec("recC", {})] },
    ]);
    const res = await poll();

    expect(calls).toHaveLength(2);
    expect(res.records.map((r) => r.eventId)).toEqual(["airtable:conn_1:h1:recA", "airtable:conn_1:h1:recB"]);
    expect(res.mirrorScope).toBeUndefined();
    expect(res.incomplete).toBe(true);
    expect(res.providerCalls).toBe(2);
    expect(warn.mock.calls[0][0]).toContain("[airtable-truncated]");
    warn.mockRestore();
  });

  it("without a base and a table there is nothing to read", async () => {
    const calls = stubFetch([{ records: [] }]);
    expect(await poll({ config: { baseId: "appA" } })).toEqual({ records: [], nextCursor: null });
    expect(await poll({ config: {} })).toEqual({ records: [], nextCursor: null });
    expect(calls).toHaveLength(0);
  });

  it("lists bases, then the tables of the chosen base, and nothing until one is chosen", async () => {
    const calls = stubFetch([
      { bases: [{ id: "appA", name: "Pipeline", permissionLevel: "create" }] },
      { tables: [{ id: "tblL", name: "Leads", primaryFieldId: "fld1", fields: [] }] },
    ]);
    expect(await airtableConnector.listOptions!("baseId", { connectionId: CONN, credentials: CREDS })).toEqual([
      { value: "appA", label: "Pipeline" },
    ]);
    expect(await airtableConnector.listOptions!("tableId", { connectionId: CONN, credentials: CREDS, config: { baseId: "appA" } })).toEqual([
      { value: "tblL", label: "Leads" },
    ]);
    expect(await airtableConnector.listOptions!("tableId", { connectionId: CONN, credentials: CREDS, config: {} })).toEqual([]);

    expect(new URL(calls[0].url).pathname).toBe("/v0/meta/bases");
    expect(new URL(calls[1].url).pathname).toBe("/v0/meta/bases/appA/tables");
    expect(calls).toHaveLength(2);
  });

  it("the connect-time preview costs one page and shows the newest rows first", async () => {
    const calls = stubFetch([
      { records: [rec("recA", {}, "2026-09-01T10:00:00.000Z"), rec("recB", {}, "2026-09-03T10:00:00.000Z")], offset: "o1" },
      { records: [rec("recC", {})] },
    ]);
    const latest = await airtableConnector.testFetchLatest!(1, {
      connectionId: CONN,
      cursor: null,
      credentials: CREDS,
      config: CONFIG,
      streamHash: "h1",
    });
    expect(latest.map((r) => r.eventId)).toEqual(["airtable:conn_1:h1:recB"]);
    expect(calls).toHaveLength(1);
  });

  it("a missing token names the field and the fix instead of calling Airtable", async () => {
    const calls = stubFetch([{ records: [] }]);
    await expect(poll({ credentials: {} })).rejects.toThrow(/apiKey/);
    expect(calls).toHaveLength(0);
  });
});
