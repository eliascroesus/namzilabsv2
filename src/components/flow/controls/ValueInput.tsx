"use client";

import { DataBrowser } from "./DataBrowser";
import { DataPill } from "./Pill";
import type { DataGroup, FieldRef, ValueModel } from "./types";
import { emptyValue } from "./types";
import { fieldRefIsStale, hasAnyFields } from "./field-utils";

const INPUT =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none";

/**
 * A single value input that is either a typed literal ("Fixed value") or one mapped
 * upstream field ("Use a field") — the exact shape the engine resolves per record. The
 * field pill snapshots the source/step/label/sample; if the producing step or field is
 * gone it renders a stale warning and is never silently remapped. Type-aware: number and
 * date fixed values get the appropriate input affordance.
 */
export function ValueInput({
  value,
  onChange,
  groups,
  fieldType,
  placeholder = "Enter a value",
  disabled = false,
  allowField = true,
}: {
  value: ValueModel;
  onChange: (v: ValueModel) => void;
  groups: DataGroup[];
  fieldType?: string;
  placeholder?: string;
  disabled?: boolean;
  allowField?: boolean;
}) {
  const canInsert = allowField && !disabled && hasAnyFields(groups);
  const pickField = (ref: FieldRef) => onChange({ mode: "field", text: "", field: ref });
  const clear = () => onChange({ ...emptyValue });

  if (value.mode === "field" && value.field) {
    const stale = fieldRefIsStale(value.field, groups);
    return (
      <DataBrowser
        groups={groups}
        onPick={pickField}
        trigger={({ toggle }) => (
          <DataPill
            stepNo={value.field!.stepNo}
            source={value.field!.source}
            label={value.field!.label}
            sample={value.field!.sample}
            stale={stale}
            onClick={disabled ? undefined : toggle}
            onClear={disabled ? undefined : clear}
          />
        )}
      />
    );
  }

  const inputType = fieldType === "date" ? "date" : "text";
  const inputMode = fieldType === "number" ? "decimal" : undefined;

  return (
    <div className="flex items-center gap-1.5">
      <input
        type={inputType}
        inputMode={inputMode}
        value={value.text}
        disabled={disabled}
        onChange={(e) => onChange({ mode: "fixed", text: e.target.value, field: null })}
        placeholder={placeholder}
        className={`${INPUT} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      />
      {canInsert && <DataBrowser groups={groups} onPick={pickField} align="right" />}
    </div>
  );
}
