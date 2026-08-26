import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTileConfig, TILE_CONFIG_KEYS } from "@/lib/board/tile-config";

/**
 * THE PRESENTATION BAG'S PARSER — and the property that makes it one.
 *
 * A single `z.object().safeParse` is all-or-nothing: one corrupt `limit`,
 * written by a buggy build or a hand in the SQL editor, would erase a
 * perfectly good `color` and render the tile with every default at once —
 * which reads as "my settings vanished". Here a bad value costs exactly its
 * own key, an unknown key costs nothing, and the worst possible input parses
 * to the empty config: what a tile with no choices made should look like.
 */

describe("each key parses independently", () => {
  it("a corrupt limit does not erase a good color", () => {
    const out = parseTileConfig({ color: "teal", limit: "forty", precision: 2 });
    expect(out).toEqual({ color: "teal", precision: 2 });
  });

  it("every corrupt value costs exactly its own key", () => {
    const out = parseTileConfig({
      title: 42,
      precision: 99,
      color: "#ff0000",
      target: "high",
      sort: "biggest",
      limit: 0,
      legend: "left",
      showDelta: "yes",
      donut: true,
    });
    expect(out).toEqual({ donut: true });
  });

  it("unknown keys are ignored on read, not errors", () => {
    // A key added by a future release must not make today's build render a
    // default-everything tile. (Preservation on WRITE is the merge's job —
    // setCustomTileAction overlays with jsonb `||` and never replaces the bag.)
    expect(parseTileConfig({ color: "blue", futureKey: { deep: true } })).toEqual({ color: "blue" });
  });

  it("never throws, whatever arrives", () => {
    for (const raw of [null, undefined, "config", 7, [1, 2], { title: "" }, { title: "   " }]) {
      expect(parseTileConfig(raw)).toEqual({});
    }
  });

  it("accepts a fully valid bag verbatim", () => {
    const full = {
      title: "Revenue, weekly",
      precision: 2,
      color: "teal",
      target: 40,
      showDelta: true,
      showGoal: false,
      showLabels: true,
      showSpark: false,
      sort: "value_desc",
      limit: 8,
      donut: true,
      legend: "bottom",
    };
    expect(parseTileConfig(full)).toEqual(full);
    // ...and a cleared target survives as the explicit null it is.
    expect(parseTileConfig({ target: null })).toEqual({ target: null });
  });
});

describe("what the schema refuses to contain", () => {
  it("has NO currency key — relabelling is not converting", () => {
    /**
     * `formatMetricValue`'s currency branch relabels, never converts: a
     * $12,400 metric restyled "EUR" would print €12,400, a confidently wrong
     * number of exactly the kind this feature exists to eliminate. Currency
     * stays a publish-time property of the metric.
     */
    expect(TILE_CONFIG_KEYS).not.toContain("currency");
    expect(parseTileConfig({ currency: "EUR" })).toEqual({});
    const src = readFileSync(join(process.cwd(), "src/lib/board/tile-config.ts"), "utf8");
    expect(src).toContain("NO `currency` KEY");
  });

  it("has no chart key — the chart is a column, and two homes is a drift", () => {
    expect(TILE_CONFIG_KEYS).not.toContain("chart");
  });
});
