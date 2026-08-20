"use client";

import { eventTypeLabel } from "@/connectors/catalog";

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
  // Raw keys: this is the record's data, and it has to read as the same
  // string a Filter step would match on.
  for (const [k, v] of Object.entries(rec.properties ?? {})) {
    if (v != null && v !== "") out.push({ label: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) });
  }
  return out;
}

/**
 * When it happened, at a glance — "is this data fresh?" must be answerable
 * from the row. LOCAL time, like every other date this app renders: a call
 * logged 7:30 PM Aug 4 CDT is stored as Aug 5 00:30 UTC, and labelling it
 * "Aug 5" contradicts the CRM the user is comparing against — the exact
 * "backend is mixing things up" impression this row exists to dispel.
 */
export function recordWhen(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Shows the latest sample records as expandable cards with every field. Picking
 * "Use this record as sample" chooses which record feeds downstream sample
 * values — it does NOT change which records the published flow processes.
 */
export function RecordSamplePicker({ records, selectedIndex, onSelect }: { records: unknown[]; selectedIndex: number; onSelect: (i: number) => void }) {
  if (records.length === 0) return <p className="text-tiny text-neutral-400">No records returned.</p>;
  return (
    <div className="space-y-1.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-neutral-400">Latest {records.length} records</p>
      {records.map((r, i) => {
        const rec = (r ?? {}) as Rec;
        const selected = i === selectedIndex;
        // Human label on the card title only; the expanded field rows below
        // keep raw values — that is the record's data, and the browser stays
        // honest about what a Filter step would actually match.
        const title = `${rec.source ?? ""} · ${rec.eventType ? eventTypeLabel(rec.source ?? null, rec.eventType) : ""}${rec.subject ? ` · ${rec.subject}` : ""}`;
        return (
          <details
            key={i}
            className={`group overflow-hidden rounded-lg border transition-colors ${
              selected ? "border-brand-200 bg-brand-50/60 ring-1 ring-brand-200" : "border-neutral-100 bg-neutral-50 hover:border-brand-200 hover:bg-brand-50/40"
            }`}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-tiny">
              <span className="flex min-w-0 items-center gap-1.5">
                {selected && (
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-600 text-micro font-bold text-white">★</span>
                )}
                <span className={`truncate font-medium ${selected ? "text-brand-900" : "text-neutral-700"}`}>{title || `Record ${i + 1}`}</span>
              </span>
              <span className="shrink-0 text-micro text-neutral-400">
                {recordWhen(rec.occurredAt) && <span className="mr-1.5">{recordWhen(rec.occurredAt)}</span>}
                {fields(rec).length} fields
              </span>
            </summary>
            <div className="border-t border-neutral-100 bg-white/70 px-2.5 py-2">
              <dl className="space-y-1">
                {fields(rec).map((f) => (
                  <div key={f.label} className="flex justify-between gap-2 text-micro">
                    <dt className="shrink-0 text-neutral-400">{f.label}</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-neutral-700">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => onSelect(i)}
                disabled={selected}
                className={`mt-2.5 w-full rounded-md border px-2 py-1.5 text-tiny font-medium transition-colors ${
                  selected
                    ? "cursor-default border-transparent bg-white text-neutral-400"
                    : "border-brand-200 text-brand-700 hover:border-brand-600 hover:bg-brand-600 hover:text-white"
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
