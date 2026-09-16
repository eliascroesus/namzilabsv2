import { describe, it, expect, vi, afterEach } from "vitest";
import { googleAnalyticsConnector } from "@/connectors/google-analytics";
import { catalogEntry } from "@/connectors/catalog";

/**
 * GOOGLE ANALYTICS 4 — asserted against the Data API v1beta reference, read
 * 16 Sep 2026.
 *
 * ═══ WHY THIS CONNECTOR NEEDS MORE THAN THE USUAL SHAPE TEST ═══
 *
 * Every other connector here reads ENTITIES: a booking, a payment, a meeting.
 * They arrive with a provider id, and dedupe is that id. `runReport` returns
 * the output of a GROUP BY — rows that do not exist until you ask for them and
 * that carry no id at all — so this connector MINTS the identity, and every
 * correctness property of the sync rests on that mint being right.
 *
 * So what is tested here is mostly the id: that it is stable across re-reads
 * (which is what makes a trailing window safe instead of a duplicate factory),
 * that it changes when the row is genuinely a different fact, and that it
 * cannot be collided by a dimension value containing the separator.
 *
 * NOTHING HERE HAS TALKED TO GOOGLE. The catalog says so too
 * (`verified: { live: null }`). These are assertions about our own arithmetic
 * over a payload shaped like the published reference — they cannot catch a
 * reference we read wrong, which is the failure mode Fathom shipped.
 */

afterEach(() => vi.unstubAllGlobals());

const ARGS = {
  connectionId: "conn_1",
  cursor: null,
  credentials: { accessToken: "ya29.test" },
  config: { propertyId: "properties/123456789" },
  streamHash: "stream_a",
};

/** A response shaped exactly as the reference documents it. */
function report(rows: Array<{ dims: string[]; mets: string[] }>, over: Record<string, unknown> = {}) {
  return {
    dimensionHeaders: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metricHeaders: [
      { name: "sessions", type: "TYPE_INTEGER" },
      { name: "engagedSessions", type: "TYPE_INTEGER" },
      { name: "totalUsers", type: "TYPE_INTEGER" },
      { name: "screenPageViews", type: "TYPE_INTEGER" },
      { name: "conversions", type: "TYPE_INTEGER" },
    ],
    rows: rows.map((r) => ({
      dimensionValues: r.dims.map((value) => ({ value })),
      metricValues: r.mets.map((value) => ({ value })),
    })),
    rowCount: rows.length,
    metadata: { timeZone: "America/New_York", currencyCode: "USD" },
    ...over,
  };
}

function stubOnce(payload: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

const ROW_A = { dims: ["20260901", "Organic Search"], mets: ["1843", "1190", "1502", "4021", "12"] };
const ROW_B = { dims: ["20260901", "Direct"], mets: ["962", "544", "871", "1990", "4"] };

describe("the request it builds", () => {
  it("posts runReport to the property path, and asks for its quota back", async () => {
    const calls = stubOnce(report([ROW_A]));
    await googleAnalyticsConnector.poll!(ARGS);

    expect(calls[0].url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport");
    const body = calls[0].body as Record<string, unknown>;
    /**
     * Token price is not per-request — it scales with rows, cardinality and
     * range — so a static budget is a guess and this flag is the only real
     * measurement of what a call cost. Pinned because dropping it is invisible
     * until a customer's property is locked out for an hour.
     */
    expect(body.returnPropertyQuota, "the only way to see quota burn").toBe(true);
    expect(body.limit).toBe(10_000);
  });

  it("accepts a bare numeric property id as well as the full path", async () => {
    // Discovery hands over `properties/123`, but a person typing into the field
    // will write the number they see in the GA UI.
    const calls = stubOnce(report([ROW_A]));
    await googleAnalyticsConnector.poll!({ ...ARGS, config: { propertyId: "123456789" } });
    expect(calls[0].url).toContain("/properties/123456789:runReport");
  });

  it("refuses to guess a property", async () => {
    stubOnce(report([]));
    await expect(googleAnalyticsConnector.poll!({ ...ARGS, config: {} })).rejects.toThrow(/no property selected/);
  });
});

describe("the row identity, which is the whole design", () => {
  it("is stable across a re-read, so a trailing window updates instead of duplicating", async () => {
    stubOnce(report([ROW_A]));
    const first = await googleAnalyticsConnector.poll!(ARGS);
    // The same row, re-read after Google revised the numbers upward.
    stubOnce(report([{ ...ROW_A, mets: ["1901", "1220", "1540", "4102", "13"] }]));
    const second = await googleAnalyticsConnector.poll!(ARGS);

    expect(first.records[0].eventId).toBe(second.records[0].eventId);
    expect(first.records[0].properties!.sessions).toBe(1843);
    expect(second.records[0].properties!.sessions, "the value moved, the identity did not").toBe(1901);
  });

  it("separates two rows that differ only in a dimension", async () => {
    stubOnce(report([ROW_A, ROW_B]));
    const { records } = await googleAnalyticsConnector.poll!(ARGS);
    expect(new Set(records.map((r) => r.eventId)).size).toBe(2);
  });

  it("cannot be collided by a value containing the separator", async () => {
    /**
     * THE CLASSIC JOIN BUG. With a comma or a colon between tuple members,
     * `["a,b", "c"]` and `["a", "b,c"]` produce the same string and therefore
     * the same id — two genuinely different rows silently become one. Channel
     * names contain spaces and page paths contain nearly everything, so this
     * is not hypothetical.
     */
    const three = (a: string, b: string) => {
      const r = report([{ dims: ["20260901", a, b], mets: ["1", "1", "1", "1", "1"] }]);
      r.dimensionHeaders = [{ name: "date" }, { name: "sessionDefaultChannelGroup" }, { name: "country" }];
      return r;
    };
    const idOf = async (a: string, b: string) => {
      stubOnce(three(a, b));
      const r = await googleAnalyticsConnector.poll!(ARGS);
      return r.records[0].eventId;
    };

    /**
     * TWO PAIRS, BECAUSE THE TWO WRONG ANSWERS COLLIDE DIFFERENTLY — and the
     * first version of this test used only one pair and therefore proved
     * nothing. Checked by sabotage: with `join(",")` the suite stayed green
     * until the comma pair was added.
     *
     *   - joined with a COMMA: breaks when a VALUE contains a comma, so the
     *     colliding pair keeps the split point and moves the comma.
     *   - joined with NOTHING: breaks on any two tuples made of the same
     *     characters, so the colliding pair moves the split point.
     *
     * A unit separator survives both: it cannot occur in a GA dimension value.
     */
    expect(await idOf("a,b", "c"), "a comma separator would collide these").not.toBe(await idOf("a", "b,c"));
    expect(await idOf("a", "bc"), "no separator at all would collide these").not.toBe(await idOf("ab", "c"));
  });

  it("separates two differently-grouped reports over the same property and day", async () => {
    // `date x channel` and `date x country` are different FACTS. Without the
    // report shape in the key they collide on (property, date) and overwrite
    // each other with differently-grouped numbers.
    stubOnce(report([ROW_A]));
    const byChannel = await googleAnalyticsConnector.poll!(ARGS);
    stubOnce(report([ROW_A]));
    const byCountry = await googleAnalyticsConnector.poll!({
      ...ARGS,
      config: { ...ARGS.config, dimensions: "date, country" },
    });
    expect(byChannel.records[0].eventId).not.toBe(byCountry.records[0].eventId);
  });

  it("separates the same property read through two streams", async () => {
    stubOnce(report([ROW_A]));
    const a = await googleAnalyticsConnector.poll!(ARGS);
    stubOnce(report([ROW_A]));
    const b = await googleAnalyticsConnector.poll!({ ...ARGS, streamHash: "stream_b" });
    expect(a.records[0].eventId).not.toBe(b.records[0].eventId);
  });
});

describe("what a row says", () => {
  it("dates it in the PROPERTY's timezone, not UTC", async () => {
    /**
     * `20260901` in America/New_York is 04:00 UTC, not midnight. Parsed as UTC
     * every row lands on the wrong day for everyone west of Greenwich — and
     * this product's whole job is putting numbers on days.
     */
    stubOnce(report([ROW_A]));
    const { records } = await googleAnalyticsConnector.poll!(ARGS);
    expect(records[0].occurredAt.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("parses metric values, which arrive as strings even when integer", async () => {
    stubOnce(report([ROW_A]));
    const { records } = await googleAnalyticsConnector.poll!(ARGS);
    expect(records[0].properties!.sessions).toBe(1843);
    expect(records[0].properties!.totalUsers).toBe(1502);
    expect(typeof records[0].properties!.sessions).toBe("number");
  });

  it("keeps (not set) and (other) as the real values they are", async () => {
    // Normalising them away merges genuinely different rows: "(other)" is
    // Google's high-cardinality rollup and "(not set)" is a real bucket.
    stubOnce(report([{ dims: ["20260901", "(not set)"], mets: ["5", "5", "5", "5", "0"] }]));
    const { records } = await googleAnalyticsConnector.poll!(ARGS);
    expect(records[0].properties!.sessionDefaultChannelGroup).toBe("(not set)");
  });

  it("zips values against the response's own headers, not the request's order", async () => {
    // The response carries `dimensionHeaders`; assuming the order we asked for
    // is the order we got would transpose two dimensions of equal cardinality
    // without any error at all.
    const swapped = report([ROW_A]);
    swapped.dimensionHeaders = [{ name: "sessionDefaultChannelGroup" }, { name: "date" }];
    stubOnce({ ...swapped, rows: [{ dimensionValues: [{ value: "Organic Search" }, { value: "20260901" }], metricValues: ROW_A.mets.map((value) => ({ value })) }] });
    const { records } = await googleAnalyticsConnector.poll!(ARGS);
    expect(records[0].properties!.sessionDefaultChannelGroup).toBe("Organic Search");
    expect(records[0].occurredAt.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });
});

describe("the window it declares", () => {
  it("retires against exactly the span it read", async () => {
    /**
     * `types.ts` is explicit: a connector must use the SAME value for its
     * request bound and for the retirement it declares, or a deepened import
     * gets retired by the next sweep. This connector is the shape that hits it
     * hardest, because the window IS its only sync mechanism.
     */
    const calls = stubOnce(report([ROW_A]));
    const res = await googleAnalyticsConnector.poll!(ARGS);
    const body = calls[0].body as { dateRanges: Array<{ startDate: string }> };
    expect(res.retireOutsideWindow!.from.toISOString().slice(0, 10)).toBe(body.dateRanges[0].startDate);
  });

  it("honours a deeper windowFloor rather than clamping to its own trailing days", async () => {
    const floor = new Date("2026-01-01T00:00:00.000Z");
    const calls = stubOnce(report([ROW_A]));
    const res = await googleAnalyticsConnector.poll!({ ...ARGS, windowFloor: floor });
    const body = calls[0].body as { dateRanges: Array<{ startDate: string }> };
    expect(body.dateRanges[0].startDate).toBe("2026-01-01");
    expect(res.retireOutsideWindow!.from.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("does not retire anything when the page budget cut the read short", async () => {
    // A prefix of the window is not the window; retiring against it would
    // tombstone every row past the last page reached.
    stubOnce(report([ROW_A], { rowCount: 999_999 }));
    const res = await googleAnalyticsConnector.poll!(ARGS);
    expect(res.retireOutsideWindow, "a prefix must claim nothing").toBeUndefined();
    expect(res.incomplete).toBe(true);
  });
});

describe("it agrees with its catalog entry", () => {
  it("declares every operation the catalog budgets for", () => {
    const entry = catalogEntry("ganalytics")!;
    expect(entry).toBeDefined();
    for (const op of googleAnalyticsConnector.operations ?? []) {
      expect(entry.rateLimits?.[op], `${op} has no declared rate limit`).toBeDefined();
    }
    expect(googleAnalyticsConnector.operationFor!({})).toBe("properties.runReport");
    expect(googleAnalyticsConnector.listOperationFor!("propertyId")).toBe("accountSummaries.list");
  });

  it("is poll-only, and says so in both places", () => {
    const entry = catalogEntry("ganalytics")!;
    // GA4 has no outbound webhook for report data. A connector claiming
    // instant delivery it cannot do shows a customer a promise nothing keeps.
    expect(entry.instant).toBe(false);
    expect(entry.poll).toBe(true);
    expect(googleAnalyticsConnector.verifySignature({} as never)).toBe(false);
    expect(googleAnalyticsConnector.normalize!({}, {} as never)).toEqual([]);
  });
});

describe("discovering properties", () => {
  it("returns every property across every account, labelled by account", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          accountSummaries: [
            {
              displayName: "Namzilabs",
              propertySummaries: [
                { property: "properties/1", displayName: "Website", propertyType: "PROPERTY_TYPE_ORDINARY" },
                { property: "properties/2", displayName: "App" },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const opts = await googleAnalyticsConnector.listOptions!("propertyId", ARGS as never);
    expect(opts.map((o) => o.value)).toEqual(["properties/1", "properties/2"]);
    // One person's "Website" can exist under three accounts.
    expect(opts[0].label).toBe("Website — Namzilabs");
  });

  it("treats no access as nothing to connect, not a failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(googleAnalyticsConnector.listOptions!("propertyId", ARGS as never)).resolves.toEqual([]);
  });
});
