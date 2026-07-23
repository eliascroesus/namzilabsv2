import { describe, it, expect } from "vitest";
import { isDateHintedName, normalizeDateValue, normalizeDatesDeep } from "@/lib/normalize-dates";

/**
 * The date detector must be BULLETPROOF in both directions:
 *  - every common date shape any connector emits converts to the canonical form;
 *  - nothing that isn't a date is ever touched (false positives destroy data).
 */

describe("isDateHintedName", () => {
  it("recognizes snake_case, camelCase and plain date-ish names", () => {
    for (const name of ["created_at", "createdAt", "Timestamp", "booking_date", "Due Date", "startTime", "dob", "scheduled_on", "ts"]) {
      expect(isDateHintedName(name), name).toBe(true);
    }
  });
  it("rejects names that merely contain date-ish substrings", () => {
    for (const name of ["status", "location", "attachment", "rating", "monday_revenue" /* "monday" is one token */, "category", "won"]) {
      expect(isDateHintedName(name), name).toBe(false);
    }
  });
});

describe("normalizeDateValue — shapes that MUST convert", () => {
  const cases: Array<[unknown, string, string?]> = [
    // ISO family (idempotency: canonical in → canonical out)
    ["2026-07-21", "2026-07-21"],
    ["2026-7-1", "2026-07-01"],
    ["2026/07/21", "2026-07-21"],
    ["2026-07-21T14:23:45.000Z", "2026-07-21T14:23:45.000Z"],
    ["2026-07-21T14:23:45Z", "2026-07-21T14:23:45.000Z"],
    ["2026-07-21 14:23:45", "2026-07-21T14:23:45.000Z"], // naive → UTC, deterministic
    ["2026-07-21T14:23:45+02:00", "2026-07-21T12:23:45.000Z"],
    ["2026-07-21T14:23:45.123456Z", "2026-07-21T14:23:45.123Z"],
    // Sheets / US style
    ["7/21/2026", "2026-07-21"],
    ["7/21/2026 14:23:45", "2026-07-21T14:23:45.000Z"],
    ["7/21/2026 2:23 PM", "2026-07-21T14:23:00.000Z"],
    ["12/31/2026 12:00 AM", "2026-12-31T00:00:00.000Z"],
    // Day-first when the day makes month impossible; dotted dates read day-first
    ["21/07/2026", "2026-07-21"],
    ["21.07.2026", "2026-07-21"],
    ["01.02.2026", "2026-02-01"], // dotted → D.M.Y
    ["01-02-2026", "2026-01-02"], // dashed → M-D-Y (US default)
    // Month names
    ["Jan 5, 2026", "2026-01-05"],
    ["January 5 2026", "2026-01-05"],
    ["5 Jan 2026", "2026-01-05"],
    ["05-Jan-2026", "2026-01-05"],
    ["5th January, 2026", "2026-01-05"],
    ["Jan 5, 2026 10:30", "2026-01-05T10:30:00.000Z"],
    // RFC 2822
    ["Tue, 05 Jan 2026 10:00:00 GMT", "2026-01-05T10:00:00.000Z"],
    ["Tue, 05 Jan 2026 10:00:00 +0200", "2026-01-05T08:00:00.000Z"],
    // Numeric shapes — ONLY with a date-hinted field name
    [1750000000, "2025-06-15T15:06:40.000Z", "created_at"],
    [1750000000000, "2025-06-15T15:06:40.000Z", "createdAt"],
    ["1750000000", "2025-06-15T15:06:40.000Z", "timestamp"],
    ["20260721", "2026-07-21", "booking_date"],
    ["7/21/26", "2026-07-21", "date"], // 2-digit year allowed only with a hint
  ];
  for (const [input, expected, field] of cases) {
    it(`${JSON.stringify(input)}${field ? ` (field ${field})` : ""} → ${expected}`, () => {
      expect(normalizeDateValue(input, field ?? "")).toBe(expected);
    });
  }
});

describe("normalizeDateValue — values that must NEVER convert", () => {
  const cases: Array<[unknown, string?]> = [
    // Plain numbers / money / counts — even in date-hinted fields when out of range
    [42, "created_at"],
    [1234.56, "created_at"],
    ["1,234.56"],
    ["42"],
    ["$1,750,000,000"],
    // Numeric timestamps WITHOUT a name hint (could be revenue, an id…)
    [1750000000, "revenue"],
    ["1750000000", "amount"],
    ["20260721", "invoice_number"],
    // Phones, versions, IPs, ids
    ["555-123-4567", "phone"],
    ["(555) 123-4567"],
    ["1.2.3"],
    ["192.168.1.1"],
    ["v2026.07.21"],
    ["2026-07-23-report"],
    ["order-2026-07-23"],
    // Partial / ambiguous — no year, no day, bare year
    ["7/21"],
    ["Jan 2026"],
    ["2026"],
    ["14:23:45"],
    // Impossible calendar dates
    ["2026-02-30"],
    ["13/13/2026"],
    ["Feb 30, 2026"],
    ["0/5/2026"],
    // Out-of-range years
    ["7/21/1850"],
    ["2450-01-01"],
    // Not dates at all
    ["hello world"],
    [""],
    [null],
    [true],
    [{ a: 1 }],
  ];
  for (const [input, field] of cases) {
    it(`${JSON.stringify(input)}${field ? ` (field ${field})` : ""} stays untouched`, () => {
      expect(normalizeDateValue(input, field ?? "")).toBeNull();
    });
  }
});

describe("normalizeDatesDeep", () => {
  it("rewrites detected dates and leaves everything else byte-identical", () => {
    const props = {
      Timestamp: "7/21/2026 14:23:45",
      email: "a@b.com",
      amount: "1250",
      created_at: 1750000000,
      note: "call on 7/21", // not a full date — untouched
      status: "active",
    };
    expect(normalizeDatesDeep(props)).toEqual({
      Timestamp: "2026-07-21T14:23:45.000Z",
      email: "a@b.com",
      amount: "1250",
      created_at: "2025-06-15T15:06:40.000Z",
      note: "call on 7/21",
      status: "active",
    });
  });

  it("recurses into nested objects and arrays (element hint = the array's key)", () => {
    const props = {
      meeting: { start_time: "2026-07-21 09:00", location: "HQ" },
      dates: ["7/21/2026", "not a date"],
      items: [{ due: "Jan 5, 2026", qty: 3 }],
    };
    const out = normalizeDatesDeep(props) as typeof props;
    expect((out.meeting as Record<string, unknown>).start_time).toBe("2026-07-21T09:00:00.000Z");
    expect((out.meeting as Record<string, unknown>).location).toBe("HQ");
    expect(out.dates).toEqual(["2026-07-21", "not a date"]);
    expect(out.items[0]).toEqual({ due: "2026-01-05", qty: 3 });
  });

  it("is idempotent — normalizing twice changes nothing", () => {
    const once = normalizeDatesDeep({ ts: "7/21/2026 2:23 PM", d: "21.07.2026", n: "42" });
    expect(normalizeDatesDeep(once)).toEqual(once);
  });

  it("never touches internal __ engine keys and tolerates null/undefined", () => {
    expect(normalizeDatesDeep(null)).toEqual({});
    expect(normalizeDatesDeep(undefined)).toEqual({});
    const props = { __count_n1: 20260721, ts: "2026-07-21" };
    expect(normalizeDatesDeep(props).__count_n1).toBe(20260721);
  });
});
