import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE BOARD'S CROSS-FILE AGREEMENTS.
 *
 * Text assertions against source, for the reason `page-width.test.ts` and
 * `chrome-band.test.ts` both give: the failure being guarded is two files
 * disagreeing, which no amount of rendering either one can catch. Three of
 * these guard hazards that produce no error at all — a className that
 * stringifies a function, a query that runs on every poll, a grid class spelled
 * twice — and are only visible as a layout that is quietly wrong.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const shape = read("src/app/dashboard/board-shape.ts");
const layout = read("src/app/dashboard/board-layout.tsx");
const page = read("src/app/dashboard/page.tsx");
const arrange = read("src/lib/board/arrange.ts");
const store = read("src/lib/board/store.ts");
const types = read("src/lib/board/types.ts");

/**
 * Prose about a query is not a query. `check-ui.ts` strips comments for exactly
 * this reason before applying its rules, and the first version of the
 * cost assertions below failed on the word `count(*)` inside the comment
 * forbidding it.
 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("constants that cross the server/client boundary", () => {
  it("live in modules with no \"use client\" directive", () => {
    /**
     * THE TRAP `page-width.test.ts` DOCUMENTS FOR THE CALENDAR'S DAY CELL. A
     * client module's export becomes a THROWING STUB when a server component
     * imports it — and because these are className fragments, the stub
     * stringifies into the markup and the column silently loses its width with
     * nothing in the console to say so.
     *
     * `board-shape.ts` is imported by the client board; `types.ts` is imported
     * by BOTH the server page and the client board. Neither may become a client
     * module.
     */
    expect(shape).not.toMatch(/^\s*"use client"/m);
    expect(types).not.toMatch(/^\s*"use client"/m);
    expect(arrange).not.toMatch(/^\s*"use client"/m);
    // And the page — a server component — really does import from them.
    expect(page).toMatch(/from "@\/lib\/board\/types"/);
  });

  it("spells the column width once, as a decision with arithmetic behind it", () => {
    // 1088px of content at `lg`, three 310px columns and two 16px gaps = 962,
    // leaving 126px of a fourth column visible. That peek IS the affordance
    // that says the board scrolls; a width that fits exactly looks like an end.
    expect(shape).toMatch(/export const COLUMN_W = "w-\[310px\]";/);
    const uses = (layout.match(/w-\[\d+px\]/g) ?? []).length;
    expect(uses, "the column width is spelled in the layout instead of imported").toBe(0);
  });
});

describe("the grid the dashboard had before groups", () => {
  it("is imported, never re-spelled", () => {
    /**
     * `tests/page-width.test.ts` fails the build if the literal
     * "sm:grid-cols-2 xl:grid-cols-3" appears anywhere but `ui/page.tsx`. Belt
     * and braces from this side: the zero-group board must reach for the same
     * constant the page used to, so "looks exactly as it did" cannot drift into
     * "looks close enough".
     */
    expect(layout).toMatch(/import \{ BOARD_GRID \} from "@\/components\/ui\/page";/);
    expect(layout).toMatch(/\$\{BOARD_GRID\}/);
    expect(layout).not.toMatch(/grid-cols-/);
  });

  it("keeps the same wrapper classes the page used to emit", () => {
    // The zero-group promise, as bytes rather than as an intention.
    expect(layout).toMatch(/mt-4 items-start \$\{BOARD_GRID\}/);
  });
});

describe("what the board costs on every freshness poll", () => {
  it("reads the placements only when a group exists", () => {
    /**
     * `FreshnessPoller` re-runs this page every twelve seconds in every open
     * tab. A workspace with no groups cannot have placements, and at launch
     * every workspace is that workspace — so the second query is conditional
     * and the common case stays at one.
     */
    expect(page).toMatch(/if \(groups\.length > 0\) placements = await listTilePlacements\(db, orgId\)/);
  });

  it("never counts, joins or queries per tile", () => {
    /**
     * The three things that will otherwise creep in later, each for a plausible
     * reason: a `count(*)` per group for the header badge, a join to
     * flow_results to decorate a placement, a per-tile lookup. The header counts
     * are computed in JS from rows already in hand.
     */
    expect(code(store)).not.toMatch(/count\(/);
    expect(code(store)).not.toMatch(/innerJoin|leftJoin/);
    expect(code(store)).not.toMatch(/flowResults/);
  });

  it("lists its columns rather than selecting the row", () => {
    // A wide column added to either table later must not ride along on the
    // hottest page in the product — the `dashboard-tiles.test.ts` discipline.
    expect(store).not.toMatch(/\.select\(\)/);
    expect(store.match(/\.select\(\{/g) ?? []).toHaveLength(2);
  });
});

describe("the tile bridge", () => {
  it("carries no functions across the RSC boundary", () => {
    /**
     * A React element serializes into a client component's props anywhere in
     * the tree, including inside an array of objects. A FUNCTION does not, and
     * one slipped in beside `node` fails the build with an error that names
     * nothing useful. Pinned as the absence of a handler in the type.
     */
    expect(types).toMatch(/node: ReactNode;/);
    expect(types).not.toMatch(/=>\s*void/);
    expect(types).not.toMatch(/^\s*on[A-Z]\w*[?]?:/m);
  });
});
