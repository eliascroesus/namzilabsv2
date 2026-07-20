import type { DataField, DataGroup, FieldRef } from "./types";

/**
 * Pure helpers behind the data browser / value input. Kept dependency-free and
 * side-effect-free so they can be unit-tested without a DOM (the builder's React
 * components are thin wrappers over these).
 */

/** Classify a raw sample value into the same vocabulary as `schema-infer`. */
export function valueType(v: unknown): string {
  if (v == null) return "unknown";
  if (typeof v === "number") return Number.isFinite(v) ? "number" : "unknown";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "object";
  if (typeof v === "string") {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return "date";
    if (v.trim() !== "" && Number.isFinite(Number(v))) return "number";
    return "text";
  }
  return "unknown";
}

/** Objects and arrays can be drilled into in the data browser. */
export function isContainerValue(v: unknown): boolean {
  return v != null && typeof v === "object";
}

/**
 * Turn a raw key into a human label: strip a leading `properties.`, take the last
 * dotted segment, split snake/camel/kebab case, and title-case the first word.
 * e.g. `properties.utm_source` → "Utm source", `firstName` → "First name".
 */
export function humanizeKey(key: string): string {
  let k = key.startsWith("properties.") ? key.slice("properties.".length) : key;
  const lastDot = k.lastIndexOf(".");
  if (lastDot >= 0) k = k.slice(lastDot + 1);
  const words = k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** Short, single-line preview of a sample value for pills/rows (never a raw path). */
export function formatSample(v: unknown, max = 40): string | null {
  if (v == null || v === "") return null;
  let s: string;
  if (typeof v === "object") {
    if (Array.isArray(v)) s = `${v.length} item${v.length === 1 ? "" : "s"}`;
    else s = `{ ${Object.keys(v as Record<string, unknown>).length} field${Object.keys(v as Record<string, unknown>).length === 1 ? "" : "s"} }`;
  } else {
    s = String(v);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Expand a container field into its child fields, computed from the field's own
 * sample value (object keys or array indices). Bounded so a huge array/object can't
 * blow up the browser. Child paths extend the parent path so `getField`/`walkPath`
 * resolve them at runtime.
 */
export function childFields(field: DataField, limit = 30): DataField[] {
  const v = field.sample;
  if (Array.isArray(v)) {
    return v.slice(0, limit).map((item, i) => ({
      path: `${field.path}.${i}`,
      label: `Item ${i + 1}`,
      type: valueType(item),
      sample: item,
      container: isContainerValue(item),
    }));
  }
  if (v != null && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .slice(0, limit)
      .map(([k, item]) => ({
        path: `${field.path}.${k}`,
        label: humanizeKey(k),
        type: valueType(item),
        sample: item,
        container: isContainerValue(item),
      }));
  }
  return [];
}

/** Build a dynamic reference to a field within a step group (snapshotting display info). */
export function makeFieldRef(group: DataGroup, field: DataField): FieldRef {
  return {
    producerStepId: group.stepId,
    fieldPath: field.path,
    label: field.label,
    source: group.source,
    stepNo: group.stepNo,
    sample: field.sample,
  };
}

/**
 * Locate the field a reference points at among the currently-available groups.
 * Matches on producing step + exact path; nested paths (drilled-in children) are
 * matched by their nearest declared ancestor field since children aren't enumerated.
 */
export function resolveRef(ref: FieldRef, groups: DataGroup[]): { group: DataGroup; field: DataField } | undefined {
  const group = groups.find((g) => g.stepId === ref.producerStepId);
  if (!group) return undefined;
  const exact = group.fields.find((f) => f.path === ref.fieldPath);
  if (exact) return { group, field: exact };
  // A drilled-in child (e.g. "properties.utm.source"): valid if a declared ancestor
  // container field is still present (e.g. "properties.utm").
  const ancestor = group.fields.find((f) => f.container && ref.fieldPath.startsWith(`${f.path}.`));
  if (ancestor) return { group, field: { ...ancestor, path: ref.fieldPath, label: ref.label, container: false } };
  return undefined;
}

/**
 * A reference is stale when its producing step is gone, or the step no longer exposes
 * the field. Stale references are surfaced as a warning and never silently remapped.
 */
export function fieldRefIsStale(ref: FieldRef, groups: DataGroup[]): boolean {
  return resolveRef(ref, groups) == null;
}

/** Total selectable fields across groups (used to show/hide the data browser affordance). */
export function hasAnyFields(groups: DataGroup[]): boolean {
  return groups.some((g) => g.fields.length > 0);
}

/** Case-insensitive filter of a group's fields by label or path (data-browser search). */
export function filterFields(fields: DataField[], query: string): DataField[] {
  const q = query.trim().toLowerCase();
  if (!q) return fields;
  return fields.filter((f) => `${f.label} ${f.path}`.toLowerCase().includes(q));
}
