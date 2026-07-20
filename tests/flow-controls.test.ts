import { describe, it, expect } from "vitest";
import { operatorsForType, operatorOptions } from "@/components/flow/controls/operators";
import { sourceStyle } from "@/components/flow/controls/source-style";

describe("operatorsForType — operators match the field type", () => {
  it("offers numeric comparisons for number fields, not text ones", () => {
    const ops = operatorsForType("number");
    expect(ops).toContain("gt");
    expect(ops).toContain("lte");
    expect(ops).not.toContain("contains");
  });
  it("offers text operators for text/email fields", () => {
    expect(operatorsForType("text")).toContain("contains");
    expect(operatorsForType("email")).toContain("starts_with");
  });
  it("offers date operators for date fields, not text ones", () => {
    const d = operatorsForType("date");
    expect(d).toContain("before");
    expect(d).toContain("between");
    expect(d).not.toContain("contains");
  });
  it("limits booleans to equality/emptiness", () => {
    expect(operatorsForType("boolean")).toEqual(["equals", "not_equals", "is_empty", "is_not_empty"]);
  });
  it("defaults to text operators for unknown types, with human labels", () => {
    expect(operatorsForType(undefined)).toContain("equals");
    const opts = operatorOptions("number");
    expect(opts.find((o) => o.value === "gt")?.label).toBe("Greater than");
  });
});

describe("sourceStyle — app-agnostic brand badges", () => {
  it("returns brand colour + short label for a known source", () => {
    expect(sourceStyle("calendly").short).toBe("Ca");
    expect(sourceStyle("gsheets").label).toBe("Google Sheets");
  });
  it("falls back to a neutral badge for unknown/future sources", () => {
    const s = sourceStyle("hubspot");
    expect(s.short).toBe("Hu");
    expect(s.color).toBeTruthy();
  });
});
