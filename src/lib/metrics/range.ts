import type { DateRange } from "./compute";

export type RangeKey = "7d" | "30d" | "90d" | "all";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

/** Resolve a range key to a concrete {from, to} window. */
export function resolveRange(key: string | undefined): { key: RangeKey; range: DateRange } {
  const now = new Date();
  const to = now;
  const days: Record<Exclude<RangeKey, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const k: RangeKey = key === "30d" || key === "90d" || key === "all" ? key : "7d";
  if (k === "all") {
    return { key: k, range: { from: new Date(0), to } };
  }
  return { key: k, range: { from: new Date(now.getTime() - days[k] * 86_400_000), to } };
}
