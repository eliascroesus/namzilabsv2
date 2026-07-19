"use client";

import { useState } from "react";
import type { FieldGroup } from "./graph-utils";
import { fieldProvenance } from "./graph-utils";
import { FieldPicker } from "./FieldPicker";
import { MappingChip } from "./MappingChip";

export type ValuePatch = { value?: string; valueKind?: "fixed" | "field"; valueField?: string };

const CTRL = "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs";

function FixedInput({ type, value, placeholder, onChange }: { type?: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  if (type === "number") return <input type="number" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={CTRL} />;
  if (type === "date") return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={CTRL} />;
  if (type === "boolean")
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={CTRL}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  return <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={CTRL} />;
}

/**
 * A value field that supports a fixed literal or a mapped upstream field (Zapier-style).
 * Fixed mode is type-aware (number/date/boolean/text based on the field being compared);
 * field mode opens the data browser and renders the choice as a data pill.
 */
export function ValueInput({
  value,
  valueKind,
  valueField,
  fieldGroups,
  fieldType,
  placeholder,
  onChange,
}: {
  value: string;
  valueKind?: "fixed" | "field";
  valueField?: string;
  fieldGroups: FieldGroup[];
  /** Inferred type of the field being compared, so fixed input matches (number/date/…). */
  fieldType?: string;
  placeholder?: string;
  onChange: (patch: ValuePatch) => void;
}) {
  const kind = valueKind === "field" ? "field" : "fixed";
  const [picking, setPicking] = useState(false);
  const prov = valueField ? fieldProvenance(fieldGroups, valueField) : null;

  const tabCls = (active: boolean) => `rounded px-2 py-0.5 text-[11px] font-medium ${active ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`;

  return (
    <div className="space-y-1">
      <div className="inline-flex gap-1 rounded-md bg-neutral-100 p-0.5">
        <button type="button" className={tabCls(kind === "fixed")} onClick={() => onChange({ valueKind: "fixed" })}>
          Fixed value
        </button>
        <button type="button" className={tabCls(kind === "field")} onClick={() => { onChange({ valueKind: "field" }); setPicking(!valueField); }}>
          Use a field
        </button>
      </div>

      {kind === "fixed" ? (
        <FixedInput type={fieldType} value={value ?? ""} placeholder={placeholder} onChange={(v) => onChange({ value: v })} />
      ) : valueField && prov && !picking ? (
        <MappingChip
          stepNo={prov.stepNo}
          source={prov.source}
          label={prov.label}
          sample={prov.sample}
          onClick={() => setPicking(true)}
          onClear={() => onChange({ valueField: "" })}
        />
      ) : (
        <FieldPicker
          value={valueField ?? ""}
          fieldGroups={fieldGroups}
          onChange={(p) => onChange({ valueField: p })}
          onCommit={() => setPicking(false)}
        />
      )}
    </div>
  );
}
