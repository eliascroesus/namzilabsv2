"use client";

import { useState } from "react";
import {
  AGGREGATIONS,
  TIME_UNITS,
  VIZ_TYPES,
  TIME_PRESETS,
  FORMULA_OPS,
  type NodeType,
} from "@/lib/flow/types";
import type { ConnMeta, FieldGroup, FNode, Filters, InputDescriptor } from "./graph-utils";
import { collidingFields, computeNodeStatus } from "./graph-utils";
import { STATUS_META, defaultTitle, formulaExpression, formulaHandleLabels, resultLabel } from "./node-meta";
import { RecordSamplePicker } from "./RecordSamplePicker";
import { NodeGlyph } from "./icons";
import { Select, DataBrowser, ValueInput, ConditionEditor, SourceBadge, humanizeKey } from "./controls";
import type { DataGroup } from "./controls/types";
import { toDataGroups } from "./field-groups";
import { storedToValue, valueToStored, asFilterConfig } from "./panel-mappers";

/** A reference to an earlier step, offered as a labeled pill for multi-input wiring. */
export type StepRef = { id: string; title: string; stepNo?: number };

const SELECT_BTN =
  "flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-left text-sm hover:border-neutral-400 focus:outline-none";
const INPUT = "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-400 focus:outline-none";
const W = 412;

const SYNC_DOT: Record<string, string> = { live: "bg-green-500", synced: "bg-green-500", importing: "bg-blue-500", outdated: "bg-amber-500", error: "bg-red-500" };
const syncStatusLabel = (s: string): string => ({ importing: "importing…", outdated: "outdated", error: "sync error" } as Record<string, string>)[s] ?? s;

const AGG_LABELS: Record<string, string> = { count: "Count of records", count_distinct: "Count of distinct values", sum: "Sum of a field", avg: "Average of a field", min: "Minimum of a field", max: "Maximum of a field" };
const FORMULA_LABELS: Record<string, string> = { add: "Add", subtract: "Subtract", multiply: "Multiply", divide: "Divide", percentage: "Percentage", percent_change: "Percent change", difference: "Difference", ratio: "Ratio", average: "Average" };
const VIZ_LABELS: Record<string, string> = { number: "Single number", line: "Line chart", bar: "Bar chart", category: "Category breakdown", table: "Table", progress: "Progress bar", funnel: "Funnel" };
const title = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Formatter operations grouped by user intent, so we show only relevant controls. */
const FORMATTER_INTENTS: Array<{ id: string; label: string; ops: string[] }> = [
  { id: "text", label: "Clean up text", ops: ["trim", "uppercase", "lowercase", "normalize_email", "normalize_phone"] },
  { id: "number", label: "Change a number", ops: ["round", "multiply", "divide", "to_number"] },
  { id: "date", label: "Change a date", ops: ["date_only", "year_month"] },
  { id: "replace", label: "Find & replace", ops: ["replace"] },
  { id: "fallback", label: "Fill in when empty", ops: ["default"] },
];
const FORMATTER_OP_LABELS: Record<string, string> = {
  trim: "Trim spaces", uppercase: "UPPERCASE", lowercase: "lowercase", normalize_email: "Normalize email", normalize_phone: "Digits only (phone)",
  round: "Round", multiply: "Multiply", divide: "Divide", to_number: "Convert to number", to_text: "Convert to text",
  date_only: "Date only (YYYY-MM-DD)", year_month: "Year & month (YYYY-MM)", replace: "Find & replace", default: "Fallback when empty",
};
const formatterIntentOf = (op: string): string => FORMATTER_INTENTS.find((i) => i.ops.includes(op))?.id ?? "text";

/** A Zapier-style field chooser (label + data browser with samples, search, drill-in). */
function FieldSelect({ value, groups, onChange, placeholder = "Choose a field…" }: { value: string; groups: DataGroup[]; onChange: (path: string) => void; placeholder?: string }) {
  const chosen = value ? groups.flatMap((g) => g.fields).find((f) => f.path === value)?.label ?? humanizeKey(value) : null;
  return (
    <DataBrowser
      groups={groups}
      width={W}
      onPick={(ref) => onChange(ref.fieldPath)}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} className={SELECT_BTN}>
          <span className={`min-w-0 truncate ${chosen ? "text-neutral-800" : "text-neutral-400"}`}>{chosen ?? placeholder}</span>
          <span className="shrink-0 text-neutral-400">▾</span>
        </button>
      )}
    />
  );
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
  onAddBranch,
  onRemoveBranch,
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
  onAddBranch: () => void;
  onRemoveBranch: (pathId: string) => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const status = computeNodeStatus({ type, cfg, inputCount, lastTest: node.data.lastTest, dirty: node.data.dirty, updating: testing });
  const sm = STATUS_META[status];
  const err = node.data.lastTest?.status === "error" ? node.data.lastTest.error : null;
  const tested = status === "ready";
  const groups = toDataGroups(fieldGroups);

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

        <NodeConfig
          type={type}
          cfg={cfg}
          connections={connections}
          groups={groups}
          inputs={inputs}
          numberCandidates={numberCandidates}
          datasetCandidates={datasetCandidates}
          onChange={onChange}
          onSetInput={onSetInput}
          onSetSources={onSetSources}
          onAddBranch={onAddBranch}
          onRemoveBranch={onRemoveBranch}
        />

        {node.data.lastTest?.status === "ok" && <TestResults node={node} onChange={onChange} />}

        <details className="border-t border-neutral-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500">Step options</summary>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button onClick={onDuplicate} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
              Duplicate
            </button>
            <button
              onClick={canReconnect ? onDeleteReconnect : onDelete}
              className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50"
              title={canReconnect ? "Remove this step and reconnect the steps around it" : "Delete this step"}
            >
              Delete step
            </button>
          </div>
        </details>
      </div>

      <div className="border-t border-neutral-200 p-3">
        <button
          onClick={cta.run}
          disabled={cta.disabled}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-default disabled:opacity-50"
        >
          {cta.label}
        </button>
      </div>
    </aside>
  );
}

function NodeConfig({
  type,
  cfg,
  connections,
  groups,
  inputs,
  numberCandidates,
  datasetCandidates,
  onChange,
  onSetInput,
  onSetSources,
  onAddBranch,
  onRemoveBranch,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  connections: ConnMeta[];
  groups: DataGroup[];
  inputs: InputDescriptor[];
  numberCandidates: StepRef[];
  datasetCandidates: StepRef[];
  onChange: (patch: Record<string, unknown>) => void;
  onSetInput: (handle: "a" | "b", sourceId: string | null) => void;
  onSetSources: (ids: string[]) => void;
  onAddBranch: () => void;
  onRemoveBranch: (pathId: string) => void;
}) {
  const [fmtIntent, setFmtIntent] = useState(() => formatterIntentOf(String((cfg as { op?: unknown }).op ?? "round")));

  if (type === "app") {
    const connId = (cfg.connectionId as string) ?? "";
    const conn = connections.find((c) => c.id === connId);
    return (
      <div className="space-y-3">
        <Field label="Connected account">
          <Select
            value={connId}
            width={W}
            placeholder="Choose an account…"
            options={connections.map((c) => ({ value: c.id, label: c.name, hint: c.source }))}
            onChange={(v) => {
              const c = connections.find((x) => x.id === v);
              onChange({ connectionId: c?.id ?? null, connectionName: c?.name ?? null, source: c?.source ?? null, eventType: null });
            }}
          />
        </Field>
        {conn?.syncStatus && (
          <p className="text-xs text-neutral-500">
            Data status: <span className={`inline-block h-2 w-2 rounded-full align-middle ${SYNC_DOT[conn.syncStatus] ?? "bg-neutral-400"}`} /> {syncStatusLabel(conn.syncStatus)}
            {conn.syncStatus === "outdated" || conn.syncStatus === "error" ? (
              <>
                {" "}&middot;{" "}
                <a className="underline" href={`/connections/${conn.id}`}>Manage</a>
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
          <Select
            value={typeof cfg.eventType === "string" ? (cfg.eventType as string) : "__none"}
            width={W}
            placeholder="Choose an event…"
            options={[{ value: "", label: "All events" }, ...(conn?.eventTypes ?? []).map((t) => ({ value: t, label: t }))]}
            onChange={(v) => onChange({ eventType: v })}
          />
        </Field>
        <Advanced>
          <Field label="Match records using">
            <FieldSelect value={(cfg.identityField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
          <p className="text-xs text-neutral-400">Used by downstream Combine / de-duplicate steps to recognise the same person.</p>
        </Advanced>
      </div>
    );
  }

  if (type === "filter") {
    const fc = asFilterConfig(cfg);
    return (
      <div className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Only continue if…</p>
        <ConditionEditor value={fc} groups={groups} showDateRange onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules, dateRange: v.dateRange })} />
      </div>
    );
  }

  if (type === "time") {
    const mode = (cfg.mode as string) ?? "preset";
    return (
      <div className="space-y-3">
        <Field label="Date field">
          <FieldSelect value={(cfg.dateField as string) ?? "occurredAt"} groups={groups} onChange={(v) => onChange({ dateField: v })} />
        </Field>
        <Field label="Window">
          <Select
            value={mode}
            width={W}
            options={[{ value: "preset", label: "Preset period" }, { value: "rolling", label: "Rolling (last N days)" }, { value: "between", label: "Between two dates" }]}
            onChange={(v) => onChange({ mode: v })}
          />
        </Field>
        {mode === "preset" && (
          <Field label="Period">
            <Select value={(cfg.preset as string) ?? "last_30_days"} width={W} searchable options={TIME_PRESETS.map((p) => ({ value: p, label: title(p) }))} onChange={(v) => onChange({ preset: v })} />
          </Field>
        )}
        {mode === "rolling" && (
          <Field label="Last N days">
            <input type="number" value={Number(cfg.days ?? 30)} onChange={(e) => onChange({ days: Number(e.target.value) })} className={INPUT} />
          </Field>
        )}
        {mode === "between" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" value={(cfg.from as string) ?? ""} onChange={(e) => onChange({ from: e.target.value })} className={INPUT} /></Field>
            <Field label="To"><input type="date" value={(cfg.to as string) ?? ""} onChange={(e) => onChange({ to: e.target.value })} className={INPUT} /></Field>
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
    return (
      <div className="space-y-3">
        <Field label="Calculation">
          <Select value={op} width={W} options={FORMULA_OPS.map((o) => ({ value: o, label: FORMULA_LABELS[o] ?? title(o) }))} onChange={(v) => onChange({ op: v })} />
        </Field>
        <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
          <p className="font-medium">{formulaExpression(op, inA?.title ?? "First number", inB?.title ?? "Second number")}</p>
        </div>
        <NumberPicker handle="a" label={labels.a} desc={inA} candidates={numberCandidates} onSetInput={onSetInput} />
        <NumberPicker handle="b" label={labels.b} desc={inB} candidates={numberCandidates} onSetInput={onSetInput} />
        {numberCandidates.length === 0 && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Add a “Calculate a number” step earlier in the flow to compare.</p>}
      </div>
    );
  }

  if (type === "combine") {
    const mode = (cfg.mode as string) ?? "stack";
    const collisions = collidingFields(inputs);
    const connectedIds = inputs.map((i) => i.nodeId);
    const toggle = (id: string, on: boolean) => onSetSources(on ? [...connectedIds, id] : connectedIds.filter((x) => x !== id));
    return (
      <div className="space-y-3">
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
                  <button key={c.id} type="button" onClick={() => toggle(c.id, !on)} className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs ${on ? "border-neutral-800 bg-neutral-50" : "border-neutral-200 hover:border-neutral-300"}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300"}`}>{on ? "✓" : ""}</span>
                      <span className="truncate">{c.stepNo != null ? `${c.stepNo}. ` : ""}{c.title}</span>
                    </span>
                    {desc?.recordCount != null && <span className="shrink-0 text-neutral-400">{desc.recordCount} recs</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Field label="How should they be combined?">
          <Select
            value={mode}
            width={W}
            options={[{ value: "stack", label: "Put all records together" }, { value: "dedupe", label: "Remove duplicate people" }, { value: "match", label: "Match records across sources" }]}
            onChange={(v) => onChange({ mode: v })}
          />
        </Field>

        {mode === "match" && (
          <Field label="Main list (records kept & enriched)">
            <Select
              value={(cfg.baseSourceId as string) ?? ""}
              width={W}
              options={[{ value: "", label: "First selected source" }, ...inputs.map((inp, i) => ({ value: inp.nodeId, label: `Source ${i + 1}: ${inp.title}` }))]}
              onChange={(v) => onChange({ baseSourceId: v || null })}
            />
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <Field label="Recognize the same person by">
            <FieldSelect value={(cfg.identityField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ identityField: v })} />
          </Field>
        )}
        {mode === "match" && (
          <Field label="Keep">
            <Select
              value={(cfg.keep as string) ?? "all"}
              width={W}
              options={[{ value: "all", label: "All records from the main list" }, { value: "matched", label: "Only matched" }, { value: "unmatched", label: "Only unmatched" }]}
              onChange={(v) => onChange({ keep: v })}
            />
          </Field>
        )}
        {(mode === "dedupe" || mode === "match") && collisions.length > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">These fields exist in more than one source and may overwrite each other: <b>{collisions.join(", ")}</b>.</p>
        )}
        {(mode === "dedupe" || mode === "match") && (
          <Advanced>
            <Field label="When duplicated, which source wins">
              <Select value={(cfg.sourceWins as string) ?? "first"} width={W} options={[{ value: "first", label: "First selected source" }, { value: "last", label: "Last selected source" }]} onChange={(v) => onChange({ sourceWins: v })} />
            </Field>
          </Advanced>
        )}
      </div>
    );
  }

  if (type === "paths") {
    const paths = (cfg.paths as Array<{ id: string; label: string }>) ?? [];
    const setLabel = (i: number, label: string) => onChange({ paths: paths.map((p, j) => (j === i ? { ...p, label } : p)) });
    return (
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">This step just splits your records into branches. Set each branch’s “only continue if” conditions in its own <b>Path conditions</b> step on the canvas.</p>
        {paths.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border border-pink-200 bg-pink-50/40 px-2 py-1.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-pink-700">Branch {i + 1}</span>
            <input value={p.label} onChange={(e) => setLabel(i, e.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
            {paths.length > 1 && (
              <button onClick={() => onRemoveBranch(p.id)} className="shrink-0 text-[11px] text-red-600 hover:underline" title="Remove this branch and its steps">Remove</button>
            )}
          </div>
        ))}
        <button onClick={onAddBranch} className="w-full rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">+ Add branch</button>
      </div>
    );
  }

  if (type === "group") {
    const mode = (cfg.mode as string) ?? "field";
    const agg = (cfg.aggregation as string) ?? "count";
    return (
      <div className="space-y-3">
        <Field label="Group by">
          <Select value={mode} width={W} options={[{ value: "field", label: "A field value" }, { value: "categories", label: "Custom categories" }]} onChange={(v) => onChange({ mode: v })} />
        </Field>
        {mode === "field" && <Field label="Field"><FieldSelect value={(cfg.field as string) ?? "source"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
        {mode === "categories" && <CategoryEditor cfg={cfg} groups={groups} onChange={onChange} />}
        <Field label="Value per group">
          <Select value={agg} width={W} options={[{ value: "count", label: "Count" }, { value: "sum", label: "Sum of a field" }, { value: "count_distinct", label: "Count distinct" }]} onChange={(v) => onChange({ aggregation: v })} />
        </Field>
        {agg === "sum" && <Field label="Sum field"><FieldSelect value={(cfg.valueField as string) ?? "value"} groups={groups} onChange={(v) => onChange({ valueField: v })} /></Field>}
      </div>
    );
  }

  if (type === "formatter") {
    const op = String(cfg.op ?? "round");
    const intent = FORMATTER_INTENTS.find((i) => i.id === fmtIntent) ?? FORMATTER_INTENTS[0];
    return (
      <div className="space-y-3">
        <Field label="Field to clean up">
          <FieldSelect value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} />
        </Field>
        <Field label="What do you want to do?">
          <Select
            value={fmtIntent}
            width={W}
            options={FORMATTER_INTENTS.map((i) => ({ value: i.id, label: i.label }))}
            onChange={(ni) => {
              setFmtIntent(ni);
              const nextOps = FORMATTER_INTENTS.find((i) => i.id === ni)?.ops ?? [];
              if (nextOps.length && !nextOps.includes(op)) onChange({ op: nextOps[0] });
            }}
          />
        </Field>
        {intent.ops.length > 1 && (
          <Field label="Operation">
            <Select value={op} width={W} options={intent.ops.map((o) => ({ value: o, label: FORMATTER_OP_LABELS[o] ?? title(o) }))} onChange={(v) => onChange({ op: v })} />
          </Field>
        )}
        {op === "round" && <Field label="Decimals"><input type="number" value={Number(cfg.decimals ?? 2)} onChange={(e) => onChange({ decimals: Number(e.target.value) })} className={INPUT} /></Field>}
        {op === "replace" && (
          <>
            <Field label="Find"><input value={(cfg.find as string) ?? ""} onChange={(e) => onChange({ find: e.target.value })} className={INPUT} /></Field>
            <Field label="Replace with"><ValueInput value={storedToValue(cfg, "replaceWith", groups)} groups={groups} placeholder="new value" onChange={(v) => onChange(valueToStored(v, "replaceWith"))} /></Field>
          </>
        )}
        {op === "default" && <Field label="Value for empty"><ValueInput value={storedToValue(cfg, "defaultValue", groups)} groups={groups} placeholder="fallback value" onChange={(v) => onChange(valueToStored(v, "defaultValue"))} /></Field>}
        {(op === "multiply" || op === "divide") && <Field label="Factor"><input type="number" value={cfg.factor != null ? Number(cfg.factor) : ""} onChange={(e) => onChange({ factor: e.target.value === "" ? undefined : Number(e.target.value) })} className={INPUT} /></Field>}
        <Advanced>
          <Field label="Save to field (defaults to same field)">
            <input value={(cfg.outputField as string) ?? ""} onChange={(e) => onChange({ outputField: e.target.value || undefined })} className={INPUT} />
          </Field>
        </Advanced>
      </div>
    );
  }

  if (type === "calculate") {
    const mode = String(cfg.mode ?? "number");
    return (
      <div className="space-y-3">
        <Field label="What do you want to calculate?">
          <Select
            value={mode}
            width={W}
            options={[{ value: "number", label: "A single number" }, { value: "breakdown", label: "Break down by category" }, { value: "compare", label: "Compare two numbers" }]}
            onChange={(v) => onChange({ mode: v })}
          />
        </Field>
        {mode === "number" && <CalcNumber cfg={cfg} groups={groups} onChange={onChange} />}
        {mode === "breakdown" && <CalcBreakdown cfg={cfg} groups={groups} onChange={onChange} />}
        {mode === "compare" && <CalcCompare cfg={cfg} inputs={inputs} numberCandidates={numberCandidates} onChange={onChange} onSetInput={onSetInput} />}
      </div>
    );
  }

  if (type === "aggregate") {
    return <CalcNumber cfg={cfg} groups={groups} onChange={onChange} />;
  }

  // output (legacy)
  return (
    <div className="space-y-3">
      <Field label="Metric name"><input value={(cfg.name as string) ?? ""} onChange={(e) => onChange({ name: e.target.value })} className={INPUT} /></Field>
      <Field label="Display as"><Select value={(cfg.viz as string) ?? "number"} width={W} options={VIZ_TYPES.map((v) => ({ value: v, label: VIZ_LABELS[v] ?? title(v) }))} onChange={(v) => onChange({ viz: v })} /></Field>
      <Field label="Format"><Select value={(cfg.format as string) ?? "number"} width={W} options={[{ value: "number", label: "Number" }, { value: "percent", label: "Percentage" }, { value: "currency", label: "Currency" }]} onChange={(v) => onChange({ format: v })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit"><input value={(cfg.unit as string) ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className={INPUT} /></Field>
        <Field label="Decimals"><input type="number" value={Number(cfg.precision ?? 0)} onChange={(e) => onChange({ precision: Number(e.target.value) })} className={INPUT} /></Field>
      </div>
      <Field label="Goal / target (optional)"><input type="number" value={cfg.target != null ? Number(cfg.target) : ""} onChange={(e) => onChange({ target: e.target.value === "" ? null : Number(e.target.value) })} className={INPUT} /></Field>
    </div>
  );
}

/** Calculate → single number (also the legacy Aggregate editor). */
function CalcNumber({ cfg, groups, onChange }: { cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const agg = String(cfg.aggregation ?? "count");
  const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string } | null) ?? null;
  const gbMode = gb ? gb.type : "none";
  return (
    <>
      <Field label="Calculation">
        <Select value={agg} width={W} options={AGGREGATIONS.map((a) => ({ value: a, label: AGG_LABELS[a] ?? title(a) }))} onChange={(v) => onChange({ aggregation: v })} />
      </Field>
      {(agg === "sum" || agg === "avg" || agg === "min" || agg === "max") && <Field label="Number field"><FieldSelect value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
      {agg === "count_distinct" && <Field label="Distinct by"><FieldSelect value={(cfg.distinctField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ distinctField: v })} /></Field>}
      <Field label="Split it up?">
        <Select
          value={gbMode ?? "none"}
          width={W}
          options={[{ value: "none", label: "No — one total number" }, { value: "time", label: "Yes — a trend over time" }, { value: "field", label: "By a field (breakdown)" }]}
          onChange={(m) => onChange({ groupBy: m === "none" ? null : m === "time" ? { type: "time", unit: "day" } : { type: "field", field: "source" } })}
        />
      </Field>
      {gb?.type === "time" && <Field label="Period"><Select value={gb.unit ?? "day"} width={W} options={TIME_UNITS.map((u) => ({ value: u, label: title(u) }))} onChange={(v) => onChange({ groupBy: { type: "time", unit: v } })} /></Field>}
      {gb?.type === "field" && <Field label="Field"><FieldSelect value={gb.field ?? "source"} groups={groups} onChange={(v) => onChange({ groupBy: { type: "field", field: v } })} /></Field>}
    </>
  );
}

/** Calculate → breakdown by field or custom categories. */
function CalcBreakdown({ cfg, groups, onChange }: { cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const bmode = String(cfg.breakdownMode ?? "field");
  const agg = String(cfg.aggregation ?? "count");
  return (
    <>
      <Field label="Break down by">
        <Select value={bmode} width={W} options={[{ value: "field", label: "A field value" }, { value: "categories", label: "Custom categories" }]} onChange={(v) => onChange({ breakdownMode: v })} />
      </Field>
      {bmode === "field" && <Field label="Field"><FieldSelect value={(cfg.breakdownField as string) ?? "source"} groups={groups} onChange={(v) => onChange({ breakdownField: v })} /></Field>}
      {bmode === "categories" && <CategoryEditor cfg={cfg} groups={groups} onChange={onChange} />}
      <Field label="Value per group">
        <Select value={agg} width={W} options={[{ value: "count", label: "Count" }, { value: "sum", label: "Sum of a field" }, { value: "count_distinct", label: "Count distinct" }]} onChange={(v) => onChange({ aggregation: v })} />
      </Field>
      {agg === "sum" && <Field label="Sum field"><FieldSelect value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
    </>
  );
}

/** Calculate → compare two numbers picked from earlier steps as labeled pills. */
function CalcCompare({ cfg, inputs, numberCandidates, onChange, onSetInput }: { cfg: Record<string, unknown>; inputs: InputDescriptor[]; numberCandidates: StepRef[]; onChange: (p: Record<string, unknown>) => void; onSetInput: (h: "a" | "b", id: string | null) => void }) {
  const op = String(cfg.op ?? "percentage");
  const labels = formulaHandleLabels(op);
  const inA = inputs.find((i) => i.targetHandle === "a");
  const inB = inputs.find((i) => i.targetHandle === "b");
  return (
    <>
      <Field label="Calculation">
        <Select value={op} width={W} options={FORMULA_OPS.map((o) => ({ value: o, label: FORMULA_LABELS[o] ?? title(o) }))} onChange={(v) => onChange({ op: v })} />
      </Field>
      <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
        <p className="font-medium">{formulaExpression(op, inA?.title ?? "First number", inB?.title ?? "Second number")}</p>
      </div>
      <NumberPicker handle="a" label={labels.a} desc={inA} candidates={numberCandidates} onSetInput={onSetInput} />
      <NumberPicker handle="b" label={labels.b} desc={inB} candidates={numberCandidates} onSetInput={onSetInput} />
      {numberCandidates.length === 0 && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Add a “Calculate a number” step earlier in the flow to compare.</p>}
    </>
  );
}

function NumberPicker({ handle, label, desc, candidates, onSetInput }: { handle: "a" | "b"; label: string; desc?: InputDescriptor; candidates: StepRef[]; onSetInput: (h: "a" | "b", id: string | null) => void }) {
  return (
    <Field label={label}>
      <Select
        value={desc?.nodeId ?? ""}
        width={W}
        placeholder="Choose a number…"
        options={candidates.map((c) => ({ value: c.id, label: `${c.stepNo != null ? `${c.stepNo}. ` : ""}${c.title}` }))}
        onChange={(v) => onSetInput(handle, v || null)}
      />
      {desc?.value != null && <p className="mt-1 text-xs text-neutral-500">= {String(desc.value)}</p>}
    </Field>
  );
}

/** Custom-category editor (shared by Group and Calculate breakdown). */
function CategoryEditor({ cfg, groups, onChange }: { cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const cats = (cfg.categories as Array<{ label: string; filters: Filters }>) ?? [];
  const setCat = (i: number, patch: Record<string, unknown>) => onChange({ categories: cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-2">
      {cats.map((c, i) => (
        <div key={i} className="space-y-2 rounded border border-neutral-200 p-2">
          <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
          <ConditionEditor value={asFilterConfig((c.filters as unknown as Record<string, unknown>) ?? {})} groups={groups} onChange={(v) => setCat(i, { filters: { combinator: v.combinator, rules: v.rules } })} emptyHint="No conditions — matches everything left over." />
          <button onClick={() => onChange({ categories: cats.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">Remove category</button>
        </div>
      ))}
      <button onClick={() => onChange({ categories: [...cats, { label: `Category ${cats.length + 1}`, filters: { combinator: "and", rules: [] } }] })} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">+ Add category</button>
      <Field label="Fallback label"><input value={(cfg.fallbackLabel as string) ?? "Other"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className={INPUT} /></Field>
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
          <div className="mt-2"><BeforeAfter before={t.inputSample ?? []} after={t.sample} /></div>
        </details>
      )}
    </div>
  );
}

function BeforeAfter({ before, after }: { before: unknown[]; after: unknown[] }) {
  const col = (recs: unknown[], label: string, tone: string) => (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">{label} ({recs.length})</p>
      <div className="space-y-1">
        {recs.length === 0 && <p className="text-xs text-neutral-400">—</p>}
        {recs.slice(0, 3).map((r, i) => <div key={i} className={`truncate rounded border p-1.5 text-[11px] ${tone}`}>{sampleLine(r)}</div>)}
      </div>
    </div>
  );
  return <div className="grid grid-cols-2 gap-2">{col(before, "Before", "border-neutral-100 bg-neutral-50")}{col(after, "After", "border-green-100 bg-green-50")}</div>;
}

function sampleLine(r: unknown): string {
  const rec = r as { source?: string; eventType?: string; subject?: string; value?: unknown };
  return `${rec.source ?? ""} · ${rec.eventType ?? ""}${rec.subject ? ` · ${rec.subject}` : ""}${rec.value != null ? ` · ${String(rec.value)}` : ""}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </div>
  );
}

function Advanced({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded border border-neutral-200 p-2">
      <summary className="cursor-pointer text-xs font-medium text-neutral-500">Advanced</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}
