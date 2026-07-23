import { describe, it, expect } from "vitest";
import { asFilterConfig } from "@/components/flow/panel-mappers";
import { toDataGroups } from "@/components/flow/field-groups";
import type { FieldGroup } from "@/components/flow/graph-utils";

describe("asFilterConfig — loose config -> FilterConfig", () => {
  it("supplies defaults for a bare blob", () => {
    expect(asFilterConfig({})).toEqual({ combinator: "and", rules: [], dateRange: undefined });
  });
  it("preserves combinator, rules and date range", () => {
    const dr = { enabled: true, dateField: "occurredAt", mode: "preset", preset: "last_7_days", days: 7 };
    const fc = asFilterConfig({ combinator: "or", rules: [{ field: "subject", op: "equals", value: "x" }], dateRange: dr });
    expect(fc.combinator).toBe("or");
    expect(fc.rules).toHaveLength(1);
    expect(fc.dateRange).toEqual(dr);
  });
});

describe("toDataGroups — FieldGroup -> DataGroup adapter", () => {
  it("maps titles, brand source, samples and container flags", () => {
    const fg: FieldGroup[] = [
      { from: "1. Get data", stepNo: 1, appSource: "calendly", fields: [{ path: "properties.utm", label: "Utm", type: "object", example: { s: 1 }, container: true }] },
      { from: "Canonical fields", system: true, fields: [{ path: "value", label: "Value", type: "number", example: 10 }] },
    ];
    const dg = toDataGroups(fg);
    expect(dg[0]).toMatchObject({ title: "1. Get data", stepNo: 1, source: "calendly" });
    expect(dg[0].fields[0]).toEqual({ path: "properties.utm", label: "Utm", type: "object", sample: { s: 1 }, container: true });
    expect(dg[1].system).toBe(true);
    // Synthetic stepIds are unique per group so refs don't collide.
    expect(dg[0].stepId).not.toBe(dg[1].stepId);
  });
});
