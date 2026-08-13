import { FILTER_OP_LABELS, type FlowFilterOp } from "@/lib/flow/types";

/**
 * The operators offered for a field, by its inferred type.
 *
 * A TYPE ADDS COMPARISONS; IT NEVER TAKES TEXT ONES AWAY.
 *
 * Every value is text underneath — `evalRule` stringifies before comparing, so
 * `contains` is well defined on a number, a date or a boolean. The old table
 * treated the types as disjoint menus, so a spreadsheet column holding "1" and
 * "2" was inferred numeric and lost Contains, Starts with and Ends with
 * entirely. Reported from a Paths branch, but nothing about Paths caused it:
 * a branch's conditions ARE a Filter, rendered by the same editor from the
 * same fields — the field's inferred type was the only difference, which is
 * exactly why hiding operators on it reads as one screen being broken.
 *
 * Inference is also a guess from a sample: a column of digits today can hold
 * "Jay" tomorrow (this one did), and a picker that has narrowed itself cannot
 * express the query the data now needs.
 */
const UNIVERSAL: FlowFilterOp[] = ["contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty", "is_one_of", "is_not_one_of"];
/** Type-specific comparisons, offered FIRST — they are why the type matters. */
const NUMERIC_COMPARISONS: FlowFilterOp[] = ["gt", "lt", "gte", "lte"];
const DATE_COMPARISONS: FlowFilterOp[] = ["before", "after", "between"];

const menu = (comparisons: FlowFilterOp[]): FlowFilterOp[] => ["equals", "not_equals", ...comparisons, ...UNIVERSAL];

export function operatorsForType(fieldType?: string): FlowFilterOp[] {
  switch (fieldType) {
    case "number":
      return menu(NUMERIC_COMPARISONS);
    case "date":
      return menu(DATE_COMPARISONS);
    default:
      return menu([]); // text / email / id / boolean / unknown
  }
}

export function operatorOptions(fieldType?: string): Array<{ value: string; label: string }> {
  return operatorsForType(fieldType).map((op) => ({ value: op, label: FILTER_OP_LABELS[op] }));
}
