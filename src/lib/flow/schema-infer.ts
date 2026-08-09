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
  /**
   * How many of the sampled records actually carried a value here. `0` means
   * the field exists in the shape but is empty on every record read — real
   * for provider payloads, which ship every optional column whether or not
   * the account uses it. Pickers push those to the back rather than dropping
   * them, because empty today is not empty next month.
   */
  populated?: number;
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
 * Build one FieldInfo from a path and an example value.
 *
 * Shared by the sample-scan path and the field-registry path so a picker looks
 * identical whichever produced it — same type inference (including the email
 * and date heuristics), same container flag. If these two diverged, the same
 * field would render with a different icon depending on whether its stream had
 * been registered yet.
 */
export function buildFieldInfo(path: string, label: string, example: unknown): FieldInfo {
  const type = inferType(path, example);
  return { path, label, type, example, container: CONTAINER_TYPES.has(type) };
}

/**
 * How many records are walked to discover the shape. Every path and every
 * populated count is "of these N", which is why the number is generous: a
 * step that loads 187 records is described exactly.
 */
const SHAPE_SAMPLE = 200;
/** Mirrors the field registry's own depth, which mirrors the date normalizer's. */
const MAX_DEPTH = 4;
/** A ceiling so one pathological payload cannot bloat the saved graph. */
const MAX_PATHS = 600;

/** Did the provider actually send something here? `0` and `false` did. */
function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Long text is a sample, not a payload — the schema is persisted in the graph. */
function trimExample(v: unknown): unknown {
  return typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
}

/**
 * Infer the output field schema of a dataset from sample records. Powers the
 * variable picker (fields + example values, labeled by node/app).
 *
 * NESTED, AND UNIONED ACROSS RECORDS — both parts load-bearing. This used to
 * enumerate top-level `properties.*` keys only, and the picker recovered
 * `data.direction` in the browser by cracking open ONE selected preview
 * record. So a field present on 180 of 187 calls vanished whenever the
 * previewed record was one of the other 7, and clicking to a different
 * preview silently rewrote the whole list. That is the "data is being
 * gatekept" complaint, and it was real.
 *
 * Walking every record also answers the other half: a path can now say how
 * many records actually carried a value, so a picker can put the ~100 columns
 * an account never fills behind the ones it does.
 */
export function inferSchema(records: FlowRecord[]): FieldInfo[] {
  const sample = records.length > SHAPE_SAMPLE ? records.slice(0, SHAPE_SAMPLE) : records;
  const out: FieldInfo[] = [];

  // The seven spine fields, same as ever — every record has them by construction.
  for (const f of STANDARD_FIELDS) {
    let example: unknown;
    let populated = 0;
    for (const r of sample) {
      const v = getField(r, f);
      if (isEmptyValue(v)) continue;
      populated++;
      if (example === undefined) example = v;
    }
    out.push({ ...buildFieldInfo(f, f, trimExample(example)), populated });
  }

  // Every provider path, to depth 4, unioned over the sample.
  type Acc = { populated: number; example?: unknown; anyValue?: unknown; container: boolean };
  const acc = new Map<string, Acc>();
  const visit = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(obj)) {
      // Internal engine keys (a step's stamped record-count / pass flag) are never fields.
      if (depth === 1 && k.startsWith("__")) continue;
      const path = `${prefix}${k}`;
      let a = acc.get(path);
      if (!a) {
        if (acc.size >= MAX_PATHS) continue;
        a = { populated: 0, container: false };
        acc.set(path, a);
      }
      if (a.anyValue === undefined) a.anyValue = v;
      if (!isEmptyValue(v)) {
        a.populated++;
        if (a.example === undefined) a.example = v;
      }
      if (v != null && typeof v === "object") {
        a.container = true;
        // Arrays stay leaves: their indices are positions, not field names, and
        // the browser still drills into them from the sample.
        if (!Array.isArray(v) && depth < MAX_DEPTH) visit(v as Record<string, unknown>, `${path}.`, depth + 1);
      }
    }
  };
  for (const r of sample) visit((r.properties ?? {}) as Record<string, unknown>, "", 1);

  for (const path of [...acc.keys()].sort()) {
    const a = acc.get(path)!;
    const example = a.example !== undefined ? a.example : a.anyValue;
    const info = buildFieldInfo(`properties.${path}`, path, trimExample(example));
    // A container that was empty in every record still types as one, so the
    // browser keeps its expand affordance rather than mislabelling it.
    out.push({ ...info, container: info.container || a.container, populated: a.populated });
  }

  return out;
}
