"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/input";

const INPUT = cn(fieldClasses, "px-3 py-2 hover:border-ring/50");

/**
 * A number input that can be cleared without emitting a non-number.
 *
 * The plain `<input type="number">` it replaces did `Number(e.target.value)`,
 * and `Number("")` is `NaN`. Clearing the Decimals box in Review & publish
 * therefore wrote NaN into the metric spec, which fails the graph's schema —
 * so the autosave of that edit and of EVERY edit after it silently failed,
 * announced only as the word "Save failed" in grey twelve-point text styled
 * exactly like "Saved". The work was gone until someone happened to refill
 * the box.
 *
 * The text lives here, locally, and only a finite number is ever handed
 * upward. An empty box is either null (when the caller allows it) or simply
 * nothing at all — never NaN.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  allowNull = false,
  placeholder,
  className,
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  min?: number;
  max?: number;
  allowNull?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^-?\d*\.?\d*$/.test(t)) return;
        setText(t);
        if (t === "" || t === "-" || t === ".") {
          if (allowNull) onChange(null);
          return;
        }
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
        onChange(clamped);
      }}
      onBlur={() => {
        /**
         * Leaving the box ALWAYS shows what was actually saved. The local
         * text can drift from the stored value whenever a clamp intervenes —
         * type "500" into a 1–50 field and the store holds 50 while the box
         * kept "500" (the second clamp-to-50 changes nothing, so the resync
         * effect never fires). A config box permanently displaying a value
         * that was never saved is the config UI lying about the config.
         */
        setText(value == null ? "" : String(value));
      }}
      className={cn(INPUT, className)}
    />
  );
}
