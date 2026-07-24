"use client";

type Rec = {
  source?: string;
  eventType?: string;
  subject?: string | null;
  value?: unknown;
  currency?: string | null;
  occurredAt?: string;
  id?: string;
  properties?: Record<string, unknown>;
};

const STANDARD: Array<[string, keyof Rec]> = [
  ["Subject", "subject"],
  ["Source", "source"],
  ["Event type", "eventType"],
  ["Value", "value"],
  ["Currency", "currency"],
  ["Occurred at", "occurredAt"],
];

function fields(rec: Rec): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [label, key] of STANDARD) {
    const v = rec[key];
    if (v != null && v !== "") out.push({ label, value: String(v) });
  }
  for (const [k, v] of Object.entries(rec.properties ?? {})) {
    if (v != null && v !== "") out.push({ label: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) });
  }
  return out;
}

/**
 * Shows the latest sample records as expandable cards with every field. Picking
 * "Use this record as sample" chooses which record feeds downstream sample
 * values — it does NOT change which records the published flow processes.
 */
export function RecordSamplePicker({ records, selectedIndex, onSelect }: { records: unknown[]; selectedIndex: number; onSelect: (i: number) => void }) {
  if (records.length === 0) return <p className="text-xs text-neutral-400">No records returned.</p>;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Latest {records.length} records</p>
      {records.map((r, i) => {
        const rec = (r ?? {}) as Rec;
        const selected = i === selectedIndex;
        const title = `${rec.source ?? ""} · ${rec.eventType ?? ""}${rec.subject ? ` · ${rec.subject}` : ""}`;
        return (
          <details
            key={i}
            className={`group overflow-hidden rounded-lg border transition-colors ${
              selected ? "border-indigo-200 bg-indigo-50/60 ring-1 ring-indigo-200" : "border-neutral-100 bg-neutral-50 hover:border-indigo-200 hover:bg-indigo-50/40"
            }`}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                {selected && (
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">★</span>
                )}
                <span className={`truncate font-medium ${selected ? "text-indigo-900" : "text-neutral-700"}`}>{title || `Record ${i + 1}`}</span>
              </span>
              <span className="shrink-0 text-[11px] text-neutral-400">{fields(rec).length} fields</span>
            </summary>
            <div className="border-t border-neutral-100 bg-white/70 px-2.5 py-2">
              <dl className="space-y-1">
                {fields(rec).map((f) => (
                  <div key={f.label} className="flex justify-between gap-2 text-[11px]">
                    <dt className="shrink-0 text-neutral-400">{f.label}</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-neutral-700">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => onSelect(i)}
                disabled={selected}
                className={`mt-2.5 w-full rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? "cursor-default border-transparent bg-white text-neutral-400"
                    : "border-indigo-200 text-indigo-700 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white"
                }`}
              >
                {selected ? "Used as sample" : "Use this record as sample"}
              </button>
            </div>
          </details>
        );
      })}
    </div>
  );
}
