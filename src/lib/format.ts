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
  const ms = now.getTime() - then.getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString();
}
