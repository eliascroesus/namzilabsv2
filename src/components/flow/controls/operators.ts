import { FILTER_OP_LABELS, type FlowFilterOp } from "@/lib/flow/types";

// The operators that make sense for each inferred field type (drives the searchable
// operator dropdown, so users only see conditions appropriate to the chosen field).
const NUMERIC: FlowFilterOp[] = ["equals", "not_equals", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty", "is_one_of", "is_not_one_of"];
const DATE: FlowFilterOp[] = ["before", "after", "between", "equals", "not_equals", "is_empty", "is_not_empty"];
const TEXTUAL: FlowFilterOp[] = ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty", "is_one_of", "is_not_one_of"];
const BOOLEAN: FlowFilterOp[] = ["equals", "not_equals", "is_empty", "is_not_empty"];

export function operatorsForType(fieldType?: string): FlowFilterOp[] {
  switch (fieldType) {
    case "number":
      return NUMERIC;
    case "date":
      return DATE;
    case "boolean":
      return BOOLEAN;
    default:
      return TEXTUAL; // text / email / id / unknown
  }
}

export function operatorOptions(fieldType?: string): Array<{ value: string; label: string }> {
  return operatorsForType(fieldType).map((op) => ({ value: op, label: FILTER_OP_LABELS[op] }));
}
