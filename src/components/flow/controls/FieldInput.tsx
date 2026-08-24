"use client";

import { DataBrowser } from "./DataBrowser";
import { ChevronDown, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/input";
import { humanizeKey } from "./field-utils";
import type { DataGroup } from "./types";

const BOX = cn(fieldClasses, "py-2 pl-3 text-left hover:border-ring/50");

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
          <button type="button" onClick={toggle} className={cn(BOX, allowCustom ? "pr-11" : "pr-9")}>
            <span className={`block truncate ${chosen ? "text-foreground" : "text-muted-foreground"}`}>{chosen ?? placeholder}</span>
          </button>
          {allowCustom ? (
            // A field that also accepts a typed value: the data icon opens the browser.
            <button
              type="button"
              onClick={toggle}
              tabIndex={-1}
              title="Pick a field from your data"
              aria-label="Pick a field from your data"
              className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-control border border-brand-200 bg-brand-50 p-1 text-brand-500 transition-colors hover:border-brand-300 hover:bg-brand-100 hover:text-brand-600"
            >
              <Database size={14} strokeWidth={2} />
            </button>
          ) : (
            // Pick-only from the dataset: a plain dropdown chevron, no data icon.
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          )}
        </div>
      )}
    />
  );
}
