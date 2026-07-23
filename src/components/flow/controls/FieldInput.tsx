"use client";

import { DataBrowser } from "./DataBrowser";
import { DataIcon } from "../icons";
import { humanizeKey } from "./field-utils";
import type { DataGroup } from "./types";

const BOX =
  "w-full rounded-md border border-neutral-300 bg-white py-1.5 pl-2 pr-9 text-left text-sm hover:border-neutral-400 focus:border-neutral-400 focus:outline-none";

/**
 * The one field chooser used by every step (Filter conditions, Calculate's
 * field, dedupe's match field, date fields…). Reads as a normal input — the
 * chosen field's name in a full-width box with the data icon inside its right
 * edge — and opens the wide data browser aligned beneath it. The browser's
 * search doubles as free typing: besides picking a listed field, the user can
 * commit what they typed as a custom field path (anything `getField` resolves),
 * so no picker ever dead-ends on an unlisted field.
 */
export function FieldInput({
  value,
  groups,
  onChange,
  placeholder = "Choose a field…",
  allowCustom = true,
}: {
  value: string;
  groups: DataGroup[];
  onChange: (path: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
}) {
  const chosen = value ? groups.flatMap((g) => g.fields).find((f) => f.path === value)?.label ?? humanizeKey(value) : null;
  return (
    <DataBrowser
      groups={groups}
      onPick={(ref) => onChange(ref.fieldPath)}
      onCustom={allowCustom ? (text) => onChange(text) : undefined}
      trigger={({ toggle }) => (
        <div className="relative">
          <button type="button" onClick={toggle} className={BOX}>
            <span className={`block truncate ${chosen ? "text-neutral-800" : "text-neutral-400"}`}>{chosen ?? placeholder}</span>
          </button>
          <span className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1 text-neutral-400">
            <DataIcon />
          </span>
        </div>
      )}
    />
  );
}
