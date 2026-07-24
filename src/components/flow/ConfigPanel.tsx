"use client";

import { useEffect, useState } from "react";
import { catalogEntry, type FlowConfigField } from "@/connectors/catalog";
import { listAppFieldsAction, listSourceOptionsAction, type AppFieldDTO } from "@/app/dashboard/flows/actions";
import {
  AGGREGATIONS,
  TIME_UNITS,
  VIZ_TYPES,
  TIME_PRESETS,
  FORMULA_OPS,
  isDatasetFormulaOp,
  type NodeType,
} from "@/lib/flow/types";
import type { ConnMeta, FieldGroup, FNode, Filters, InputDescriptor } from "./graph-utils";
import { computeNodeStatus, STD_META } from "./graph-utils";
import { STATUS_META, datasetCalcExpression, defaultTitle, formulaExpression, formulaHandleLabels, resultLabel } from "./node-meta";
import { RecordSamplePicker } from "./RecordSamplePicker";
import { DataIcon, NodeIcon } from "./icons";
import { Select, DataBrowser, FieldInput, ConditionEditor, humanizeKey } from "./controls";
import type { DataGroup } from "./controls/types";
import { toDataGroups } from "./field-groups";
import { asFilterConfig } from "./panel-mappers";

/** A reference to an earlier step, offered as a labeled pill for multi-input wiring. */
export type StepRef = { id: string; title: string; stepNo?: number };

/** Branch-head context: how records enter this Paths branch (mode lives on the hub). */
export type BranchCtx = { mode: string; siblingHasFallback: boolean; siblingHasAlways: boolean; set: (mode: string) => void };

const INPUT = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100";
const W = 412;

/** Shared button language for the config panel (Make.com vibe: rounded, tactile, colourful). */
const BTN_BASE = "rounded-xl px-4 py-3 text-sm font-semibold transition-all active:scale-[0.985]";
const BTN_PRIMARY = `${BTN_BASE} bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700 disabled:cursor-default disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none`;
const BTN_SECONDARY = `${BTN_BASE} border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50`;

const AGG_LABELS: Record<string, string> = { count: "Count of records", count_distinct: "Count of distinct values", sum: "Sum of a field", avg: "Average of a field", min: "Minimum of a field", max: "Maximum of a field" };
const FORMULA_LABELS: Record<string, string> = {
  add: "+  Add",
  subtract: "−  Subtract",
  multiply: "×  Multiply",
  divide: "÷  Divide",
  percentage: "%  Percentage",
  percent_change: "Δ%  Percent change",
  difference: "−  Difference",
  ratio: "∶  Ratio",
  average: "x̄  Average of two numbers",
  count: "#  Count records",
  count_distinct: "#  Count unique values",
  sum: "Σ  Sum",
  avg: "x̄  Average",
  min: "↓  Minimum (lowest value)",
  max: "↑  Maximum (highest value)",
};
/** Binary (two-number) ops first, then the dataset aggregations at the end. */
const FORMULA_OP_OPTIONS = FORMULA_OPS.map((o) => ({
  value: o as string,
  label: FORMULA_LABELS[o] ?? o,
  group: isDatasetFormulaOp(o) ? "Across your records" : "Compare two numbers",
}));
/** The legacy Calculate node's compare mode runs ONLY the two-number ops. */
const BINARY_OP_OPTIONS = FORMULA_OPS.filter((o) => !isDatasetFormulaOp(o)).map((o) => ({ value: o as string, label: FORMULA_LABELS[o] ?? o }));
const VIZ_LABELS: Record<string, string> = { number: "Single number", line: "Line chart", bar: "Bar chart", category: "Category breakdown", table: "Table", progress: "Progress bar", funnel: "Funnel" };
const title = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * A numeric input backed by local text state, so the field can be cleared and retyped.
 * Empty input never snaps back to a forced value (the old `Number(x) || 1` bug), and
 * `min` is only applied to committed numbers — not while typing.
 */
function NumberField({ value, onChange, min, allowNull = false, placeholder, className }: { value: number | null | undefined; onChange: (n: number | null) => void; min?: number; allowNull?: boolean; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^-?\d*\.?\d*$/.test(t)) return;
        setText(t);
        if (t === "" || t === "-" || t === ".") {
          if (allowNull) onChange(null);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n)) onChange(min != null ? Math.max(min, n) : n);
      }}
      onBlur={() => {
        if (text.trim() === "" && !allowNull) setText(value == null ? "" : String(value));
      }}
      className={`${INPUT} ${className ?? ""}`}
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
  numberGroups,
  datasetCandidates,
  onChange,
  onRename,
  onTest,
  onAddNext,
  animClass = "flow-pop-in",
  branch,
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
  numberGroups: DataGroup[];
  datasetCandidates: StepRef[];
  branch: BranchCtx | null;
  onChange: (patch: Record<string, unknown>) => void;
  onRename: (v: string) => void;
  onTest: () => void;
  onAddNext: (anchor?: { x: number; y: number; leftX?: number }) => void;
  animClass?: string;
  onSetInput: (handle: "a" | "b", sourceId: string | null) => void;
  onSetSources: (ids: string[]) => void;
  onAddBranch: () => void;
  onRemoveBranch: (pathId: string) => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const status = computeNodeStatus({ type, cfg, inputCount, inputHandles: inputs.map((i) => i.targetHandle), lastTest: node.data.lastTest, dirty: node.data.dirty, updating: testing });
  const sm = STATUS_META[status];
  const err = node.data.lastTest?.status === "error" ? node.data.lastTest.error : null;
  const tested = status === "ready";
  const groups = toDataGroups(fieldGroups);

  // Two tabs: set the step up, then test it. Remounts per step (keyed on id), so a
  // freshly-opened step always starts on Configure.
  const [tab, setTab] = useState<"configure" | "test">("configure");

  // The step's OWN fields (from its last test) — used by pickers that configure the
  // step itself (Get data's "Match duplicates by"). Falls back to the canonical
  // fields before the first test so the picker is never empty.
  const selfT = node.data.lastTest;
  const selfFields =
    selfT?.status === "ok" && (selfT.outputSchema ?? []).length > 0
      ? (selfT.outputSchema ?? []).filter((f) => !f.path.startsWith("__")).map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container }))
      : Object.entries(STD_META).map(([path, m]) => ({ path, label: m.label, type: m.type }));
  const selfGroups: DataGroup[] = [
    { stepId: "self", stepNo, source: type === "app" ? String((cfg as { source?: unknown }).source ?? "") : undefined, title: "This step’s fields", fields: selfFields },
  ];

  return (
    <aside className={`absolute inset-y-0 right-0 z-20 m-4 flex w-[452px] flex-col overflow-hidden rounded-2xl bg-white flow-shadow ${animClass}`}>
      {/* Header — a soft grey band with the step's colourful icon, so it reads as a
          distinct "what am I editing" strip above the fields. */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200/70 bg-neutral-50 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <NodeIcon type={type} source={String((cfg as { source?: unknown }).source ?? "")} size={38} />
          <input
            value={node.data.label ?? ""}
            onChange={(e) => onRename(e.target.value)}
            placeholder={`${stepNo != null ? `${stepNo}. ` : ""}${defaultTitle(type, node.data)}`}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[17px] font-semibold text-neutral-900 hover:border-neutral-200 hover:bg-white focus:border-neutral-300 focus:bg-white focus:outline-none"
          />
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${sm.cls}`}>{sm.label}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-5 border-b border-neutral-200 bg-white px-5">
        {(["configure", "test"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 py-3 text-sm capitalize transition-colors ${
              tab === t ? "border-indigo-500 font-semibold text-neutral-900" : "border-transparent font-medium text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col p-5">
          {tab === "configure" ? (
            <>
              <NodeConfig
                type={type}
                cfg={cfg}
                connections={connections}
                groups={groups}
                selfGroups={selfGroups}
                inputs={inputs}
                numberGroups={numberGroups}
                datasetCandidates={datasetCandidates}
                branch={branch}
                onChange={onChange}
                onSetInput={onSetInput}
                onSetSources={onSetSources}
                onAddBranch={onAddBranch}
                onRemoveBranch={onRemoveBranch}
              />
              {!(branch && branch.mode !== "custom") && <NodeExtras type={type} cfg={cfg} groups={groups} onChange={onChange} />}
            </>
          ) : (
            <div className="space-y-4">
              {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}
              {node.data.lastTest?.status === "ok" ? (
                <TestResults node={node} onChange={onChange} />
              ) : (
                !err && (
                  <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-6 text-center">
                    <p className="text-sm font-medium text-neutral-700">{status === "setup" ? "Finish setting up this step first." : "Run the test to preview this step’s data."}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {status === "setup" ? "Fill in the fields on the Configure tab." : "See exactly what this step returns before you continue."}
                    </p>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-neutral-200 bg-white p-4">
        <Footer
          tab={tab}
          status={status}
          testing={testing}
          hasTest={!!node.data.lastTest}
          tested={tested}
          onContinueToTest={() => setTab("test")}
          onBackToConfigure={() => setTab("configure")}
          onTest={onTest}
          onAddNext={onAddNext}
        />
      </div>
    </aside>
  );
}

/**
 * The step's guided bottom action. On Configure: "Continue" advances to the Test
 * tab. On Test: "Test" runs it; once it passes, "Retest" + "Continue" (add the
 * next step). Wording and flow mirror Make.com's set-up → test → continue rhythm.
 */
function Footer({
  tab,
  status,
  testing,
  hasTest,
  tested,
  onContinueToTest,
  onBackToConfigure,
  onTest,
  onAddNext,
}: {
  tab: "configure" | "test";
  status: string;
  testing: boolean;
  hasTest: boolean;
  tested: boolean;
  onContinueToTest: () => void;
  onBackToConfigure: () => void;
  onTest: () => void;
  onAddNext: (anchor?: { x: number; y: number; leftX?: number }) => void;
}) {
  if (testing) {
    return (
      <button disabled className={`${BTN_PRIMARY} w-full`}>
        Testing…
      </button>
    );
  }

  if (tab === "configure") {
    return (
      <button onClick={onContinueToTest} disabled={status === "setup"} className={`${BTN_PRIMARY} w-full`}>
        {status === "setup" ? "Fill in the fields above" : "Continue"}
      </button>
    );
  }

  // Test tab.
  if (tested) {
    return (
      <div className="flex gap-3">
        <button onClick={onTest} className={`${BTN_SECONDARY} flex-1`}>
          Retest
        </button>
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onAddNext({ x: r.right, y: r.top + r.height / 2, leftX: r.left });
          }}
          className={`${BTN_PRIMARY} flex-1`}
        >
          Continue
        </button>
      </div>
    );
  }
  if (status === "setup") {
    return (
      <button onClick={onBackToConfigure} className={`${BTN_SECONDARY} w-full`}>
        ← Back to Configure
      </button>
    );
  }
  return (
    <button onClick={onTest} className={`${BTN_PRIMARY} w-full`}>
      {hasTest ? "Test again" : "Test"}
    </button>
  );
}

function NodeConfig({
  type,
  cfg,
  connections,
  groups,
  selfGroups,
  inputs,
  numberGroups,
  datasetCandidates,
  branch,
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
  selfGroups: DataGroup[];
  inputs: InputDescriptor[];
  numberGroups: DataGroup[];
  datasetCandidates: StepRef[];
  branch: BranchCtx | null;
  onChange: (patch: Record<string, unknown>) => void;
  onSetInput: (handle: "a" | "b", sourceId: string | null) => void;
  onSetSources: (ids: string[]) => void;
  onAddBranch: () => void;
  onRemoveBranch: (pathId: string) => void;
}) {

  if (type === "app") {
    const connId = (cfg.connectionId as string) ?? "";
    const conn = connections.find((c) => c.id === connId);
    return (
      <div className="space-y-5">
        {/* Which connected account this flow pulls from. */}
        <Field label="Account">
          <Select
            value={connId}
            width={W}
            placeholder="Choose an account…"
            options={connections.map((c) => ({ value: c.id, label: c.name, hint: c.source }))}
            onChange={(v) => {
              const c = connections.find((x) => x.id === v);
              // A different account invalidates the resource selection (its spreadsheet
              // ids, calendars… belong to the old account), so sourceConfig resets.
              onChange({ connectionId: c?.id ?? null, connectionName: c?.name ?? null, source: c?.source ?? null, eventType: null, sourceConfig: {} });
            }}
          />
          {connections.length === 0 && (
            <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              No connected accounts yet. Connect one in <a className="underline" href="/integrations">Integrations</a>.
            </p>
          )}
        </Field>

        {/* What to pull — set per flow. Stream-scoped sources (Sheets, Calendar,
            Calendly) pick their resource here via dropdowns. */}
        {conn && (
          <>
            {(catalogEntry(conn.source)?.flowFields ?? [])
              .filter((f) => {
                // A field can be gated on another field's current value (Calendly's Group
                // only shows once scope = A specific group).
                if (!f.showWhen) return true;
                const sc = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
                return String(sc[f.showWhen.key] ?? "") === f.showWhen.equals;
              })
              .map((f) => (
                <SourceConfigField key={f.key} field={f} conn={conn} cfg={cfg} onChange={onChange} />
              ))}
            <Field label="Which event">
              <Select
                value={typeof cfg.eventType === "string" ? (cfg.eventType as string) : "__none"}
                width={W}
                placeholder="Choose an event…"
                options={[{ value: "", label: "All events" }, ...(conn?.eventTypes ?? []).map((t) => ({ value: t, label: t }))]}
                onChange={(v) => onChange({ eventType: v })}
              />
            </Field>

            <DedupeSection cfg={cfg} fallbackGroups={selfGroups} onChange={onChange} />
          </>
        )}
      </div>
    );
  }

  if (type === "filter") {
    const fc = asFilterConfig(cfg);
    const bmode = branch?.mode ?? "custom";
    return (
      <div className="space-y-4">
        {/* A branch head chooses how records enter its path (Zapier-style): custom
            rules, always run, or fallback. The mode is stored on the hub's path entry. */}
        {branch && (
          <div className="space-y-2">
            <SectionLabel>How records enter this path</SectionLabel>
            <Select
              value={bmode}
              width={W}
              options={[
                { value: "custom", label: "Custom rules", hint: "Only records matching the conditions below." },
                {
                  value: "always",
                  label: "Always run",
                  disabled: branch.siblingHasFallback,
                  hint: branch.siblingHasFallback ? "Not with a fallback branch." : "Every record continues.",
                },
                {
                  value: "fallback",
                  label: "Fallback",
                  disabled: branch.siblingHasFallback || branch.siblingHasAlways,
                  hint: branch.siblingHasFallback
                    ? "Another branch is the fallback."
                    : branch.siblingHasAlways
                      ? "Not with an always-run branch."
                      : "Records no other path matched.",
                },
              ]}
              onChange={(v) => branch.set(v)}
            />
          </div>
        )}
        {bmode === "custom" ? (
          <div className="space-y-2.5">
            <SectionLabel>Only continue if…</SectionLabel>
            <ConditionEditor value={fc} groups={groups} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />
          </div>
        ) : (
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[13px] text-neutral-600">
            {bmode === "always" ? "Every record continues — no conditions needed." : "Gets the records no other path matched."}
          </p>
        )}
      </div>
    );
  }

  if (type === "time") {
    const mode = (cfg.mode as string) ?? "preset";
    return (
      <div className="space-y-4">
        <Field label="Date field">
          <FieldInput value={(cfg.dateField as string) ?? "occurredAt"} groups={groups} onChange={(v) => onChange({ dateField: v })} />
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
            <NumberField value={Number(cfg.days ?? 30)} min={1} onChange={(n) => onChange({ days: n ?? 1 })} />
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
    const datasetOp = isDatasetFormulaOp(op);
    const labels = formulaHandleLabels(op);
    const inA = inputs.find((i) => i.targetHandle === "a");
    const inB = inputs.find((i) => i.targetHandle === "b");
    const aFixed = typeof cfg.aFixed === "number" ? cfg.aFixed : null;
    const bFixed = typeof cfg.bFixed === "number" ? cfg.bFixed : null;
    const gb = (cfg.groupBy as { type?: string; unit?: string } | null) ?? null;
    const fieldPath = String((op === "count_distinct" ? cfg.distinctField : cfg.field) ?? (op === "count_distinct" ? "subject" : "value"));
    const fieldLabel = groups.flatMap((g) => g.fields).find((f) => f.path === fieldPath)?.label ?? humanizeKey(fieldPath);
    const setOp = (v: string) => {
      onChange({ op: v });
      // Numbers play no part in a dataset aggregation — clear any wired slots so
      // stray a/b reference edges never linger on the canvas.
      if (isDatasetFormulaOp(v) && !datasetOp) {
        if (inA) onSetInput("a", null);
        if (inB) onSetInput("b", null);
      }
    };
    return (
      <div className="space-y-4">
        <Field label="Calculation">
          <Select value={op} width={W} options={FORMULA_OP_OPTIONS} onChange={setOp} />
        </Field>
        <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
          <p className="font-medium">
            {datasetOp
              ? datasetCalcExpression(op, op === "count" ? "records" : fieldLabel)
              : formulaExpression(op, inA?.title ?? (aFixed != null ? String(aFixed) : "First number"), inB?.title ?? (bFixed != null ? String(bFixed) : "Second number"))}
          </p>
        </div>
        {datasetOp ? (
          <>
            {(op === "sum" || op === "avg" || op === "min" || op === "max") && (
              <Field label="Field to calculate">
                <FieldInput value={String(cfg.field ?? "value")} groups={groups} onChange={(v) => onChange({ field: v })} placeholder="Pick the number field…" />
              </Field>
            )}
            {op === "count_distinct" && (
              <Field label="Count unique values of">
                <FieldInput value={String(cfg.distinctField ?? "subject")} groups={groups} onChange={(v) => onChange({ distinctField: v })} />
              </Field>
            )}
            <Field label="Split over time?">
              <Select
                value={gb?.type === "time" ? "time" : "none"}
                width={W}
                options={[{ value: "none", label: "No — one total number" }, { value: "time", label: "Yes — a trend over time" }]}
                onChange={(m) => onChange({ groupBy: m === "time" ? { type: "time", unit: "day" } : null })}
              />
            </Field>
            {gb?.type === "time" && (
              <Field label="Period">
                <Select value={gb.unit ?? "day"} width={W} options={TIME_UNITS.map((u) => ({ value: u, label: title(u) }))} onChange={(v) => onChange({ groupBy: { type: "time", unit: v } })} />
              </Field>
            )}
          </>
        ) : (
          <>
            <NumberPicker handle="a" label={labels.a} desc={inA} groups={numberGroups} fixed={aFixed} onSetInput={onSetInput} onSetFixed={(n) => onChange({ aFixed: n })} />
            <NumberPicker handle="b" label={labels.b} desc={inB} groups={numberGroups} fixed={bFixed} onSetInput={onSetInput} onSetFixed={(n) => onChange({ bFixed: n })} />
          </>
        )}
      </div>
    );
  }

  if (type === "unite") {
    // Unite is pure flow shape: pick which lanes flow into it. Its edges ARE the lanes.
    const laneIds = inputs.map((i) => i.nodeId);
    return (
      <div className="space-y-4">
        <p className="text-xs text-neutral-500">Joins lanes into one line — later steps see data from all of them.</p>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Lanes</p>
          <div className="space-y-1.5">
            {inputs.map((inp, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={inp.nodeId}
                  width={320}
                  placeholder="Choose a step…"
                  options={datasetCandidates.filter((c) => c.id === inp.nodeId || !laneIds.includes(c.id)).map((c) => ({ value: c.id, label: `${c.stepNo != null ? `${c.stepNo}. ` : ""}${c.title}` }))}
                  onChange={(v) => onSetSources(laneIds.map((x, i) => (i === idx ? v : x)))}
                />
                <button type="button" onClick={() => onSetSources(laneIds.filter((_, i) => i !== idx))} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                  Remove
                </button>
              </div>
            ))}
            {laneIds.length < datasetCandidates.length && (
              <button
                type="button"
                onClick={() => {
                  const avail = datasetCandidates.find((c) => !laneIds.includes(c.id));
                  if (avail) onSetSources([...laneIds, avail.id]);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-800"
              >
                <span className="text-sm leading-none">+</span> Add a lane
              </button>
            )}
            {datasetCandidates.length === 0 && inputs.length === 0 && <p className="text-xs text-neutral-400">Add data steps first.</p>}
          </div>
        </div>
      </div>
    );
  }

  if (type === "paths") {
    // The hub configures NOTHING except its branches. How records enter a branch
    // (custom rules / always run / fallback) is chosen inside that branch's own
    // "Path conditions" step — exactly where the rules live.
    const paths = (cfg.paths as Array<{ id: string; label: string; mode?: string }>) ?? [];
    const setLabel = (i: number, label: string) => onChange({ paths: paths.map((p, j) => (j === i ? { ...p, label } : p)) });
    return (
      <div className="space-y-4">
        <p className="text-xs text-neutral-500">Splits the flow into branches. Each branch’s rules live in its own <b>Path conditions</b> step.</p>
        {paths.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border border-pink-200 bg-pink-50/40 px-2 py-1.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-pink-700">Branch {i + 1}</span>
            <input value={p.label} onChange={(e) => setLabel(i, e.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium" />
            {(p.mode ?? "custom") !== "custom" && (
              <span className="shrink-0 rounded bg-pink-100 px-1.5 py-0.5 text-[10px] font-medium text-pink-700">{p.mode === "always" ? "always runs" : "fallback"}</span>
            )}
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
      <div className="space-y-4">
        <Field label="Group by">
          <Select value={mode} width={W} options={[{ value: "field", label: "A field value" }, { value: "categories", label: "Custom categories" }]} onChange={(v) => onChange({ mode: v })} />
        </Field>
        {mode === "field" && <Field label="Field"><FieldInput value={(cfg.field as string) ?? "source"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
        {mode === "categories" && <CategoryEditor cfg={cfg} groups={groups} onChange={onChange} />}
        <Field label="Value per group">
          <Select value={agg} width={W} options={[{ value: "count", label: "Count" }, { value: "sum", label: "Sum of a field" }, { value: "count_distinct", label: "Count distinct" }]} onChange={(v) => onChange({ aggregation: v })} />
        </Field>
        {agg === "sum" && <Field label="Sum field"><FieldInput value={(cfg.valueField as string) ?? "value"} groups={groups} onChange={(v) => onChange({ valueField: v })} /></Field>}
      </div>
    );
  }

  if (type === "calculate") {
    const mode = String(cfg.mode ?? "number");
    return (
      <div className="space-y-4">
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
        {mode === "compare" && <CalcCompare cfg={cfg} inputs={inputs} numberGroups={numberGroups} onChange={onChange} onSetInput={onSetInput} />}
      </div>
    );
  }

  // output (legacy)
  return (
    <div className="space-y-4">
      <Field label="Metric name"><input value={(cfg.name as string) ?? ""} onChange={(e) => onChange({ name: e.target.value })} className={INPUT} /></Field>
      <Field label="Display as"><Select value={(cfg.viz as string) ?? "number"} width={W} options={VIZ_TYPES.map((v) => ({ value: v, label: VIZ_LABELS[v] ?? title(v) }))} onChange={(v) => onChange({ viz: v })} /></Field>
      <Field label="Format"><Select value={(cfg.format as string) ?? "number"} width={W} options={[{ value: "number", label: "Number" }, { value: "percent", label: "Percentage" }, { value: "currency", label: "Currency" }]} onChange={(v) => onChange({ format: v })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit"><input value={(cfg.unit as string) ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className={INPUT} /></Field>
        <Field label="Decimals"><NumberField value={Number(cfg.precision ?? 0)} min={0} onChange={(n) => onChange({ precision: n ?? 0 })} /></Field>
      </div>
      <Field label="Goal / target (optional)"><NumberField value={cfg.target != null ? Number(cfg.target) : null} allowNull onChange={(n) => onChange({ target: n })} /></Field>
    </div>
  );
}

/** The Count step (aggregate executor): turn records into one number, optionally a trend. */
function CalcNumber({ cfg, groups, onChange }: { cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const agg = String(cfg.aggregation ?? "count");
  const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string } | null) ?? null;
  return (
    <>
      <Field label="Calculation">
        <Select value={agg} width={W} options={AGGREGATIONS.map((a) => ({ value: a, label: AGG_LABELS[a] ?? title(a) }))} onChange={(v) => onChange({ aggregation: v })} />
      </Field>
      {(agg === "sum" || agg === "avg" || agg === "min" || agg === "max") && <Field label="Number field"><FieldInput value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
      {agg === "count_distinct" && <Field label="Distinct by"><FieldInput value={(cfg.distinctField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ distinctField: v })} /></Field>}
      <Field label="Split over time?">
        <Select
          value={gb?.type === "time" ? "time" : "none"}
          width={W}
          options={[{ value: "none", label: "No — one total number" }, { value: "time", label: "Yes — a trend over time" }]}
          onChange={(m) => onChange({ groupBy: m === "time" ? { type: "time", unit: "day" } : null })}
        />
      </Field>
      {gb?.type === "time" && <Field label="Period"><Select value={gb.unit ?? "day"} width={W} options={TIME_UNITS.map((u) => ({ value: u, label: title(u) }))} onChange={(v) => onChange({ groupBy: { type: "time", unit: v } })} /></Field>}
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
      {bmode === "field" && <Field label="Field"><FieldInput value={(cfg.breakdownField as string) ?? "source"} groups={groups} onChange={(v) => onChange({ breakdownField: v })} /></Field>}
      {bmode === "categories" && <CategoryEditor cfg={cfg} groups={groups} onChange={onChange} />}
      <Field label="Value per group">
        <Select value={agg} width={W} options={[{ value: "count", label: "Count" }, { value: "sum", label: "Sum of a field" }, { value: "count_distinct", label: "Count distinct" }]} onChange={(v) => onChange({ aggregation: v })} />
      </Field>
      {agg === "sum" && <Field label="Sum field"><FieldInput value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
    </>
  );
}

/** Calculate → compare two numbers: pick from earlier steps or type literals. */
function CalcCompare({ cfg, inputs, numberGroups, onChange, onSetInput }: { cfg: Record<string, unknown>; inputs: InputDescriptor[]; numberGroups: DataGroup[]; onChange: (p: Record<string, unknown>) => void; onSetInput: (h: "a" | "b", id: string | null) => void }) {
  const op = String(cfg.op ?? "percentage");
  const labels = formulaHandleLabels(op);
  const inA = inputs.find((i) => i.targetHandle === "a");
  const inB = inputs.find((i) => i.targetHandle === "b");
  const aFixed = typeof cfg.aFixed === "number" ? cfg.aFixed : null;
  const bFixed = typeof cfg.bFixed === "number" ? cfg.bFixed : null;
  return (
    <>
      <Field label="Calculation">
        <Select value={op} width={W} options={BINARY_OP_OPTIONS} onChange={(v) => onChange({ op: v })} />
      </Field>
      <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
        <p className="font-medium">{formulaExpression(op, inA?.title ?? (aFixed != null ? String(aFixed) : "First number"), inB?.title ?? (bFixed != null ? String(bFixed) : "Second number"))}</p>
      </div>
      <NumberPicker handle="a" label={labels.a} desc={inA} groups={numberGroups} fixed={aFixed} onSetInput={onSetInput} onSetFixed={(n) => onChange({ aFixed: n })} />
      <NumberPicker handle="b" label={labels.b} desc={inB} groups={numberGroups} fixed={bFixed} onSetInput={onSetInput} onSetFixed={(n) => onChange({ bFixed: n })} />
    </>
  );
}

/**
 * A compare step's number input: type a literal number directly, or use the data
 * icon INSIDE the input to pick an earlier step's number instead (a scalar step's
 * Result, or a dataset step's Output number — its record count, e.g. "56 passed").
 * The browser opens aligned under the input, extending left over the canvas.
 */
function NumberPicker({
  handle,
  label,
  desc,
  groups,
  fixed,
  onSetInput,
  onSetFixed,
}: {
  handle: "a" | "b";
  label: string;
  desc?: InputDescriptor;
  groups: DataGroup[];
  fixed: number | null;
  onSetInput: (h: "a" | "b", id: string | null) => void;
  onSetFixed: (n: number | null) => void;
}) {
  const chosen = groups.find((g) => g.stepId === desc?.nodeId);
  const chosenLabel = chosen ? `${chosen.stepNo != null ? `${chosen.stepNo}. ` : ""}${chosen.title}` : desc ? desc.title : null;
  // The group sample is already the right number per step type (a scalar step's Result,
  // a dataset step's record count). Never fall back to recordCount — that shows a scalar
  // step's meaningless "1 record" instead of its actual value.
  const preview = chosen?.fields[0]?.sample ?? desc?.value;
  return (
    <Field label={label}>
      <DataBrowser
        groups={groups}
        onPick={(ref) => {
          onSetInput(handle, ref.producerStepId);
          onSetFixed(null);
        }}
        trigger={({ toggle }) => (
          <div className="relative">
            {desc ? (
              <div className="flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-neutral-50 py-1.5 pl-2 pr-14 text-sm">
                <span className="min-w-0 truncate text-neutral-800">{chosenLabel}</span>
                <button
                  type="button"
                  onClick={() => onSetInput(handle, null)}
                  className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"
                  title="Clear — type a number instead"
                  aria-label="Clear the picked step"
                >
                  ✕
                </button>
              </div>
            ) : (
              <NumberField value={fixed} allowNull placeholder="Type a number…" onChange={onSetFixed} className="pr-9" />
            )}
            <button
              type="button"
              onClick={toggle}
              title="Use a number from an earlier step"
              aria-label="Pick a number from an earlier step"
              className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <DataIcon />
            </button>
          </div>
        )}
      />
      {desc && preview != null && <p className="mt-1 text-xs text-neutral-500">= {String(preview)}</p>}
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

/**
 * One flow-level resource field of a Get data step (which spreadsheet, which tab…).
 * Dynamic fields list live choices from the provider via the connection's credentials;
 * dependent fields stay disabled until their prerequisites are chosen, and changing a
 * prerequisite resets them. If listing fails, a manual text input takes over so the
 * step is never dead-ended.
 */
/**
 * Session cache of a resource id → its friendly name (e.g. a spreadsheet id →
 * "NAMZI Cabal Leads"), so re-opening a Get data step shows the name instantly
 * instead of flashing the raw id while the option list re-fetches.
 */
const sourceLabelCache = new Map<string, string>();

function SourceConfigField({ field, conn, cfg, onChange }: { field: FlowConfigField; conn: ConnMeta; cfg: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
  const value = String(sourceConfig[field.key] ?? "");
  const deps = field.dependsOn ?? [];
  const depsReady = deps.every((d) => String(sourceConfig[d] ?? "").trim() !== "");
  // The connection id is part of the fetch signature: switching the Account MUST
  // refetch, so the list always shows the selected account's own resources — never
  // a stale list from the previously selected one.
  const depsSignature = [conn.id, ...deps.map((d) => String(sourceConfig[d] ?? ""))].join(" ");

  const [state, setState] = useState<{ sig: string | null; status: "idle" | "loading" | "ok" | "error"; options: Array<{ value: string; label: string }>; error?: string }>({ sig: null, status: "idle", options: [] });

  useEffect(() => {
    if (!field.dynamic || !depsReady) return;
    if (state.sig === depsSignature && state.status !== "idle") return;
    let cancelled = false;
    setState({ sig: depsSignature, status: "loading", options: [] });
    void listSourceOptionsAction(conn.id, field.key, sourceConfig).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        // Remember every id→label so the next open resolves the name with no flash.
        for (const o of r.options) sourceLabelCache.set(`${conn.id}:${field.key}:${o.value}`, o.label);
        setState({ sig: depsSignature, status: "ok", options: r.options });
      } else setState({ sig: depsSignature, status: "error", options: [], error: r.error });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.dynamic, field.key, conn.id, depsReady, depsSignature]);

  const entry = catalogEntry(conn.source);
  const set = (v: string) => {
    const next: Record<string, unknown> = { ...sourceConfig, [field.key]: v };
    // Changing a prerequisite invalidates everything that depends on it.
    for (const other of entry?.flowFields ?? []) {
      if ((other.dependsOn ?? []).includes(field.key)) delete next[other.key];
    }
    onChange({ sourceConfig: next });
  };

  if (!depsReady) {
    return (
      <Field label={field.label}>
        <Select value="" options={[]} onChange={() => {}} width={W} disabled placeholder={`Choose ${deps.map((d) => entry?.flowFields?.find((f) => f.key === d)?.label ?? d).join(", ")} first…`} />
      </Field>
    );
  }

  // Listing failed (permissions, revoked scope…): manual entry keeps the step usable.
  if (field.dynamic && state.status === "error") {
    return (
      <Field label={field.label}>
        <input value={value} placeholder={field.placeholder} onChange={(e) => set(e.target.value)} className={INPUT} />
        <p className="mt-1 text-xs text-amber-700">Couldn’t list options ({state.error}). Paste the {field.label.toLowerCase()} manually.</p>
      </Field>
    );
  }

  const options = field.dynamic ? state.options : field.options ?? [];
  // Keep the saved value selectable even before/while the list loads — but NEVER
  // show the raw id. Prefer the cached friendly name; while it's still loading with
  // no cached name, drop the option so the "Loading…" placeholder shows instead.
  const cachedLabel = value ? sourceLabelCache.get(`${conn.id}:${field.key}:${value}`) : undefined;
  const needsCurrent = value && !options.some((o) => o.value === value);
  const withCurrent = needsCurrent
    ? cachedLabel
      ? [{ value, label: cachedLabel }, ...options]
      : field.dynamic && state.status === "loading"
        ? options
        : [{ value, label: value }, ...options]
    : options;

  return (
    <Field label={field.label}>
      <Select
        value={value}
        options={withCurrent}
        onChange={set}
        width={W}
        searchable
        placeholder={field.dynamic && state.status === "loading" ? "Loading…" : `Choose a ${field.label.toLowerCase()}…`}
      />
    </Field>
  );
}

/**
 * "Remove duplicates" on the Get data step — applied engine-side as the FIRST
 * thing when records load, so a duplicate never runs through the rest of the
 * flow. The match-field picker lists the step's REAL fields (the user's sheet
 * columns, webhook keys…), sampled live from its synced events — no test
 * needed first. Custom columns come first; canonical fields that carry data
 * follow, humanised.
 */
function DedupeSection({ cfg, fallbackGroups, onChange }: { cfg: Record<string, unknown>; fallbackGroups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const on = !!cfg.dedupe;
  const sig = JSON.stringify([cfg.connectionId ?? null, cfg.source ?? null, cfg.eventType ?? null, cfg.sourceConfig ?? {}]);
  const [state, setState] = useState<{ sig: string | null; status: "idle" | "loading" | "ok" | "error"; fields: AppFieldDTO[] }>({ sig: null, status: "idle", fields: [] });

  useEffect(() => {
    if (!on || state.sig === sig) return;
    let cancelled = false;
    setState({ sig, status: "loading", fields: [] });
    void listAppFieldsAction({
      connectionId: cfg.connectionId,
      source: cfg.source,
      eventType: cfg.eventType,
      sourceConfig: cfg.sourceConfig,
    } as Record<string, unknown>).then((r) => {
      if (cancelled) return;
      if (r.ok) setState({ sig, status: "ok", fields: r.fields });
      else setState({ sig, status: "error", fields: [] });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, sig]);

  // The user's own columns first, then canonical fields that actually carry data.
  const stdSet = new Set(Object.keys(STD_META));
  const custom = state.fields.filter((f) => !stdSet.has(f.path));
  const std = state.fields
    .filter((f) => stdSet.has(f.path) && f.example != null && f.example !== "")
    .map((f) => ({ ...f, label: STD_META[f.path]?.label ?? f.label, type: STD_META[f.path]?.type ?? f.type }));
  const loaded = [...custom, ...std];
  const groups: DataGroup[] =
    loaded.length > 0
      ? [
          {
            stepId: "self",
            source: (typeof cfg.source === "string" && cfg.source) || undefined,
            title: "This step’s data",
            fields: loaded.map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container })),
          },
        ]
      : fallbackGroups;

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-2.5">
      <button type="button" onClick={() => onChange({ dedupe: !on })} className="flex items-center gap-2 text-xs font-medium text-neutral-700">
        <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300"}`}>
          {on ? "✓" : ""}
        </span>
        Remove duplicates
      </button>
      {on ? (
        <>
          <Field label="Match duplicates by">
            <FieldInput value={(cfg.dedupeField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ dedupeField: v })} placeholder="Pick the field that identifies a duplicate…" />
          </Field>
          {state.status === "loading" && <p className="text-xs text-neutral-400">Loading your fields…</p>}
          {state.status === "ok" && loaded.length === 0 && (
            <p className="text-xs text-amber-700">No synced records yet — sync or test this step to see its fields.</p>
          )}
          <p className="text-xs text-neutral-400">
            Records sharing the same value count as one — the newest is kept, the rest are dropped before anything else runs.
          </p>
        </>
      ) : (
        <p className="text-xs text-neutral-400">Drop records that appear more than once, right as they load.</p>
      )}
    </div>
  );
}

const DATE_PRESETS: Array<{ value: string; label: string }> = TIME_PRESETS.map((p) => ({ value: p, label: title(p) }));

type DateRange = { enabled?: boolean; dateField?: string; mode?: "preset" | "rolling" | "between"; preset?: string; days?: number; from?: string; to?: string };

/** Node-specific extras that belong at the bottom, out of the main focus. */
function NodeExtras({ type, cfg, groups, onChange }: { type: NodeType; cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  if (type === "filter") return <DateRangeSection cfg={cfg} groups={groups} onChange={onChange} />;
  return null;
}

/** Optional "Date range" window for Filter (collapsed by default), maps to engine dateRange. */
function DateRangeSection({ cfg, groups, onChange }: { cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const dr = (cfg.dateRange as DateRange) ?? {};
  const [open, setOpen] = useState(!!dr.enabled);
  const enabled = !!dr.enabled;
  const mode = dr.mode ?? "preset";
  const set = (patch: Partial<DateRange>) =>
    onChange({ dateRange: { enabled, dateField: dr.dateField ?? "occurredAt", mode, preset: dr.preset ?? "last_30_days", days: dr.days ?? 30, from: dr.from, to: dr.to, ...patch } });
  // Only date fields make sense here; fall back to the built-in when none are known yet.
  const dateGroups: DataGroup[] = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.type === "date") }))
    .filter((g) => g.fields.length > 0);
  if (dateGroups.length === 0) dateGroups.push({ stepId: "builtin", title: "Built-in", fields: [{ path: "occurredAt", label: "When it happened", type: "date" }] });
  return (
    <div className="rounded-lg border border-neutral-200">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-neutral-600 hover:bg-neutral-50">
        <span>Date range {enabled ? "· on" : "· off"}</span>
        <span className="text-neutral-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-neutral-100 p-3">
          <button type="button" onClick={() => set({ enabled: !enabled })} className="flex items-center gap-2 text-xs text-neutral-700">
            <span className={`flex h-4 w-4 items-center justify-center rounded border ${enabled ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300"}`}>{enabled ? "✓" : ""}</span>
            Only include records inside a date window
          </button>
          {enabled && (
            <div className="space-y-2">
              <Field label="Date field">
                <FieldInput value={dr.dateField ?? "occurredAt"} groups={dateGroups} onChange={(v) => set({ dateField: v })} />
              </Field>
              <Field label="Window">
                <Select
                  value={mode}
                  width={W}
                  options={[{ value: "preset", label: "A preset range" }, { value: "rolling", label: "Last N days" }, { value: "between", label: "Between two dates" }]}
                  onChange={(v) => set({ mode: v as DateRange["mode"] })}
                />
              </Field>
              {mode === "preset" && <Field label="Range"><Select value={dr.preset ?? "last_30_days"} width={W} searchable options={DATE_PRESETS} onChange={(v) => set({ preset: v })} /></Field>}
              {mode === "rolling" && <Field label="Days"><NumberField value={dr.days ?? 30} min={1} onChange={(n) => set({ days: n ?? 1 })} /></Field>}
              {mode === "between" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From"><input type="date" value={dr.from ?? ""} onChange={(e) => set({ from: e.target.value })} className={INPUT} /></Field>
                  <Field label="To"><input type="date" value={dr.to ?? ""} onChange={(e) => set({ to: e.target.value })} className={INPUT} /></Field>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
    <div className="space-y-3 text-sm">
      <SectionLabel>Result</SectionLabel>
      <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center text-base font-semibold text-neutral-900">{resultLabel(type, t)}</p>
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
      <span className="mb-1.5 block text-[13px] font-medium text-neutral-700">{label}</span>
      {children}
    </div>
  );
}

/** A small uppercase section heading, matching the step picker's group labels. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{children}</p>;
}

