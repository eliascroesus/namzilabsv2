export { parseDate } from "../field-utils";

/** Epoch seconds or milliseconds (or a numeric string) to a Date; "auto" reads > 1e12 as ms. */
export function epochToDate(v: unknown, unit: "s" | "ms" | "auto" = "auto"): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const ms = unit === "ms" ? n : unit === "s" ? n * 1000 : n > 1e12 ? n : n * 1000;
  return new Date(ms);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Any string Date.parse accepts, normalised to ISO; null otherwise. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
