"use client";

import type { MetricSpecT } from "./graph-utils";

const VIZ = ["number", "line", "bar", "category", "table", "progress"] as const;

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-neutral-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 p-4">
          <div>
            <h2 className="text-sm font-semibold">Review &amp; publish</h2>
            <p className="text-xs text-neutral-500">Choose which results appear on your dashboard.</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {endpoints.length === 0 && <p className="text-sm text-neutral-500">This flow has no endpoints yet. Add a Calculate step, then come back.</p>}
          {endpoints.map((ep) => {
            const m = byId.get(ep.nodeId);
            if (!m) return null;
            return (
              <div key={ep.nodeId} className={`rounded-md border p-3 ${m.enabled ? "border-neutral-300" : "border-neutral-200 opacity-70"}`}>
                <label className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => set(ep.nodeId, { enabled: e.target.checked })} className="h-4 w-4" />
                    <span className="truncate text-sm font-medium">{ep.title}</span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">metric</span>
                </label>
                {m.enabled && (
                  <div className="mt-3 space-y-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Metric name</span>
                      <input value={m.name} onChange={(e) => set(ep.nodeId, { name: e.target.value })} placeholder="e.g. Show-up rate" className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Show as</span>
                        <select value={m.viz} onChange={(e) => set(ep.nodeId, { viz: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                          {VIZ.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Format</span>
                        <select value={m.format} onChange={(e) => set(ep.nodeId, { format: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                          <option value="number">Number</option>
                          <option value="percent">Percentage</option>
                          <option value="currency">Currency</option>
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Decimals</span>
                        <input type="number" value={m.precision} onChange={(e) => set(ep.nodeId, { precision: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">Goal / target</span>
                        <input type="number" value={m.target ?? ""} onChange={(e) => set(ep.nodeId, { target: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-neutral-100 p-4">
          {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">Can’t publish: {error}</p>}
          {warning && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{warning}</p>}
          <button
            onClick={onPublish}
            disabled={publishing || enabledCount === 0}
            className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : publishedVersion != null ? `Update dashboard (${enabledCount})` : `Publish ${enabledCount} metric${enabledCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
