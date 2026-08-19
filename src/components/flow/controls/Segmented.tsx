"use client";

/**
 * A row of pills for a small, closed set of choices.
 *
 * The panel reached for a full-width `Select` for every question, including
 * the binary ones — "Stack or match", "A number or a length of time", "One
 * total or a trend". A dropdown for two options costs a click to see an
 * answer that would have fitted on screen, and it hides the alternative,
 * which is the half that teaches what the control is for.
 *
 * Only for choices that are short and few. Anything longer, or anything that
 * grows (fields, steps, presets), stays a Select — a segmented control that
 * wraps to three rows is worse than the dropdown it replaced.
 */
export function Segmented({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: string;
  options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex w-full rounded-lg border border-neutral-300 bg-neutral-100 p-0.5" role="group">
      {options.map((o) => {
        const active = o.value === value;
        const off = disabled || o.disabled;
        return (
          <button
            key={o.value}
            type="button"
            disabled={off}
            title={o.hint}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-w-0 flex-1 truncate rounded-[6px] px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
              active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
            } ${off ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
