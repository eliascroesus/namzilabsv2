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
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Latest {records.length} records</p>
      {records.map((r, i) => {
        const rec = (r ?? {}) as Rec;
        const selected = i === selectedIndex;
        const title = `${rec.source ?? ""} · ${rec.eventType ?? ""}${rec.subject ? ` · ${rec.subject}` : ""}`;
        return (
          <details key={i} className={`rounded border ${selected ? "border-neutral-800 bg-neutral-50" : "border-neutral-200"}`}>
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span className="truncate">
                {selected && <span className="mr-1 text-neutral-800">★</span>}
                {title || `Record ${i + 1}`}
              </span>
              <span className="shrink-0 text-neutral-400">{fields(rec).length} fields</span>
            </summary>
            <div className="border-t border-neutral-100 p-2">
              <dl className="space-y-0.5">
                {fields(rec).map((f) => (
                  <div key={f.label} className="flex justify-between gap-2 text-[11px]">
                    <dt className="shrink-0 text-neutral-400">{f.label}</dt>
                    <dd className="min-w-0 truncate text-right text-neutral-700">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => onSelect(i)}
                disabled={selected}
                className={`mt-2 w-full rounded border px-2 py-1 text-xs font-medium ${selected ? "cursor-default border-neutral-300 text-neutral-400" : "border-neutral-800 text-neutral-800 hover:bg-neutral-800 hover:text-white"}`}
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
