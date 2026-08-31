import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canvasRowFate, UNSET_TILE_KEY } from "@/lib/board/types";
import { PRESET_COLS, REPORT_PRESET, VIEW_PRESETS, asPreset, presetRows } from "@/lib/board/presets";
import { boardTileCap } from "@/lib/limits";
import { defaultSize } from "@/lib/board/charts";

/**
 * A CHART WITH NO METRIC YET, AND THE TEMPLATE BUILT OUT OF THEM.
 *
 * Adding a chart used to bind it to "the first metric that can draw it", so a
 * new tile arrived showing a number nobody chose. Now it arrives EMPTY and asks.
 * That one change is also what makes a layout template possible: an arrangement
 * travels between workspaces and the metrics in it never do, so a template can
 * only be a shape.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("an unset tile is not a dead one", () => {
  it("renders, rather than reporting a metric that was never chosen", () => {
    /**
     * THE BUG THIS PREVENTS, WHICH WOULD HAVE HIT EVERY NEW TILE AND EVERY
     * TEMPLATE. `canvasRowFate` answers "dead" for a key that joins to nothing
     * and is in no unfiltered set — which is exactly what an unset key looks
     * like to every test that function performs. Without the guard, a freshly
     * added chart would render "It isn't published any more": a deletion notice
     * for something that has never existed.
     *
     * `existing` is deliberately EMPTY here — that is the case that would fail.
     */
    expect(canvasRowFate(UNSET_TILE_KEY, false, new Set())).toBe("render");
    // And the two real fates are untouched.
    expect(canvasRowFate("flow:f1:o1", false, new Set())).toBe("dead");
    expect(canvasRowFate("flow:f1:o1", false, new Set(["flow:f1:o1"]))).toBe("hidden");
    expect(canvasRowFate("flow:f1:o1", true, new Set())).toBe("render");
  });

  it("is a sentinel, not a null column", () => {
    // `dashboard_tiles.tile_key` is NOT NULL. A nullable column would mean a
    // migration plus a third case in every reader; the sentinel keeps the
    // column's shape and puts the meaning in one exported constant.
    expect(UNSET_TILE_KEY).toBe("unset");
    expect(read("src/db/schema.ts")).toMatch(/tileKey: text\("tile_key"\)\.notNull\(\)/);
  });

  it("passes the key schema, so the action accepts what the menu sends", () => {
    const actions = read("src/app/dashboard/board-actions.ts");
    expect(actions).toMatch(/\$\{UNSET_TILE_KEY\}\|flow:/);
  });

  it("gets its own card, never DeadTile's", () => {
    const board = read("src/app/dashboard/custom-board.tsx");
    expect(board).toMatch(/if \(t\.tileKey === UNSET_TILE_KEY\)/);
    expect(board).toMatch(/function EmptyTile/);
    // The empty card opens the picker that already exists rather than a second
    // one — `setRepointing` is the same state the tile menu's Change metric uses.
    expect(board).toMatch(/onPick=\{\(\) => setRepointing\(tile\.id\)\}/);
  });

  it("offers every chart, since no metric constrains an empty tile", () => {
    // Narrowing to the empty set would leave a fresh tile unable to change its
    // own chart — the edit somebody is most likely to want before picking data.
    const page = read("src/app/dashboard/page.tsx");
    expect(page).toMatch(/charts: unset\s*\?\s*\(CHART_IDS as readonly string\[\]\)\.slice\(\)/);
  });

  it("never ranks as needing attention", () => {
    // An empty slot sorting above a genuinely broken number is the bug here.
    expect(read("src/app/dashboard/page.tsx")).toMatch(/attention: block \|\| unset \? 0/);
  });
});

describe("the Report preset", () => {
  it("fills the grid exactly, with no gaps and no overflow", () => {
    /**
     * A preset that leaves a hole reads as a bug in the board rather than a
     * choice in the template — and one that overflows twelve columns would be
     * silently compacted into a shape nobody designed.
     */
    const rows = presetRows(REPORT_PRESET);
    const cells = new Map<string, number>();
    for (const t of REPORT_PRESET.tiles) {
      expect(t.x + t.w, `${t.chart} overflows the grid`).toBeLessThanOrEqual(PRESET_COLS);
      for (let x = t.x; x < t.x + t.w; x++) {
        for (let y = t.y; y < t.y + t.h; y++) {
          const k = `${x},${y}`;
          cells.set(k, (cells.get(k) ?? 0) + 1);
        }
      }
    }
    // Every cell covered exactly once: no gap, no overlap.
    expect(cells.size).toBe(PRESET_COLS * rows);
    expect([...cells.values()].every((n) => n === 1)).toBe(true);
  });

  it("sizes every tile at its chart's OWN default", () => {
    /**
     * So a preset tile is exactly what adding that chart by hand produces, and
     * the two paths cannot disagree about how big a thing is. Inventing sizes
     * here would make the template a second opinion about the same question.
     */
    for (const t of REPORT_PRESET.tiles) {
      const d = defaultSize(t.chart as Parameters<typeof defaultSize>[0]);
      expect({ w: t.w, h: t.h }, `${t.chart} is not its default size`).toEqual(d);
    }
  });

  it("fits under the tile cap, so the template can always be created", () => {
    for (const p of VIEW_PRESETS) expect(p.tiles.length).toBeLessThanOrEqual(boardTileCap());
  });

  it("reads an unknown id as no preset", () => {
    // Same "unknown reads as nothing" rule `asViewKind` follows — a hand-edited
    // post gets an empty custom view, never a layout nobody defined.
    expect(asPreset("report")).toBe(REPORT_PRESET);
    for (const junk of ["", "Report", null, undefined, 7, {}]) expect(asPreset(junk)).toBeNull();
  });

  it("lands its tiles in the SAME statement as the view", () => {
    // A view holding four of its six boxes looks like a board somebody built
    // badly, and the customer cannot tell it is half. Same argument, and the
    // same CTE, as the calendar's placement.
    const actions = read("src/app/dashboard/board-actions.ts");
    const branch = actions.slice(actions.indexOf("} else if (preset) {"));
    expect(branch.slice(0, 900)).toMatch(/newViewCte\(/);
    expect(branch.slice(0, 900)).toMatch(/insert into \$\{dashboardTiles\}/);
    // Every tile it lands is empty — that is what makes it portable.
    expect(branch.slice(0, 900)).toMatch(/\$\{UNSET_TILE_KEY\}/);
  });

  it("draws its thumbnail FROM the preset, so the card cannot lie", () => {
    /**
     * Every other preview in the picker is a hand-made impression of a board.
     * This one is the layout itself, so the card cannot promise an arrangement
     * the template does not create — the same argument the picker already makes
     * for drawing previews from tokens rather than shipping screenshots, taken
     * one step further. A picture and the thing it depicts drift the moment they
     * are two objects.
     */
    const picker = read("src/app/dashboard/view-template-picker.tsx");
    expect(picker).toMatch(/REPORT_PRESET\.tiles\.map/);
    expect(picker).toMatch(/gridColumn: `\$\{t\.x \+ 1\} \/ span \$\{t\.w\}`/);
    // And it posts the preset it drew.
    expect(picker).toMatch(/name="preset" value=\{t\.preset\}/);
  });

  it("every template card has a UNIQUE id, because two share a kind", () => {
    /**
     * THE BUG THIS PINS, WHICH SHIPPED FOR ABOUT TEN MINUTES. The picker keyed
     * its cards on `kind`, and adding the preset made TWO of them
     * `kind: "custom"` — so React logged "Encountered two children with the
     * same key" and was free to drop or duplicate one. It rendered correctly
     * anyway, which is exactly why a test has to hold it: the failure is
     * conditional on reconciliation, not on the first paint.
     */
    const picker = read("src/app/dashboard/view-template-picker.tsx");
    const ids = [...picker.matchAll(/^\s{4}id: "?([\w.]+)"?,?$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size, `duplicate template ids: ${ids.join(", ")}`).toBe(ids.length);
    // And two of them genuinely do share a kind, which is the whole reason.
    // Comments stripped first: the note explaining this collision contains the
    // words `kind: "custom"`, and prose about a thing is not the thing —
    // `board-shape.test.ts` strips for exactly the same reason.
    const code = picker.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect((code.match(/kind: "custom"/g) ?? []).length).toBe(2);
  });

  it("is a CUSTOM view, so everything you can do to one you can do to it", () => {
    // A template is a starting arrangement, not a fourth kind of board.
    const picker = read("src/app/dashboard/view-template-picker.tsx");
    const card = picker.slice(picker.indexOf("preset: REPORT_PRESET.id") - 400, picker.indexOf("preset: REPORT_PRESET.id") + 100);
    expect(card).toMatch(/kind: "custom"/);
  });
});
