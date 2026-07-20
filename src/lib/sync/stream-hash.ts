import { createHash } from "node:crypto";

/**
 * Normalize a stream's resource config for hashing: keep only primitive values,
 * drop empties, and sort keys — so `{range:"", spreadsheetId:"X"}` and
 * `{spreadsheetId:"X"}` are the same stream. The hash identifies the stream for
 * its whole life (cursor row + event tagging), so it must be deterministic.
 */
export function normalizeStreamConfig(config: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(config ?? {}).sort()) {
    const v = (config as Record<string, unknown>)[key];
    if (v == null) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const s = String(v).trim();
    if (s === "") continue;
    out[key] = s;
  }
  return out;
}

/** Stable identity of one (connection, resource-config) stream. */
export function streamConfigHash(config: Record<string, unknown> | null | undefined): string {
  const normalized = normalizeStreamConfig(config);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

/** True when the config selects an actual resource (after normalization). */
export function hasStreamConfig(config: Record<string, unknown> | null | undefined): boolean {
  return Object.keys(normalizeStreamConfig(config)).length > 0;
}
