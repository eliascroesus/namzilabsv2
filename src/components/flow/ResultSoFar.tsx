"use client";

import type { ChainStepDTO } from "@/app/dashboard/flows/actions";

function fmtVal(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString();
}

/** A plain-English sentence for one step's running result. */
function sentence(step: ChainStepDTO, title: string): string {
  const { type, recordsIn, recordsOut, value } = step;
  const v = value != null ? fmtVal(value) : "—";
  switch (type) {
    case "app":
      return `${recordsOut} records loaded from ${title}`;
    case "filter":
      return `${recordsOut} of ${recordsIn} records remain after ${title}`;
    case "time":
      return `${recordsOut} of ${recordsIn} records within ${title}`;
    case "formatter":
      return `${recordsOut} records reshaped by ${title}`;
    case "combine":
      return `${recordsOut} records after ${title}`;
    case "paths":
      return `${recordsOut} records routed by ${title}`;
    case "group":
      return `${recordsOut} groups from ${title}`;
    case "aggregate":
    case "formula":
      return `${title} = ${v}`;
    case "output":
      return `${title}: ${v}`;
    default:
      return `${recordsOut} of ${recordsIn} records`;
  }
}

/**
 * Persistent "Result so far" panel: the running result of each step from the source
 * down to the selected step, in plain English. Auto-refreshes on a debounce (the
 * caller recomputes) — read-only transforms never need a manual test.
 */
export function ResultSoFar({ steps, titles, loading }: { steps: ChainStepDTO[]; titles: Record<string, string>; loading?: boolean }) {
  if (steps.length === 0) {
    return (
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Result so far</p>
        <p className="mt-1 text-xs text-neutral-400">Choose an account and load data to see live results.</p>
      </div>
    );
  }
  return (
    <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Result so far</p>
        {loading && <span className="text-[10px] text-neutral-400">updating…</span>}
      </div>
      <ul className="mt-1 space-y-1">
        {steps.map((s) => (
          <li key={s.nodeId} className={`flex items-start gap-1.5 text-xs ${s.status === "error" ? "text-red-600" : "text-neutral-700"}`}>
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "error" ? "bg-red-500" : "bg-green-500"}`} />
            <span className="min-w-0">{s.status === "error" ? (s.error ?? "This step has an error.") : sentence(s, titles[s.nodeId] ?? "this step")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
