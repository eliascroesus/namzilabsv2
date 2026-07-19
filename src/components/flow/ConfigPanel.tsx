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
import { collidingFields, fieldProvenance } from "./graph-utils";
import { NODE_META, MORE_FILTER_OPS, defaultTitle, formulaExpression, formulaHandleLabels, resultLabel } from "./node-meta";
import { FieldPicker } from "./FieldPicker";
import { ValueInput } from "./ValueInput";
import { RecordSamplePicker } from "./RecordSamplePicker";
import { ResultSoFar } from "./ResultSoFar";
import type { ChainStepDTO } from "@/app/dashboard/flows/actions";

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

export type GuidedStep = { id: string; label: string; tab: TabKey; done: boolean };

/**
 * Ordered guided steps for a node. Drives the single progressing CTA and the panel's
 * auto-open-to-first-incomplete behaviour, so users never inspect tabs to find what's
 * missing. Labels are app-agnostic (no hardcoded provider names).
 */
export function nodeSteps(node: FNode, type: NodeType, cfg: Record<string, unknown>, inputCount: number): GuidedStep[] {
  const tested = !!node.data.lastTest && node.data.lastTest.status === "ok" && !node.data.dirty;
  const steps: GuidedStep[] = [];
  if (type === "app") {
    const hasAccount = !!cfg.connectionId || !!cfg.source;
    steps.push({ id: "account", label: "Choose an account", tab: "configure", done: hasAccount });
    steps.push({ id: "event", label: "Choose which event", tab: "configure", done: hasAccount && typeof cfg.eventType === "string" });
    steps.push({ id: "record", label: "Use this record", tab: "test", done: tested });
  } else if (type === "formula") {
    steps.push({ id: "inputs", label: "Connect a number to A and B", tab: "configure", done: inputCount >= 2 });
    steps.push({ id: "test", label: "Test this step", tab: "test", done: tested });
  } else if (type === "output") {
    steps.push({ id: "input", label: "Connect an input", tab: "configure", done: inputCount > 0 });
    steps.push({ id: "name", label: "Name this metric", tab: "configure", done: !!String(cfg.name ?? "").trim() });
    steps.push({ id: "test", label: "Test this step", tab: "test", done: tested });
  } else {
    steps.push({ id: "input", label: "Connect an input", tab: "configure", done: inputCount > 0 });
    steps.push({ id: "test", label: "Test this step", tab: "test", done: tested });
  }
  return steps;
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
  resultSteps,
  resultTitles,
  resultLoading,
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
  resultSteps: ChainStepDTO[];
  resultTitles: Record<string, string>;
  resultLoading: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onRename: (v: string) => void;
  onTest: () => void;
  onDelete: () => void;
  onDeleteReconnect: () => void;
  onDuplicate: () => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const steps = nodeSteps(node, type, cfg, inputCount);
  const firstOpen = steps.find((s) => !s.done);
  const configureDone = steps.filter((s) => s.tab === "configure").every((s) => s.done);
  const tested = !!node.data.lastTest && node.data.lastTest.status === "ok" && !node.data.dirty;

  const [tab, setTab] = useState<TabKey>(() => firstOpen?.tab ?? "configure");

  const tabs: Array<{ key: TabKey; label: string; done: boolean; enabled: boolean }> = [
    { key: "setup", label: "Guide", done: !firstOpen, enabled: true },
    { key: "configure", label: "Configure", done: configureDone, enabled: true },
    { key: "test", label: "Test", done: tested, enabled: configureDone },
  ];

  const cta = firstOpen
    ? {
        label: testing && firstOpen.tab === "test" ? "Testing…" : firstOpen.label,
        run: () => {
          setTab(firstOpen.tab);
          if (firstOpen.tab === "test" && configureDone && !testing) onTest();
        },
      }
    : tab !== "test"
      ? { label: "Continue", run: () => setTab("test") }
      : { label: testing ? "Testing…" : "Re-test step", run: onTest };

  return (
    <aside className="flex w-[480px] shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          <span>{NODE_META[type].icon}</span>
          <span>{stepNo != null ? `Step ${stepNo} · ` : ""}{NODE_META[type].label}</span>
        </div>
        <input
          value={node.data.label ?? ""}
          onChange={(e) => onRename(e.target.value)}
          placeholder={defaultTitle(type, node.data)}
          className="mt-1 w-full rounded border border-transparent px-1 py-1 text-base font-medium hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
        />
      </div>

      <div className="flex border-b border-neutral-200 text-sm">
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

      <ResultSoFar steps={resultSteps} titles={resultTitles} loading={resultLoading} />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "setup" && (
          <div className="space-y-5 text-sm">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Steps</p>
              {steps.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setTab(s.tab)}
                  className="flex w-full items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-left hover:bg-neutral-50"
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${s.done ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className={s.done ? "text-neutral-500" : "font-medium text-neutral-800"}>{s.label}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={onDuplicate} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
                Duplicate
              </button>
              <button onClick={onDelete} className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">
                Delete
              </button>
              {canReconnect && (
                <button onClick={onDeleteReconnect} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50" title="Remove this step and connect the previous step straight to the next">
                  Delete &amp; reconnect
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "configure" && <ConfigureTab type={type} cfg={cfg} connections={connections} fieldGroups={fieldGroups} inputs={inputs} onChange={onChange} />}

        {tab === "test" && <TestTab node={node} testing={testing} onTest={onTest} onChange={onChange} />}
      </div>

      <div className="border-t border-neutral-200 p-3">
        <button
          onClick={cta.run}
          disabled={testing}
          className={`w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${firstOpen ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-neutral-900 text-white hover:bg-neutral-800"}`}
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
  onChange,
}: {
  type: NodeType;
  cfg: Record<string, unknown>;
  connections: ConnMeta[];
  fieldGroups: FieldGroup[];
  inputs: InputDescriptor[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
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
    return <RulesEditor value={fc} fieldGroups={fieldGroups} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />;
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
    const nameA = inA?.title ?? labels.a;
    const nameB = inB?.title ?? labels.b;
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
        <FormulaInput label={`${labels.a} (input A)`} desc={inA} />
        <FormulaInput label={`${labels.b} (input B)`} desc={inB} />
        <p className="text-xs text-neutral-400">Inputs A and B accept a single number from an Aggregate or Formula step.</p>
      </div>
    );
  }

  if (type === "combine") {
    const mode = (cfg.mode as string) ?? "stack";
    const collisions = collidingFields(inputs);
    return (
      <div className="space-y-3 text-sm">
        <Field label="Mode">
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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
            <select value={(cfg.baseSourceId as string) ?? ""} onChange={(e) => onChange({ baseSourceId: e.target.value || null })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="">First connected input</option>
              {inputs.map((inp, i) => (
                <option key={inp.nodeId} value={inp.nodeId}>
                  Source {i + 1}: {inp.title}
                </option>
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
            <select value={(cfg.keep as string) ?? "all"} onChange={(e) => onChange({ keep: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
              <option value="all">All base records</option>
              <option value="matched">Only matched</option>
              <option value="unmatched">Only unmatched</option>
            </select>
          </Field>
        )}

        {(mode === "dedupe" || mode === "match") && collisions.length > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Fields present in more than one source may overwrite each other: <b>{collisions.join(", ")}</b>. The winning source is set below.
          </p>
        )}

        {(mode === "dedupe" || mode === "match") && (
          <AdvancedSection>
            <Field label="When duplicated, which source wins">
              <select value={(cfg.sourceWins as string) ?? "first"} onChange={(e) => onChange({ sourceWins: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
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
      <div className="space-y-3 text-sm">
        {paths.map((p, i) => (
          <div key={p.id} className="space-y-2 rounded border border-neutral-200 p-2">
            <input value={p.label} onChange={(e) => setPath(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
            <RulesEditor value={p.filters ?? { combinator: "and", rules: [] }} fieldGroups={fieldGroups} onChange={(v) => setPath(i, { filters: v })} />
            {paths.length > 1 && (
              <button onClick={() => onChange({ paths: paths.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">
                Remove path
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => onChange({ paths: [...paths, { id: `p${Math.random().toString(36).slice(2, 7)}`, label: `Path ${paths.length + 1}`, filters: { combinator: "and", rules: [] } }] })}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          + Add path
        </button>
        <Field label="Fallback label (unmatched records)">
          <input value={(cfg.fallbackLabel as string) ?? "Fallback"} onChange={(e) => onChange({ fallbackLabel: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
        </Field>
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
    const op = (cfg.op as string) ?? "round";
    return (
      <div className="space-y-3 text-sm">
        <Field label="Field to format">
          <FieldPicker value={(cfg.field as string) ?? "value"} fieldGroups={fieldGroups} onChange={(v) => onChange({ field: v })} />
        </Field>
        <Field label="Operation">
          <select value={op} onChange={(e) => onChange({ op: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5">
            {FORMATTER_OPS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {op === "round" && (
          <Field label="Decimals">
            <input type="number" value={Number(cfg.decimals ?? 2)} onChange={(e) => onChange({ decimals: Number(e.target.value) })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
          </Field>
        )}
        {op === "replace" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Find">
              <input value={(cfg.find as string) ?? ""} onChange={(e) => onChange({ find: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
            <Field label="Replace with">
              <input value={(cfg.replaceWith as string) ?? ""} onChange={(e) => onChange({ replaceWith: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
            </Field>
          </div>
        )}
        {op === "default" && (
          <Field label="Value for empty">
            <input value={(cfg.defaultValue as string) ?? ""} onChange={(e) => onChange({ defaultValue: e.target.value })} className="w-full rounded-md border border-neutral-300 px-2 py-1.5" />
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

function TestTab({ node, testing, onTest, onChange }: { node: FNode; testing: boolean; onTest: () => void; onChange: (patch: Record<string, unknown>) => void }) {
  const t = node.data.lastTest;
  const type = String(node.type);
  const sampleIndex = Number((node.data.config as { sampleIndex?: unknown }).sampleIndex ?? 0);
  return (
    <div className="space-y-3 text-sm">
      <button onClick={onTest} disabled={testing} className="w-full rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
        {testing ? "Testing…" : node.data.lastTest ? "Test again" : "Test this node"}
      </button>
      {node.data.dirty && <p className="text-xs text-amber-700">This node changed — retest to refresh its data.</p>}
      {t && t.status === "error" && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{t.error}</p>}
      {t && t.status === "ok" && (
        <div className="space-y-3">
          <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-center font-medium">{resultLabel(type, t)}</p>
          {type === "app" ? (
            <RecordSamplePicker records={t.sample} selectedIndex={sampleIndex} onSelect={(i) => onChange({ sampleIndex: i })} />
          ) : (
            <BeforeAfter before={t.inputSample ?? []} after={t.sample} />
          )}
        </div>
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
      <button onClick={() => onChange({ ...value, rules: [...rules, { field: "eventType", op: "equals", value: "" }] })} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50">
        + Add rule
      </button>
    </div>
  );
}

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

/** One connected Combine source, expandable to its origin + sample records. */
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
        {desc.appSource && (
          <p>
            App: {desc.appSource}
            {desc.account ? ` · ${desc.account}` : ""}
            {desc.eventType ? ` · ${desc.eventType}` : ""}
          </p>
        )}
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

/** One Formula input (A/B), showing the upstream step, its calculation, and value. */
function FormulaInput({ label, desc }: { label: string; desc?: InputDescriptor }) {
  return (
    <div className="rounded border border-neutral-200 p-2 text-xs">
      <p className="font-medium text-neutral-600">{label}</p>
      {desc ? (
        <p className="mt-0.5 text-neutral-700">
          {desc.title}
          {desc.calc ? ` — ${desc.calc}` : ""}
          {desc.value != null ? ` = ${String(desc.value)}` : desc.status === "untested" ? " (test to see value)" : ""}
        </p>
      ) : (
        <p className="mt-0.5 text-amber-700">Not connected — connect an Aggregate or Formula step.</p>
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
