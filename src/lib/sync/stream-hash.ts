import { createHash } from "node:crypto";
import { readFilterKeys } from "@/connectors/catalog";

/**
 * Normalize a stream's resource config for hashing: keep only primitive values,
 * drop empties, drop the source's read filters, and sort keys — so
 * `{range:"", spreadsheetId:"X"}` and `{spreadsheetId:"X"}` are the same stream.
 * The hash identifies the stream for its whole life (cursor row + event
 * tagging), so it must be deterministic.
 *
 * `source` is REQUIRED, and the reason is worth stating. A config key either
 * selects the resource to fetch or describes how one flow reads it
 * (FlowConfigField.readFilter), and only the catalog knows which — the value
 * looks identical either way. Letting the argument be optional would make an
 * un-updated call site fork the stream silently, which is exactly the failure
 * this parameter exists to prevent: Calendly's meeting type was in the identity,
 * so picking one pointed the read at an empty stream and the step showed 0.
 */
export function normalizeStreamConfig(
  config: Record<string, unknown> | null | undefined,
  source: string | null | undefined,
): Record<string, string> {
  const readOnly = readFilterKeys(source);
  const out: Record<string, string> = {};
  for (const key of Object.keys(config ?? {}).sort()) {
    if (readOnly.has(key)) continue; // narrows the read, not the sync
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
export function streamConfigHash(config: Record<string, unknown> | null | undefined, source: string | null | undefined): string {
  const normalized = normalizeStreamConfig(config, source);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

/** True when the config selects an actual resource (after normalization). */
export function hasStreamConfig(config: Record<string, unknown> | null | undefined, source: string | null | undefined): boolean {
  return Object.keys(normalizeStreamConfig(config, source)).length > 0;
}
