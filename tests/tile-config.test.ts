import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accentOf, fieldsFor, honoured, parseTileConfig, TILE_CONFIG_KEYS } from "@/lib/board/tile-config";
import { BLOCK_IDS, CHART_IDS } from "@/lib/board/charts";
import { MATERIALIZED_RANGES } from "@/lib/metrics/range";

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

/**
 * THE FIELD MATRIX — the reason a control cannot lie about what it does.
 *
 * `CONFIG_FIELDS` is read by the panel to decide what to OFFER and by the
 * renderer to decide what to HONOUR. That is the whole point of writing it
 * once: a colour picker on a chart that draws from a fixed palette is a
 * control that changes nothing, and two separate lists would grow one
 * eventually. These assertions are what keep the single list honest as charts
 * are added.
 */
describe("what each chart offers", () => {
  it("covers every chart, with no invented keys", () => {
    for (const id of CHART_IDS) {
      const fields = fieldsFor(id);
      expect(fields.length, `${id} offers nothing at all`).toBeGreaterThan(0);
      for (const f of fields) {
        expect(TILE_CONFIG_KEYS, `${id} offers "${f}", which is not a config key`).toContain(f);
      }
      // Every tile can be renamed, whatever it is.
      expect(fields, `${id} must offer a name`).toContain("title");
      /**
       * A PERIOD ONLY IF THERE IS DATA TO WINDOW. Blocks are furniture — a
       * heading pinned to "Last 7 days" would be a control with nothing behind
       * it — so the rule is per kind rather than universal.
       */
      const isBlock = (BLOCK_IDS as readonly string[]).includes(id);
      expect(fields.includes("rangeKey"), `${id} and its period`).toBe(!isBlock);
    }
  });

  it("leaves no key that no chart can reach", () => {
    // A key in the schema that no chart offers is a setting nobody can change
    // and nothing reads — dead weight in every stored bag.
    const reachable = new Set(CHART_IDS.flatMap((id) => [...fieldsFor(id)]));
    expect([...TILE_CONFIG_KEYS].filter((k) => !reachable.has(k))).toEqual([]);
  });

  it("offers a colour only where the mark actually takes one", () => {
    /**
     * The specific lie this table exists to prevent. `PieChart` and `GoalBar`
     * take no accent — the pie draws from `SLICE_ORDER`, the goal bar from
     * success/brand tokens — so a colour control on either would be a swatch
     * that does nothing. Sabotage: add "color" to `pie` and this fails.
     */
    expect(fieldsFor("pie")).not.toContain("color");
    expect(fieldsFor("progress")).not.toContain("color");
    expect(fieldsFor("bar")).toContain("color");
    expect(fieldsFor("pipeline")).toContain("color");
  });

  it("offers donut and legend to the pie and to nothing else", () => {
    for (const id of CHART_IDS) {
      const has = fieldsFor(id).includes("donut") || fieldsFor(id).includes("legend");
      expect(has, `${id} should not offer pie-only settings`).toBe(id === "pie");
    }
  });

  it("drops the settings a chart cannot use, so a switched chart starts clean", () => {
    // Set a colour on a bar, switch to a pie: the stored key survives (switch
    // back and it returns) but the pie never sees it.
    const bag = { color: "teal", donut: true, title: "Revenue" } as const;
    expect(honoured("bar", bag)).toEqual({ color: "teal", title: "Revenue" });
    expect(honoured("pie", bag)).toEqual({ donut: true, title: "Revenue" });
  });

  it("only lets a tile pin a period the metric was actually computed for", () => {
    // The override reads `byRange`, which is keyed by MATERIALIZED_RANGES. A
    // key outside that list would read a slot nothing ever wrote.
    for (const key of MATERIALIZED_RANGES) expect(parseTileConfig({ rangeKey: key })).toEqual({ rangeKey: key });
    expect(parseTileConfig({ rangeKey: "upcoming" })).toEqual({});
    expect(parseTileConfig({ rangeKey: "last-tuesday" })).toEqual({});
  });
});

describe("the colour key is a key, not anything that answers to `in`", () => {
  it("refuses inherited Object properties", () => {
    /**
     * `c in GROUP_ACCENT` walks the prototype chain, so "constructor",
     * "toString" and "__proto__" all passed validation, were persisted, and
     * then resolved in `accentOf` to a FUNCTION — which React stringifies into
     * the style attribute. `Object.hasOwn` is the whole fix, in both places.
     */
    for (const key of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(parseTileConfig({ color: key }), `"${key}" must not validate`).toEqual({});
    }
    expect(parseTileConfig({ color: "teal" })).toEqual({ color: "teal" });
  });

  it("degrades an unpalatable stored value to the kit's own mark colour", () => {
    // Belt and braces: a row written before the schema was tightened must not
    // render a function into a style attribute.
    expect(accentOf("constructor")).toBe("var(--color-brand-600)");
    expect(accentOf("nope")).toBe("var(--color-brand-600)");
    expect(accentOf(undefined)).toBe("var(--color-brand-600)");
    expect(accentOf("teal")).not.toBe("var(--color-brand-600)");
  });
});
