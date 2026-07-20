/**
 * Brand styling for data sources, used by the rebuilt control system (pills, data
 * browser, node cards). App-agnostic: known connectors get their brand colour + a short
 * label; unknown/future sources fall back to a neutral badge derived from the key.
 */
export type SourceStyle = { label: string; color: string; short: string };

const SOURCE_STYLE: Record<string, SourceStyle> = {
  calendly: { label: "Calendly", color: "#006BFF", short: "Ca" },
  close: { label: "Close", color: "#1E88E5", short: "Cl" },
  instantly: { label: "Instantly", color: "#7C3AED", short: "In" },
  sendblue: { label: "Sendblue", color: "#2563EB", short: "Sb" },
  gsheets: { label: "Google Sheets", color: "#0F9D58", short: "Sh" },
  gcal: { label: "Google Calendar", color: "#4285F4", short: "GC" },
  webhook: { label: "Webhook", color: "#64748B", short: "Wh" },
};

export function sourceStyle(source?: string | null): SourceStyle {
  if (source && SOURCE_STYLE[source]) return SOURCE_STYLE[source];
  const key = (source ?? "").trim();
  return { label: key || "App", color: "#64748B", short: (key || "ap").slice(0, 2).replace(/^\w/, (c) => c.toUpperCase()) };
}
