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
/**
 * A DAY'S HEIGHT COMES OFF THE VIEWPORT'S HEIGHT, NOT ITS WIDTH.
 *
 * It was `clamp(5.75rem, 8.5vw, 11rem)` — 92px, then 8.5% of the WIDTH, up to
 * 176. On a wide, short screen that is the worst possible pairing: a 1440x800
 * display got 122px cells because it is wide, and then could not show the six
 * rows AND the summary underneath without scrolling. The owner's report —
 * "I can see the calendar thing but I can't see the Best day / Average day /
 * Days with data things underneath, I have to scroll a tiny bit".
 *
 * A calendar is one object that should be taken in at a glance, so the axis
 * that decides how tall it may be is the one that runs out: `dvh`, minus
 * everything the month competes with for it.
 *
 *   27rem (432px) is that overhead, and it is the sum of fixed, known parts:
 *     113  the two chrome bands (64 + 49)
 *      16  the panel's 8px gutter, top and bottom
 *       2  its hairline, top and bottom
 *      48  PageContainer's own 24px, top and bottom
 *      32  the sheet's p-4, top and bottom
 *      32  the weekday row and its gap
 *      40  five 8px gaps between six rows
 *     ~150 the summary block below the sheet, and the gap above it
 *
 * Divided by six because six is the most rows a month can occupy.
 *
 * THE CLAMP IS NOT DECORATION. Below ~2.75rem a cell cannot hold a date and a
 * figure, so on a very short window the page scrolls rather than rendering
 * something unreadable — a floor is the honest failure. The 11rem ceiling is
 * the old one: past it the squares start reading as panels rather than days.
 *
 * `dvh` rather than `vh`: on a phone the address bar's slide would otherwise
 * resize every cell mid-scroll.
 *
 * `pnpm calendar` measures the real thing at four viewport heights rather than
 * trusting this arithmetic, because the overhead above is a sum of numbers
 * that live in six other files and any of them can move.
 */
export const DAY_CELL_H = "h-[clamp(2.75rem,calc((100dvh-27rem)/6),11rem)]";

/**
 * DID THIS DAY HAVE ANYTHING TO MEASURE?
 *
 * `dayValues` already drops a day the metric could not ANSWER — a rate whose
 * denominator emptied has no value at all and is simply absent from `byDay`.
 * What it keeps, and must keep, is a day that answered ZERO: for a count,
 * "nothing happened" is a real result and the calendar has always drawn it as
 * a numeral on purpose.
 *
 * THE CALENDAR ASKS A NARROWER QUESTION THAN THE TILES DO, and that is the
 * whole of this function. A month grid is sixty squares seen at once; a
 * fortnight of "0" before a workspace connected its first source reads as a
 * failure rather than as absence, which is what was reported — "instead of
 * having it say 0 and shit since there is no data". A tile shows one window
 * and has no such problem, so nothing outside this view changes.
 *
 * `records` IS THE SIGNAL, and it is a reliable one rather than a guess.
 * Measured against production before writing this: across six stored tiles,
 * 61/9/61/61/61/61 days each, EVERY zero-valued day carried no `records` key
 * and every day that carried one had a non-zero value. `dayValues` stores
 * `records` only when it is greater than zero, so its presence means records
 * were counted on that day.
 *
 * So the two facts stay distinguishable in the direction that matters:
 *
 *   value 0, records 6  -> data existed and the answer was zero. Shows "0".
 *   value 0, no records -> nothing to count. Draws an empty square.
 *   value 7             -> data. Shows "7", records or not.
 *
 * A metric that reported no record counts at all would blank its zeros, which
 * is the one ambiguous case and the one the owner asked for by name.
 */
type DayEntry = { value: number; records?: number };

/* A TYPE PREDICATE, not a boolean, so the narrowing survives. `has` used to be
   `value != null`, which TypeScript follows through an aliased condition — a
   plain boolean would leave every `entry.value` below possibly-undefined and
   force non-null assertions at the two places that read it. */
export function dayHasData(entry?: DayEntry): entry is DayEntry {
  if (entry == null) return false;
  return entry.records != null || entry.value !== 0;
}
