import { describe, it, expect } from "vitest";
import { storedToValue, valueToStored, asFilterConfig } from "@/components/flow/panel-mappers";
import { toDataGroups } from "@/components/flow/field-groups";
import type { DataGroup } from "@/components/flow/controls/types";
import type { FieldGroup } from "@/components/flow/graph-utils";

const groups: DataGroup[] = [
  {
    stepId: "s1",
    stepNo: 1,
    source: "calendly",
    title: "Get data",
    fields: [
      { path: "subject", label: "Subject", type: "text", sample: "a@b.com" },
      { path: "properties.plan", label: "Plan", type: "text", sample: "pro" },
    ],
  },
];

describe("panel value mappers — config <-> ValueModel round-trip", () => {
  it("reads a fixed literal and folds it back to the same keys", () => {
    const v = storedToValue({ replaceWith: "hello", replaceWithKind: "fixed" }, "replaceWith", groups);
    expect(v).toEqual({ mode: "fixed", text: "hello", field: null });
    expect(valueToStored(v, "replaceWith")).toEqual({ replaceWithKind: "fixed", replaceWith: "hello", replaceWithField: undefined });
  });

  it("reads a mapped field, snapshotting display info from the groups", () => {
    const v = storedToValue({ replaceWithKind: "field", replaceWithField: "properties.plan" }, "replaceWith", groups);
    expect(v.mode).toBe("field");
    expect(v.field).toMatchObject({ fieldPath: "properties.plan", label: "Plan", source: "calendly", stepNo: 1, producerStepId: "s1" });
    expect(valueToStored(v, "replaceWith")).toEqual({ replaceWithKind: "field", replaceWithField: "properties.plan", replaceWith: "" });
  });

  it("falls back to a humanised label when the mapped field is no longer present", () => {
    const v = storedToValue({ defaultValueKind: "field", defaultValueField: "properties.utm_source" }, "defaultValue", groups);
    expect(v.field?.label).toBe("Utm source");
    expect(v.field?.producerStepId).toBe("");
  });

  it("defaults an empty blob to a fixed empty value", () => {
    expect(storedToValue({}, "replaceWith", groups)).toEqual({ mode: "fixed", text: "", field: null });
  });
});

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
