/**
 * A DAY SQUARE'S SHAPE — A RATIO, NOT A HEIGHT.
 *
 * This was `min-h-[92px]`, flat at every viewport, and the note here argued that
 * "nothing about the calendar should change when you resize the window". That
 * held while the page was capped at 1152px, where seven columns are ~158px wide
 * and 92px tall reads as a day rather than a strip.
 *
 * The board runs UNCAPPED (`width="full"` — a grid of cards gains columns as the
 * window grows), so the same 92px against a 340px-wide cell on a 2560px display
 * is exactly the letterbox slot the flat value was meant to prevent. A fixed
 * height cannot be right at both widths; a RATIO is right at every width.
 *
 * 16/9 is within a hair of what the capped page produced by hand (158/92 =
 * 1.72), so the shape nobody complained about is the shape this preserves —
 * it just keeps it as the calendar gets wider instead of flattening.
 *
 * `min-h` SURVIVES AS A FLOOR. On a phone the seven columns are ~40px wide and
 * the ratio would give a 22px cell with a date and a percentage in it; when the
 * aspect-derived height falls under the floor, the floor wins and the cell grows
 * to fit its content instead of clipping it.
 *
 * ── WHY THIS IS ITS OWN FILE, WITH NO `"use client"` ───────────────────────
 *
 * Two things draw this square: `CalendarBoard.tsx`, which is a client
 * component, and `loading.tsx`, which is a SERVER component (the route is
 * `force-dynamic` and has a loading.tsx, so the fallback is server-rendered on
 * every request). A skeleton that disagrees with its page is a jump on arrival,
 * so both must read one value — but the value cannot live in the client module.
 *
 * A `"use client"` file's exports are not values on the server. Next's flight
 * loader replaces each one with a registered client reference — for an ESM
 * module, a throwing stub function — so interpolating it into a className on
 * the server does not fail loudly, which would at least be honest. It
 * stringifies the FUNCTION: every day cell ships a ~264-character class
 * attribute containing `function(){throw Error(...)}` and no height at all.
 * Thirty-five of them, on the shimmer that is supposed to prevent a jump.
 *
 * `src/components/flow/panel-chrome.tsx` carries the same note for the same
 * reason — `/design` is a server page that needs `PANEL_SHELL` as a string.
 * When a constant is shared across the server/client boundary, it belongs in a
 * module with no directive. Adding `"use client"` here re-breaks the skeleton
 * silently; tests/page-width.test.ts pins that it stays absent.
 */
export const DAY_CELL_H = "aspect-[16/9] min-h-[92px]";
