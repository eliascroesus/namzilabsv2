"use client";

import { Select } from "./Select";
import { operatorOptions } from "./operators";

/** A searchable operator dropdown whose choices match the selected field's type. */
export function OperatorSelect({ value, fieldType, onChange }: { value: string; fieldType?: string; onChange: (v: string) => void }) {
  return <Select value={value} options={operatorOptions(fieldType)} onChange={onChange} searchable placeholder="Choose condition…" width={240} />;
}
