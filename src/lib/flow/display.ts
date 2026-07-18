import type { MetricFormat } from "@/lib/format";

/** The resolved dashboard display for a calculation node (Aggregate/Formula/Group). */
export type MetricDisplay = MetricFormat & {
  name: string;
  viz: string;
  format: "number" | "percent" | "currency";
  precision: number;
  currency: string;
  target: number | null;
};

/**
 * Resolve how a calculation node's result should be shown. Percentage formulas
 * default to "%", currency to 0 decimals, percentages to 2 — but any explicit
 * choice on the node wins. Shared by the engine (building the stored tile) and
 * the canvas/preview so the number reads the same everywhere.
 */
export function metricDisplay(nodeType: string, config: Record<string, unknown>): MetricDisplay {
  const op = String(config.op ?? "");
  const isPercentOp = nodeType === "formula" && (op === "percentage" || op === "percent_change");
  const format = (config.format as MetricDisplay["format"] | undefined) ?? (isPercentOp ? "percent" : "number");
  const precision = (config.precision as number | undefined) ?? (format === "percent" ? 2 : 0);
  const vizDefault = nodeType === "group" ? "category" : "number";
  return {
    name: String(config.name ?? ""),
    viz: String(config.viz ?? vizDefault),
    format,
    precision,
    currency: String(config.currency ?? "USD"),
    unit: (config.unit as string) || undefined,
    target: config.target != null ? Number(config.target) : null,
  };
}
