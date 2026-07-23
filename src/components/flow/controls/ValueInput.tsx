"use client";

import { DataBrowser } from "./DataBrowser";
import { DataPill } from "./Pill";
import { DataIcon } from "../icons";
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
 *
 * Zapier-style layout: the input runs the full width with the data icon INSIDE its
 * right edge; the browser opens aligned under the input (and wider, extending left).
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
    <DataBrowser
      groups={groups}
      onPick={pickField}
      trigger={({ toggle }) => (
        <div className="relative">
          <input
            type={inputType}
            inputMode={inputMode}
            value={value.text}
            disabled={disabled}
            onChange={(e) => onChange({ mode: "fixed", text: e.target.value, field: null })}
            placeholder={placeholder}
            className={`${INPUT} ${canInsert ? "pr-9" : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          />
          {canInsert && (
            <button
              type="button"
              onClick={toggle}
              title="Insert data from an earlier step"
              aria-label="Insert data from an earlier step"
              className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <DataIcon />
            </button>
          )}
        </div>
      )}
    />
  );
}
