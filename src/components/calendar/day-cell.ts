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
 * A CLAMP, NOT AN ASPECT RATIO — and dropping `aspect-ratio` is a bug fix
 * rather than a change of shape.
 *
 * `aspect-[2/1] min-h-[92px]` looks like "height follows width, with a floor".
 * It is not what CSS does. When the floor wins, the ratio runs BACKWARDS and
 * derives the WIDTH from it: each cell demanded 2 × 92 = 184px, seven of those
 * plus gaps overflowed the card, and the month grew a horizontal scrollbar with
 * Saturday cut off. It only appeared once the rail could be pinned, because
 * that is the first time the page was narrow enough for the floor to win — the
 * ratio had been the binding constraint until then, which is exactly how a
 * latent layout bug waits for a feature.
 *
 * `clamp()` cannot do that. Height is a length that reads the VIEWPORT, so
 * nothing about it can feed back into the column's width: the grid decides how
 * wide a day is, full stop, and the cell simply is that wide.
 *
 * 8.5vw between a 92px floor and a 176px ceiling. The floor is a phone, where
 * the ratio alone would give a 20px cell holding a date and a percentage. The
 * ceiling keeps six rows plus the header and the footnote inside a 1080px
 * window. Between them the day grows with the screen, which is the behaviour a
 * ratio was reached for in the first place.
 *
 * A FLOOR AND A CEILING, AND THE CEILING IS THE ONE THAT WAS MISSING.
 *
 * The floor is for a phone: seven columns are ~40px wide there and the ratio
 * alone would give a 22px cell with a date and a percentage in it.
 *
 * The CEILING is for the opposite end and it is the bug that shipped. A month
 * is six rows; at 16/9 with no cap, a 2500px-wide window makes each cell ~190px
 * and the grid ~1200px, so the one view whose entire job is to be seen AT ONCE
 * no longer fits on the screen it was widened onto. 132px keeps six rows plus
 * the header and the footnote inside a 900px viewport, which is the shortest
 * laptop this is used on.
 *
 * So the ratio governs the middle — the range where the calendar is genuinely
 * getting wider — and the two bounds stop it running away at either end.
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
export const DAY_CELL_H = "h-[clamp(5.75rem,8.5vw,11rem)]";
