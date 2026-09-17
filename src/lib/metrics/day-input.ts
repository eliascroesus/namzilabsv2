/**
 * A DAY, TYPED BY A PERSON.
 *
 * The range picker's two ends are text fields, so somebody can reach January
 * 2025 without twenty presses of a month arrow. This turns what they type into
 * the same `2026-08-19` key every other date in the product is spelled as, or
 * into `null`.
 *
 * ═══ WHY NOT `new Date(text)` ═══
 *
 * Because it is three different functions wearing one name. `new Date("8/19/2026")`
 * parses in LOCAL time, `new Date("2026-08-19")` parses in UTC, and anything
 * else is implementation-defined — the spec explicitly allows engines to accept
 * whatever they like. A picker whose fields are local and whose grid is UTC
 * disagrees with itself by one day for half the planet for part of every day,
 * which is the exact bug `date-range-picker.tsx` and `calendar.ts` are both
 * written at length to avoid. So every format here is matched explicitly and
 * built with `Date.UTC`.
 *
 * ═══ WHAT IT ACCEPTS ═══
 *
 * The one it prints — `Aug 19, 2026` — first, because the overwhelmingly common
 * edit is to select the text that is already there and change part of it. Then
 * ISO, because it is unambiguous and anyone who works with data types it. Then
 * `8/19/2026`, month-first to match the `en-US` the fields render in. Then
 * `19 Aug 2026`, because half the world writes the day first and the month name
 * makes the order unambiguous anyway.
 *
 * It does NOT accept `8/19/26`. A two-digit year has to guess a century, and a
 * silent guess on the control that decides which numbers the whole dashboard
 * shows is worse than making somebody type two more characters.
 *
 * ═══ AND IT REJECTS RATHER THAN SLIDES ═══
 *
 * `Date.UTC(2026, 1, 30)` is cheerfully 2 March. A day somebody cannot have
 * meant must not quietly become one they did not pick, so every candidate is
 * built and then re-formatted, and kept only if it comes back the same — the
 * same round trip `parseCustomRange` does on a URL.
 */

const ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * A month name to its 1-based number, or -1.
 *
 * WHOLE NAMES ONLY. Matching on the first three letters would read "junk" as
 * June and "mayonnaise" as May — a typo silently becoming a date is precisely
 * what a parser on this control must not do. `sept` is the one abbreviation
 * outside the list that enough people write to be worth naming.
 */
function monthIndex(name: string): number {
  const abbr = ABBR.indexOf(name);
  if (abbr >= 0) return abbr;
  const full = FULL.indexOf(name);
  if (full >= 0) return full;
  return name === "sept" ? 8 : -1;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A real day as `2026-08-19`, or null if those three numbers are not one. */
function makeDay(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  // 1970 because every window in this product is measured from the epoch, and
  // a year outside four digits is a typo rather than a date.
  if (y < 1970 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const key = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === key ? key : null;
}

/** What somebody typed, as a UTC day key — or null if it is not a day. */
export function parseDayInput(text: string): string | null {
  // Commas are separators here and nothing else, so "Aug 19, 2026" and
  // "Aug 19 2026" are the same input by the time anything looks at them.
  const s = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;

  let m: RegExpMatchArray | null;
  // Aug 19 2026 — the spelling the field itself prints.
  if ((m = s.match(/^([a-z]{3,9}) (\d{1,2}) (\d{4})$/))) {
    const i = monthIndex(m[1]);
    return i < 0 ? null : makeDay(Number(m[3]), i + 1, Number(m[2]));
  }
  // 2026-08-19
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return makeDay(Number(m[1]), Number(m[2]), Number(m[3]));
  // 8/19/2026 — month first, matching the en-US the fields render in.
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return makeDay(Number(m[3]), Number(m[1]), Number(m[2]));
  // 19 Aug 2026 — the month name makes the order unambiguous.
  if ((m = s.match(/^(\d{1,2}) ([a-z]{3,9}) (\d{4})$/))) {
    const i = monthIndex(m[2]);
    return i < 0 ? null : makeDay(Number(m[3]), i + 1, Number(m[1]));
  }
  return null;
}
