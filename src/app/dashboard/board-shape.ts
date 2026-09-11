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
 * matching padding keeps the content where it was.
 *
 * ── IT MUST EQUAL `PageContainer`'s OWN INSET, AND FOR A WHILE IT DID NOT ──
 *
 * This stepped — 16 / 24 / 32 — because the container used to step with it.
 * The container stopped: it is a FLAT `p-6` at every width now, deliberately,
 * so the page's content and the top bar's content stand on one vertical line
 * (see its own note). This constant did not follow, and the mismatch is not
 * cosmetic — it is arithmetic:
 *
 *     bleed 32, inset 24  ->  the scroller is 2x8 = 16px WIDER than the box
 *                             it sits in, at every `lg` width and above
 *
 * which is every desktop. The result was a horizontal scrollbar on the group
 * view with nothing in it wide enough to need one — reported as "it's suppose
 * to just be fill just like the other view pages", which is exactly right.
 *
 * Flat 24 now. A bleed SMALLER than the inset would merely fail to reach the
 * gutter; a bleed larger overflows the page. They have to be one number, and
 * the number belongs to the container.
 */
export const SCROLLER_BLEED = "-mx-6 px-6";
