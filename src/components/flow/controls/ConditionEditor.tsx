"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { OperatorSelect } from "./OperatorSelect";
import { Select } from "./Select";
import { ValueInput } from "./ValueInput";
import { FieldInput } from "./FieldInput";
import { operatorsForType } from "./operators";
import { humanizeKey } from "./field-utils";
import type { DataGroup, ValueModel } from "./types";
import { NO_VALUE_FILTER_OPS, type FilterConfig } from "@/lib/flow/types";

type Rule = FilterConfig["rules"][number];

/** Convert a stored rule's value side into the ValueInput model (looking up display info). */
function ruleToValue(rule: Rule, groups: DataGroup[]): ValueModel {
  if (rule.valueKind === "field" && rule.valueField) {
    const owner = groups.find((g) => g.fields.some((x) => x.path === rule.valueField));
    const f = owner?.fields.find((x) => x.path === rule.valueField);
    return {
      mode: "field",
      text: "",
      field: {
        producerStepId: owner?.stepId ?? "",
        fieldPath: rule.valueField,
        label: f?.label ?? humanizeKey(rule.valueField),
        source: owner?.source,
        stepNo: owner?.stepNo,
        sample: f?.sample,
      },
    };
  }
  return { mode: "fixed", text: rule.value ?? "", field: null };
}

/** Fold a ValueInput model back into the rule's persisted fields. */
function valueToRule(v: ValueModel): Partial<Rule> {
  if (v.mode === "field" && v.field) return { valueKind: "field", valueField: v.field.fieldPath, value: "" };
  return { valueKind: "fixed", value: v.text, valueField: undefined };
}

/**
 * The condition builder used by Filter and by each Path's "Path conditions" step. Starts
 * empty — the operator only sees comparisons appropriate to the chosen field's type, and
 * the value is a Fixed value or a mapped field. Rules combine with All (AND) or Any (OR).
 * `groups` is the data flowing into this step — the only data conditions test against.
 */
export function ConditionEditor({
  value,
  onChange,
  groups,
}: {
  value: FilterConfig;
  onChange: (v: FilterConfig) => void;
  groups: DataGroup[];
}) {
  const rules = value.rules;

  const setRules = (next: Rule[]) => onChange({ ...value, rules: next });
  const updateRule = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const addRule = () => setRules([...rules, { field: "", op: "equals", value: "", value2: undefined, valueKind: "fixed", valueField: undefined }]);

  const allFields = groups.flatMap((g) => g.fields);
  const fieldMeta = (path: string) => allFields.find((f) => f.path === path);
  const typeOfRuleField = (rule: Rule) => fieldMeta(rule.field)?.type;

  const pickField = (i: number, path: string) => {
    const newType = fieldMeta(path)?.type;
    const ops = operatorsForType(newType);
    const curOp = rules[i].op;
    updateRule(i, {
      field: path,
      op: ops.includes(curOp) ? curOp : ops[0],
      value: "",
      value2: undefined,
      valueKind: "fixed",
      valueField: undefined,
    });
  };

  return (
    <div className="space-y-3">
      {rules.length > 1 && (
        <div className="flex items-center gap-2 text-tiny text-muted-foreground">
          <span>Continue only if</span>
          <Select
            value={value.combinator}
            options={[
              { value: "and", label: "all" },
              { value: "or", label: "any" },
            ]}
            onChange={(v) => onChange({ ...value, combinator: v as "and" | "or" })}
            width={110}
          />
          <span>of these match:</span>
        </div>
      )}

      <div className="space-y-3">
        {rules.map((rule, i) => {
          const ftype = typeOfRuleField(rule);
          const noValue = NO_VALUE_FILTER_OPS.includes(rule.op);
          const isBetween = rule.op === "between";
          return (
            <div key={i} className="rounded-card border border-border bg-muted/40 p-3">
              {i > 0 && (
                <div className="-mt-1 mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{value.combinator === "or" ? "or" : "and"}</div>
              )}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <FieldLabel>Field</FieldLabel>
                  <FieldInput value={rule.field} groups={groups} onChange={(path) => pickField(i, path)} allowCustom={false} />
                </div>
                <div>
                  <FieldLabel>Condition</FieldLabel>
                  <OperatorSelect value={rule.op} fieldType={ftype} onChange={(op) => updateRule(i, { op: op as Rule["op"] })} />
                </div>
                {!noValue && (
                  <div>
                    <FieldLabel>{isBetween ? "From" : "Value"}</FieldLabel>
                    <ValueInput
                      value={ruleToValue(rule, groups)}
                      onChange={(v) => updateRule(i, valueToRule(v))}
                      groups={groups}
                      fieldType={ftype}
                    />
                  </div>
                )}
                {isBetween && (
                  <div>
                    <FieldLabel>To</FieldLabel>
                    <input
                      type="date"
                      value={rule.value2 ?? ""}
                      onChange={(e) => updateRule(i, { value2: e.target.value })}
                      className={cn(fieldClasses, "px-2 py-1.5 hover:border-ring/50")}
                    />
                  </div>
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="rounded-control text-tiny text-muted-foreground transition-colors hover:text-danger-ink"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRule}
        className="inline-flex items-center gap-1 rounded-control border border-dashed border-border px-2.5 py-1.5 text-tiny text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
      >
        <Plus size={14} strokeWidth={2.25} aria-hidden /> Add condition
      </button>
    </div>
  );
}
