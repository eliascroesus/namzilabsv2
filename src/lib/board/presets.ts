import { GRID_COLS } from "./grid";

/**
 * A LAYOUT A VIEW CAN START FROM — the shape, and nothing else.
 *
 * A template here is a custom view that arrives with its boxes already placed
 * and NONE of them pointing at a metric. That second half is what makes the
 * first half possible: an arrangement is portable between workspaces, and the
 * metrics in it are the one part that never is. So a preset is positions and
 * chart kinds, and every tile it lands is `UNSET_TILE_KEY` — the same empty
 * slot that adding a chart by hand now produces.
 *
 * IT IS ALSO THE THUMBNAIL. The picker draws its preview from this same array
 * rather than from a hand-made picture, so the card cannot promise a layout the
 * template does not create. That is the argument the picker already makes for
 * drawing previews from tokens instead of shipping screenshots — a picture and
 * the thing it depicts drift the moment they are two objects.
 *
 * DIRECTIVE-FREE, because both halves import it: the server action that writes
 * the rows and the client picker that draws them. A `"use client"` here would
 * make the array a throwing stub on the server — the trap `lib/board/types.ts`
 * documents at length.
 */
export type PresetTile = { chart: string; x: number; y: number; w: number; h: number };
export type ViewPreset = {
  id: string;
  label: string;
  /** What the shape is FOR, in the picker's card. */
  blurb: string;
  tiles: readonly PresetTile[];
};

/**
 * THE ONE PRESET SO FAR — two charts over a row of headline numbers.
 *
 * The most-requested dashboard shape there is, and the one this product's own
 * board already converges on: a couple of things you watch over time, then the
 * figures you quote. Sizes are the CHARTS' OWN DEFAULTS (`defaultSize`) rather
 * than numbers invented here — 6×6 for a plot, 3×4 for a number — so a preset
 * tile is exactly what you would get by adding that chart by hand, and the two
 * paths cannot disagree about how big a thing is.
 *
 * Twelve columns exactly, twice: two 6-wide plots, then four 3-wide numbers.
 * `PRESETS_FILL_THE_GRID` in the tests pins that, because a preset that leaves
 * a gap looks like a bug in the board rather than a choice in the template.
 */
export const REPORT_PRESET: ViewPreset = {
  id: "report",
  label: "Report",
  blurb: "Two charts over a row of headline numbers.",
  tiles: [
    { chart: "area", x: 0, y: 0, w: 6, h: 6 },
    { chart: "line", x: 6, y: 0, w: 6, h: 6 },
    { chart: "number", x: 0, y: 6, w: 3, h: 4 },
    { chart: "number", x: 3, y: 6, w: 3, h: 4 },
    { chart: "number", x: 6, y: 6, w: 3, h: 4 },
    { chart: "number", x: 9, y: 6, w: 3, h: 4 },
  ],
} as const;

export const VIEW_PRESETS: readonly ViewPreset[] = [REPORT_PRESET];

/** A posted preset id, or null — the same "unknown reads as nothing" rule
 *  `asViewKind` follows, so a hand-edited form cannot mint an odd layout. */
export function asPreset(v: unknown): ViewPreset | null {
  return VIEW_PRESETS.find((p) => p.id === v) ?? null;
}

/** The rows a preset occupies — what the thumbnail scales itself against. */
export function presetRows(p: ViewPreset): number {
  return Math.max(...p.tiles.map((t) => t.y + t.h));
}

/** The grid a preset is laid out on, so the preview and the board agree. */
export const PRESET_COLS = GRID_COLS;
