"use client";

import { Copy, Plus } from "lucide-react";
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
  /**
   * COPY A CONDITION, NEXT TO THE ONE IT CAME FROM.
   *
   * The case this exists for is the one that produced it: three conditions on
   * the SAME field with the same operator and only the value differing —
   * `willing_to_invest starts with $1,000 / $2,500 / $5,000`. Building that from
   * "Add condition" means choosing the field and the operator again for each,
   * out of a field list that can run to forty entries, when the only thing that
   * actually differs is the last box.
   *
   * INSERTED AT `i + 1`, not appended. A copy that appears at the bottom of a
   * list of six is a copy you then have to find. Position is purely cosmetic
   * here — every rule joins by the SAME combinator, so a flat list means the
   * same thing in any order — which is exactly why the copy can go where it
   * reads best rather than where it is cheapest.
   *
   * SPREAD, so the copy shares no reference with its original. `value2` and
   * `valueField` are plain strings and the rest are primitives, so one level is
   * the whole object — but a rule that ever grows a nested bag would need this
   * to grow with it, or editing the copy would silently edit the original.
   *
   * Safe against the index keys this list renders with: `ValueInput`,
   * `FieldInput` and `OperatorSelect` are all fully controlled — none of them
   * holds state of its own — so a row shifting down by one carries nothing
   * with it that could be wrong.
   */
  const duplicateRule = (i: number) => setRules([...rules.slice(0, i + 1), { ...rules[i] }, ...rules.slice(i + 1)]);

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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                <div className="-mt-1 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{value.combinator === "or" ? "or" : "and"}</div>
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
              {/* TWO ACTS, SAME VOICE. Duplicate joins Remove in the row that
                  was already there rather than becoming a floating icon in a
                  corner — they are the two things you can do to a condition and
                  a reader should find them in one place.
                  IT CARRIES A WORD AS WELL AS A GLYPH. A bare icon beside a
                  text link reads as two different kinds of control, and "copy"
                  and "remove" are close enough in consequence that guessing
                  between them from a 13px picture is a bad trade for the space
                  saved. Remove keeps its exact appearance and its danger hover;
                  Duplicate is neutral, because copying costs nothing. */}
              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => duplicateRule(i)}
                  title="Duplicate this condition"
                  className="inline-flex items-center gap-1 rounded-control text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Copy size={12} aria-hidden />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="rounded-control text-xs text-muted-foreground transition-colors hover:text-danger-ink"
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
        className="inline-flex items-center gap-1 rounded-control border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
      >
        <Plus size={14} aria-hidden /> Add condition
      </button>
    </div>
  );
}
