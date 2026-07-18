"use client";

import type { ReviewSummary } from "./outline";

/**
 * The "Review and publish" summary: what will be published, and what's not ready.
 * Publishing snapshots an immutable version and materializes the dashboard tile.
 */
export function ReviewModal({
  summary,
  publishing,
  error,
  onPublish,
  onClose,
}: {
  summary: ReviewSummary;
  publishing: boolean;
  error: string | null;
  onPublish: () => void;
  onClose: () => void;
}) {
  const notReady = summary.metrics.length === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-20" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 p-4">
          <h2 className="text-sm font-semibold">Review and publish</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4 text-sm">
          <Section title="Dashboard metric">
            {summary.metrics.length === 0 ? (
              <p className="text-amber-700">No Dashboard metric step yet — add one so there is something to publish.</p>
            ) : (
              summary.metrics.map((m, i) => (
                <p key={i} className="flex items-center justify-between">
                  <span className="font-medium">{m.name}</span>
                  {m.value != null && <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{m.value}{m.format === "percent" ? "%" : ""}</span>}
                </p>
              ))
            )}
          </Section>

          <Section title="Source accounts">
            {summary.sources.length === 0 ? <Muted>None</Muted> : summary.sources.map((s, i) => <p key={i}>{s}</p>)}
          </Section>

          {summary.dateRules.length > 0 && (
            <Section title="Date rules">{summary.dateRules.map((d, i) => <p key={i}>{d}</p>)}</Section>
          )}

          <Section title="Calculations">
            {summary.calculations.length === 0 ? <Muted>None</Muted> : summary.calculations.map((c, i) => <p key={i}>{c}</p>)}
          </Section>

          {(summary.untested.length > 0 || summary.stale.length > 0) && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {summary.untested.length > 0 && (
                <p>
                  <b>Untested steps:</b> {summary.untested.map((u) => `${u.step != null ? `${u.step}. ` : ""}${u.title}`).join(", ")}. Publishing will still try to compute them.
                </p>
              )}
              {summary.stale.length > 0 && (
                <p className="mt-1">
                  <b>Changed since last preview:</b> {summary.stale.map((u) => `${u.step != null ? `${u.step}. ` : ""}${u.title}`).join(", ")}.
                </p>
              )}
            </div>
          )}

          <Section title="After publishing">
            <p className="text-xs text-neutral-500">
              The result is computed now and shown on your dashboard. It refreshes automatically when new data arrives and on a
              schedule; you can also refresh a tile by hand. Editing this draft won&rsquo;t change the live tile until you publish again.
            </p>
          </Section>

          {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 p-4">
          <button onClick={onClose} className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50">Keep editing</button>
          <button onClick={onPublish} disabled={publishing || notReady} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {publishing ? "Publishing…" : "Publish now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</p>
      <div className="space-y-0.5 text-neutral-700">{children}</div>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-neutral-400">{children}</p>;
}
