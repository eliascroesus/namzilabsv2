import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys are sorted recursively so the same logical
 * payload always serializes identically (required for stable hashing).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, sortValue(obj[k])]),
    );
  }
  return v;
}

/**
 * Derive a stable, deduplication-safe id for a payload that has no natural id.
 * Deterministic: identical payloads → identical id, so at-least-once delivery
 * collapses to exactly-once at the events table.
 */
export function hashId(namespace: string, obj: unknown): string {
  const digest = createHash("sha256").update(stableStringify(obj)).digest("hex").slice(0, 32);
  return `${namespace}:${digest}`;
}
