/**
 * THE CUSTOM CANVAS'S GEOMETRY, AS ARITHMETIC.
 *
 * A groups view orders tiles in a list, so its whole geometry is one fractional
 * key per tile (`order.ts`). A custom view puts them in BOXES on a twelve-column
 * grid, which is a genuinely different problem: boxes can overlap, boxes can
 * float, and two boxes can want the same cell. This module is the answer to all
 * of it, and it is deliberately the ONLY answer — the live drag preview, the
 * committed write and the server-side placement of a newly added tile all call
 * the same functions, so what you see while dragging IS the outcome.
 *
 * That last point is the whole design. The groups board learned it the
 * expensive way: when the thing that draws the placeholder and the thing that
 * computes the drop are two implementations of one idea, they drift, and the
 * bug reads as "the drop landed in the wrong place" rather than as "two
 * functions disagree".
 *
 * NO `"use client"`, and that absence is load-bearing rather than incidental —
 * the same rule `board-shape.ts` and `arrange.ts` carry. A client module's
 * exports become throwing stubs when a server component imports one, and the
 * SERVER needs this file: `addCustomTileAction` places a new tile with the same
 * `compact` the browser previews it with. Pure arithmetic, no DOM, no clock, no
 * randomness.
 *
 * UNITS ARE COLUMNS AND ROWS, NEVER PIXELS. Pixels live in `board-shape.ts`
 * (`ROW_H`, `GRID_GAP`) and are read only by the CSS and the resize hook.
 */

/** One tile's box on the grid. `x`/`w` are columns; `y`/`h` are rows. */
export type GridBox = { id: string; x: number; y: number; w: number; h: number };

/** The stored layout is always the twelve-column one. See `reflow`. */
export const GRID_COLS = 12;

/**
 * ONE ROW'S PITCH IN PIXELS — THE GUTTER INCLUDED.
 *
 * Forty-eight is a row PLUS the gap beneath it, so a tile `h` rows tall
 * measures `h * ROW_UNIT_PX - GRID_GAP_PX`: a number tile at `h: 4` is 168px, a
 * chart at `h: 6` is 264px. Getting this backwards — treating 48 as the row and
 * adding the gap on top — inflates every tile by 24px per row, which is 96px on
 * a number tile and looks like a padding bug rather than an arithmetic one.
 *
 * THE GAP IS 24 BECAUSE THE PAGE'S GUTTER IS 24. It was 16, which made this the
 * one grid in the product whose tiles sat closer to each other than the page
 * sits to its own edges. The ROW stays 24; only the gutter moved, so the pitch
 * went 40 -> 48 and every tile is proportionally taller.
 *
 * The CSS spells the same fact the other way round (`grid-auto-rows: 24px` with
 * `gap: 24px`), which is why both numbers live here rather than one here and
 * one in a stylesheet: the resize gesture converts pixels to rows with this
 * pitch, and if it and the grid disagreed a tile would settle a row away from
 * where it was dropped.
 */
export const ROW_UNIT_PX = 48;

/** The gutter between cells, both axes. Must equal the CSS `gap`. */
export const GRID_GAP_PX = 24;

/** Column counts the board is rendered into: desktop, tablet, phone. */
export type GridCols = 12 | 6 | 1;

/**
 * Do two boxes share any cell? Touching edges do NOT overlap — a tile ending at
 * column 6 and one starting at column 6 sit side by side, and an inclusive
 * comparison here would push every neighbour down a row forever.
 */
function overlaps(a: GridBox, b: GridBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Fit a box inside the grid: at least one cell, never wider than the grid, never
 * hanging off either edge, never above the top.
 *
 * `w` is clamped BEFORE `x`, because clamping `x` against an unclamped `w` can
 * produce a negative left edge — a fourteen-wide box would be pushed to `x: -2`
 * and render off the side of the page.
 */
function clampBox(box: GridBox, cols: number): GridBox {
  const w = Math.min(Math.max(1, Math.round(box.w)), cols);
  const h = Math.max(1, Math.round(box.h));
  const x = Math.min(Math.max(0, Math.round(box.x)), cols - w);
  const y = Math.max(0, Math.round(box.y));
  return { id: box.id, x, y, w, h };
}

/**
 * Reading order, with one tile allowed to win its row.
 *
 * `first` is what makes a drop feel like a drop. Without it the tile you just
 * dropped sorts BEHIND the tile already sitting there — same row, larger `x` or
 * a later id — so it floats back to where it came from and the gesture reads as
 * having done nothing at all. With it, the moved tile is placed first and the
 * one it landed on is pushed down, which is what the pointer said.
 */
function orderOf(b: GridBox, first?: string): [number, number, number, string] {
  return [b.y, b.id === first ? 0 : 1, b.x, b.id];
}

function compareOrder(a: [number, number, number, string], b: [number, number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);
}

/**
 * FLOAT EVERYTHING UP, IN READING ORDER, RESOLVING EVERY OVERLAP ON THE WAY.
 *
 * Deliberately TOTAL rather than partial: hand it any set of boxes —
 * overlapping, out of bounds, negative, in any order — and it returns a layout
 * with no overlaps and no vertical holes. That totality is what lets one
 * function be the entire engine, and what makes a layout read from the database
 * safe to trust without validating it first.
 *
 * The walk is: take each box in reading order, drop it to `y = 0`, and raise it
 * one row at a time until it collides with nothing already placed. Terminates
 * because `y` is bounded by the total height of the boxes ahead of it.
 *
 * IDEMPOTENT — `compact(compact(x))` equals `compact(x)` — because a compacted
 * layout re-walked in the same order finds every box already at the lowest row
 * it can occupy. `tests/board-grid.test.ts` proves it over randomised inputs,
 * because "obviously" is how the groups board's ordering bug survived review.
 */
export function compact<T extends GridBox>(tiles: readonly T[], cols: number = GRID_COLS, first?: string): T[] {
  const sorted = tiles
    .map((t) => ({ t, box: clampBox(t, cols), key: orderOf(t, first) }))
    .sort((a, b) => compareOrder(a.key, b.key));

  const out: T[] = [];
  for (const { t, box } of sorted) {
    let y = 0;
    // eslint-disable-next-line no-loop-func -- `out` is read, never captured.
    while (out.some((placed) => overlaps({ ...box, y }, placed))) y++;
    // The caller's own row rides through untouched — a stored tile carries its
    // `tileKey`, `chart` and `config`, and zipping those back on afterwards is
    // an opportunity to lose one.
    out.push({ ...t, x: box.x, y, w: box.w, h: box.h });
  }
  /**
   * RETURNED IN CANONICAL READING ORDER, which is a stronger promise than
   * "these boxes do not overlap" and the one idempotence actually needs.
   *
   * Boxes are PLACED in input order, so without this the output array is
   * ordered by where each box started rather than where it ended up — and a
   * second pass, which sorts by the new positions, returns the same geometry in
   * a different array order. The layout was stable; the list was not. That is
   * enough to make React re-key every cell and to make `compact(compact(x))`
   * fail a deep-equal for reasons that have nothing to do with the layout.
   */
  return out.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * THE SAME SAVED LAYOUT, RENDERED INTO A NARROWER GRID — AND NEVER WRITTEN BACK.
 *
 * One layout is stored, at twelve columns, and the tablet and phone renderings
 * are computed from it. The alternative — a stored layout per breakpoint — is
 * three things to keep in step and two of them are edited by nobody.
 *
 * THERE IS DELIBERATELY NO INVERSE, and that is a constraint on the gestures
 * rather than an omission here. A six-column layout cannot be widened back into
 * the twelve-column one it came from without inventing information, so a drag
 * performed against a narrow rendering has nothing honest to save. The resize
 * hook refuses to start unless the live grid measures twelve columns.
 *
 * WIDTHS ARE SCALED AND TILES ARE RE-FLOWED; the desktop `x` is NOT reused.
 * Scaling both edges of a box independently is the obvious approach and it is
 * wrong: two quarter-width tiles side by side (x 0 and x 3, each w 3) both round
 * to two columns of six and land on columns 0-1 and 1-2, overlapping in column
 * one. So the narrow renderings pack left to right in the desktop READING
 * ORDER, wrapping when the next tile will not fit, which is what a responsive
 * grid means and what keeps a full-width tile full width at every size.
 *
 * The `y` handed to `compact` is the reading index rather than a row: it exists
 * only to make the sort reproduce that order, and gravity then decides the real
 * rows.
 */
export function reflow<T extends GridBox>(tiles: readonly T[], cols: GridCols): T[] {
  if (cols === GRID_COLS) return compact(tiles, GRID_COLS);
  let cursor = 0;
  const flowed = compact(tiles, GRID_COLS).map((b, i) => {
    const w = Math.min(cols, Math.max(1, Math.round((b.w * cols) / GRID_COLS)));
    if (cursor + w > cols) cursor = 0;
    const x = cursor;
    cursor = cursor + w >= cols ? 0 : cursor + w;
    return { ...b, x, w, y: i };
  });
  return compact(flowed, cols);
}

/**
 * THE THREE RENDERINGS, MERGED PER TILE INTO THE PROPERTIES THE CSS READS.
 *
 * `.board-canvas` changes its column count at two breakpoints and each
 * `.board-cell` reads `--c12/--r12`, `--c6/--r6` or `--c1/--r1` accordingly, so
 * every cell has to carry all three. Computing them here rather than in the
 * component keeps the off-by-one in one place: CSS grid lines are 1-BASED and
 * these coordinates are 0-based, so a tile at `x: 3` starts at line 4. That
 * single `+ 1` is the kind of thing that is wrong for a week in a component and
 * obvious in a function with a test.
 *
 * Returned in the DESKTOP reading order, which is the DOM order at every width
 * — the cells are placed on explicit lines, so this decides tab order rather
 * than position, and desktop reading order is the only order a phone can
 * honestly present.
 */
export function canvasCells<T extends GridBox>(tiles: readonly T[]): Array<{ tile: T; vars: Record<string, string> }> {
  const byId = (cols: GridCols) => new Map(reflow(tiles, cols).map((b) => [b.id, b]));
  const at: Array<[string, Map<string, T>]> = [
    ["12", byId(12)],
    ["6", byId(6)],
    ["1", byId(1)],
  ];
  return compact(tiles, GRID_COLS).map((tile) => {
    const vars: Record<string, string> = {};
    for (const [suffix, placed] of at) {
      const b = placed.get(tile.id);
      if (!b) continue;
      vars[`--c${suffix}`] = `${b.x + 1} / span ${b.w}`;
      vars[`--r${suffix}`] = `${b.y + 1} / span ${b.h}`;
    }
    return { tile, vars };
  });
}
