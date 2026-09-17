import { describe, it, expect } from "vitest";
import { parseDayInput } from "@/lib/metrics/day-input";

/**
 * THE TYPED DATE, PARSED.
 *
 * This runs with `TZ=UTC`, which means the one bug it most needs to catch is
 * invisible to it: a parser that went through `new Date(text)` would agree with
 * every assertion here and be a day out for anyone west of Greenwich. So the
 * guard against that is structural — the module matches every format explicitly
 * and builds with `Date.UTC` — and what these assertions cover is the rest:
 * which spellings are accepted, and that nothing that is not a date becomes one.
 */

describe("the spellings a person actually types", () => {
  it("reads back the format the field itself prints", () => {
    // The overwhelmingly common edit is to select what is there and change
    // part of it, so this one has to work or nothing else matters.
    expect(parseDayInput("Aug 19, 2026")).toBe("2026-08-19");
    expect(parseDayInput("Aug 19 2026")).toBe("2026-08-19");
    expect(parseDayInput("August 19, 2026")).toBe("2026-08-19");
    expect(parseDayInput("  aug   19 ,  2026 ")).toBe("2026-08-19");
  });

  it("reads ISO, which is what anyone who works with data types", () => {
    expect(parseDayInput("2026-08-19")).toBe("2026-08-19");
    expect(parseDayInput("2026-8-9")).toBe("2026-08-09");
  });

  it("reads slashes month-first, matching the en-US the field renders in", () => {
    expect(parseDayInput("8/19/2026")).toBe("2026-08-19");
    expect(parseDayInput("08/19/2026")).toBe("2026-08-19");
  });

  it("reads day-first when a month NAME makes the order unambiguous", () => {
    expect(parseDayInput("19 Aug 2026")).toBe("2026-08-19");
    expect(parseDayInput("1 September 2026")).toBe("2026-09-01");
  });

  it("takes `sept`, which enough people write to be worth naming", () => {
    expect(parseDayInput("Sept 1, 2026")).toBe("2026-09-01");
  });
});

describe("what it refuses, and why each one matters", () => {
  it("refuses a day that does not exist rather than sliding it", () => {
    /**
     * `Date.UTC(2026, 1, 30)` is cheerfully 2 March. A day somebody cannot have
     * meant must not quietly become one they did not pick — this is the round
     * trip `parseCustomRange` does on a URL, applied to a keystroke.
     */
    expect(parseDayInput("Feb 30, 2026")).toBeNull();
    expect(parseDayInput("2026-02-30")).toBeNull();
    expect(parseDayInput("2025-02-29"), "2025 is not a leap year").toBeNull();
    expect(parseDayInput("2024-02-29"), "2024 is").toBe("2024-02-29");
    expect(parseDayInput("13/1/2026"), "there is no thirteenth month").toBeNull();
  });

  it("refuses a two-digit year rather than guessing a century", () => {
    // A silent guess on the control that decides which numbers the whole
    // dashboard shows is worse than two more characters.
    expect(parseDayInput("8/19/26")).toBeNull();
    expect(parseDayInput("Aug 19, 26")).toBeNull();
  });

  it("refuses a word that merely STARTS like a month", () => {
    /**
     * THE ASSERTION THAT PAID FOR ITSELF. Matching on the first three letters —
     * the obvious implementation — reads "junk" as June and "mayonnaise" as
     * May. A typo silently becoming a date is exactly what a parser on this
     * control must not do.
     */
    expect(parseDayInput("junk 5 2026")).toBeNull();
    expect(parseDayInput("mayonnaise 5 2026")).toBeNull();
    expect(parseDayInput("decade 5 2026")).toBeNull();
  });

  it("refuses the empty, the partial and the nonsense", () => {
    for (const bad of ["", "   ", "Aug", "Aug 2026", "2026", "tomorrow", "last week", "19/8", "--", "0/0/0000"]) {
      expect(parseDayInput(bad), `"${bad}" is not a day`).toBeNull();
    }
  });

  it("refuses a year outside the range any window here can mean", () => {
    // Every window in this product is measured from the epoch; four digits or
    // it is a typo.
    expect(parseDayInput("1900-01-01")).toBeNull();
    expect(parseDayInput("1969-12-31")).toBeNull();
    expect(parseDayInput("1970-01-01")).toBe("1970-01-01");
  });
});

describe("it never reaches for the platform parser", () => {
  it("does not accept a format only `new Date` would", () => {
    /**
     * These all parse under `new Date(...)` in V8 and none of them is a format
     * this module claims. If one starts passing, somebody has reached for the
     * platform parser — which is the local-time bug this file cannot otherwise
     * see, because the suite runs in UTC.
     */
    for (const engineOnly of ["Wed Aug 19 2026", "2026/08/19", "August 19, 2026 10:00:00", "20 August 2026 GMT"]) {
      expect(parseDayInput(engineOnly), `"${engineOnly}" should not be recognised here`).toBeNull();
    }
  });
});
