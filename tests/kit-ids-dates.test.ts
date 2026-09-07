import { describe, it, expect } from "vitest";
import { eventId, naturalOrHash } from "@/connectors/kit/ids";
import { epochToDate, ymd, isoOrNull } from "@/connectors/kit/dates";
import { hashId } from "@/lib/ids";

describe("ids", () => {
  it("namespaces by source and connection, and hashes when there is no natural id", () => {
    expect(eventId("stripe", "c1", "evt_1")).toBe("stripe:c1:evt_1");
    expect(eventId("stripe", "c1", "refund", 42)).toBe("stripe:c1:refund:42");
    expect(naturalOrHash("stripe", "c1", "evt_1", {})).toBe("stripe:c1:evt_1");
    expect(naturalOrHash("stripe", "c1", null, { a: 1 })).toBe(hashId("stripe:c1", { a: 1 }));
  });
});

describe("dates", () => {
  it("epochToDate reads seconds, milliseconds, strings, and refuses junk", () => {
    expect(epochToDate(1_700_000_000, "s")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate(1_700_000_000_000, "ms")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate("1700000000")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate(1_700_000_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToDate("soon")).toBeNull();
    expect(epochToDate(null)).toBeNull();
  });
  it("ymd and isoOrNull", () => {
    expect(ymd(new Date("2026-09-07T23:59:59Z"))).toBe("2026-09-07");
    expect(isoOrNull("2026-09-07T10:00:00+02:00")).toBe("2026-09-07T08:00:00.000Z");
    expect(isoOrNull("nope")).toBeNull();
    expect(isoOrNull(undefined)).toBeNull();
  });
});
