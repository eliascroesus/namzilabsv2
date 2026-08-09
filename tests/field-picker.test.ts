import { describe, it, expect } from "vitest";
import { prepareGroups, rankFields, toDataGroups } from "@/components/flow/field-groups";
import { filterFields, flattenFields } from "@/components/flow/controls/field-utils";
import { catalogEntry } from "@/connectors/catalog";
import type { FieldGroup } from "@/components/flow/graph-utils";
import type { DataField } from "@/components/flow/controls/types";

/**
 * The field picker's job on a real Close record — which carries ~480 fields.
 * Ranking is DISPLAY ONLY: everything stays present and pickable, the useful
 * handful just stops being buried under `data.address_id`.
 */

const f = (path: string) => ({ path, label: path });

describe("rankFields", () => {
  it("floats the catalog's common fields, in the catalog's order", () => {
    const ranked = rankFields("close", [
      f("properties.data.address_id"),
      f("properties.data.disposition"),
      f("properties.data.agent_config_id"),
      f("properties.data.direction"),
    ]);
    // direction before disposition — the catalog's order, not the input's.
    expect(ranked.map((x) => x.path)).toEqual([
      "properties.data.direction",
      "properties.data.disposition",
      "properties.data.address_id",
      "properties.data.agent_config_id",
    ]);
  });

  it("keeps every field — ranking never drops one", () => {
    const input = [f("a"), f("properties.data.direction"), f("b"), f("c")];
    const ranked = rankFields("close", input);
    expect(ranked).toHaveLength(input.length);
    expect(new Set(ranked.map((x) => x.path))).toEqual(new Set(input.map((x) => x.path)));
    // Unranked fields keep their relative order.
    expect(ranked.slice(1).map((x) => x.path)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for a source with no declared common fields", () => {
    const input = [f("z"), f("a")];
    expect(rankFields("webhook", input).map((x) => x.path)).toEqual(["z", "a"]);
    expect(rankFields(undefined, input).map((x) => x.path)).toEqual(["z", "a"]);
  });

  it("every declared common field is a real path shape, not a label", () => {
    // Sabotage guard: `data.direction` (missing the `properties.` prefix)
    // would rank nothing, silently — the picker's paths are full paths.
    for (const p of catalogEntry("close")!.commonFields!) {
      expect(p.startsWith("properties.")).toBe(true);
    }
  });

  it("applies through toDataGroups, the one adapter the picker reads", () => {
    const groups: FieldGroup[] = [
      {
        from: "1. Calls dialed",
        stepNo: 1,
        appSource: "close",
        fields: [
          { path: "properties.data.address_id", label: "Address id" },
          { path: "properties.data.direction", label: "Direction" },
        ],
      },
    ];
    expect(toDataGroups(groups)[0].fields.map((x) => x.path)).toEqual([
      "properties.data.direction",
      "properties.data.address_id",
    ]);
  });

  it("toDataGroups flattens too — one preparation, so every consumer sees the same list", () => {
    const groups: FieldGroup[] = [
      { from: "1. Calls", stepNo: 1, appSource: "close", fields: [{ path: "properties.data", label: "data", container: true, example: { direction: "outbound" } }] },
    ];
    expect(toDataGroups(groups)[0].fields.map((x) => x.path)).toContain("properties.data.direction");
  });
});


/**
 * THE REPORTED BUG. A Close call step lists 23 top-level fields, and every
 * field a person filters on (`direction`, `duration`, `disposition`) lives
 * inside the `data` object behind a drill-in. The browser searched only the
 * level it was standing on, so typing "direction" found nothing while the
 * Field input above it literally read "Direction" — data that looked
 * withheld.
 */
describe("flattenFields", () => {
  const callRecord = (): DataField[] => [
    { path: "properties.lead_id", label: "Lead id", type: "text", sample: "lead_1" },
    {
      path: "properties.data",
      label: "Data",
      type: "object",
      container: true,
      sample: { direction: "outbound", duration: 42, contact: { name: "Ana" } },
    },
    { path: "subject", label: "Subject / person", type: "text", sample: "+1555" },
  ];

  it("brings nested fields into the list, labelled with their RAW path", () => {
    const flat = flattenFields(callRecord());
    const direction = flat.find((f) => f.path === "properties.data.direction");
    expect(direction).toBeTruthy();
    // Raw — not "Data › Direction", not "Direction". The string in the list is
    // the string the engine resolves and the string the input box shows back.
    expect(direction!.label).toBe("data.direction");
    expect(direction!.sample).toBe("outbound");
    expect(flat.find((f) => f.path === "properties.data.contact.name")!.label).toBe("data.contact.name");
  });

  it("the list and the input box agree on every nested field", () => {
    // THE complaint: the picker said one thing ("Data › Direction") and the
    // box you picked into said another ("Direction"). FieldInput resolves the
    // chosen path against the SAME prepared groups, so they must be
    // byte-identical. Sabotage: humanize the child label and this fails.
    const [g] = prepareGroups([{ stepId: "s", title: "Calls", source: "close", fields: callRecord() }]);
    const row = g.fields.find((f) => f.path === "properties.data.direction")!;
    const shownInInput = g.fields.find((f) => f.path === "properties.data.direction")?.label;
    expect(shownInInput).toBe(row.label);
    expect(row.label).toBe("data.direction");
  });

  it("search finds a nested field — the exact thing that returned nothing", () => {
    // Sabotage: search the top-level array instead of the flattened one and
    // this is empty, which is precisely what the customer saw.
    expect(filterFields(flattenFields(callRecord()), "direction").map((f) => f.path)).toEqual([
      "properties.data.direction",
    ]);
    expect(filterFields(callRecord(), "direction")).toHaveLength(0);
  });

  it("keeps the container itself — flattening ADDS the contents, it never hides the parent", () => {
    const flat = flattenFields(callRecord());
    expect(flat.some((f) => f.path === "properties.data" && f.container)).toBe(true);
  });

  it("descends more than one level, and stops at the depth cap", () => {
    expect(flattenFields(callRecord()).some((f) => f.path === "properties.data.contact.name")).toBe(true);
    // Depth 1 = top level only: no children at all.
    expect(flattenFields(callRecord(), 1).some((f) => f.path.startsWith("properties.data."))).toBe(false);
  });

  it("honours the total cap so a pathological record can't hang the picker", () => {
    const wide: DataField[] = [
      { path: "properties.data", label: "Data", container: true, sample: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i])) },
    ];
    expect(flattenFields(wide, 3, 50)).toHaveLength(50);
  });
});

describe("the spine survives the 25-row cap", () => {
  it("occurredAt ranks into the head even when a source has hundreds of fields", () => {
    // buildFieldGroups appends the canonical fields LAST, so on a Close step
    // `occurredAt` — the default of every date picker — sat at index ~478 and
    // fell outside the visible 25. Sabotage: drop SPINE_FIELDS from
    // rankFields and this lands past 25.
    const many = Array.from({ length: 480 }, (_, i) => ({ path: `properties.data.f${String(i).padStart(3, "0")}`, label: `F${i}` }));
    const ranked = rankFields("close", [...many, { path: "occurredAt", label: "Occurred at" }]);
    expect(ranked.findIndex((f) => f.path === "occurredAt")).toBeLessThan(25);
  });
});
