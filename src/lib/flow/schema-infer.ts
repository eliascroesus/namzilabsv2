import type { FlowRecord } from "./records";
import { STANDARD_FIELDS, getField } from "./records";

export type FieldType = "text" | "number" | "date" | "email" | "boolean" | "id" | "object" | "list" | "unknown";

/** Types that hold structured children the data browser can expand into. */
export const CONTAINER_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(["object", "list"]);

export type FieldInfo = {
  /** Field path usable by getField (e.g. "subject" or "properties.plan"). */
  path: string;
  /** Human label for the variable picker. */
  label: string;
  type: FieldType;
  example?: unknown;
  /** True for objects/arrays — the data browser shows an expand affordance. */
  container?: boolean;
};

function inferType(path: string, value: unknown): FieldType {
  if (path === "occurredAt") return "date";
  if (path === "id") return "id";
  if (value == null) return "unknown";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    if (/@/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return "date";
    if (value.trim() !== "" && Number.isFinite(Number(value))) return "number";
    return "text";
  }
  return "unknown";
}

/**
 * Infer the output field schema of a dataset from sample records. Powers the
 * variable picker (fields + example values, labeled by node/app).
 */
export function inferSchema(records: FlowRecord[]): FieldInfo[] {
  const out: FieldInfo[] = [];
  const seen = new Set<string>();
  const push = (path: string, label: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    let example: unknown;
    for (const r of records) {
      const v = getField(r, path);
      if (v != null && v !== "") {
        example = v;
        break;
      }
    }
    const type = inferType(path, example);
    out.push({ path, label, type, example, container: CONTAINER_TYPES.has(type) });
  };

  for (const f of STANDARD_FIELDS) push(f, f);

  // Union of property keys across the sample (bounded).
  const propKeys = new Set<string>();
  for (const r of records.slice(0, 50)) {
    for (const k of Object.keys(r.properties ?? {})) propKeys.add(k);
  }
  for (const k of [...propKeys].sort()) push(`properties.${k}`, k);

  return out;
}
