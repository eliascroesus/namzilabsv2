/**
 * THE BOARD'S MEASUREMENTS, IN A MODULE WITH NO `"use client"` DIRECTIVE.
 *
 * That absence is the whole reason this file exists separately from
 * `board-layout.tsx`. A constant shared across the server/client boundary must
 * live in a plain module: a client module's export becomes a THROWING STUB when
 * a server component imports it, and since these are className fragments the
 * stub stringifies into the markup and the layout silently loses its width with
 * nothing in the console. `tests/page-width.test.ts` documents the same trap for
 * the calendar's day-cell height, which is where this rule was learned.
 */

/**
 * ONE COLUMN, ONE TILE WIDE.
 *
 * The arithmetic, so this is a decision rather than a number somebody liked:
 * `PageContainer` caps at `max-w-6xl` (1152px) and the `lg` gutter is 32px a
 * side, so the content is 1088px. Three 310px columns plus two 16px gaps is
 * 962, which leaves 126px of a FOURTH column visible at the right edge — and
 * that peek is the entire affordance saying the board scrolls sideways.
 *
 * 352px was the alternative and is what a tile measures on today's 3-up grid
 * ((1088 − 32) / 3). It fits exactly three columns with nothing left over, so
 * the board looks like it ends where the page does. Tiles narrowing from 352 to
 * 310 the moment a first group is created is the cost, and it is paid once.
 */
export const COLUMN_W = "w-[310px]";

/**
 * The gap between columns, and between tiles stacked inside one.
 *
 * The same `gap-4` `BOARD_GRID` uses, so a board and a grid are spaced by one
 * number rather than by two that happen to match today.
 */
export const LANE_GAP = "gap-4";

/**
 * HOW A HORIZONTAL SCROLLER REACHES THE GUTTER WITHOUT INDENTING ITS CONTENT.
 *
 * A bare `overflow-x-auto` CLIPS THE FOCUS RING of its first and last child, so
 * a keyboard user loses the outline at exactly the two ends they arrive at. The
 * negative margin lets the ring breathe out into the page gutter while the
 * matching padding keeps the content where it was. Lifted verbatim in shape
 * from the dashboard's own range track, which explains it at the point of use.
 */
export const SCROLLER_BLEED = "-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8";
