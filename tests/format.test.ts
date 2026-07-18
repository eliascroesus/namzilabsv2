import { describe, it, expect } from "vitest";
import { formatMetric } from "@/lib/format";

describe("formatMetric (shared everywhere)", () => {
  it("respects decimal precision for percentages", () => {
    expect(formatMetric(75.675676, { format: "percent", precision: 2 })).toBe("75.68%");
    expect(formatMetric(75.675676, { format: "percent", precision: 0 })).toBe("76%");
  });
  it("formats currency and plain numbers", () => {
    expect(formatMetric(1234.5, { format: "currency", currency: "USD", precision: 2 })).toBe("$1,234.50");
    expect(formatMetric(1234.5, { format: "number", precision: 0 })).toBe("1,235");
    expect(formatMetric(42, { format: "number", unit: "calls" })).toBe("42 calls");
  });
  it("handles empty values", () => {
    expect(formatMetric(null)).toBe("—");
    expect(formatMetric(undefined)).toBe("—");
    expect(formatMetric(NaN)).toBe("—");
  });
});
