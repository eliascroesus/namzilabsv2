"use client";

import { Star } from "lucide-react";
import { eventTypeLabel } from "@/connectors/catalog";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";

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
  return formatDate(new Date(t));
}

/**
 * Shows the latest sample records as expandable cards with every field. Picking
 * "Use this record as sample" chooses which record feeds downstream sample
 * values — it does NOT change which records the published flow processes.
 */
export function RecordSamplePicker({ records, selectedIndex, onSelect }: { records: unknown[]; selectedIndex: number; onSelect: (i: number) => void }) {
  if (records.length === 0) return <p className="text-xs text-muted-foreground">No records returned.</p>;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest {records.length} records</p>
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
            className={cn(
              "group overflow-hidden rounded-control border transition-colors has-[summary:focus-visible]:ring-4 has-[summary:focus-visible]:ring-ring/40",
              /* Selection is the marker's, edge and wash alike: `bg-accent` is
                 marker-50, so its border comes off the same ramp rather than
                 off the brand's, which at these steps is a pale gold. */
              selected ? "border-marker-300 bg-accent/60" : "border-border bg-muted/40 hover:border-marker-200 hover:bg-muted",
            )}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                {/* A COLOURED GLYPH IS THE MARKER'S, filled or not. A 14px star
                    is read against the surface behind it rather than as a
                    surface carrying ink, so the 11.24:1 the yellow earns under
                    near-black does not apply to it — as `text-primary` it would
                    be a 1.55:1 star on a violet wash. It takes the ink step so
                    it is the same violet as the title beside it, instead of two
                    violets two rungs apart on one row. */}
                {selected && <Star size={14} fill="currentColor" className="shrink-0 text-marker" aria-hidden />}
                <span className={cn("truncate font-medium", selected ? "text-accent-foreground" : "text-foreground")}>{title || `Record ${i + 1}`}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {recordWhen(rec.occurredAt) && <span className="mr-1.5">{recordWhen(rec.occurredAt)}</span>}
                {fields(rec).length} fields
              </span>
            </summary>
            <div className="border-t border-border bg-card/70 px-2.5 py-2">
              <dl className="space-y-1">
                {fields(rec).map((f) => (
                  <div key={f.label} className="flex justify-between gap-2 text-xs">
                    <dt className="shrink-0 text-muted-foreground">{f.label}</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-foreground">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={() => onSelect(i)}
                disabled={selected}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2.5 w-full")}
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
