/** One selectable field from an earlier step (human name + type + real sample). */
export type DataField = { path: string; label: string; type?: string; sample?: unknown; container?: boolean };

/** A group of fields from one earlier step, shown in the Insert-data browser. */
export type DataGroup = {
  stepId: string;
  stepNo?: number;
  source?: string; // app key → brand badge
  title: string;
  system?: boolean;
  fields: DataField[];
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
