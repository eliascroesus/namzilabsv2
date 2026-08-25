/**
 * A DAY SQUARE'S HEIGHT — ONE NUMBER, AT EVERY VIEWPORT.
 *
 * It briefly grew at two breakpoints, to stop a month grid stretched across an
 * uncapped page turning its cells into letterbox slots. The page has a cap
 * again, so the sheet is a sheet at every size: seven columns inside 1152px is
 * a ~150px square, and 92px of height against it reads as a day rather than a
 * strip. Nothing about the calendar should change when you resize the window.
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
export const DAY_CELL_H = "min-h-[92px]";
