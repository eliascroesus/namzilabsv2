import { describe, it, expect } from "vitest";
import { rankFields, toDataGroups } from "@/components/flow/field-groups";
import { catalogEntry } from "@/connectors/catalog";
import type { FieldGroup } from "@/components/flow/graph-utils";

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
});
