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
