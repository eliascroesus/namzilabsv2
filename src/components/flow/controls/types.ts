/** One selectable field from an earlier step (human name + type + real sample). */
export type DataField = {
  path: string;
  label: string;
  type?: string;
  sample?: unknown;
  container?: boolean;
  /** How many of this step's records carried a value here; 0 = empty in all of them. */
  populated?: number;
};

/** A group of fields from one earlier step, shown in the Insert-data browser. */
export type DataGroup = {
  stepId: string;
  stepNo?: number;
  source?: string; // app key → brand badge
  title: string;
  system?: boolean;
  fields: DataField[];
  /**
   * Why this step offers fewer fields than the step itself holds — printed
   * under its fields, in the caller's words. The browser renders whatever
   * sentence it is handed and knows no step-type rules: only the picker that
   * built the group knows what it gated on and can say so without guessing.
   */
  note?: string;
};

/**
 * A dynamic reference to a field produced by an earlier step. Identity is the
 * producing step + field path (never the label), so the reference survives renames
 * and reordering and can be detected as stale when the producer changes. The extra
 * display fields (label/source/stepNo/sample) are a cached snapshot for the pill.
 */
export type FieldRef = {
  producerStepId: string;
  fieldPath: string;
  label: string;
  source?: string;
  stepNo?: number;
  sample?: unknown;
};

/**
 * A single value input, matching the engine's model exactly: either a typed literal
 * ("Fixed value") or one mapped upstream field ("Use a field"). `mode` maps to the
 * engine's `valueKind`, `text` to `value`, and `field.fieldPath` to `valueField`.
 */
export type ValueMode = "fixed" | "field";
export type ValueModel = {
  mode: ValueMode;
  text: string;
  field: FieldRef | null;
};

export const emptyValue: ValueModel = { mode: "fixed", text: "", field: null };
