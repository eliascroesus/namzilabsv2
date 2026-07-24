"use client";

import type { MetricSpecT } from "./graph-utils";
import { Select } from "./controls";

const VIZ_OPTIONS = [
  { value: "number", label: "Single number" },
  { value: "line", label: "Line chart" },
  { value: "bar", label: "Bar chart" },
  { value: "category", label: "Category breakdown" },
  { value: "table", label: "Table" },
  { value: "progress", label: "Progress bar" },
];
const FORMAT_OPTIONS = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percentage" },
  { value: "currency", label: "Currency" },
];
const TIME_UNIT_OPTIONS = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "quarter", label: "By quarter" },
  { value: "year", label: "By year" },
];

/** An endpoint of the flow (a step with no next step) that can become a metric. */
export type Endpoint = { nodeId: string; title: string };

/**
 * "Review & publish": the Output node is gone — instead each flow endpoint becomes a
 * metric here. Flows whose Paths branches weren't recombined have several endpoints,
 * so the user picks which become dashboard tiles and names/formats each.
 */
export function ReviewPublishModal({
  endpoints,
  metrics,
  timeFieldOptions,
  publishing,
  error,
  warning,
  publishedVersion,
  onChange,
  onPublish,
  onClose,
}: {
  endpoints: Endpoint[];
  metrics: MetricSpecT[];
  timeFieldOptions: Array<{ value: string; label: string; hint?: string }>;
  publishing: boolean;
  error: string | null;
  warning: string | null;
  publishedVersion: number | null;
  onChange: (m: MetricSpecT[]) => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const byId = new Map(metrics.map((m) => [m.nodeId, m]));
  const set = (nodeId: string, patch: Partial<MetricSpecT>) => onChange(metrics.map((m) => (m.nodeId === nodeId ? { ...m, ...patch } : m)));
  const enabledCount = metrics.filter((m) => m.enabled).length;

  const inputCls =
    "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-800 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-16 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white flow-shadow flow-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">Review &amp; publish</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Choose which results appear on your dashboard.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-neutral-50/60 p-4">
          {endpoints.length === 0 && <p className="text-sm text-neutral-500">This flow has no endpoints yet. Add a Calculate step, then come back.</p>}
          {endpoints.map((ep) => {
            const m = byId.get(ep.nodeId);
            if (!m) return null;
            return (
              <div key={ep.nodeId} className={`rounded-xl border p-3.5 transition-colors ${m.enabled ? "border-indigo-200 bg-indigo-50/40" : "border-neutral-100 bg-white opacity-80"}`}>
                <label className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => set(ep.nodeId, { enabled: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
                    <span className="truncate text-sm font-semibold text-neutral-800">{ep.title}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">metric</span>
                </label>
                {m.enabled && (
                  <div className="mt-3 space-y-2.5">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Metric name</span>
                      <input value={m.name} onChange={(e) => set(ep.nodeId, { name: e.target.value })} placeholder="e.g. Show-up rate" className={inputCls} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Show as</span>
                        <Select value={m.viz} width={210} options={VIZ_OPTIONS} onChange={(v) => set(ep.nodeId, { viz: v })} />
                      </div>
                      <div>
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Format</span>
                        <Select value={m.format} width={210} options={FORMAT_OPTIONS} onChange={(v) => set(ep.nodeId, { format: v })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Time reference</span>
                        <Select
                          value={m.timeField ?? ""}
                          width={260}
                          searchable
                          placeholder="Pick a field…"
                          options={[{ value: "", label: "None" }, ...timeFieldOptions]}
                          onChange={(v) => set(ep.nodeId, { timeField: v || undefined })}
                        />
                      </div>
                      {(m.viz === "line" || m.viz === "bar") && m.timeField && (
                        <div>
                          <span className="mb-1 block text-xs font-medium text-neutral-600">Group by</span>
                          <Select value={m.timeUnit ?? "month"} width={210} options={TIME_UNIT_OPTIONS} onChange={(v) => set(ep.nodeId, { timeUnit: v })} />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Decimals</span>
                        <input type="number" value={m.precision} onChange={(e) => set(ep.nodeId, { precision: Number(e.target.value) })} className={inputCls} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Goal / target</span>
                        {/* The goal is in the metric's own format: % for percentages, $ for currency. */}
                        <div className="relative">
                          {m.format === "currency" && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>}
                          <input
                            type="number"
                            value={m.target ?? ""}
                            onChange={(e) => set(ep.nodeId, { target: e.target.value === "" ? null : Number(e.target.value) })}
                            className={`${inputCls} ${m.format === "currency" ? "pl-6" : ""} ${m.format === "percent" ? "pr-7" : ""}`}
                          />
                          {m.format === "percent" && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">%</span>}
                        </div>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-neutral-100 p-4">
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">Can’t publish: {error}</p>}
          {warning && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{warning}</p>}
          <button
            onClick={onPublish}
            disabled={publishing || enabledCount === 0}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : publishedVersion != null ? `Update dashboard (${enabledCount})` : `Publish ${enabledCount} metric${enabledCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
