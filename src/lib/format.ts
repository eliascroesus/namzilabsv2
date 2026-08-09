/**
 * The ONE formatter for a metric value — the dashboard tile and the Review &
 * publish preview must render the same number the same way, or the preview
 * is a lie about the tile it predicts.
 */
export function formatMetricValue(
  value: number | null | undefined,
  opts: { format?: string; currency?: string; precision?: number; unit?: string },
): string {
  if (value == null) return "—";
  const p = opts.precision ?? 0;
  if (opts.format === "duration") return formatDuration(value, opts.unit ?? "minutes");
  if (opts.format === "percent") return `${value.toFixed(p)}%`;
  if (opts.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: opts.currency || "USD",
      maximumFractionDigits: p,
    }).format(value);
  }
  const n = value.toLocaleString(undefined, { maximumFractionDigits: p });
  return opts.unit ? `${n} ${opts.unit}` : n;
}

/**
 * A length of time, read the way a person says it: "4h 45m", "38 min",
 * "12 sec". `unit` is the unit the NUMBER is in — a speed-to-lead of
 * 285.195783 minutes is 4h 45m, and printing the bare number was the
 * complaint that produced this function.
 */
export function formatDuration(value: number, unit: string): string {
  const perUnit: Record<string, number> = { seconds: 1, minutes: 60, hours: 3_600, days: 86_400 };
  const totalSec = Math.round(value * (perUnit[unit] ?? 60));
  if (!Number.isFinite(totalSec)) return "—";
  const neg = totalSec < 0 ? "-" : "";
  const s = Math.abs(totalSec);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
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
