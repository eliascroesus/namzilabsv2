/**
 * The ONE formatter for a metric value — the dashboard tile and the Review &
 * publish preview must render the same number the same way, or the preview
 * is a lie about the tile it predicts.
 */
export function formatMetricValue(
  value: number | null | undefined,
  opts: { format?: string; currency?: string; precision?: number; unit?: string; durationDisplay?: string },
): string {
  if (value == null) return "—";
  const p = opts.precision ?? 0;
  if (opts.format === "duration") return formatDuration(value, opts.unit ?? "seconds", opts.durationDisplay);
  if (opts.format === "percent") return `${value.toFixed(p)}%`;
  if (opts.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: opts.currency || "USD",
      maximumFractionDigits: p,
    }).format(value);
  }
  // en-US pinned like every other formatter in the pipeline (the builder's
  // resultLabel, the currency branch above): the same tile must not read
  // "1,234" on one machine and "1.234" on another.
  const n = value.toLocaleString("en-US", { maximumFractionDigits: p });
  return opts.unit ? `${n} ${opts.unit}` : n;
}

/**
 * A length of time, said the way a person says it.
 *
 * TWO SEPARATE THINGS, and conflating them is what made this untrustworthy:
 *
 * - `valueUnit` is a fact about the DATA — what the number counts. It is
 *   derived from the field, never asked, because it is not a preference and
 *   answering it wrong changes the answer.
 * - `display` is a preference about the READING. It never changes the length
 *   of time, only how finely it is broken down. Picking the unit shows that
 *   unit and every smaller one, down to seconds, exactly as it would be said
 *   out loud: 4h 45m under hours, 285m 12s under minutes, 17112s under
 *   seconds. All three are the same moment-to-moment gap.
 *
 * These used to be one argument, so switching the dropdown re-read 285 as
 * minutes, then as seconds, and reported two different durations for one
 * number.
 */
export const DURATION_DISPLAYS = ["auto", "seconds", "minutes", "hours", "days"] as const;
const SECONDS_PER: Record<string, number> = { seconds: 1, minutes: 60, hours: 3_600, days: 86_400 };

export function formatDuration(value: number, valueUnit: string, display: string = "auto"): string {
  const per = SECONDS_PER[valueUnit];
  // An unrecognised unit is a bug upstream, not a number to guess at. Saying
  // so beats silently meaning minutes.
  if (per == null || !Number.isFinite(value)) return "—";
  const totalSec = Math.round(value * per);
  const neg = totalSec < 0 ? "-" : "";
  const s = Math.abs(totalSec);

  if (display === "seconds") return `${neg}${s.toLocaleString("en-US")}s`;

  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;

  // Every unit from the chosen one down, so the reading is the same shape no
  // matter how big the gap is — "0h 4m 30s" is the point, not a rounding bug.
  if (display === "days") return `${neg}${d}d ${h}h ${m}m ${sec}s`;
  if (display === "hours") return `${neg}${d * 24 + h}h ${m}m ${sec}s`;
  if (display === "minutes") return `${neg}${(d * 1_440 + h * 60 + m).toLocaleString("en-US")}m ${sec}s`;

  // auto: the two largest units that carry information.
  if (d > 0) return `${neg}${d}d ${h}h`;
  if (h > 0) return `${neg}${h}h ${m}m`;
  if (m > 0) return `${neg}${m}m${sec > 0 ? ` ${sec}s` : ""}`;
  return `${neg}${sec}s`;
}

/** "4 minutes ago" / "2 hours ago" / a date past a week — for freshness lines. */
export function relativeTime(then: Date, now: Date = new Date()): string {
  /**
   * ABBREVIATED, AND THE REASON IS WHERE THIS STRING LIVES.
   *
   * It was "23 minutes ago". Almost every call site is a tile's footline —
   * beside a chart kind, a kebab and a status dot, on a card that can be a
   * third of a board wide — and "minutes" is nine characters buying nothing:
   * nobody reads "23 min ago" as anything other than what it is.
   *
   * It cost real layout. On a narrow tile the long form pushed the kebab into
   * the text beside it, which is what made the two look like they were
   * overlapping rather than sharing a row.
   *
   * NO PLURALS, deliberately. "1 min ago" is correct English for an
   * abbreviation and "1 mins ago" is not, so dropping the branch removes a
   * decision rather than taking a shortcut. "sec" appears at all because the
   * old "just now" swallowed the entire first minute, which on a page whose
   * whole point is freshness is the one interval worth being precise about.
   */
  const ms = now.getTime() - then.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return formatDate(then);
}

/* --- Dates, said one way everywhere ---------------------------------------
 * The app had a dozen bare `toLocaleString()` calls, some rendered on the
 * server and some in the browser — so the same timestamp wore the server's
 * locale on one page and the visitor's on the next. These three are the only
 * sanctioned spellings, en-US-pinned like every number above, and the same
 * string no matter which side renders it.
 */

/** "Aug 21, 2026" — list rows, facts, anywhere a day is enough. */
export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "3:07 PM" — when the day is already on screen. */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Aug 21, 2026, 3:07 PM" — audit trails, previews, event tables. */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)}, ${formatTime(d)}`;
}
