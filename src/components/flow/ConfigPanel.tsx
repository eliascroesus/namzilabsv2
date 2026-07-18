"use client";

import { useEffect, useRef, useState } from "react";
import {
  FILTER_OP_LABELS,
  PRIMARY_FILTER_OPS,
  NO_VALUE_FILTER_OPS,
  AGGREGATIONS,
  TIME_UNITS,
  VIZ_TYPES,
  TIME_PRESETS,
  FORMULA_OPS,
  FORMATTER_OPS,
  type NodeType,
  type FlowFilterOp,
} from "@/lib/flow/types";
import type { ConnMeta, FieldGroup, FNode, Filters, InputDescriptor, Rule } from "./graph-utils";
import { collidingFields } from "./graph-utils";
import { NODE_META, MORE_FILTER_OPS, defaultTitle, formulaExpression, formulaHandleLabels, resultLabel } from "./node-meta";
import { STEP_LABEL, stageOf } from "./outline";
import { FieldPicker } from "./FieldPicker";
import { RecordSamplePicker } from "./RecordSamplePicker";

const METRIC_STEPS = new Set<NodeType>(["aggregate", "formula", "group", "output"]);

const SYNC_DOT: Record<string, string> = {
  live: "bg-green-500",
  synced: "bg-green-500",
  importing: "bg-blue-500",
  outdated: "bg-amber-500",
  error: "bg-red-500",
};
function SyncDot({ status }: { status: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full align-middle ${SYNC_DOT[status] ?? "bg-neutral-400"}`} />;
}
function syncStatusLabel(status: string): string {
  const map: Record<string, string> = { importing: "importing…", outdated: "outdated", error: "sync error" };
  return map[status] ?? status;
}

type TabKey = "setup" | "configure" | "test";

/** Required setup still missing for this node (drives the guided CTA + checkmarks). */
export function nodeRequirements(type: NodeType, cfg: Record<string, unknown>, inputCount: number): string[] {
  const miss: string[] = [];
  if (type === "app") {
    if (!cfg.connectionId && !cfg.source) miss.push("Choose a connected account");
  } else if (type === "formula") {
    if (inputCount < 2) miss.push("Connect a number to A and to B");
  } else if (inputCount === 0) {
    miss.push("Connect an input");
  }
  if (type === "output" && !String(cfg.name ?? "").trim()) miss.push("Name this metric");
  return miss;
}

export function ConfigPanel({
  node,
  stepNo,
  connections,
  fieldGroups,
  inputs,
  inputCount,
  testing,
  canReconnect,
  onChange,
  onRename,
  onTest,
  onDelete,
  onDeleteReconnect,
  onDuplicate,
}: {
  node: FNode;
  stepNo?: number;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputs: InputDescriptor[];
  inputCount: number;
  testing: boolean;
  canReconnect: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onRename: (v: string) => void;
  onTest: () => void;
  onDelete: () => void;
  onDeleteReconnect: () => void;
  onDuplicate: () => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const missing = nodeRequirements(type, cfg, inputCount);
  const setupDone = missing.length === 0;
  const tested = !!node.data.lastTest && node.data.lastTest.status === "ok" && !node.data.dirty;
  const isMetric = METRIC_STEPS.has(type);
  const previewLabelWord = isMetric ? "Calculate preview" : "Preview";

  // Auto-open the first incomplete tab.
  const initialTab: TabKey = !setupDone ? "setup" : !tested ? "test" : "configure";
  const [tab, setTab] = useState<TabKey>(initialTab);

  const previewCount = type === "app" ? node.data.lastTest?.recordsOut : inputs[0]?.recordCount;
  const previewCta = type === "output" ? "Preview dashboard value" : isMetric ? "Test calculation" : previewCount != null ? `Preview ${previewCount} records` : "Preview records";

  // One primary action, worded for the step + current tab; surfaces the real missing item.
  const cta: { label: string; run: () => void; warn?: boolean } = !setupDone
    ? { label: missing[0], run: () => setTab("setup"), warn: true }
    : tab === "setup"
      ? { label: "Continue to configure", run: () => setTab("configure") }
      : tab === "configure"
        ? { label: previewCta, run: () => { setTab("test"); onTest(); } }
        : { label: testing ? "Working…" : tested ? "Re-run preview" : previewCta, run: onTest };

  const tabs: Array<{ key: TabKey; label: string; done: boolean; enabled: boolean }> = [
    { key: "setup", label: "Setup", done: setupDone, enabled: true },
    { key: "configure", label: "Configure", done: setupDone, enabled: true },
    { key: "test", label: previewLabelWord, done: tested, enabled: setupDone },
  ];

  return (
    <aside className="flex w-[480px] shrink-0 flex-col border-l border-neutral-200 bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            <span>{NODE_META[type].icon}</span>
            <span>{stepNo != null ? `Step ${stepNo} · ` : ""}{stageOf(type)}</span>
          </div>
          <input
            value={node.data.label ?? ""}
            onChange={(e) => onRename(e.target.value)}
            placeholder={defaultTitle(type, node.data)}
            className="mt-1 w-full rounded border border-transparent px-1 py-0.5 text-base font-semibold hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
          />
          <p className="px-1 text-xs text-neutral-400">{STEP_LABEL[type]}</p>
        </div>
        <KebabMenu nodeId={node.id} canReconnect={canReconnect} onDuplicate={onDuplicate} onDelete={onDelete} onDeleteReconnect={onDeleteReconnect} />
      </div>

      {/* Sticky tabs */}
      <div className="sticky top-0 z-10 flex border-b border-neutral-200 bg-white text-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            disabled={!t.enabled}
            onClick={() => t.enabled && setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1 px-3 py-2.5 ${tab === t.key ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"} ${!t.enabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {t.done ? <span className="text-green-600">✓</span> : null}
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {tab === "setup" && <SetupFields type={type} cfg={cfg} connections={connections} fieldGroups={fieldGroups} inputs={inputs} inputCount={inputCount} missing={missing} onChange={onChange} />}
        {tab === "configure" && <ConfigureFields type={type} cfg={cfg} fieldGroups={fieldGroups} inputs={inputs} onChange={onChange} />}
        {tab === "test" && <PreviewTab node={node} testing={testing} inputs={inputs} onChange={onChange} />}
      </div>

      {/* Sticky primary action */}
      <div className="sticky bottom-0 border-t border-neutral-200 bg-white p-4">
        <button
          onClick={cta.run}
          disabled={testing}
          className={`w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${cta.warn ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-neutral-900 text-white hover:bg-neutral-800"}`}
        >
          {cta.warn ? `Fix: ${cta.label}` : cta.label}
        </button>
      </div>
    </aside>
  );
}

function KebabMenu({ nodeId, canReconnect, onDuplicate, onDelete, onDeleteReconnect }: { nodeId: string; canReconnect: boolean; onDuplicate: () => void; onDelete: () => void; onDeleteReconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const item = "block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded p-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100" title="More">
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          <button className={item} onClick={() => { onDuplicate(); setOpen(false); }}>Duplicate step</button>
          {canReconnect && <button className={item} onClick={() => { onDeleteReconnect(); setOpen(false); }}>Delete &amp; reconnect</button>}
          <button className={`${item} text-red-700`} onClick={() => { onDelete(); setOpen(false); }}>Delete step</button>
          <div className="my-1 border-t border-neutral-100" />
          <button className={item} onClick={() => setDetails((d) => !d)}>Technical details</button>
          {details && <p className="px-3 py-1 text-xs text-neutral-400">Node id: <code>{nodeId}</code></p>}
        </div>
      )}
    </div>
  );
}

// ---------- Setup (primary decision) ----------

function SetupFields({
  type,
  cfg,
  connections,
  fieldGroups,
  inputs,
  inputCount,
  missing,
  onChange,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputs: InputDescriptor[];
  inputCount: number;
  missing: string[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const banner =
    missing.length > 0 ? (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
        {missing.length === 1 ? missing[0] : `${missing.length} things needed: ${missing.join(", ")}`}
      </div>
    ) : null;

  if (type === "app") {
    const connId = (cfg.connectionId as string) ?? "";
    const conn = connections.find((c) => c.id === connId);
    return (
      <div className="space-y-5">
        {banner}
        <Field label="Account">
          <select
            value={connId}
            onChange={(e) => {
              const c = connections.find((x) => x.id === e.target.value);
              onChange({ connectionId: c?.id ?? null, connectionName: c?.name ?? null, source: c?.source ?? null, eventType: null });
            }}
            className={INPUT}
          >
            <option value="">Choose a connected account…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.source})</option>
            ))}
          </select>
        </Field>
        {conn?.syncStatus && (
          <p className="-mt-3 text-xs text-neutral-500">
            Data status: <SyncDot status={conn.syncStatus} /> {syncStatusLabel(conn.syncStatus)}
            {conn.syncStatus === "outdated" || conn.syncStatus === "error" ? <> · <a className="underline" href={`/connections/${conn.id}`}>Manage</a></> : null}
          </p>
        )}
        {connections.length === 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            No connected accounts yet. Connect one in <a className="underline" href="/integrations">Integrations</a>.
          </p>
        )}
        <Field label="Record type">
          <select value={(cfg.eventType as string) ?? ""} onChange={(e) => onChange({ eventType: e.target.value || null })} className={INPUT}>
            <option value="">All records</option>
            {(conn?.eventTypes ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>
    );
  }

  if (type === "aggregate") {
    const agg = (cfg.aggregation as string) ?? "count";
    return (
      <div className="space-y-5">
        {banner}
        <Field label="Calculation">
          <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className={INPUT}>
            {AGGREGATIONS.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {(agg === "sum" || agg === "avg" || agg === "min" || agg === "max") && (
          <Field label="Number field">
            <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
          </Field>
        )}
        {agg === "count_distinct" && (
          <Field label="Distinct by">
            <FieldPicker value={(cfg.distinctField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ distinctField: v })} />
          </Field>
        )}
      </div>
    );
  }

  if (type === "formula") {
    const op = String(cfg.op ?? "percentage");
    const labels = formulaHandleLabels(op);
    return (
      <div className="space-y-5">
        {banner}
        <Field label="Calculation">
          <select value={op} onChange={(e) => onChange({ op: e.target.value })} className={INPUT}>
            {FORMULA_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        <div className="rounded border border-indigo-200 bg-indigo-50 p-2.5 text-xs text-indigo-900">
          {formulaExpression(op, inputs.find((i) => i.targetHandle === "a")?.title ?? labels.a, inputs.find((i) => i.targetHandle === "b")?.title ?? labels.b)}
        </div>
      </div>
    );
  }

  if (type === "output") {
    return (
      <div className="space-y-5">
        {banner}
        <Field label="Metric name">
          <input value={(cfg.name as string) ?? ""} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Today's booked calls" className={INPUT} />
        </Field>
        <Field label="Format">
          <select value={(cfg.format as string) ?? "number"} onChange={(e) => onChange({ format: e.target.value })} className={INPUT}>
            <option value="number">Number</option>
            <option value="percent">Percentage</option>
            <option value="currency">Currency</option>
          </select>
        </Field>
      </div>
    );
  }

  if (type === "group") {
    return (
      <div className="space-y-5">
        {banner}
        <GroupPrimary cfg={cfg} fieldGroups={fieldGroups} onChange={onChange} />
      </div>
    );
  }

  // Record-shaping steps: their conditions/settings ARE the primary decision.
  return (
    <div className="space-y-5">
      {banner}
      {inputCount === 0 && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Connect an input step first.</p>}
      <ConfigureFields type={type} cfg={cfg} fieldGroups={fieldGroups} inputs={inputs} onChange={onChange} />
    </div>
  );
}

// ---------- Configure (secondary options) ----------

const INPUT = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm";

function ConfigureFields({
  type,
  cfg,
  fieldGroups,
  inputs,
  onChange,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  fieldGroups: FieldGroup[];
  inputs: InputDescriptor[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  if (type === "app") {
    return (
      <AdvancedSection defaultOpen>
        <Field label="Match records using">
          <FieldPicker value={(cfg.identityField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ identityField: v })} />
        </Field>
        <p className="text-xs text-neutral-400">Used by downstream Combine / de-duplicate steps to recognise the same person.</p>
      </AdvancedSection>
    );
  }

  if (type === "filter") {
    const fc: Filters = { combinator: (cfg.combinator as string) ?? "and", rules: (cfg.rules as Rule[]) ?? [] };
    return <RulesEditor value={fc} fieldGroups={fieldGroups} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />;
  }

  if (type === "time") {
    const mode = (cfg.mode as string) ?? "preset";
    return (
      <div className="space-y-4">
        <Field label="Date field">
          <FieldPicker value={(cfg.dateField as string) ?? "occurredAt"} fieldGroups={fieldGroups} onChange={(v) => onChange({ dateField: v })} />
        </Field>
        <Field label="Window">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className={INPUT}>
            <option value="preset">Preset period</option>
            <option value="rolling">Rolling (last N days)</option>
            <option value="between">Between two dates</option>
          </select>
        </Field>
        {mode === "preset" && (
          <Field label="Period">
            <select value={(cfg.preset as string) ?? "last_30_days"} onChange={(e) => onChange({ preset: e.target.value })} className={INPUT}>
              {TIME_PRESETS.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
          </Field>
        )}
        {mode === "rolling" && (
          <Field label="Last N days">
            <input type="number" value={Number(cfg.days ?? 30)} onChange={(e) => onChange({ days: Number(e.target.value) })} className={INPUT} />
          </Field>
        )}
        {mode === "between" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input type="date" value={(cfg.from as string) ?? ""} onChange={(e) => onChange({ from: e.target.value })} className={INPUT} />
            </Field>
            <Field label="To">
              <input type="date" value={(cfg.to as string) ?? ""} onChange={(e) => onChange({ to: e.target.value })} className={INPUT} />
            </Field>
          </div>
        )}
      </div>
    );
  }

  if (type === "formula") {
    const op = String(cfg.op ?? "percentage");
    const labels = formulaHandleLabels(op);
    return (
      <div className="space-y-4">
        <FormulaInput label={`${labels.a} (input A)`} desc={inputs.find((i) => i.targetHandle === "a")} />
        <FormulaInput label={`${labels.b} (input B)`} desc={inputs.find((i) => i.targetHandle === "b")} />
        <p className="text-xs text-neutral-400">Inputs A and B accept a single number from an Aggregate or Formula step.</p>
      </div>
    );
  }

  if (type === "combine") {
    const mode = (cfg.mode as string) ?? "stack";
    const collisions = collidingFields(inputs);
    return (
      <div className="space-y-4">
        <Field label="Mode">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className={INPUT}>
            <option value="stack">Stack (combine all records)</option>
            <option value="dedupe">De-duplicate by identity</option>
            <option value="match">Match records by identity</option>
          </select>
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Connected sources ({inputs.length})</p>
          {inputs.length === 0 && <p className="text-xs text-neutral-400">Connect two or more record steps (Apps, Filter, Time, …).</p>}
          <div className="space-y-1.5">
            {inputs.map((inp, i) => (
              <SourceCard key={inp.nodeId} index={i + 1} desc={inp} isBase={mode === "match" && (cfg.baseSourceId as string) === inp.nodeId} />
            ))}
          </div>
        </div>
        {mode === "match" && (
          <Field label="Base source (records kept & enriched)">
            <select value={(cfg.baseSourceId as string) ?? ""} onChange={(e) => onChange({ baseSourceId: e.target.value || null })} className={INPUT}>
              <option value="">First connected input</option>
              {inputs.map((inp, i) => (
                <option key={inp.nodeId} value={inp.nodeId}>Source {i + 1}: {inp.title}</option>
              ))}
            </select>
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <Field label="Match records using">
            <FieldPicker value={(cfg.identityField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
        )}
        {mode === "match" && (
          <Field label="Keep">
            <select value={(cfg.keep as string) ?? "all"} onChange={(e) => onChange({ keep: e.target.value })} className={INPUT}>
              <option value="all">All base records</option>
              <option value="matched">Only matched</option>
              <option value="unmatched">Only unmatched</option>
            </select>
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && collisions.length > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Fields in more than one source may overwrite each other: <b>{collisions.join(", ")}</b>.
          </p>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <AdvancedSection>
            <Field label="When duplicated, which source wins">
              <select value={(cfg.sourceWins as string) ?? "first"} onChange={(e) => onChange({ sourceWins: e.target.value })} className={INPUT}>
                <option value="first">First connected input</option>
                <option value="last">Last connected input</option>
              </select>
            </Field>
          </AdvancedSection>
        )}
      </div>
    );
  }

  if (type === "paths") {
    const paths = (cfg.paths as Array<{ id: string; label: string; filters: Filters }>) ?? [];
    const setPath = (i: number, patch: Record<string, unknown>) => onChange({ paths: paths.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
    return (
      <div className="space-y-3">
        {paths.map((p, i) => (
          <div key={p.id} className="space-y-2 rounded border border-neutral-200 p-2.5">
            <input value={p.label} onChange={(e) => setPath(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
            <RulesEditor value={p.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setPath(i, { filters: v })} />
            {paths.length > 1 && (
              <button onClick={() => onChange({ paths: paths.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">Remove path</button>
            )}
          </div>
        ))}
        <button onClick={() => onChange({ paths: [...paths, { id: `p${Math.random().toString(36).slice(2, 7)}`, label: `Path ${paths.length + 1}`, filters: { combinator: "and", rules: [] } }] })} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
          + Add path
        </button>
        <Field label="Fallback label (unmatched records)">
          <input value={(cfg.fallbackLabel as string) ?? "Fallback"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className={INPUT} />
        </Field>
      </div>
    );
  }

  if (type === "formatter") {
    const op = (cfg.op as string) ?? "round";
    return (
      <div className="space-y-4">
        <Field label="Field to format">
          <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
        </Field>
        <Field label="Operation">
          <select value={op} onChange={(e) => onChange({ op: e.target.value })} className={INPUT}>
            {FORMATTER_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {op === "round" && (
          <Field label="Decimals">
            <input type="number" value={Number(cfg.decimals ?? 2)} onChange={(e) => onChange({ decimals: Number(e.target.value) })} className={INPUT} />
          </Field>
        )}
        {op === "replace" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Find"><input value={(cfg.find as string) ?? ""} onChange={(e) => onChange({ find: e.target.value })} className={INPUT} /></Field>
            <Field label="Replace with"><input value={(cfg.replaceWith as string) ?? ""} onChange={(e) => onChange({ replaceWith: e.target.value })} className={INPUT} /></Field>
          </div>
        )}
        {op === "default" && (
          <Field label="Value for empty"><input value={(cfg.defaultValue as string) ?? ""} onChange={(e) => onChange({ defaultValue: e.target.value })} className={INPUT} /></Field>
        )}
        {(op === "multiply" || op === "divide") && (
          <Field label="Factor"><input type="number" value={cfg.factor != null ? Number(cfg.factor) : ""} onChange={(e) => onChange({ factor: e.target.value === "" ? undefined : Number(e.target.value) })} className={INPUT} /></Field>
        )}
        <AdvancedSection>
          <Field label="Save to field (defaults to same field)">
            <input value={(cfg.outputField as string) ?? ""} onChange={(e) => onChange({ outputField: e.target.value || undefined })} className={INPUT} />
          </Field>
        </AdvancedSection>
      </div>
    );
  }

  if (type === "aggregate") {
    const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string } | null) ?? null;
    const gbMode = gb ? gb.type : "none";
    return (
      <div className="space-y-4">
        <Field label="Group by">
          <select
            value={gbMode}
            onChange={(e) => {
              const m = e.target.value;
              if (m === "none") onChange({ groupBy: null });
              else if (m === "time") onChange({ groupBy: { type: "time", unit: "day" } });
              else onChange({ groupBy: { type: "field", field: "source" } });
            }}
            className={INPUT}
          >
            <option value="none">No grouping (single number)</option>
            <option value="time">Time period (trend)</option>
            <option value="field">A field (breakdown)</option>
          </select>
        </Field>
        {gb?.type === "time" && (
          <Field label="Period">
            <select value={gb.unit} onChange={(e) => onChange({ groupBy: { type: "time", unit: e.target.value } })} className={INPUT}>
              {TIME_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
        )}
        {gb?.type === "field" && (
          <Field label="Field">
            <FieldPicker value={gb.field ?? "source"} fieldGroups={fieldGroups} onChange={(v) => onChange({ groupBy: { type: "field", field: v } })} />
          </Field>
        )}
      </div>
    );
  }

  if (type === "group") {
    const agg = (cfg.aggregation as string) ?? "count";
    return (
      <div className="space-y-4">
        <Field label="Value per group">
          <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className={INPUT}>
            <option value="count">Count</option>
            <option value="sum">Sum of a field</option>
            <option value="count_distinct">Count distinct</option>
          </select>
        </Field>
        {agg === "sum" && (
          <Field label="Sum field">
            <FieldPicker value={(cfg.valueField as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ valueField: v })} />
          </Field>
        )}
      </div>
    );
  }

  // output
  return (
    <div className="space-y-4">
      <Field label="Display as">
        <select value={(cfg.viz as string) ?? "number"} onChange={(e) => onChange({ viz: e.target.value })} className={INPUT}>
          {VIZ_TYPES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit"><input value={(cfg.unit as string) ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className={INPUT} /></Field>
        <Field label="Decimals"><input type="number" value={Number(cfg.precision ?? 0)} onChange={(e) => onChange({ precision: Number(e.target.value) })} className={INPUT} /></Field>
      </div>
      <Field label="Goal / target (optional)">
        <input type="number" value={cfg.target != null ? Number(cfg.target) : ""} onChange={(e) => onChange({ target: e.target.value === "" ? null : Number(e.target.value) })} className={INPUT} />
      </Field>
    </div>
  );
}

function GroupPrimary({ cfg, fieldGroups, onChange }: { cfg: Record<string, unknown>; fieldGroups: FieldGroup[]; onChange: (patch: Record<string, unknown>) => void }) {
  const mode = (cfg.mode as string) ?? "field";
  const cats = (cfg.categories as Array<{ label: string; filters: Filters }>) ?? [];
  const setCat = (i: number, patch: Record<string, unknown>) => onChange({ categories: cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <>
      <Field label="Group by">
        <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className={INPUT}>
          <option value="field">A field value</option>
          <option value="categories">Custom categories</option>
        </select>
      </Field>
      {mode === "field" && (
        <Field label="Field">
          <FieldPicker value={(cfg.field as string) ?? "source"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
        </Field>
      )}
      {mode === "categories" && (
        <div className="space-y-2">
          {cats.map((c, i) => (
            <div key={i} className="space-y-2 rounded border border-neutral-200 p-2.5">
              <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
              <RulesEditor value={c.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setCat(i, { filters: v })} />
              <button onClick={() => onChange({ categories: cats.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">Remove category</button>
            </div>
          ))}
          <button onClick={() => onChange({ categories: [...cats, { label: `Category ${cats.length + 1}`, filters: { combinator: "and", rules: [] } }] })} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">+ Add category</button>
          <Field label="Fallback label">
            <input value={(cfg.fallbackLabel as string) ?? "Other"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className={INPUT} />
          </Field>
        </div>
      )}
    </>
  );
}

// ---------- Preview / Calculate preview ----------

function PreviewTab({ node, testing, inputs, onChange }: { node: FNode; testing: boolean; inputs: InputDescriptor[]; onChange: (patch: Record<string, unknown>) => void }) {
  const t = node.data.lastTest;
  const type = String(node.type);
  const isMetric = METRIC_STEPS.has(type as NodeType);
  const sampleIndex = Number((node.data.config as { sampleIndex?: unknown }).sampleIndex ?? 0);
  const excluded = t && t.status === "ok" ? Math.max(0, t.recordsIn - t.recordsOut) : 0;

  return (
    <div className="space-y-4">
      {node.data.dirty && <p className="text-xs text-amber-700">This step changed — re-run the preview to refresh its data and the fields it offers downstream.</p>}
      {t && t.status === "error" && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-medium">Couldn&rsquo;t {isMetric ? "calculate" : "preview"} this step</p>
          <p className="mt-1">{t.error}</p>
        </div>
      )}
      {t && t.status === "ok" && (
        <div className="space-y-4">
          <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-center text-base font-semibold">{resultLabel(type, t)}</p>

          {!isMetric && (
            <p className="text-xs text-neutral-500">
              {t.recordsIn} in · {t.recordsOut} out
              {excluded > 0 && <> · <span className="text-amber-700">{excluded} excluded</span></>}
            </p>
          )}
          {isMetric && inputs.length > 0 && (
            <div className="rounded border border-neutral-200 p-2 text-xs text-neutral-600">
              <p className="mb-1 font-medium text-neutral-500">Inputs</p>
              {inputs.map((i) => (
                <p key={i.nodeId}>{i.title}{i.calc ? ` — ${i.calc}` : ""}{i.value != null ? ` = ${String(i.value)}` : ""}</p>
              ))}
            </div>
          )}

          {type === "app" ? (
            <RecordSamplePicker records={t.sample} selectedIndex={sampleIndex} onSelect={(i) => onChange({ sampleIndex: i })} />
          ) : (
            <BeforeAfter before={t.inputSample ?? []} after={t.sample} />
          )}
        </div>
      )}
      {!t && <p className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">Run the preview to see the input sample, the result, and any excluded records.</p>}
    </div>
  );
}

function BeforeAfter({ before, after }: { before: unknown[]; after: unknown[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Before ({before.length})</p>
        <div className="space-y-1">
          {before.length === 0 && <p className="text-xs text-neutral-400">—</p>}
          {before.slice(0, 3).map((r, i) => (
            <div key={i} className="truncate rounded border border-neutral-100 bg-neutral-50 p-1.5 text-[11px]">{sampleLine(r)}</div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">After ({after.length})</p>
        <div className="space-y-1">
          {after.length === 0 && <p className="text-xs text-neutral-400">—</p>}
          {after.slice(0, 3).map((r, i) => (
            <div key={i} className="truncate rounded border border-green-100 bg-green-50 p-1.5 text-[11px]">{sampleLine(r)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- shared bits ----------

function sampleLine(r: unknown): string {
  const rec = r as { source?: string; eventType?: string; subject?: string; value?: unknown };
  return `${rec.source ?? ""} · ${rec.eventType ?? ""}${rec.subject ? ` · ${rec.subject}` : ""}${rec.value != null ? ` · ${String(rec.value)}` : ""}`;
}

function StatusPill({ status, count }: { status: InputDescriptor["status"]; count?: number }) {
  const cls: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    dirty: "bg-amber-100 text-amber-700",
    untested: "bg-neutral-100 text-neutral-500",
  };
  const label = status === "ok" ? (count != null ? `${count} recs` : "tested") : status === "error" ? "error" : status === "dirty" ? "retest" : "not tested";
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${cls[status]}`}>{label}</span>;
}

function SourceCard({ index, desc, isBase }: { index: number; desc: InputDescriptor; isBase: boolean }) {
  return (
    <details className={`rounded border ${isBase ? "border-neutral-800" : "border-neutral-200"}`}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium">Source {index}:</span> {desc.title}
          {isBase && <span className="ml-1 rounded bg-neutral-800 px-1 text-[9px] text-white">BASE</span>}
        </span>
        <StatusPill status={desc.status} count={desc.recordCount} />
      </summary>
      <div className="space-y-1 border-t border-neutral-100 p-2 text-[11px] text-neutral-600">
        {desc.appSource && <p>App: {desc.appSource}{desc.account ? ` · ${desc.account}` : ""}{desc.eventType ? ` · ${desc.eventType}` : ""}</p>}
        {desc.chain.length > 0 && <p className="text-neutral-400">Chain: {desc.chain.join(" → ")}</p>}
        {desc.sample.length > 0 && (
          <div className="space-y-0.5">
            {desc.sample.slice(0, 3).map((r, i) => (
              <div key={i} className="truncate rounded bg-neutral-50 p-1">{sampleLine(r)}</div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function FormulaInput({ label, desc }: { label: string; desc?: InputDescriptor }) {
  return (
    <div className="rounded border border-neutral-200 p-2.5 text-xs">
      <p className="font-medium text-neutral-600">{label}</p>
      {desc ? (
        <p className="mt-0.5 text-neutral-700">
          {desc.title}
          {desc.calc ? ` — ${desc.calc}` : ""}
          {desc.value != null ? ` = ${String(desc.value)}` : desc.status === "untested" ? " (preview to see value)" : ""}
        </p>
      ) : (
        <p className="mt-0.5 text-amber-700">Not connected — connect an Aggregate or Formula step.</p>
      )}
    </div>
  );
}

/** Reusable AND/OR rule list, used by Filter, Paths, and Group categories. */
export function RulesEditor({ value, fieldGroups, onChange }: { value: Filters; fieldGroups: FieldGroup[]; onChange: (v: Filters) => void }) {
  const rules = value.rules ?? [];
  const setRule = (i: number, patch: Partial<Rule>) => onChange({ ...value, rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2 text-sm">
      {rules.length > 1 && (
        <select value={value.combinator} onChange={(e) => onChange({ ...value, combinator: e.target.value })} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
          <option value="and">Match ALL rules</option>
          <option value="or">Match ANY rule</option>
        </select>
      )}
      {rules.map((r, i) => (
        <div key={i} className="space-y-1 rounded border border-neutral-200 p-2">
          <FieldPicker value={r.field} fieldGroups={fieldGroups} onChange={(v) => setRule(i, { field: v })} />
          <div className="flex gap-1">
            <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} className="rounded-md border border-neutral-300 px-1 py-1 text-xs">
              <optgroup label="Common">
                {PRIMARY_FILTER_OPS.map((o) => (
                  <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>
                ))}
              </optgroup>
              <optgroup label="More">
                {MORE_FILTER_OPS.map((o) => (
                  <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>
                ))}
              </optgroup>
            </select>
            {!NO_VALUE_FILTER_OPS.includes(r.op as FlowFilterOp) && (
              <input value={r.value ?? ""} placeholder="value" onChange={(e) => setRule(i, { value: e.target.value })} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
            )}
            {r.op === "between" && (
              <input value={r.value2 ?? ""} placeholder="to" onChange={(e) => setRule(i, { value2: e.target.value })} className="w-14 rounded-md border border-neutral-300 px-1 py-1 text-xs" />
            )}
          </div>
          <button onClick={() => onChange({ ...value, rules: rules.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">Remove</button>
        </div>
      ))}
      <button onClick={() => onChange({ ...value, rules: [...rules, { field: "eventType", op: "equals", value: "" }] })} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50">+ Add rule</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function AdvancedSection({ children, defaultOpen }: { children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded border border-neutral-200 p-2.5">
      <summary className="cursor-pointer text-xs font-medium text-neutral-500">Advanced</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}
