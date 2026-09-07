import { catalogEntry } from "@/connectors/catalog";

/**
 * Brand styling for data sources, used by the rebuilt control system (pills,
 * data browser, node cards). The colours live on the catalog entry now, so a
 * new connector registers its mark in the same place as everything else;
 * unknown sources fall back to a neutral badge derived from the key.
 */
export type SourceStyle = { label: string; color: string; short: string };

export function sourceStyle(source?: string | null): SourceStyle {
  const entry = source ? catalogEntry(source) : undefined;
  if (entry?.brand) return { label: entry.brand.label ?? entry.name, color: entry.brand.color, short: entry.brand.short };
  const key = (source ?? "").trim();
  return { label: key || "App", color: "#64748B", short: (key || "ap").slice(0, 2).replace(/^\w/, (c) => c.toUpperCase()) };
}
