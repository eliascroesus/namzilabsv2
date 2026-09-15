import { describe, it, expect } from "vitest";
import { fieldsForGroup, filterFields } from "@/components/flow/controls/field-utils";
import type { DataField } from "@/components/flow/controls/types";

/**
 * SEARCHING A NUMBER PICKER BY THE NAME ON SCREEN.
 *
 * A Calculate's number picker lists one column per step and calls it "Output
 * number" on every one of them. So the only string that tells two steps apart
 * is the STEP's name — and it was the one string the search could not see:
 * `filterFields` reads a column's label, path and sample value. Typing
 * "booking" with three steps called Booking rate matched nothing, and the
 * flyout answered "No fields match", which is true about columns and useless
 * to the person reading step names.
 */
const num = (label: string, path: string, sample: unknown = 1): DataField => ({
  label,
  path,
  type: "number",
  sample,
});

const OUTPUT = [num("Output number", "__count_n9", 2130)];

describe("finding a step by its own name", () => {
  it("keeps a step's columns when the query names the STEP", () => {
    const out = fieldsForGroup({ title: "Bookings by hour", stepNo: 9 }, OUTPUT, "booking");
    expect(out.map((f) => f.label)).toEqual(["Output number"]);
  });

  it("matches the step number too, because it is on screen beside the name", () => {
    expect(fieldsForGroup({ title: "Bookings by hour", stepNo: 9 }, OUTPUT, "9")).toHaveLength(1);
  });

  it("is case- and spacing-insensitive, like every other search here", () => {
    expect(fieldsForGroup({ title: "Booking rate by hour", stepNo: 10 }, OUTPUT, "BOOKING RATE")).toHaveLength(1);
  });

  it("still finds nothing in a step the query does not name", () => {
    // The negative half: without it "matches the step" could be "matches
    // everything", which is not a search.
    expect(fieldsForGroup({ title: "Response time", stepNo: 8 }, OUTPUT, "booking")).toHaveLength(0);
  });

  it("still matches a COLUMN when the step's name does not", () => {
    // The original behaviour, unchanged — a step called something else that
    // happens to carry a `booked_at` column is still findable.
    const fields = [num("Booked at", "properties.booked_at")];
    expect(fieldsForGroup({ title: "Response time", stepNo: 8 }, fields, "booked")).toHaveLength(1);
  });

  it("keeps the type chip a question about the COLUMN, not the step", () => {
    /**
     * Naming the step does not turn a text column into a number. The chip is
     * applied first and survives the name match, or "Numbers" would start
     * listing dates the moment somebody typed a step's name.
     */
    const mixed = [num("Output number", "__count_n9"), { label: "Setter", path: "properties.setter", type: "string" as const, sample: "Ana" }];
    const out = fieldsForGroup({ title: "Bookings by hour", stepNo: 9 }, mixed, "bookings", "number");
    expect(out.map((f) => f.label)).toEqual(["Output number"]);
  });

  it("leaves the column-only search exactly as it was", () => {
    // `filterFields` is still the rule for everything below a group heading.
    expect(filterFields(OUTPUT, "output")).toHaveLength(1);
    expect(filterFields(OUTPUT, "booking")).toHaveLength(0);
    // …including its match on a sample VALUE, which is how you find a column
    // by something you can see in it.
    expect(filterFields(OUTPUT, "2130")).toHaveLength(1);
  });
});
