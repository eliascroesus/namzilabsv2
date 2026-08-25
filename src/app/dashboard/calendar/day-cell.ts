/**
 * A DAY SQUARE'S HEIGHT, WHICH IS NOT ONE NUMBER ANY MORE.
 *
 * The sheet fills the page now, and seven columns across an ultrawide put a
 * 92px-tall cell at better than three to one — a letterbox slot, not a day.
 * The width is not the thing to cap: a month grid IS the page it is on, and
 * capping it would leave a sheet marooned in canvas on the one screen with
 * room to read it comfortably. So the cell gets taller as it gets wider, on
 * the same two rungs the boards gain columns at.
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
export const DAY_CELL_H = "min-h-[92px] 2xl:min-h-[116px] 3xl:min-h-[140px]";
