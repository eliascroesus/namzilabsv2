"use client";

import { useState } from "react";
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
import { collidingFields, computeNodeStatus, fieldProvenance } from "./graph-utils";
import { NODE_META, STATUS_META, MORE_FILTER_OPS, defaultTitle, formulaExpression, formulaHandleLabels, resultLabel } from "./node-meta";
import { FieldPicker } from "./FieldPicker";
import { ValueInput, type ValuePatch } from "./ValueInput";
import { RecordSamplePicker } from "./RecordSamplePicker";
import { NodeGlyph } from "./icons";
import { SourceBadge } from "./MappingChip";

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

/** A reference to an earlier step, offered as a labeled pill for multi-input wiring. */
export type StepRef = { id: string; title: string; stepNo?: number };

/** Formatter operations grouped by user intent, so we show only relevant controls. */
const FORMATTER_INTENTS: Array<{ id: string; label: string; ops: string[] }> = [
  { id: "text", label: "Clean text", ops: ["trim", "uppercase", "lowercase", "normalize_email", "normalize_phone"] },
  { id: "number", label: "Change number", ops: ["round", "multiply", "divide", "to_number"] },
  { id: "date", label: "Change date", ops: ["date_only", "year_month"] },
  { id: "replace", label: "Replace value", ops: ["replace"] },
  { id: "fallback", label: "Use fallback", ops: ["default"] },
  { id: "custom", label: "Custom", ops: [...FORMATTER_OPS] },
];
const FORMATTER_OP_LABELS: Record<string, string> = {
  trim: "Trim spaces",
  uppercase: "UPPERCASE",
  lowercase: "lowercase",
  normalize_email: "Normalize email",
  normalize_phone: "Digits only (phone)",
  round: "Round",
  multiply: "Multiply",
  divide: "Divide",
  to_number: "Convert to number",
  to_text: "Convert to text",
  date_only: "Date only (YYYY-MM-DD)",
  year_month: "Year & month (YYYY-MM)",
  replace: "Find & replace",
  default: "Fallback when empty",
};
function formatterIntentOf(op: string): string {
  const found = FORMATTER_INTENTS.find((i) => i.id !== "custom" && i.ops.includes(op));
  return found?.id ?? "custom";
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
  numberCandidates,
  datasetCandidates,
  onChange,
  onRename,
  onTest,
  onDelete,
  onDeleteReconnect,
  onDuplicate,
  onAddNext,
  onSetInput,
  onSetSources,
}: {
  node: FNode;
  stepNo?: number;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputs: InputDescriptor[];
  inputCount: number;
  testing: boolean;
  canReconnect: boolean;
  numberCandidates: StepRef[];
  datasetCandidates: StepRef[];
  onChange: (patch: Record<string, unknown>) => void;
  onRename: (v: string) => void;
  onTest: () => void;
  onDelete: () => void;
  onDeleteReconnect: () => void;
  onDuplicate: () => void;
  onAddNext: () => void;
  onSetInput: (handle: "a" | "b", sourceId: string | null) => void;
  onSetSources: (ids: string[]) => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const status = computeNodeStatus({ type, cfg, inputCount, lastTest: node.data.lastTest, dirty: node.data.dirty, updating: testing });
  const sm = STATUS_META[status];
  const err = node.data.lastTest?.status === "error" ? node.data.lastTest.error : null;
  const tested = status === "ready";

  // Bottom action: complete setup → Test → (on pass) Add next step. No auto-testing.
  const cta = testing
    ? { label: "Testing…", disabled: true, run: () => {} }
    : status === "setup"
      ? { label: "Fill in the fields above", disabled: true, run: () => {} }
      : tested
        ? { label: "+ Add next step", disabled: false, run: onAddNext }
        : { label: node.data.lastTest ? "Test again" : "Test this step", disabled: false, run: onTest };

  return (
    <aside className="flex w-[480px] shrink-0 flex-col border-l border-neutral-200 bg-white">
      {/* Minimal header: step number · name + one status. */}
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-neutral-500">
              {type === "app" ? <SourceBadge source={String((cfg as { source?: unknown }).source ?? "")} size={18} /> : <NodeGlyph type={type} className="h-4.5 w-4.5" />}
            </span>
            <input
              value={node.data.label ?? ""}
              onChange={(e) => onRename(e.target.value)}
              placeholder={`${stepNo != null ? `${stepNo}. ` : ""}${defaultTitle(type, node.data)}`}
              className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-base font-medium hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
            />
          </div>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${sm.cls}`}>{sm.label}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {err && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

        <ConfigureTab
          type={type}
          cfg={cfg}
          connections={connections}
          fieldGroups={fieldGroups}
          inputs={inputs}
          numberCandidates={numberCandidates}
          datasetCandidates={datasetCandidates}
          onChange={onChange}
          onSetInput={onSetInput}
          onSetSources={onSetSources}
        />

        {/* Test results appear only after a manual test — never auto-computed. */}
        {node.data.lastTest?.status === "ok" && <TestResults node={node} onChange={onChange} />}

        <details className="border-t border-neutral-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500">Step options</summary>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button onClick={onDuplicate} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
              Duplicate
            </button>
            <button onClick={canReconnect ? onDeleteReconnect : onDelete} className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50" title={canReconnect ? "Remove this step and reconnect the steps around it" : "Delete this step"}>
              Delete step
            </button>
          </div>
        </details>
      </div>

      <div className="border-t border-neutral-200 p-3">
        <button
          onClick={cta.run}
          disabled={cta.disabled}
          className={`w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:cursor-default disabled:opacity-50 ${tested ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-neutral-900 text-white hover:bg-neutral-800"}`}
        >
          {cta.label}
        </button>
      </div>
    </aside>
  );
}

function ConfigureTab({
  type,
  cfg,
  connections,
  fieldGroups,
  inputs,
  numberCandidates,
  datasetCandidates,
  onChange,
  onSetInput,
  onSetSources,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputs: InputDescriptor[];
  numberCandidates: StepRef[];
  datasetCandidates: StepRef[];
  onChange: (patch: Record<string, unknown>) => void;
  onSetInput: (handle: "a" | "b", sourceId: string | null) => void;
  onSetSources: (ids: string[]) => void;
}) {
  // Formatter shows controls by intent (Clean text / Change number / …), derived from the op.
  const [fmtIntent, setFmtIntent] = useState(() => formatterIntentOf(String((cfg as { op?: unknown }).op ?? "round")));

  if (type === "app") {
    const connId = (cfg.connectionId as string) ?? "";
    const conn = connections.find((c) => c.id === connId);
    return (
      <div className="space-y-3 text-sm">
        <Field label="Connected account">
          <select
            value={connId}
            onChange={(e) => {
              const c = connections.find((x) => x.id === e.target.value);
              onChange({ connectionId: c?.id ?? null, connectionName: c?.name ?? null, source: c?.source ?? null, eventType: null });
            }}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
          >
            <option value="">Choose an account…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.source})
              </option>
            ))}
          </select>
        </Field>
        {conn?.syncStatus && (
          <p className="text-xs text-neutral-500">
            Data status: <SyncDot status={conn.syncStatus} /> {syncStatusLabel(conn.syncStatus)}
            {conn.syncStatus === "outdated" || conn.syncStatus === "error" ? (
              <>
                {" "}
                &middot;{" "}
                <a className="underline" href={`/connections/${conn.id}`}>
                  Manage
                </a>
              </>
            ) : null}
          </p>
        )}
        {connections.length === 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            No connected accounts yet. Connect one in <a className="underline" href="/integrations">Integrations</a>.
          </p>
        )}
        <Field label="Which event">
          <select
            value={typeof cfg.eventType === "string" ? (cfg.eventType as string) : "__none"}
            onChange={(e) => onChange({ eventType: e.target.value === "__none" ? null : e.target.value })}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
          >
            <option value="__none" disabled hidden>
              Choose an event…
            </option>
            <option value="">All events</option>
            {(conn?.eventTypes ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <AdvancedSection>
          <Field label="Match records using">
            <FieldPicker value={(cfg.identityField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
          <p className="text-xs text-neutral-400">Used by downstream Combine / de-duplicate steps to recognise the same person.</p>
        </AdvancedSection>
      </div>
    );
  }

  if (type === "filter") {
    const fc: Filters = { combinator: (cfg.combinator as string) ?? "and", rules: (cfg.rules as Rule[]) ?? [] };
    const dr = (cfg.dateRange as DateRange) ?? { enabled: false, dateField: "occurredAt", mode: "preset", preset: "last_30_days", days: 30 };
    const setDr = (patch: Partial<DateRange>) => onChange({ dateRange: { ...dr, ...patch } });
    return (
      <div className="space-y-4 text-sm">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">Only continue if…</p>
          <RulesEditor value={fc} fieldGroups={fieldGroups} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />
        </div>
        <AdvancedSection>
          <DateRangeSection dr={dr} setDr={setDr} fieldGroups={fieldGroups} />
        </AdvancedSection>
      </div>
    );
  }

  if (type === "time") {
    const mode = (cfg.mode as string) ?? "preset";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Date field">
          <FieldPicker value={(cfg.dateField as string) ?? "occurredAt"} fieldGroups={fieldGroups} onChange={(v) => onChange({ dateField: v })} />
        </Field>
        <Field label="Window">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="preset">Preset period</option>
            <option value="rolling">Rolling (last N days)</option>
            <option value="between">Between two dates</option>
          </select>
        </Field>
        {mode === "preset" && (
          <Field label="Period">
            <select value={(cfg.preset as string) ?? "last_30_days"} onChange={(e) => onChange({ preset: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              {TIME_PRESETS.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
          </Field>
        )}
        {mode === "rolling" && (
          <Field label="Last N days">
            <input type="number" value={Number(cfg.days ?? 30)} onChange={(e) => onChange({ days: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        {mode === "between" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <input type="date" value={(cfg.from as string) ?? ""} onChange={(e) => onChange({ from: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
            <Field label="To">
              <input type="date" value={(cfg.to as string) ?? ""} onChange={(e) => onChange({ to: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          </div>
        )}
      </div>
    );
  }

  if (type === "formula") {
    const op = String(cfg.op ?? "percentage");
    const labels = formulaHandleLabels(op);
    const inA = inputs.find((i) => i.targetHandle === "a");
    const inB = inputs.find((i) => i.targetHandle === "b");
    const nameA = inA?.title ?? "First number";
    const nameB = inB?.title ?? "Second number";
    const numberPicker = (handle: "a" | "b", label: string, desc?: InputDescriptor) => (
      <Field label={label}>
        <select value={desc?.nodeId ?? ""} onChange={(e) => onSetInput(handle, e.target.value || null)} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
          <option value="">Choose a number…</option>
          {numberCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.stepNo != null ? `${c.stepNo}. ` : ""}{c.title}
            </option>
          ))}
        </select>
        {desc?.value != null && <p className="mt-1 text-xs text-neutral-500">= {String(desc.value)}</p>}
      </Field>
    );
    return (
      <div className="space-y-3 text-sm">
        <Field label="Calculation">
          <select value={op} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            {FORMULA_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
          <p className="font-medium">{formulaExpression(op, nameA, nameB)}</p>
        </div>
        {numberPicker("a", labels.a, inA)}
        {numberPicker("b", labels.b, inB)}
        {numberCandidates.length === 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Add a “Calculate a number” step earlier in the flow to compare.</p>
        )}
      </div>
    );
  }

  if (type === "combine") {
    const mode = (cfg.mode as string) ?? "stack";
    const collisions = collidingFields(inputs);
    const connectedIds = inputs.map((i) => i.nodeId);
    const toggle = (id: string, on: boolean) => onSetSources(on ? [...connectedIds, id] : connectedIds.filter((x) => x !== id));
    return (
      <div className="space-y-3 text-sm">
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Data to combine</p>
          {datasetCandidates.length === 0 ? (
            <p className="text-xs text-neutral-400">Add earlier data steps to combine them here.</p>
          ) : (
            <div className="space-y-1">
              {datasetCandidates.map((c) => {
                const on = connectedIds.includes(c.id);
                const desc = inputs.find((i) => i.nodeId === c.id);
                return (
                  <label key={c.id} className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <input type="checkbox" checked={on} onChange={(e) => toggle(c.id, e.target.checked)} />
                      <span className="truncate">{c.stepNo != null ? `${c.stepNo}. ` : ""}{c.title}</span>
                    </span>
                    {desc?.recordCount != null && <span className="shrink-0 text-neutral-400">{desc.recordCount} recs</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <Field label="How should they be combined?">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="stack">Put all records together</option>
            <option value="dedupe">Remove duplicate people</option>
            <option value="match">Match records across sources</option>
          </select>
        </Field>

        {mode === "match" && (
          <Field label="Main list (records kept &amp; enriched)">
            <select value={(cfg.baseSourceId as string) ?? ""} onChange={(e) => onChange({ baseSourceId: e.target.value || null })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="">First selected source</option>
              {inputs.map((inp, i) => (
                <option key={inp.nodeId} value={inp.nodeId}>
                  Source {i + 1}: {inp.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <Field label="Recognize the same person by">
            <FieldPicker value={(cfg.identityField as string) ?? "subject"} fieldGroups={fieldGroups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
        )}
        {mode === "match" && (
          <Field label="Keep">
            <select value={(cfg.keep as string) ?? "all"} onChange={(e) => onChange({ keep: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="all">All records from the main list</option>
              <option value="matched">Only matched</option>
              <option value="unmatched">Only unmatched</option>
            </select>
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && collisions.length > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            These fields exist in more than one source and may overwrite each other: <b>{collisions.join(", ")}</b>.
          </p>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <AdvancedSection>
            <Field label="When duplicated, which source wins">
              <select value={(cfg.sourceWins as string) ?? "first"} onChange={(e) => onChange({ sourceWins: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
                <option value="first">First selected source</option>
                <option value="last">Last selected source</option>
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
      <div className="space-y-3 text-sm">
        <p className="text-xs text-neutral-500">Records are sent down the first branch whose conditions they match. Add as many branches as you need — each becomes its own path (and can be its own dashboard metric).</p>
        {paths.map((p, i) => (
          <div key={p.id} className="space-y-2 rounded-md border border-pink-200 bg-pink-50/40 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-pink-700">Branch {i + 1}</span>
              {paths.length > 1 && (
                <button onClick={() => onChange({ paths: paths.filter((_, j) => j !== i) })} className="text-[11px] text-red-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
            <input value={p.label} placeholder={`Branch ${i + 1} name`} onChange={(e) => setPath(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
            <RulesEditor value={p.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setPath(i, { filters: v })} />
          </div>
        ))}
        <button
          onClick={() => onChange({ paths: [...paths, { id: `p${Math.random().toString(36).slice(2, 7)}`, label: `Branch ${paths.length + 1}`, filters: { combinator: "and", rules: [] } }] })}
          className="w-full rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          + Add branch
        </button>
        <div className="rounded-md border border-neutral-200 p-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Fallback branch</span>
          <p className="mb-1 text-[11px] text-neutral-500">Everything that matches no branch above.</p>
          <input value={(cfg.fallbackLabel as string) ?? "Fallback"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </div>
      </div>
    );
  }

  if (type === "group") {
    const mode = (cfg.mode as string) ?? "field";
    const agg = (cfg.aggregation as string) ?? "count";
    const cats = (cfg.categories as Array<{ label: string; filters: Filters }>) ?? [];
    const setCat = (i: number, patch: Record<string, unknown>) => onChange({ categories: cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    return (
      <div className="space-y-3 text-sm">
        <Field label="Group by">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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
              <div key={i} className="space-y-2 rounded border border-neutral-200 p-2">
                <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
                <RulesEditor value={c.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setCat(i, { filters: v })} />
                <button onClick={() => onChange({ categories: cats.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
                  Remove category
                </button>
              </div>
            ))}
            <button onClick={() => onChange({ categories: [...cats, { label: `Category ${cats.length + 1}`, filters: { combinator: "and", rules: [] } }] })} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
              + Add category
            </button>
            <Field label="Fallback label">
              <input value={(cfg.fallbackLabel as string) ?? "Other"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          </div>
        )}
        <Field label="Value per group">
          <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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

  if (type === "formatter") {
    const op = String(cfg.op ?? "round");
    const intent = FORMATTER_INTENTS.find((i) => i.id === fmtIntent) ?? FORMATTER_INTENTS[FORMATTER_INTENTS.length - 1];
    const mapPatch = (patch: ValuePatch, prefix: "replaceWith" | "defaultValue"): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      if ("value" in patch) out[prefix] = patch.value;
      if ("valueKind" in patch) out[`${prefix}Kind`] = patch.valueKind;
      if ("valueField" in patch) out[`${prefix}Field`] = patch.valueField;
      return out;
    };
    return (
      <div className="space-y-3 text-sm">
        <Field label="Field to clean up">
          <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
        </Field>
        <Field label="What do you want to do?">
          <select
            value={fmtIntent}
            onChange={(e) => {
              const ni = e.target.value;
              setFmtIntent(ni);
              const nextOps = FORMATTER_INTENTS.find((i) => i.id === ni)?.ops ?? [];
              if (nextOps.length && !nextOps.includes(op)) onChange({ op: nextOps[0] });
            }}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
          >
            {FORMATTER_INTENTS.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </Field>
        {intent.ops.length > 1 && (
          <Field label="Operation">
            <select value={op} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              {intent.ops.map((o) => (
                <option key={o} value={o}>{FORMATTER_OP_LABELS[o] ?? o.replace(/_/g, " ")}</option>
              ))}
            </select>
          </Field>
        )}
        {op === "round" && (
          <Field label="Decimals">
            <input type="number" value={Number(cfg.decimals ?? 2)} onChange={(e) => onChange({ decimals: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        {op === "replace" && (
          <>
            <Field label="Find">
              <input value={(cfg.find as string) ?? ""} onChange={(e) => onChange({ find: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
            <Field label="Replace with">
              <ValueInput
                value={(cfg.replaceWith as string) ?? ""}
                valueKind={cfg.replaceWithKind as "fixed" | "field" | undefined}
                valueField={cfg.replaceWithField as string | undefined}
                fieldGroups={fieldGroups}
                placeholder="new value"
                onChange={(p) => onChange(mapPatch(p, "replaceWith"))}
              />
            </Field>
          </>
        )}
        {op === "default" && (
          <Field label="Value for empty">
            <ValueInput
              value={(cfg.defaultValue as string) ?? ""}
              valueKind={cfg.defaultValueKind as "fixed" | "field" | undefined}
              valueField={cfg.defaultValueField as string | undefined}
              fieldGroups={fieldGroups}
              placeholder="fallback value"
              onChange={(p) => onChange(mapPatch(p, "defaultValue"))}
            />
          </Field>
        )}
        {(op === "multiply" || op === "divide") && (
          <Field label="Factor">
            <input type="number" value={cfg.factor != null ? Number(cfg.factor) : ""} onChange={(e) => onChange({ factor: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        <AdvancedSection>
          <Field label="Save to field (defaults to same field)">
            <input value={(cfg.outputField as string) ?? ""} onChange={(e) => onChange({ outputField: e.target.value || undefined })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        </AdvancedSection>
      </div>
    );
  }

  if (type === "calculate") {
    const mode = String(cfg.mode ?? "number");
    const agg = String(cfg.aggregation ?? "count");
    const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string } | null) ?? null;
    const gbMode = gb ? gb.type : "none";
    const op = String(cfg.op ?? "percentage");
    const labels = formulaHandleLabels(op);
    const inA = inputs.find((i) => i.targetHandle === "a");
    const inB = inputs.find((i) => i.targetHandle === "b");
    const bmode = String(cfg.breakdownMode ?? "field");
    const cats = (cfg.categories as Array<{ label: string; filters: Filters }>) ?? [];
    const setCat = (i: number, patch: Record<string, unknown>) => onChange({ categories: cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    const numberPicker = (handle: "a" | "b", label: string, desc?: InputDescriptor) => (
      <Field label={label}>
        <select value={desc?.nodeId ?? ""} onChange={(e) => onSetInput(handle, e.target.value || null)} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
          <option value="">Choose a number…</option>
          {numberCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.stepNo != null ? `${c.stepNo}. ` : ""}{c.title}
            </option>
          ))}
        </select>
        {desc?.value != null && <p className="mt-1 text-xs text-neutral-500">= {String(desc.value)}</p>}
      </Field>
    );
    return (
      <div className="space-y-3 text-sm">
        <Field label="What do you want to calculate?">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            <option value="number">A single number</option>
            <option value="breakdown">Break down by category</option>
            <option value="compare">Compare two numbers</option>
          </select>
        </Field>

        {mode === "number" && (
          <>
            <Field label="Calculation">
              <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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
            <Field label="Split over time?">
              <select
                value={gbMode}
                onChange={(e) => {
                  const m = e.target.value;
                  if (m === "none") onChange({ groupBy: null });
                  else if (m === "time") onChange({ groupBy: { type: "time", unit: "day" } });
                  else onChange({ groupBy: { type: "field", field: "source" } });
                }}
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
              >
                <option value="none">No — one total number</option>
                <option value="time">Yes — a trend over time</option>
                <option value="field">By a field (breakdown)</option>
              </select>
            </Field>
            {gb?.type === "time" && (
              <Field label="Period">
                <select value={gb.unit} onChange={(e) => onChange({ groupBy: { type: "time", unit: e.target.value } })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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
          </>
        )}

        {mode === "breakdown" && (
          <>
            <Field label="Break down by">
              <select value={bmode} onChange={(e) => onChange({ breakdownMode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
                <option value="field">A field value</option>
                <option value="categories">Custom categories</option>
              </select>
            </Field>
            {bmode === "field" && (
              <Field label="Field">
                <FieldPicker value={(cfg.breakdownField as string) ?? "source"} fieldGroups={fieldGroups} onChange={(v) => onChange({ breakdownField: v })} />
              </Field>
            )}
            {bmode === "categories" && (
              <div className="space-y-2">
                {cats.map((c, i) => (
                  <div key={i} className="space-y-2 rounded border border-neutral-200 p-2">
                    <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
                    <RulesEditor value={c.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setCat(i, { filters: v })} />
                    <button onClick={() => onChange({ categories: cats.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
                      Remove category
                    </button>
                  </div>
                ))}
                <button onClick={() => onChange({ categories: [...cats, { label: `Category ${cats.length + 1}`, filters: { combinator: "and", rules: [] } }] })} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
                  + Add category
                </button>
                <Field label="Fallback label">
                  <input value={(cfg.fallbackLabel as string) ?? "Other"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
                </Field>
              </div>
            )}
            <Field label="Value per group">
              <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
                <option value="count">Count</option>
                <option value="sum">Sum of a field</option>
                <option value="count_distinct">Count distinct</option>
              </select>
            </Field>
            {agg === "sum" && (
              <Field label="Sum field">
                <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
              </Field>
            )}
          </>
        )}

        {mode === "compare" && (
          <>
            <Field label="Calculation">
              <select value={op} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
                {FORMULA_OPS.map((o) => (
                  <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                ))}
              </select>
            </Field>
            <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
              <p className="font-medium">{formulaExpression(op, inA?.title ?? "First number", inB?.title ?? "Second number")}</p>
            </div>
            {numberPicker("a", labels.a, inA)}
            {numberPicker("b", labels.b, inB)}
            {numberCandidates.length === 0 && (
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Add a “Calculate a number” step earlier in the flow to compare.</p>
            )}
          </>
        )}
      </div>
    );
  }

  if (type === "aggregate") {
    const agg = (cfg.aggregation as string) ?? "count";
    const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string } | null) ?? null;
    const gbMode = gb ? gb.type : "none";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Calculation">
          <select value={agg} onChange={(e) => onChange({ aggregation: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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
        <Field label="Group by">
          <select
            value={gbMode}
            onChange={(e) => {
              const m = e.target.value;
              if (m === "none") onChange({ groupBy: null });
              else if (m === "time") onChange({ groupBy: { type: "time", unit: "day" } });
              else onChange({ groupBy: { type: "field", field: "source" } });
            }}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
          >
            <option value="none">No grouping (single number)</option>
            <option value="time">Time period (trend)</option>
            <option value="field">A field (breakdown)</option>
          </select>
        </Field>
        {gb?.type === "time" && (
          <Field label="Period">
            <select value={gb.unit} onChange={(e) => onChange({ groupBy: { type: "time", unit: e.target.value } })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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

  // output
  return (
    <div className="space-y-3 text-sm">
      <Field label="Metric name">
        <input value={(cfg.name as string) ?? ""} onChange={(e) => onChange({ name: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
      </Field>
      <Field label="Display as">
        <select value={(cfg.viz as string) ?? "number"} onChange={(e) => onChange({ viz: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
          {VIZ_TYPES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Format">
        <select value={(cfg.format as string) ?? "number"} onChange={(e) => onChange({ format: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
          <option value="number">Number</option>
          <option value="percent">Percentage</option>
          <option value="currency">Currency</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit">
          <input value={(cfg.unit as string) ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
        <Field label="Decimals">
          <input type="number" value={Number(cfg.precision ?? 0)} onChange={(e) => onChange({ precision: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
      </div>
      <Field label="Goal / target (optional)">
        <input type="number" value={cfg.target != null ? Number(cfg.target) : ""} onChange={(e) => onChange({ target: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
      </Field>
    </div>
  );
}

/** Shown only after a successful manual test (never auto-computed). */
function TestResults({ node, onChange }: { node: FNode; onChange: (patch: Record<string, unknown>) => void }) {
  const t = node.data.lastTest;
  if (!t || t.status !== "ok") return null;
  const type = String(node.type);
  const sampleIndex = Number((node.data.config as { sampleIndex?: unknown }).sampleIndex ?? 0);
  return (
    <div className="space-y-2 border-t border-neutral-100 pt-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Test result</p>
      <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-center font-medium">{resultLabel(type, t)}</p>
      {type === "app" ? (
        <RecordSamplePicker records={t.sample} selectedIndex={sampleIndex} onSelect={(i) => onChange({ sampleIndex: i })} />
      ) : (
        <details>
          <summary className="cursor-pointer text-xs text-neutral-500">View sample data</summary>
          <div className="mt-2">
            <BeforeAfter before={t.inputSample ?? []} after={t.sample} />
          </div>
        </details>
      )}
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
        <div key={i} className="space-y-1.5 rounded border border-neutral-200 p-2">
          <FieldPicker value={r.field} fieldGroups={fieldGroups} onChange={(v) => setRule(i, { field: v })} />
          <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs">
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
            <ValueInput
              value={r.value ?? ""}
              valueKind={r.valueKind}
              valueField={r.valueField}
              fieldGroups={fieldGroups}
              fieldType={fieldProvenance(fieldGroups, r.field).type}
              placeholder="value"
              onChange={(patch) => setRule(i, patch)}
            />
          )}
          {r.op === "between" && (
            <input value={r.value2 ?? ""} placeholder="to (date)" onChange={(e) => setRule(i, { value2: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs" />
          )}
          <button onClick={() => onChange({ ...value, rules: rules.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
            Remove
          </button>
        </div>
      ))}
      <button onClick={() => onChange({ ...value, rules: [...rules, { field: "", op: "equals", value: "" }] })} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50">
        + Add rule
      </button>
    </div>
  );
}

function sampleLine(r: unknown): string {
  const rec = r as { source?: string; eventType?: string; subject?: string; value?: unknown };
  return `${rec.source ?? ""} · ${rec.eventType ?? ""}${rec.subject ? ` · ${rec.subject}` : ""}${rec.value != null ? ` · ${String(rec.value)}` : ""}`;
}


type DateRange = { enabled?: boolean; dateField?: string; mode?: string; preset?: string; days?: number; from?: string; to?: string };

/** Prominent "Date range" quick section shown at the top of Filter records. */
function DateRangeSection({ dr, setDr, fieldGroups }: { dr: DateRange; setDr: (patch: Partial<DateRange>) => void; fieldGroups: FieldGroup[] }) {
  const mode = dr.mode ?? "preset";
  return (
    <div className={`rounded-md border p-3 ${dr.enabled ? "border-blue-200 bg-blue-50/40" : "border-neutral-200"}`}>
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-sm font-medium">Date range</span>
        <input type="checkbox" checked={!!dr.enabled} onChange={(e) => setDr({ enabled: e.target.checked })} className="h-4 w-4" />
      </label>
      <p className="mt-0.5 text-xs text-neutral-500">Only include records within a time window.</p>
      {dr.enabled && (
        <div className="mt-3 space-y-2">
          <Field label="Date field">
            <FieldPicker value={dr.dateField ?? "occurredAt"} fieldGroups={fieldGroups} onChange={(v) => setDr({ dateField: v })} />
          </Field>
          <Field label="Window">
            <select value={mode} onChange={(e) => setDr({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="preset">Preset period</option>
              <option value="rolling">Rolling (last N days)</option>
              <option value="between">Between two dates</option>
            </select>
          </Field>
          {mode === "preset" && (
            <Field label="Period">
              <select value={dr.preset ?? "last_30_days"} onChange={(e) => setDr({ preset: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
                {TIME_PRESETS.map((p) => (
                  <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                ))}
              </select>
            </Field>
          )}
          {mode === "rolling" && (
            <Field label="Last N days">
              <input type="number" value={Number(dr.days ?? 30)} onChange={(e) => setDr({ days: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          )}
          {mode === "between" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">
                <input type="date" value={dr.from ?? ""} onChange={(e) => setDr({ from: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
              </Field>
              <Field label="To">
                <input type="date" value={dr.to ?? ""} onChange={(e) => setDr({ to: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
              </Field>
            </div>
          )}
        </div>
      )}
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

function AdvancedSection({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded border border-neutral-200 p-2">
      <summary className="cursor-pointer text-xs font-medium text-neutral-500">Advanced</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}
