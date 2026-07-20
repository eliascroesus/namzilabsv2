import { describe, it, expect } from "vitest";
import { operatorsForType, operatorOptions } from "@/components/flow/controls/operators";
import { sourceStyle } from "@/components/flow/controls/source-style";
import {
  valueType,
  isContainerValue,
  humanizeKey,
  formatSample,
  childFields,
  makeFieldRef,
  resolveRef,
  fieldRefIsStale,
  hasAnyFields,
  filterFields,
} from "@/components/flow/controls/field-utils";
import type { DataGroup, FieldRef } from "@/components/flow/controls/types";

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

describe("valueType — classify raw samples like schema-infer", () => {
  it("recognises numbers, booleans, containers", () => {
    expect(valueType(42)).toBe("number");
    expect(valueType(true)).toBe("boolean");
    expect(valueType([1, 2])).toBe("list");
    expect(valueType({ a: 1 })).toBe("object");
    expect(valueType(null)).toBe("unknown");
  });
  it("recognises string sub-types (email, date, numeric string, text)", () => {
    expect(valueType("a@b.com")).toBe("email");
    expect(valueType("2026-01-05T10:00:00Z")).toBe("date");
    expect(valueType("12.5")).toBe("number");
    expect(valueType("hello")).toBe("text");
  });
  it("isContainerValue is true only for objects/arrays", () => {
    expect(isContainerValue({ a: 1 })).toBe(true);
    expect(isContainerValue([1])).toBe(true);
    expect(isContainerValue("x")).toBe(false);
    expect(isContainerValue(null)).toBe(false);
  });
});

describe("humanizeKey — human field names, never raw paths", () => {
  it("strips a properties. prefix and title-cases", () => {
    expect(humanizeKey("properties.status")).toBe("Status");
    expect(humanizeKey("properties.utm_source")).toBe("Utm source");
  });
  it("splits camelCase and takes the last dotted segment", () => {
    expect(humanizeKey("firstName")).toBe("First name");
    expect(humanizeKey("properties.utm.source")).toBe("Source");
  });
});

describe("formatSample — compact previews", () => {
  it("summarises containers instead of dumping JSON", () => {
    expect(formatSample({ a: 1, b: 2 })).toBe("{ 2 fields }");
    expect(formatSample([1, 2, 3])).toBe("3 items");
  });
  it("truncates long strings and drops empties", () => {
    expect(formatSample("")).toBeNull();
    expect(formatSample(null)).toBeNull();
    expect(formatSample("x".repeat(60))!.endsWith("…")).toBe(true);
  });
});

describe("childFields — drill into nested samples", () => {
  it("expands object keys with extended paths and inferred types", () => {
    const kids = childFields({ path: "properties.utm", label: "Utm", container: true, sample: { source: "google", clicks: 5 } });
    expect(kids.map((k) => k.path)).toEqual(["properties.utm.source", "properties.utm.clicks"]);
    expect(kids.find((k) => k.path === "properties.utm.clicks")?.type).toBe("number");
    expect(kids.find((k) => k.path === "properties.utm.source")?.label).toBe("Source");
  });
  it("expands array items by index", () => {
    const kids = childFields({ path: "properties.items", label: "Items", container: true, sample: [{ p: 1 }, { p: 2 }] });
    expect(kids.map((k) => k.path)).toEqual(["properties.items.0", "properties.items.1"]);
    expect(kids[0].label).toBe("Item 1");
    expect(kids[0].container).toBe(true);
  });
  it("returns nothing for a leaf value", () => {
    expect(childFields({ path: "value", label: "Value", sample: 10 })).toEqual([]);
  });
});

describe("field references — resolve + stale detection (never silently remapped)", () => {
  const groups: DataGroup[] = [
    {
      stepId: "s1",
      stepNo: 1,
      source: "calendly",
      title: "Get data",
      fields: [
        { path: "subject", label: "Subject", type: "text", sample: "a@b.com" },
        { path: "properties.utm", label: "Utm", type: "object", container: true, sample: { source: "google" } },
      ],
    },
  ];

  it("makeFieldRef snapshots identity + display info", () => {
    const ref = makeFieldRef(groups[0], groups[0].fields[0]);
    expect(ref).toMatchObject({ producerStepId: "s1", fieldPath: "subject", label: "Subject", source: "calendly", stepNo: 1 });
  });
  it("resolves an exact field and a drilled-in child via its ancestor", () => {
    const exact: FieldRef = { producerStepId: "s1", fieldPath: "subject", label: "Subject" };
    expect(resolveRef(exact, groups)?.field.path).toBe("subject");
    const nested: FieldRef = { producerStepId: "s1", fieldPath: "properties.utm.source", label: "Source" };
    expect(resolveRef(nested, groups)?.field.path).toBe("properties.utm.source");
  });
  it("flags a reference stale when the step or field is gone", () => {
    expect(fieldRefIsStale({ producerStepId: "s1", fieldPath: "subject", label: "Subject" }, groups)).toBe(false);
    expect(fieldRefIsStale({ producerStepId: "gone", fieldPath: "subject", label: "Subject" }, groups)).toBe(true);
    expect(fieldRefIsStale({ producerStepId: "s1", fieldPath: "properties.missing", label: "?" }, groups)).toBe(true);
  });
  it("hasAnyFields + filterFields power the browser affordances", () => {
    expect(hasAnyFields(groups)).toBe(true);
    expect(hasAnyFields([{ stepId: "x", title: "empty", fields: [] }])).toBe(false);
    expect(filterFields(groups[0].fields, "utm").map((f) => f.path)).toEqual(["properties.utm"]);
    expect(filterFields(groups[0].fields, "").length).toBe(2);
  });
});
