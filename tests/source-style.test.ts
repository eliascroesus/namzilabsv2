import { describe, it, expect } from "vitest";
import { sourceStyle } from "@/components/flow/controls/source-style";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/** The map as it stood before brand moved into the catalog — byte-for-byte. */
const BEFORE: Record<string, { label: string; color: string; short: string }> = {
  calendly: { label: "Calendly", color: "#006BFF", short: "Ca" },
  close: { label: "Close", color: "#1E88E5", short: "Cl" },
  instantly: { label: "Instantly", color: "#7C3AED", short: "In" },
  whop: { label: "Whop", color: "#FF6243", short: "Wh" },
  gsheets: { label: "Google Sheets", color: "#0F9D58", short: "Sh" },
  gcal: { label: "Google Calendar", color: "#4285F4", short: "GC" },
  webhook: { label: "Webhook", color: "#64748B", short: "Wh" },
};

describe("sourceStyle reads the catalog", () => {
  it("renders every existing connector exactly as before", () => {
    for (const [source, want] of Object.entries(BEFORE)) expect(sourceStyle(source), source).toEqual(want);
  });
  it("every catalog entry declares a brand", () => {
    for (const e of CONNECTOR_CATALOG) {
      expect(e.brand, e.source).toBeDefined();
      expect(e.brand!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(e.brand!.short.length).toBeGreaterThanOrEqual(1);
      expect(e.brand!.short.length).toBeLessThanOrEqual(3);
    }
  });
  it("falls back to a neutral badge for an unknown or missing source", () => {
    expect(sourceStyle("zzz")).toEqual({ label: "zzz", color: "#64748B", short: "Zz" });
    expect(sourceStyle(null)).toEqual({ label: "App", color: "#64748B", short: "Ap" });
  });
});
