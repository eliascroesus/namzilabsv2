"use client";

import { useState, type ReactNode } from "react";
import type { MetricSpecT } from "./graph-utils";
import { Select } from "./controls";
import { formatMetricValue } from "@/lib/format";
import { NumberField } from "./controls/NumberField";

/**
 * Only what the dashboard tile HONESTLY renders. "Line" and "Table" used to
 * be offered here with no renderer behind them — a promise the tile broke by
 * silently drawing bars. The zod enum keeps every legacy value valid, and a
 * saved legacy choice stays selectable below so nobody's spec is silently
 * rewritten.
 */
const VIZ_OPTIONS = [
  { value: "number", label: "Single number" },
  { value: "bar", label: "Bar chart" },
  { value: "category", label: "Category breakdown" },
  { value: "progress", label: "Progress toward goal" },
];
const LEGACY_VIZ_LABELS: Record<string, string> = { line: "Line chart (draws bars)", table: "Table (draws bars)", funnel: "Funnel (draws bars)" };
const FORMAT_OPTIONS = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percentage" },
  { value: "currency", label: "Currency" },
];
/**
 * A length of time is declared by the STEP that measures it, which is also
 * where the unit it counts and the way it reads are chosen. Offering it here
 * as well let a metric be marked a duration with no unit behind it, which
 * silently meant minutes. It stays listed for a metric that already is one,
 * so the dropdown shows what it is, but it cannot be picked into.
 */
const DURATION_OPTION = { value: "duration", label: "Length of time (set on the step)", disabled: true };
const formatOptionsFor = (format: string) => (format === "duration" ? [...FORMAT_OPTIONS, DURATION_OPTION] : FORMAT_OPTIONS);
const TIME_UNIT_OPTIONS = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "quarter", label: "By quarter" },
  { value: "year", label: "By year" },
];

/** An endpoint of the flow (a step with no next step) that can become a metric. */
export type Endpoint = { nodeId: string; title: string };

/** A small inline "▸ label" section that opens in place. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md py-1 text-tiny font-medium text-neutral-500 transition-colors hover:text-foreground"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ›
        </span>
        {summary}
      </button>
      {open && <div className="mt-1.5 space-y-2.5">{children}</div>}
    </div>
  );
}

/**
 * "Review & publish": the Output node is gone — instead each flow endpoint becomes a
 * metric here. Flows whose Paths branches weren't recombined have several endpoints,
 * so the user picks which become dashboard tiles and names/formats each.
 */
export function ReviewPublishModal({
  endpoints,
  metrics,
  previews,
  timeFieldOptions,
  hasCustomRange,
  hasOpenEndedRange,
  publishing,
  error,
  issues,
  onSelectNode,
  warning,
  publishedVersion,
  onChange,
  onPublish,
  onClose,
}: {
  endpoints: Endpoint[];
  metrics: MetricSpecT[];
  /** Each endpoint's last tested value, unformatted — null when untested. */
  previews: Record<string, number | null>;
  timeFieldOptions: Array<{ value: string; label: string; hint?: string }>;
  /** True when any step uses a date window with BOTH ends set. */
  hasCustomRange: boolean;
  /** True when any step uses a date window with no end date. */
  hasOpenEndedRange: boolean;
  publishing: boolean;
  error: string | null;
  /** Publish issues, each naming the step that caused it. */
  issues: Array<{ nodeId?: string; message: string }>;
  /** Select a step on the canvas and close this modal. */
  onSelectNode: (nodeId: string) => void;
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
    "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-base text-foreground transition-colors focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-16 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-surface border border-border bg-card shadow-panel flow-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="text-title font-semibold tracking-tight text-foreground">Review &amp; publish</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-neutral-50/60 p-4">
          {endpoints.length === 0 && <p className="text-base text-neutral-500">This flow has no result step yet. Add a Calculate step, then come back.</p>}
          {/* The one change in the reliability pass that MOVES a number, said
              at the moment of consequence rather than in a release note. */}
          {/* The bigger of the two window changes, and the one most likely to
              move a live number: an open end used to stop at the current
              instant, so a flow reading a calendar counted 9 of its 20
              matching meetings. */}
          {hasOpenEndedRange && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-tiny text-amber-900">
              A date range with no “To” now has no end at all. It used to stop at the moment the number was computed, so anything dated in the future —
              scheduled meetings — was left out. This number may rise.
            </p>
          )}
          {hasCustomRange && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-tiny text-amber-900">
              A custom date range now includes the whole of its “To” day. It used to stop at midnight, so this number may rise by up to a day&rsquo;s worth of records.
            </p>
          )}
          {endpoints.map((ep) => {
            const m = byId.get(ep.nodeId);
            if (!m) return null;
            return (
              <div key={ep.nodeId} className={`rounded-xl border p-3.5 transition-colors ${m.enabled ? "border-brand-200 bg-brand-50/40" : "border-neutral-100 bg-white opacity-80"}`}>
                <label className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => set(ep.nodeId, { enabled: e.target.checked })} className="h-4 w-4 accent-brand-600" />
                    <span className="truncate text-base font-semibold text-foreground">{ep.title}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-neutral-400">metric</span>
                </label>
                {m.enabled && (
                  <div className="mt-3 space-y-2.5">
                    <label className="block">
                      <span className="mb-1 block text-base font-semibold text-foreground">Metric name</span>
                      <input value={m.name} onChange={(e) => set(ep.nodeId, { name: e.target.value })} placeholder="e.g. Show-up rate" className={inputCls} />
                    </label>
                    {previews[ep.nodeId] != null && (
                      <p className="text-tiny font-medium text-neutral-700">{formatMetricValue(previews[ep.nodeId], m)}</p>
                    )}
                    {/* THE ONE SETTING THAT CHANGES A NUMBER STAYS IN THE OPEN.
                        Everything else here is presentation and has a correct
                        default; this decides which records land in which
                        period, so it is the only one a user can get wrong
                        without noticing. Its old label, "Time reference", read
                        as a chart setting — the question is concrete and the
                        label now asks it. */}
                    <div>
                      <span className="mb-1 block text-base font-semibold text-foreground">Date the dashboard filters by</span>
                      <Select
                        value={m.timeField ?? ""}
                        width={260}
                        searchable
                        placeholder="Pick a field…"
                        options={[{ value: "", label: "When it happened (default)" }, ...timeFieldOptions]}
                        onChange={(v) => set(ep.nodeId, { timeField: v || undefined })}
                      />
                    </div>

                    {/* Five presentation settings, folded away. A user who
                        wants one number on a dashboard was answering seven
                        questions per metric, six of which already had the
                        right answer. */}
                    <Disclosure summary="Display options">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="mb-1 block text-base font-semibold text-foreground">Show as</span>
                          <Select
                            value={m.viz}
                            width={210}
                            options={VIZ_OPTIONS.some((o) => o.value === m.viz) ? VIZ_OPTIONS : [...VIZ_OPTIONS, { value: m.viz, label: LEGACY_VIZ_LABELS[m.viz] ?? m.viz }]}
                            onChange={(v) => set(ep.nodeId, { viz: v })}
                          />
                        </div>
                        <div>
                          <span className="mb-1 block text-base font-semibold text-foreground">Format</span>
                          <Select value={m.format} width={210} options={formatOptionsFor(m.format)} onChange={(v) => set(ep.nodeId, { format: v })} />
                        </div>
                      </div>
                      {(m.viz === "line" || m.viz === "bar") && m.timeField && (
                        <div>
                          <span className="mb-1 block text-base font-semibold text-foreground">Group by</span>
                          <Select value={m.timeUnit ?? "month"} width={210} options={TIME_UNIT_OPTIONS} onChange={(v) => set(ep.nodeId, { timeUnit: v })} />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-base font-semibold text-foreground">Decimals</span>
                          {/* Not <input type="number">: Number("") is NaN, and a
                              NaN here fails the graph schema, so clearing this
                              box silently killed the autosave of this edit and
                              every edit after it. */}
                          <NumberField value={m.precision} min={0} onChange={(n) => set(ep.nodeId, { precision: n ?? 0 })} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-base font-semibold text-foreground">Goal / target</span>
                          {/* The goal is in the metric's own format: % for percentages, $ for currency. */}
                          <div className="relative">
                            {m.format === "currency" && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-neutral-400">$</span>}
                            <NumberField
                              value={m.target}
                              allowNull
                              onChange={(n) => set(ep.nodeId, { target: n })}
                              className={`${m.format === "currency" ? "pl-6" : ""} ${m.format === "percent" ? "pr-7" : ""}`}
                            />
                            {m.format === "percent" && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-base text-neutral-400">%</span>}
                          </div>
                        </label>
                      </div>
                    </Disclosure>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-neutral-100 p-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-tiny text-red-800">
              <p>{error}</p>
              {/* The per-issue list used to render only in a canvas banner
                  gated on the modal being CLOSED — and publish can only be
                  started from this modal, which stays open when it fails. So
                  the list existed and was never once seen. */}
              {issues.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {issues.map((iss, i) => (
                    <li key={i}>
                      {iss.nodeId ? (
                        <button type="button" onClick={() => onSelectNode(iss.nodeId!)} className="text-left underline underline-offset-2 hover:no-underline">
                          {iss.message}
                        </button>
                      ) : (
                        iss.message
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {warning && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-tiny text-amber-800">{warning}</p>}
          {/* WHAT THE BUTTON DOES, BEFORE IT IS PRESSED. "Publish 1 metric" is
              accurate and says nothing about consequences, and people hesitate
              at buttons that sound one-way. Both halves here are true: it
              starts updating by itself, and none of it is permanent. */}
          {enabledCount > 0 && !publishing && (
            <p className="text-center text-tiny text-neutral-500">Updates automatically. Editable any time.</p>
          )}
          <button
            onClick={onPublish}
            disabled={publishing || enabledCount === 0}
            className="w-full rounded-control bg-primary px-4 py-2.5 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:brightness-95 disabled:cursor-default disabled:opacity-50"
          >
            {publishing ? "Publishing…" : publishedVersion != null ? `Update dashboard (${enabledCount})` : `Publish ${enabledCount} metric${enabledCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
