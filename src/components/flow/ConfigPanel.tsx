"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogEntry, eventTypeLabel, eventTypeOptions, fieldAppliesToEventType, type FlowConfigField } from "@/connectors/catalog";
import {
  importStatusAction,
  listAppFieldsAction,
  listRecordTypesAction,
  listSourceOptionsAction,
  streamDateColumnAction,
  type AppFieldDTO,
} from "@/app/dashboard/flows/actions";
import type { DateColumnChoice } from "@/lib/sync/date-column";
import type { ImportStatus } from "@/lib/sync/import-status";
import type { SourceOption } from "@/connectors/types";
import {
  AGGREGATIONS,
  aggregationInputs,
  DURATION_UNITS,
  fieldNamesItsUnit,
  TIME_UNITS,
  VIZ_TYPES,
  TIME_PRESETS,
  FORMULA_OPS,
  isDatasetFormulaOp,
  type NodeType,
} from "@/lib/flow/types";
import type { ConnMeta, FieldGroup, FNode, Filters, InputDescriptor } from "./graph-utils";
import { computeNodeStatus, STD_META } from "./graph-utils";
import { NumberField } from "./controls/NumberField";
import { STATUS_META, datasetCalcExpression, defaultTitle, formulaExpression, formulaHandleLabels, resultLabel } from "./node-meta";
import { RecordSamplePicker, recordWhen } from "./RecordSamplePicker";
import { DataIcon, NodeIcon } from "./icons";
import { Select, DataBrowser, FieldInput, ConditionEditor, humanizeKey } from "./controls";
import type { DataGroup } from "./controls/types";
import { prepareGroups, toDataGroups, momentGroups } from "./field-groups";
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

const AGG_LABELS: Record<string, string> = { count: "Count of records", count_distinct: "Count of distinct values", sum: "Sum of a field", avg: "Average of a field", median: "Median of a field", min: "Minimum of a field", max: "Maximum of a field" };
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
  median: "x̃  Median (middle value)",
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
  laneScopes,
  onChange,
  onRename,
  onTest,
  onTestUpstream,
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
  /** Cross-reference only: per-input lane scope (which steps' fields each side may offer). */
  laneScopes?: Record<string, string[]>;
  branch: BranchCtx | null;
  onChange: (patch: Record<string, unknown>) => void;
  onRename: (v: string) => void;
  onTest: () => void;
  /** Runs the previous step's test — the cure for an empty field picker. */
  onTestUpstream?: () => void;
  onAddNext: (anchor?: { x: number; y: number; leftX?: number }) => void;
  animClass?: string;
  onSetInput: (handle: "a" | "b", sourceId: string | null) => void;
  onSetSources: (ids: string[]) => void;
  onAddBranch: () => void;
  onRemoveBranch: (pathId: string) => void;
}) {
  const type = String(node.type) as NodeType;
  const cfg = node.data.config;
  const status = computeNodeStatus({ type, cfg, inputCount, inputHandles: inputs.map((i) => i.targetHandle), branchMode: branch?.mode ?? null, lastTest: node.data.lastTest, dirty: node.data.dirty, updating: testing });
  const sm = STATUS_META[status];
  const err = node.data.lastTest?.status === "error" ? node.data.lastTest.error : null;
  const tested = status === "ready";
  // Memoized: the field browser flattens these into a list that can run to
  // hundreds of entries, and a fresh array identity every render would
  // re-flatten on every keystroke in the panel.
  const groups = useMemo(() => toDataGroups(fieldGroups), [fieldGroups]);

  // Two tabs: set the step up, then test it. Remounts per step (keyed on id), so a
  // freshly-opened step always starts on Configure.
  const [tab, setTab] = useState<"configure" | "test">("configure");
  // A split hub has nothing to test — only Configure.
  const supportsTest = type !== "paths";
  const activeTab = supportsTest ? tab : "configure";

  // The step's OWN fields (from its last test) — used by pickers that configure the
  // step itself (Get data's "Match duplicates by"). Falls back to the canonical
  // fields before the first test so the picker is never empty.
  const selfT = node.data.lastTest;
  const selfFields =
    selfT?.status === "ok" && (selfT.outputSchema ?? []).length > 0
      ? (selfT.outputSchema ?? []).filter((f) => !f.path.startsWith("__")).map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container, populated: f.populated }))
      : Object.entries(STD_META).map(([path, m]) => ({ path, label: m.label, type: m.type }));
  // Through the same preparation as every other group, so a nested field is
  // findable here too and reads by the same raw name.
  const selfGroups: DataGroup[] = useMemo(
    () =>
      prepareGroups([
        { stepId: "self", stepNo, source: type === "app" ? String((cfg as { source?: unknown }).source ?? "") : undefined, title: "This step’s fields", fields: selfFields },
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stepNo, type, JSON.stringify(selfFields)],
  );

  return (
    <aside data-config-panel className={`absolute inset-y-0 right-0 z-20 m-4 flex w-[452px] flex-col overflow-hidden rounded-2xl bg-neutral-50 flow-shadow ${animClass}`}>
      {/* Header — a slightly darker grey band with the step's colourful icon, so it
          reads as a distinct "what am I editing" strip above the fields. */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200/70 bg-neutral-100 px-5 py-4">
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
      <div data-config-tabs className="flex gap-5 border-b border-neutral-200 bg-neutral-50 px-5">
        {(["configure", "test"] as const)
          .filter((t) => supportsTest || t === "configure")
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 py-3 text-sm capitalize transition-colors ${
                activeTab === t ? "border-indigo-500 font-semibold text-neutral-900" : "border-transparent font-medium text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t}
            </button>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col p-5">
          {activeTab === "configure" ? (
            <div className="space-y-5">
              <NodeConfig
                type={type}
                cfg={cfg}
                connections={connections}
                groups={groups}
                selfGroups={selfGroups}
                inputs={inputs}
                numberGroups={numberGroups}
                datasetCandidates={datasetCandidates}
                laneScopes={laneScopes}
                branch={branch}
                onChange={onChange}
                onTestUpstream={onTestUpstream}
                onSetInput={onSetInput}
                onSetSources={onSetSources}
                onAddBranch={onAddBranch}
                onRemoveBranch={onRemoveBranch}
              />
              {!(branch && branch.mode !== "custom") && <NodeExtras type={type} cfg={cfg} groups={groups} onChange={onChange} />}
            </div>
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

      <div className="border-t border-neutral-200 bg-neutral-50 p-4">
        <Footer
          tab={activeTab}
          status={status}
          testing={testing}
          hasTest={!!node.data.lastTest}
          supportsTest={supportsTest}
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
  supportsTest,
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
  supportsTest: boolean;
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
    // Untestable steps (split hub) continue straight on; the rest advance to Test.
    return (
      <button onClick={supportsTest ? onContinueToTest : () => onAddNext()} disabled={status === "setup"} className={`${BTN_PRIMARY} w-full`}>
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
        <button onClick={() => onAddNext()} className={`${BTN_PRIMARY} flex-1`}>
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
  laneScopes,
  branch,
  onChange,
  onTestUpstream,
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
  laneScopes?: Record<string, string[]>;
  branch: BranchCtx | null;
  onChange: (patch: Record<string, unknown>) => void;
  onTestUpstream?: () => void;
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
              // ids, calendars… belong to the old account), so sourceConfig resets —
              // UNLESS the new account is the SAME source (a template preset the
              // source and record type before any account existed; wiping them on
              // the pick would gut the template's wiring).
              const sameSource = c?.source != null && c.source === cfg.source;
              onChange({
                connectionId: c?.id ?? null,
                connectionName: c?.name ?? null,
                source: c?.source ?? null,
                eventType: sameSource ? (cfg.eventType ?? null) : null,
                sourceConfig: sameSource ? ((cfg.sourceConfig as Record<string, unknown>) ?? {}) : {},
              });
            }}
          />
          {connections.length === 0 && (
            <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              No connected accounts yet. Connect one in <a className="underline" href="/integrations">Integrations</a>.
            </p>
          )}
          {conn && <ImportStatusLine connectionId={conn.id} historyNote={catalogEntry(conn.source)?.historyNote} />}
        </Field>

        {/* What to pull — set per flow. Stream-scoped sources (Sheets, Calendar,
            Calendly) pick their resource here via dropdowns. */}
        {conn && (
          <>
            {(catalogEntry(conn.source)?.flowFields ?? [])
              .filter((f) => {
                // Two gates. A field can depend on another field's value
                // (Calendly's Group appears once scope = a specific group),
                // and a field can belong to ONE record kind (Close's Pipeline
                // exists only on opportunities — offering it elsewhere was a
                // guaranteed "0 loaded").
                if (!fieldAppliesToEventType(f, typeof cfg.eventType === "string" ? cfg.eventType : null)) return false;
                if (!f.showWhen) return true;
                const sc = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
                return String(sc[f.showWhen.key] ?? "") === f.showWhen.equals;
              })
              .map((f) => (
                <SourceConfigField key={f.key} field={f} conn={conn} cfg={cfg} onChange={onChange} />
              ))}
            {/* A sheet row has no timestamp of its own, so which column holds one
                is a question only the user can answer — and the answer belongs to
                the STREAM, because its rows are shared by every flow reading it. */}
            {conn.source === "gsheets" && <DateColumnField conn={conn} cfg={cfg} />}
            {/* "Record type" and not "event type": this is our canonical kind
                (booked / canceled / no_show), while a connector's own flowFields
                may offer the PROVIDER's event type — Calendly calls its meeting
                templates "event types". Two dropdowns reading "event" in one
                panel are indistinguishable. */}
            <RecordTypeField conn={conn} cfg={cfg} onChange={onChange} />

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

  if (type === "time_between") {
    return <TimeBetweenFields cfg={cfg} groups={groups} onChange={onChange} />;
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
    const useDistinct = aggregationInputs(op).distinctField;
    const fieldPath = String((useDistinct ? cfg.distinctField : cfg.field) ?? (useDistinct ? "subject" : "value"));
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
            <Field label="What are you calculating?">
              <Select
                value={String(cfg.resultKind ?? "number")}
                width={W}
                options={[
                  { value: "number", label: "A number" },
                  { value: "duration", label: "A length of time" },
                ]}
                onChange={(v) => onChange({ resultKind: v, ...(v === "duration" ? { groupBy: null } : {}) })}
              />
            </Field>
            {aggregationInputs(op).numberField && (
              <Field label="Field to calculate">
                <FieldInput value={String(cfg.field ?? "value")} groups={groups} onChange={(v) => onChange({ field: v })} placeholder="Pick the number field…" />
              </Field>
            )}
            {aggregationInputs(op).distinctField && (
              <Field label="Count unique values of">
                <FieldInput value={String(cfg.distinctField ?? "subject")} groups={groups} onChange={(v) => onChange({ distinctField: v })} />
              </Field>
            )}
            {/* A duration asks only how to READ it. What unit the numbers are
                counted in comes from the field — `time_between.minutes` says
                so itself — and is asked for only when the field stays silent.
                They used to be one dropdown, so changing it reported a
                different length of time for the same number. */}
            {String(cfg.resultKind ?? "number") === "duration" ? (
              <>
                {!fieldNamesItsUnit(String(cfg.field ?? "")) && (
                  <Field label="The numbers are in">
                    <Select
                      value={String(cfg.durationUnit ?? "minutes")}
                      width={W}
                      options={DURATION_UNITS.map((u) => ({ value: u, label: title(u) }))}
                      onChange={(v) => onChange({ durationUnit: v })}
                    />
                  </Field>
                )}
                <Field label="Show it as">
                  <Select
                    value={String(cfg.durationDisplay ?? "auto")}
                    width={W}
                    options={[
                      { value: "auto", label: "Whatever reads best" },
                      { value: "seconds", label: "Seconds" },
                      { value: "minutes", label: "Minutes and seconds" },
                      { value: "hours", label: "Hours, minutes and seconds" },
                      { value: "days", label: "Days, hours, minutes and seconds" },
                    ]}
                    onChange={(v) => onChange({ durationDisplay: v })}
                  />
                </Field>
              </>
            ) : (
              <>
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
    // Unite is flow shape first: pick which lanes flow into it (its edges ARE
    // the lanes) — then optionally MATCH the two lanes instead of stacking them.
    const laneIds = inputs.map((i) => i.nodeId);
    const matching = String(cfg.mode ?? "stack") === "match";
    // Rewiring a lane invalidates whatever was matched on it.
    const setLanes = (ids: string[]) => {
      onSetSources(ids);
      if (matching) {
        const keepId = String(cfg.keepNodeId ?? "");
        onChange({ keyField: "", lookupField: "", keepNodeId: ids.includes(keepId) ? keepId : "" });
      }
    };
    return (
      <div className="space-y-4">
        <p className="text-xs text-neutral-500">Brings branches and other data steps back together — later steps see records from all of them.</p>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Steps to combine</p>
          <div className="space-y-1.5">
            {inputs.map((inp, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={inp.nodeId}
                  width={320}
                  placeholder="Choose a step…"
                  options={datasetCandidates.filter((c) => c.id === inp.nodeId || !laneIds.includes(c.id)).map((c) => ({ value: c.id, label: `${c.stepNo != null ? `${c.stepNo}. ` : ""}${c.title}` }))}
                  onChange={(v) => setLanes(laneIds.map((x, i) => (i === idx ? v : x)))}
                />
                <button type="button" onClick={() => setLanes(laneIds.filter((_, i) => i !== idx))} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                  Remove
                </button>
              </div>
            ))}
            {laneIds.length < datasetCandidates.length && !(matching && laneIds.length >= 2) && (
              <button
                type="button"
                onClick={() => {
                  const avail = datasetCandidates.find((c) => !laneIds.includes(c.id));
                  if (avail) setLanes([...laneIds, avail.id]);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-800"
              >
                <span className="text-sm leading-none">+</span> Add another step
              </button>
            )}
            {datasetCandidates.length === 0 && inputs.length === 0 && <p className="text-xs text-neutral-400">Add a Get data step first, then combine it here.</p>}
          </div>
        </div>

        {/* The join option, where the sources come together. Off = stack everything. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-neutral-200 bg-white p-3">
          <input
            type="checkbox"
            checked={matching}
            onChange={(e) => onChange(e.target.checked ? { mode: "match" } : { mode: "stack" })}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-800">Only keep records that match across these steps</span>
            <span className="mt-0.5 block text-xs text-neutral-500">Like a lookup: keep one step&rsquo;s records only when a value from them also exists in the other step.</span>
          </span>
        </label>
        {matching && inputs.length !== 2 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Matching compares exactly two steps — this Combine has {inputs.length} wired in.
          </p>
        )}
        {matching && inputs.length === 2 && <CombineMatchFields cfg={cfg} groups={groups} inputs={inputs} datasetCandidates={datasetCandidates} laneScopes={laneScopes} onChange={onChange} />}
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
        {aggregationInputs(agg).numberField && <Field label="Sum field"><FieldInput value={(cfg.valueField as string) ?? "value"} groups={groups} onChange={(v) => onChange({ valueField: v })} /></Field>}
        {aggregationInputs(agg).distinctField && <Field label="Distinct by"><FieldInput value={(cfg.distinctField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ distinctField: v })} /></Field>}
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
      {aggregationInputs(agg).numberField && <Field label="Number field"><FieldInput value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
      {aggregationInputs(agg).distinctField && <Field label="Distinct by"><FieldInput value={(cfg.distinctField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ distinctField: v })} /></Field>}
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
      {aggregationInputs(agg).numberField && <Field label="Sum field"><FieldInput value={(cfg.field as string) ?? "value"} groups={groups} onChange={(v) => onChange({ field: v })} /></Field>}
      {aggregationInputs(agg).distinctField && <Field label="Distinct by"><FieldInput value={(cfg.distinctField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ distinctField: v })} /></Field>}
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
              <NumberField value={fixed} allowNull placeholder="Type a number…" onChange={onSetFixed} className="pr-11" />
            )}
            <button
              type="button"
              onClick={toggle}
              title="Use a number from an earlier step"
              aria-label="Pick a number from an earlier step"
              className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 p-1 text-indigo-500 transition-colors hover:border-indigo-300 hover:bg-indigo-100 hover:text-indigo-600"
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
          <ConditionEditor value={asFilterConfig((c.filters as unknown as Record<string, unknown>) ?? {})} groups={groups} onChange={(v) => setCat(i, { filters: { combinator: v.combinator, rules: v.rules } })} />
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

/**
 * Session cache of a connection's distinct record types, so re-opening a
 * panel renders instantly with the last known list while the fresh one loads.
 */
const recordTypeCache = new Map<string, string[]>();

/**
 * The Record type dropdown. Options are fetched when the panel opens — the
 * old list was a snapshot taken when the editor PAGE rendered, so a type
 * synced by the very Test the user just ran wouldn't appear until a full
 * browser reload, and the panel read "All record types" as if the source had
 * no data.
 *
 * Values stay the stored type strings; only labels go through
 * `eventTypeLabel`. The raw string rides along as the option hint so a user
 * matching against a Filter step or the API can still see the real value. A
 * saved value missing from the fresh list stays selectable — deselecting
 * someone's filter because a fetch was slow would silently widen their data.
 */
function RecordTypeField({
  conn,
  cfg,
  onChange,
}: {
  conn: ConnMeta;
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const [types, setTypes] = useState<string[]>(() => recordTypeCache.get(conn.id) ?? []);
  useEffect(() => {
    setTypes(recordTypeCache.get(conn.id) ?? []);
    let live = true;
    void listRecordTypesAction(conn.id).then((r) => {
      if (!live || !r.ok) return; // on error: keep cache/current value, never a dead field
      recordTypeCache.set(conn.id, r.types);
      setTypes(r.types);
    });
    return () => {
      live = false;
    };
  }, [conn.id]);

  const current = typeof cfg.eventType === "string" ? (cfg.eventType as string) : "";
  return (
    <Field label="Record type">
      <Select
        // "" is "All record types" — a real, selected answer. The old code
        // mapped null to "__none", which matched no option and showed the
        // "Choose…" placeholder as if the step were unconfigured.
        value={current}
        width={W}
        placeholder="Choose a record type…"
        // eventTypeOptions owns curation: hidden noise dropped, the saved
        // value always retained, labels humanized with the raw string as
        // hint, sorted by label.
        options={[{ value: "", label: "All record types" }, ...eventTypeOptions(conn.source, types, current || null)]}
        onChange={(v) => {
          // Drop any setting that belongs to the kind of record we just left
          // (a Pipeline chosen for opportunities means nothing on leads). The
          // engine ignores such a value anyway; clearing it keeps the saved
          // config honest about what the step is actually doing.
          const sc = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
          const stale = (catalogEntry(conn.source)?.flowFields ?? []).filter(
            (f) => f.key in sc && !fieldAppliesToEventType(f, v),
          );
          if (stale.length === 0) return onChange({ eventType: v });
          const next = { ...sc };
          for (const f of stale) delete next[f.key];
          onChange({ eventType: v, sourceConfig: next });
        }}
      />
    </Field>
  );
}

/**
 * Which column holds a row's event time.
 *
 * NOT part of `sourceConfig`, and that is the whole design. `occurred_at` is a
 * fact about a ROW; a stream's rows are shared by every flow reading the same
 * tab, so this cannot be a per-flow opinion. Stored on the stream, written
 * through its own action, and the copy below says what is actually happening —
 * first-seen is a defensible answer, first-seen presented as the event time is
 * not.
 */
function DateColumnField({ conn, cfg }: { conn: ConnMeta; cfg: Record<string, unknown> }) {
  const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
  const ready = typeof sourceConfig.spreadsheetId === "string" && sourceConfig.spreadsheetId !== "";
  const [choice, setChoice] = useState<DateColumnChoice>({ kind: "auto" });
  const [note, setNote] = useState<string>("");
  const [columns, setColumns] = useState<SourceOption[]>([]);
  const [busy, setBusy] = useState(false);
  const signature = JSON.stringify(sourceConfig);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void (async () => {
      const [settings, opts] = await Promise.all([
        streamDateColumnAction(conn.id, sourceConfig),
        listSourceOptionsAction(conn.id, "dateField", sourceConfig),
      ]);
      if (!live) return;
      setColumns(opts.ok ? opts.options : []);
      if (settings.ok) {
        setChoice(settings.choice);
        setNote(settings.note);
      }
    })();
    return () => {
      live = false;
    };
  }, [conn.id, ready, signature]);

  if (!ready) return null;

  const save = async (next: DateColumnChoice) => {
    setBusy(true);
    const res = await streamDateColumnAction(conn.id, sourceConfig, next);
    if (res.ok) {
      setChoice(res.choice);
      setNote(res.note);
    }
    setBusy(false);
  };

  /**
   * THREE answers, and "Detect automatically" is the default rather than a
   * feature. A sheet with an obvious date column sitting on import time until
   * somebody notices is broken by default, so the default has to be the fix.
   *
   * "Use import time" is a real answer, not the absence of one — picking it
   * stops the detector for good. And auto stays selectable, because an override
   * with no way back is a one-way door: a user who tries a column has to be able
   * to hand the question back.
   *
   * What the detector actually decided is in `note`, never in this control. The
   * control shows what was ANSWERED; a guess displayed as a selection is
   * indistinguishable from a choice the user made.
   */
  const value = choice.kind === "column" ? choice.column : choice.kind === "none" ? "__none" : "__auto";
  const pick = (v: string) =>
    void save(v === "__auto" ? { kind: "auto" } : v === "__none" ? { kind: "none" } : { kind: "column", column: v });

  return (
    <Field label="Date column">
      <Select
        value={value}
        width={W}
        disabled={busy}
        options={[
          { value: "__auto", label: "Detect automatically", hint: "Use a column that holds real dates, if exactly one does." },
          { value: "__none", label: "Use import time (no date column)" },
          ...columns,
        ]}
        onChange={pick}
      />
      <p className="mt-1.5 text-xs text-gray-500">
        Which column holds the date each row happened on. Applies to every flow reading this sheet.
      </p>
      <p className="mt-1 text-xs text-gray-600">{note}</p>
    </Field>
  );
}

/**
 * "Is more data still coming?" — answered under the Account picker, because
 * a number built while history is still loading is a number that will move.
 * Silent when there is nothing honest to say (see ImportStatus.unknown).
 */
const importStatusCache = new Map<string, ImportStatus>();
function ImportStatusLine({ connectionId, historyNote }: { connectionId: string; historyNote?: string }) {
  const [status, setStatus] = useState<ImportStatus | null>(() => importStatusCache.get(connectionId) ?? null);
  useEffect(() => {
    setStatus(importStatusCache.get(connectionId) ?? null);
    let live = true;
    void importStatusAction(connectionId).then((s) => {
      if (!live) return;
      importStatusCache.set(connectionId, s);
      setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [connectionId]);

  if (!status) return null;
  if (status.state === "done") {
    // "This is everything" is true of the provider's API and can still be
    // false of the ACCOUNT — Close forgets its own event log after ~30 days.
    // Without the note, a lead the CRM shows but we never received reads as
    // our sync losing data.
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-xs text-green-700">History imported — everything the source still offers.</p>
        {historyNote && <p className="text-xs text-neutral-500">{historyNote}</p>}
      </div>
    );
  }
  // Importing, or an import that ended without finishing. "unknown" with no
  // note is the no-evidence case and stays silent rather than guessing.
  if (!status.note) return null;
  return <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{status.note}</p>;
}

/**
 * Time between's Configure — the SAME controls as every other step: pick the
 * moment that starts the clock, pick the moment that stops it.
 *
 * It has now shed two bespoke designs. First two record-type dropdowns that
 * compared `eventType` by raw column; then two full Filter-style rule
 * builders, which made the simplest question in the product look like the
 * hardest. Both were the one step that did not work like the others.
 *
 * Only moments and numbers are offered, because those are the only things a
 * clock can be started on — a picker showing 480 Close fields when four of
 * them are dates is the same "where is my data" problem from the other end.
 */
/**
 * A matching Combine's questions, top to bottom as one sentence with no
 * hidden side: whose records continue, matched on which of their fields,
 * checked against which field of the other step. Each field picker is scoped
 * to ITS side's lane — offering the union would re-open the trap matching
 * exists to close, picking a field the chosen side's records never carry.
 */
function CombineMatchFields({
  cfg,
  groups,
  inputs,
  datasetCandidates,
  laneScopes,
  onChange,
}: {
  cfg: Record<string, unknown>;
  groups: DataGroup[];
  inputs: InputDescriptor[];
  datasetCandidates: StepRef[];
  laneScopes?: Record<string, string[]>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const keepId = String(cfg.keepNodeId ?? "");
  const matchMode = String(cfg.matchMode ?? "appears");
  const other = inputs.find((i) => i.nodeId !== keepId);
  const keepPicked = inputs.some((i) => i.nodeId === keepId);
  const scopeFor = (nodeId: string | undefined): DataGroup[] => {
    if (!nodeId) return [];
    const allowed = new Set(laneScopes?.[nodeId] ?? [nodeId]);
    return groups
      .map((g) => ({ ...g, fields: g.fields.filter((f) => !f.path.startsWith("__")) }))
      .filter((g) => allowed.has(g.stepId) && g.fields.length > 0);
  };
  const stepLabel = (id: string) => {
    const c = datasetCandidates.find((x) => x.id === id);
    const inp = inputs.find((i) => i.nodeId === id);
    return c ? `${c.stepNo != null ? `${c.stepNo}. ` : ""}${c.title}` : inp?.title ?? id;
  };
  return (
    <div className="space-y-4">
      <Field label="Keep records from">
        <Select
          value={keepPicked ? keepId : ""}
          width={W}
          placeholder="Choose whose records continue…"
          options={inputs.map((i) => ({ value: i.nodeId, label: stepLabel(i.nodeId) }))}
          // Flipping sides swaps BOTH lanes, so both picked fields go with it.
          onChange={(v) => onChange({ keepNodeId: v, keyField: "", lookupField: "" })}
        />
      </Field>
      {keepPicked && (
        <>
          <Field label="Matching on its field">
            <FieldInput value={String(cfg.keyField ?? "")} groups={scopeFor(keepId)} onChange={(v) => onChange({ keyField: v })} placeholder="Pick the field to look up…" />
          </Field>
          <Field label="Keep a record when its value">
            <Select
              value={matchMode}
              width={W}
              options={[
                { value: "appears", label: `Appears in ${other ? stepLabel(other.nodeId) : "the other step"}` },
                { value: "missing", label: `Doesn't appear in ${other ? stepLabel(other.nodeId) : "the other step"}` },
              ]}
              onChange={(v) => onChange({ matchMode: v })}
            />
          </Field>
          {other && (
            <Field label={`In ${stepLabel(other.nodeId)}’s field`}>
              <FieldInput value={String(cfg.lookupField ?? "")} groups={scopeFor(other.nodeId)} onChange={(v) => onChange({ lookupField: v })} placeholder="Pick the field holding the values…" />
            </Field>
          )}
          <p className="text-xs text-neutral-400">
            Matching ignores capitalization and extra spaces. A record with a blank value can never match{matchMode === "appears" ? ", so it is dropped." : ", so it is kept."}
          </p>
        </>
      )}
    </div>
  );
}

function TimeBetweenFields({
  cfg,
  groups,
  onChange,
}: {
  cfg: Record<string, unknown>;
  groups: DataGroup[];
  onChange: (p: Record<string, unknown>) => void;
}) {
  const timeGroups = useMemo(() => momentGroups(groups), [groups]);
  const keyGroups = useMemo(
    () => groups.map((g) => ({ ...g, fields: g.fields.filter((f) => !f.path.startsWith("__")) })).filter((g) => g.fields.length > 0),
    [groups],
  );
  return (
    <div className="space-y-4">
      <Field label="Match records by">
        {/* Not the raw `groups`: they include a step's "Output number"
            (`__count_<id>`), which is the same on every row. Picking it makes
            every record one group, so the whole dataset collapses to a single
            pair and reports one plausible duration. */}
        <FieldInput value={String(cfg.keyField ?? "")} groups={keyGroups} onChange={(v) => onChange({ keyField: v })} />
      </Field>
      <Field label="Start the clock on">
        <MomentInput
          path={String(cfg.startField ?? "")}
          stepId={String(cfg.startStep ?? "")}
          groups={timeGroups}
          onChange={(startField, startStep) => onChange({ startField, startStep })}
        />
      </Field>
      <Field label="Stop the clock on">
        <MomentInput
          path={String(cfg.endField ?? "")}
          stepId={String(cfg.endStep ?? "")}
          groups={timeGroups}
          onChange={(endField, endStep) => onChange({ endField, endStep })}
        />
      </Field>
    </div>
  );
}

/**
 * A picked moment: the field path AND the step that produced it.
 *
 * The step is not decoration. After a Combine, leads and calls both carry
 * `occurredAt`, so "Step 1 › occurredAt" and "Step 2 › occurredAt" are the
 * same path and different data — the group the row was picked from is the
 * only thing that tells them apart, and the engine matches records by the
 * same step stamp.
 */
function MomentInput({
  path,
  stepId,
  groups,
  onChange,
}: {
  path: string;
  stepId: string;
  groups: DataGroup[];
  onChange: (path: string, stepId: string) => void;
}) {
  const group = groups.find((g) => g.stepId === stepId);
  const label = path ? group?.fields.find((f) => f.path === path)?.label ?? path : null;
  const from = group ? `${group.stepNo ? `${group.stepNo}. ` : ""}${group.title}` : null;
  return (
    <DataBrowser
      groups={groups}
      onPick={(ref) => onChange(ref.fieldPath, ref.producerStepId)}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="relative w-full rounded-lg border border-neutral-300 bg-white py-2 pl-3 pr-9 text-left text-sm transition-colors hover:border-neutral-400 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        >
          {label ? (
            <span className="block truncate text-neutral-800">
              {from ? <span className="text-neutral-400">{from} › </span> : null}
              {label}
            </span>
          ) : (
            <span className="block truncate text-neutral-400">Choose a time…</span>
          )}
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden>
            ▾
          </span>
        </button>
      )}
    />
  );
}

/**
 * What "Remove duplicates" actually did, in one sentence, every time.
 *
 * A ticked box that removes nothing looks exactly like a ticked box that
 * found no duplicates, and the existing E.7 warning cannot tell them apart:
 * it fires on a field with too FEW distinct values, but a field that appears
 * on no record at all has none, so it stays silent. That is how matching
 * Close calls on `data.number` — a field belonging to Close's phone-number
 * object, offered because the picker lists every field on the connection —
 * removed zero rows with nothing on screen saying so.
 */
function DedupeOutcome({ d }: { d: { field: string; keep?: string; orderField?: string; loaded: number; matched: number; ordered?: number; removed: number; groups?: number } }) {
  const name = d.field.replace(/^properties\./, "");
  const orderName = (d.orderField ?? "occurredAt").replace(/^properties\./, "");
  if (d.matched === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        Nothing was removed: <span className="font-medium">{name}</span> is empty on all {d.loaded.toLocaleString()} records here, so there was nothing to match on. Pick a
        field these records actually carry.
      </p>
    );
  }
  // The field is a CATEGORY, not an identity: a handful of distinct values
  // swallowing almost every record. Measured on this run — the old warning
  // judged from connection-wide registry stats and could sit directly above a
  // receipt saying the opposite about the same step.
  if (d.removed > 0 && d.groups != null && d.matched >= 100 && d.groups < d.matched * 0.05) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        Matching by <span className="font-medium">{name}</span> collapsed {d.removed.toLocaleString()} of {d.matched.toLocaleString()} records into just{" "}
        {d.groups.toLocaleString()} — it looks like a category, not an identity. If you meant one record per person, pick a field that identifies one (an email or an id).
      </p>
    );
  }
  const partial = d.matched < d.loaded ? ` ${(d.loaded - d.matched).toLocaleString()} records had no ${name} and were all kept.` : "";
  // Nothing was orderable, so the survivor is whichever loaded first — saying
  // "kept the earliest occurredAt" here would be a plain untruth.
  if (d.removed > 0 && d.ordered === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        Removed {d.removed.toLocaleString()} record{d.removed === 1 ? "" : "s"}, but <span className="font-medium">{orderName}</span> is empty on all of them — so which one survived was arbitrary. Pick a
        field that orders these records.
      </p>
    );
  }
  return (
    <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs text-neutral-600">
      {d.removed === 0
        ? `No duplicates found — every ${name} was different.`
        : `Removed ${d.removed.toLocaleString()} record${d.removed === 1 ? "" : "s"}, keeping the ${d.keep === "earliest" ? "earliest" : "latest"} ${orderName} of each ${name}.`}
      {partial}
    </p>
  );
}

/**
 * What pairing actually did. Time between emits nothing for a key that never
 * got a stop moment, so "median speed to lead" is quietly a median over the
 * leads that were eventually called — a better-sounding number than the truth,
 * with nothing on screen to say the denominator shrank.
 */
function PairingOutcome({ p }: { p: { keys: number; started: number; matched: number; noStop: number; stopBeforeStart: number } }) {
  // No records at all is a quiet week, not a mistake — the same distinction
  // the aggregations make between an empty window and a wrong field.
  if (p.keys === 0) return null;
  if (p.started === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        Nothing was paired: none of the {p.keys.toLocaleString()} matched groups had a start time. Check the field picked for “Start the clock on”.
      </p>
    );
  }
  const bits = [`${p.matched.toLocaleString()} of ${p.started.toLocaleString()} matched a stop time`];
  if (p.noStop > 0) bits.push(`${p.noStop.toLocaleString()} never got one`);
  if (p.stopBeforeStart > 0) bits.push(`${p.stopBeforeStart.toLocaleString()} only had one before the start`);
  return (
    <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs text-neutral-600">
      {bits.join(", ")}. The rest are not in this number.
    </p>
  );
}

/**
 * What Cross-reference actually did. "8 kept" against a list that supplied
 * zero values is the silent version of the bug this step replaces — so the
 * list size, the blanks, and where every record went are part of the answer.
 */
function CrossRefOutcome({ c }: { c: { mode: string; keyField: string; lookupField: string; checked: number; kept: number; dropped: number; blanks: number; listSize: number; listBlanks: number } }) {
  const key = c.keyField.replace(/^properties\./, "");
  const lookup = c.lookupField.replace(/^properties\./, "");
  if (c.checked === 0) return null; // an empty window is an empty window
  if (c.listSize === 0) {
    // The wrong-field case throws in the engine, so reaching here means the
    // other step genuinely had no records — an empty sheet, not a mistake.
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        The other step had no records, so there was nothing to check <span className="font-medium">{key}</span> against.
      </p>
    );
  }
  const blankNote =
    c.blanks > 0
      ? ` ${c.blanks.toLocaleString()} had no ${key} and ${c.mode === "appears" ? "were dropped — a blank can't match anything" : "were kept — a blank isn't in the list either"}.`
      : "";
  const listNote = c.listBlanks > 0 ? ` (${c.listBlanks.toLocaleString()} of its records had no ${lookup})` : "";
  const outcome =
    c.mode === "appears"
      ? `${c.kept.toLocaleString()} matched and continue; ${(c.dropped - c.blanks).toLocaleString()} didn't.`
      : `${(c.kept - c.blanks).toLocaleString()} aren't in the list and continue; ${c.dropped.toLocaleString()} are, and were dropped.`;
  return (
    <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs text-neutral-600">
      Checked {c.checked.toLocaleString()} records against {c.listSize.toLocaleString()} values{listNote}. {outcome}
      {blankNote}
    </p>
  );
}

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
  // A read filter's unset state is a real answer ("All pipelines"), not a
  // missing one — so it gets a selectable "" option, which also makes the
  // choice REVERSIBLE. Without it, the only way back from a picked pipeline
  // was switching the Account away and back, which resets the whole step.
  // Resource selectors (a spreadsheet, a calendar) keep no such option: for
  // them, empty genuinely means "not configured yet".
  const clearable = !!field.readFilter && !field.required;
  const withClear = clearable ? [{ value: "", label: field.placeholder ?? `All ${field.label.toLowerCase()}s` }, ...withCurrent] : withCurrent;

  return (
    <Field label={field.label}>
      <Select
        value={value}
        options={withClear}
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
      ? prepareGroups([
          {
            stepId: "self",
            source: (typeof cfg.source === "string" && cfg.source) || undefined,
            title: "This step’s data",
            fields: loaded.map((f) => ({ path: f.path, label: f.label, type: f.type, sample: f.example, container: f.container })),
          },
        ])
      : fallbackGroups;

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-2.5">
      <button type="button" onClick={() => onChange({ dedupe: !on })} className="flex items-center gap-2 text-xs font-medium text-neutral-700">
        <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300"}`}>
          {on ? "✓" : ""}
        </span>
        Keep one record per…
      </button>
      {on ? (
        <>
          {/* WHICH ONE SURVIVES IS ASKED, IN THE SAME BREATH AS THE ORDER IT
              SURVIVES BY. The old copy said "the newest is kept" in grey below
              a control called "Match duplicates by" — so someone wanting the
              first call to each lead ticked the box, got the last one, and
              read a 24-hour speed-to-lead. Two dropdowns side by side cannot
              be read backwards. */}
          <Field label="Keep one record per">
            <FieldInput value={(cfg.dedupeField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ dedupeField: v })} placeholder="Pick what identifies one thing…" />
          </Field>
          <Field label="Keep the one with the">
            <div className="flex gap-2">
              <Select
                value={String(cfg.dedupeKeep ?? "latest")}
                width={130}
                options={keepDirectionOptions(orderFieldType(groups, String(cfg.dedupeOrderField ?? "occurredAt")))}
                onChange={(v) => onChange({ dedupeKeep: v })}
              />
              <div className="flex-1">
                <FieldInput
                  value={String(cfg.dedupeOrderField ?? "occurredAt")}
                  groups={groups}
                  onChange={(v) => onChange({ dedupeOrderField: v })}
                  placeholder="Pick the field that orders them…"
                />
              </div>
            </div>
          </Field>
          {state.status === "loading" && <p className="text-xs text-neutral-400">Loading your fields…</p>}
          {state.status === "ok" && loaded.length === 0 && (
            <p className="text-xs text-amber-700">No synced records yet — sync or test this step to see its fields.</p>
          )}
        </>
      ) : (
        <p className="text-xs text-neutral-400">Collapse records that share a value down to one, right as they load.</p>
      )}
    </div>
  );
}

/**
 * "Earliest/latest" for a moment, "smallest/largest" for a plain number.
 * The words have to match the field beside them or the sentence stops reading
 * as one — "the one with the earliest Duration" is not English.
 */
function keepDirectionOptions(fieldType: string | undefined): Array<{ value: string; label: string }> {
  return fieldType === "number"
    ? [{ value: "earliest", label: "Smallest" }, { value: "latest", label: "Largest" }]
    : [{ value: "earliest", label: "Earliest" }, { value: "latest", label: "Latest" }];
}

function orderFieldType(groups: DataGroup[], path: string): string | undefined {
  for (const g of groups) for (const f of g.fields) if (f.path === path) return f.type;
  return undefined;
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
              {/* THE WINDOW SAYS WHAT IT INCLUDES. A date range is the one
                  control whose meaning cannot be read off its own inputs:
                  "to 31 Aug" could reasonably mean midnight or midnight-plus-
                  a-day, and it silently meant the first. Printing the resolved
                  window is a permanent answer to "did this change?" that no
                  one-off announcement can be. */}
              <p className="text-xs text-neutral-400">{describeWindow(mode, dr)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The resolved window, in words. Presets that are still running say so — a
 * period that ends at "now" compared against a finished one always reads low,
 * which is what makes a week-over-week built from `this_week` and `last_week`
 * structurally negative on every day except Sunday.
 */
const RUNNING_PRESETS = new Set(["today", "this_week", "this_month"]);

function describeWindow(mode: string, dr: { preset?: string; days?: number; from?: string; to?: string }): string {
  if (mode === "rolling") return `Includes the last ${dr.days ?? 30} days, up to right now (UTC).`;
  if (mode === "between") {
    if (!dr.from && !dr.to) return "Pick both dates to set the window.";
    const from = dr.from ? `${dr.from} 00:00` : "the earliest record";
    const to = dr.to ? `${dr.to} 23:59` : "right now";
    return `Includes ${from} through ${to} (UTC) — the whole of the last day.`;
  }
  const preset = dr.preset ?? "last_30_days";
  if (RUNNING_PRESETS.has(preset)) {
    return "This period is still running, so it holds fewer records than a finished one. Comparing it to a completed period always reads low.";
  }
  return "Includes whole days, ending at the last complete one (UTC).";
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
      {/* F.8: when the source couldn't be re-read, the Test says so plainly
          instead of implying these numbers are freshly pulled. */}
      {t.sourceNote && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">{t.sourceNote}</p>
      )}
      {t.dedupe && <DedupeOutcome d={t.dedupe} />}
      {t.pairing && <PairingOutcome p={t.pairing} />}
      {t.crossRef && <CrossRefOutcome c={t.crossRef} />}
      {t.truncated && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          Only the newest 500,000 records were read, so this number is a floor, not a total. Narrow the step with a date range to measure a complete period.
        </p>
      )}
      <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center text-base font-semibold text-neutral-900">{resultLabel(type, t, node.data.config as Record<string, unknown>)}</p>
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
  const rec = r as { source?: string; eventType?: string; subject?: string; value?: unknown; occurredAt?: string };
  const type = rec.eventType ? eventTypeLabel(rec.source ?? null, rec.eventType) : "";
  const when = recordWhen(rec.occurredAt);
  return `${rec.source ?? ""} · ${type}${rec.subject ? ` · ${rec.subject}` : ""}${rec.value != null ? ` · ${String(rec.value)}` : ""}${when ? ` · ${when}` : ""}`;
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

