/**
 * The single source of truth for turning a metric's numeric value into display
 * text. Used by the engine tile, the dashboard tiles, the canvas cards, and the
 * previews so a percentage with two decimals always reads "75.68%" — never
 * "75.675676" in one place and "75.68%" in another.
 */
export type MetricFormat = {
  format?: "number" | "percent" | "currency";
  precision?: number;
  currency?: string;
  unit?: string;
};

function round(value: number, precision: number): number {
  const m = 10 ** precision;
  return Math.round(value * m) / m;
}

export function formatMetric(value: number | null | undefined, f: MetricFormat = {}): string {
  if (value == null || Number.isNaN(value)) return "—";
  const p = Math.max(0, Math.min(6, f.precision ?? 0));
  if (f.format === "percent") {
    return `${round(value, p).toFixed(p)}%`;
  }
  if (f.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: f.currency || "USD",
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    }).format(value);
  }
  const n = round(value, p).toLocaleString(undefined, { maximumFractionDigits: p });
  return f.unit ? `${n} ${f.unit}` : n;
}
