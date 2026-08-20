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
  aggregationFields,
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
import { STATUS_META, defaultTitle, formulaExpression, formulaHandleLabels, nodeVariant, resultLabel } from "./node-meta";
import { RecordSamplePicker, recordWhen } from "./RecordSamplePicker";
import { NodeIcon } from "./icons";
import { PANEL_SHELL, PanelTabs } from "./panel-chrome";
import { Database } from "lucide-react";
import { Select, Segmented, DataBrowser, FieldInput, ConditionEditor, humanizeKey } from "./controls";
import { hasAnyFields } from "./controls/field-utils";
import type { DataGroup } from "./controls/types";
import { prepareGroups, toDataGroups, momentGroups } from "./field-groups";
import { asFilterConfig } from "./panel-mappers";

/** A reference to an earlier step, offered as a labeled pill for multi-input wiring. */
export type StepRef = { id: string; title: string; stepNo?: number };

/** Branch-head context: how records enter this Paths branch (mode lives on the hub). */
export type BranchCtx = { mode: string; siblingHasFallback: boolean; siblingHasAlways: boolean; set: (mode: string) => void };

const INPUT = "w-full rounded-control border border-input bg-white px-3 py-2 text-sm transition-colors focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100";
const W = 412;

/** Shared button language for the config panel (Make.com vibe: rounded, tactile, colourful). */
const BTN_BASE = "rounded-card px-4 py-3 text-sm font-semibold transition-all active:scale-[0.985]";
const BTN_PRIMARY = `${BTN_BASE} bg-primary text-primary-foreground transition-all hover:brightness-110 active:brightness-95 disabled:cursor-default disabled:bg-neutral-200 disabled:text-neutral-400`;
const BTN_SECONDARY = `${BTN_BASE} border border-border bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50`;

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
  recordSourceNote,
  inputCount,
  testing,
  numberGroups,
  datasetCandidates,
  laneScopes,
  onChange,
  onRename,
  onTest,
  onCancelTest,
  onTestUpstream,
  onAddNext,
  animClass = "flow-panel-in",
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
  /** The step whose records this one reads, when it is not the step above. */
  recordSourceNote?: string | null;
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
  /** Abandons a running test — its late result is dropped, not applied. */
  onCancelTest?: () => void;
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
    // Fixed at 452px, which on a 13" laptop is 35% of the screen before the
    // field browser opens beside it. It now yields on a narrow viewport
    // instead of pushing the canvas off the left edge.
    //
    // It stops short of the top island and the bottom bar — `chrome-band` is
    // their 58px height plus the 24px inset above and the 24px gap below — so
    // the chrome never has to move out of its way. It used to run the full
    // viewport height and open straight over "Review & publish", which meant
    // both bars slid sideways every time a step was selected; the panel keeping
    // to the space between them is what makes that unnecessary. Same 24px on
    // the right as everything else floating over the canvas.
    <aside
      data-config-panel
      className={`absolute right-6 top-chrome-band bottom-6 z-20 w-[min(452px,calc(100vw-3rem))] ${PANEL_SHELL} ${animClass}`}
    >
      {/* Header — no longer a darker band. The panel is ONE white surface cut by
          hairlines, the way every other island in the builder is; three stacked
          greys was the last place still separating regions by tint. What marks
          this strip as "what am I editing" is the step's own colourful icon and
          the rule under it, neither of which needed a second grey to work. */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <NodeIcon type={type} source={String((cfg as { source?: unknown }).source ?? "")} variant={nodeVariant(type, cfg)} size={38} />
          <input
            value={node.data.label ?? ""}
            onChange={(e) => onRename(e.target.value)}
            placeholder={`${stepNo != null ? `${stepNo}. ` : ""}${defaultTitle(type, node.data)}`}
            className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-title font-semibold text-foreground hover:border-border hover:bg-white focus:border-input focus:bg-white focus:outline-none"
          />
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold ${sm.cls}`}>{sm.label}</span>
      </div>

      <PanelTabs tabs={supportsTest ? ["configure", "test"] : ["configure"]} active={activeTab} onSelect={setTab} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col p-5">
          {activeTab === "configure" ? (
            <div className="space-y-5">
              {/* Every picker in this panel is fed by the step above's last
                  test, so before that test they are all empty and the panel
                  is unanswerable. This says so ONCE, at the top, with the fix
                  attached — instead of letting the user discover it by
                  opening a picker and reading "No data yet. Test an earlier
                  step to bring its fields here", which is an instruction to
                  leave this step, find that one, run it, and come back. */}
              {type !== "app" && onTestUpstream && !hasAnyFields(groups) && (
                <UpstreamPrompt onTestUpstream={onTestUpstream} />
              )}
              <NodeConfig
                type={type}
                cfg={cfg}
                connections={connections}
                groups={groups}
                selfGroups={selfGroups}
                inputs={inputs}
                recordSourceNote={recordSourceNote}
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
            </div>
          ) : (
            <div className="space-y-4">
              {err && <div className="rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}
              {node.data.lastTest?.status === "ok" ? (
                <TestResults node={node} onChange={onChange} />
              ) : (
                !err && (
                  <div className="rounded-card border border-dashed border-border bg-neutral-50/60 p-6 text-center">
                    <p className="text-sm font-medium text-neutral-700">{status === "setup" ? "Finish the Configure tab first." : "Test to see this step’s data."}</p>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* The same hairline-over-tint trade as the header: this band was grey
          when the whole panel was, and left alone it would be the one slab of
          neutral in an otherwise white surface. The rule above it is what
          holds the action apart from the fields. */}
      <div className="border-t border-border bg-white p-4">
        <Footer
          tab={activeTab}
          status={status}
          testing={testing}
          hasTest={!!node.data.lastTest}
          supportsTest={supportsTest}
          tested={tested}
          /**
           * ONE BUTTON PER STEP, NOT TWO. Continue used to only switch tabs,
           * so the user pressed Continue, arrived at a screen whose whole
           * content was another button, and pressed that. The middle click
           * existed to reach a button. Now Continue advances AND runs, which
           * is the Zapier rhythm — and it means almost every published flow
           * has been seen working, because testing is on the forward path
           * rather than beside it.
           *
           * A step already tested and unchanged just shows its result: a
           * re-run there would spend a real query to redraw the same numbers.
           */
          onContinueToTest={() => {
            setTab("test");
            if (status !== "ready") onTest();
          }}
          onBackToConfigure={() => setTab("configure")}
          onTest={onTest}
          onCancelTest={onCancelTest}
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
  onCancelTest,
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
  onCancelTest?: () => void;
  onAddNext: (anchor?: { x: number; y: number; leftX?: number }) => void;
}) {
  if (testing) return <TestingFooter onCancelTest={onCancelTest} />;

  if (tab === "configure") {
    // Untestable steps (split hub) continue straight on; the rest advance to Test.
    return (
      <button onClick={supportsTest ? onContinueToTest : () => onAddNext()} disabled={status === "setup"} className={`${BTN_PRIMARY} w-full`}>
        {status === "setup" ? "Finish the fields above" : "Continue"}
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

/**
 * A RUNNING TEST SAYS HOW LONG IT HAS BEEN RUNNING, AND CAN BE LEFT.
 *
 * A test can hold this footer for ninety seconds (112 ticks of 800ms) behind a
 * disabled "Testing…" with no elapsed time and no way out. The three failure
 * messages waiting at the end of that window are precise and useful — but a
 * minute and a half of a dead button is a long time to earn them, and a user
 * who realises mid-run that they picked the wrong field has to sit through it.
 *
 * The counter appears at 8s: below that it is noise on a test that was about
 * to return anyway. The suggestion appears at 30s, because by then the most
 * likely cause is genuinely the amount of data, and narrowing the range is
 * something the user can actually do.
 */
function TestingFooter({ onCancelTest }: { onCancelTest?: () => void }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (secs < 8 || !onCancelTest) {
    return (
      <button disabled className={`${BTN_PRIMARY} w-full`}>
        Testing…
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button disabled className={`${BTN_PRIMARY} flex-1`}>
          Testing… {secs}s
        </button>
        <button onClick={onCancelTest} className={BTN_SECONDARY}>
          Stop
        </button>
      </div>
      {secs >= 30 && (
        <p className="text-center text-xs text-muted-foreground">Large date ranges take longer. You can narrow this step and try again.</p>
      )}
    </div>
  );
}

/**
 * The one banner that turns a dead panel into a live one.
 *
 * `onTestUpstream` has existed since the panel was built — created in the
 * canvas, threaded through two components, typed at every hop, and never once
 * rendered. Its own comment called it "the cure for an empty field picker".
 * This is that cure, on screen: the step above has not been tested, so this
 * step has no fields to offer, and the fix is one button rather than five
 * navigation moves.
 */
function UpstreamPrompt({ onTestUpstream }: { onTestUpstream: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-card border border-amber-200 bg-amber-50 p-3.5">
      <p className="text-small font-medium text-amber-900">No fields to choose from yet</p>
      <p className="mt-1 text-xs leading-snug text-amber-800">
        The step above hasn&rsquo;t been tested, so we don&rsquo;t know what its records look like.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onTestUpstream();
        }}
        className="mt-2.5 rounded-control border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60"
      >
        {busy ? "Testing the previous step…" : "Test the previous step"}
      </button>
    </div>
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
  recordSourceNote,
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
  recordSourceNote?: string | null;
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
            <FieldLabel>How records enter this path</FieldLabel>
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
          <div className="space-y-5">
            {/* LIMITING A METRIC TO A PERIOD IS ONE OF THE TWO THINGS EVERYONE
                DOES TO ONE, and it was a collapsed grey accordion reading
                "Date range · off", below the conditions, below the fold. The
                config shape, the engine and the resolved-window sentence are
                all unchanged — only the prominence is. */}
            <TimePeriodSection cfg={cfg} groups={groups} onChange={onChange} />
            <div className="space-y-2.5">
              <FieldLabel>Only continue if…</FieldLabel>
              <ConditionEditor value={fc} groups={groups} onChange={(v) => onChange({ combinator: v.combinator, rules: v.rules })} />
            </div>
          </div>
        ) : (
          <p className="rounded-control border border-border bg-neutral-50 p-3 text-small text-neutral-600">
            {bmode === "always" ? "Every record continues." : "Gets what no other path matched."}
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
            options={[{ value: "preset", label: "Preset period" }, { value: "rolling", label: "Rolling (last N days)" }, { value: "between", label: "From a date onwards" }]}
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
            {/* Open-ended on purpose: an empty "To" means "up to right now",
                which is what "count everything since we started doing X"
                needs. The engine always allowed it; only the label said
                otherwise. */}
            <Field label="To (optional)"><input type="date" value={(cfg.to as string) ?? ""} onChange={(e) => onChange({ to: e.target.value })} className={INPUT} /></Field>
          </div>
        )}
        <p className="text-xs text-neutral-400">{describeWindow(mode, cfg as { preset?: string; days?: number; from?: string; to?: string })}</p>
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
    const gb = (cfg.groupBy as { type?: string; unit?: string; field?: string; topN?: number | null } | null) ?? null;
    const useDistinct = aggregationInputs(op).distinctField;
    const fieldPath = String((useDistinct ? cfg.distinctField : cfg.field) ?? (useDistinct ? "subject" : "value"));
    const labelOf = (p: string) => groups.flatMap((g) => g.fields).find((f) => f.path === p)?.label ?? humanizeKey(p);
    // "Sum of CRM + Your phone" — the summary line names EVERY column being
    // totalled, so a second field can never be added invisibly.
    const fieldLabel = useDistinct ? labelOf(fieldPath) : aggregationFields(cfg).map(labelOf).join(" + ");
    const setOp = (v: string) => {
      // Numbers play no part in a dataset aggregation — clear any wired slots so
      // stray a/b reference edges never linger on the canvas. The picked
      // columns go with them: they described inputs that no longer exist.
      if (isDatasetFormulaOp(v) && !datasetOp) {
        onChange({ op: v, aField: null, bField: null });
        if (inA) onSetInput("a", null);
        if (inB) onSetInput("b", null);
      } else {
        onChange({ op: v });
      }
    };
    return (
      <div className="space-y-4">
        <Field label="Calculation">
          <Select value={op} width={W} options={FORMULA_OP_OPTIONS} onChange={setOp} />
        </Field>
        {/* The expression, ONLY where it adds something the controls don't.
            A two-number compare composes two other steps, so naming them is
            the one place a user can check the thing they meant; a dataset
            aggregation just restated the dropdown directly below it ("Count
            of records" over a select reading "Count of records"). */}
        {!datasetOp && (
          <div className="rounded-control border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-900">
            {formulaExpression(op, inA?.title ?? (aFixed != null ? String(aFixed) : "First number"), inB?.title ?? (bFixed != null ? String(bFixed) : "Second number"))}
          </div>
        )}
        {/* The engine reaches past steps that produce a NUMBER to the nearest
            one that produces records — that is what lets two totals come off
            one source. Doing it silently would be worse than the error it
            replaces, so the step says where its records came from. */}
        {datasetOp && recordSourceNote && (
          <p className="rounded-control border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">Reads records from {recordSourceNote}</p>
        )}
        {datasetOp ? (
          <>
            <Field label="Measuring">
              <Segmented
                value={String(cfg.resultKind ?? "number")}
                options={[
                  { value: "number", label: "A number" },
                  { value: "duration", label: "A length of time" },
                ]}
                onChange={(v) => onChange({ resultKind: v, ...(v === "duration" ? { groupBy: null } : {}) })}
              />
            </Field>
            {aggregationInputs(op).numberField && <NumberFieldList cfg={cfg} groups={groups} onChange={onChange} />}
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
                <Field label="Result">
                  <Segmented
                    value={gb?.type === "time" ? "time" : "none"}
                    options={[{ value: "none", label: "One number" }, { value: "time", label: "A trend" }]}
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
            <NumberPicker handle="a" label={labels.a} desc={inA} groups={numberGroups} fixed={aFixed} fieldPath={typeof cfg.aField === "string" ? cfg.aField : null} onSetInput={onSetInput} onSetFixed={(n) => onChange({ aFixed: n })} onSetField={(path) => onChange({ aField: path })} />
            <NumberPicker handle="b" label={labels.b} desc={inB} groups={numberGroups} fixed={bFixed} fieldPath={typeof cfg.bField === "string" ? cfg.bField : null} onSetInput={onSetInput} onSetFixed={(n) => onChange({ bFixed: n })} onSetField={(path) => onChange({ bField: path })} />
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
        {/* The paragraph that used to sit here described STACKING, and it was
            rendered in both modes — so a step set to match opened with a
            sentence promising the opposite ("later steps see records from all
            of them"). Nothing replaced it: which of the two this step is, is
            already answered by its own name, its icon and the labels below. */}
        <div>
          <p className="mb-1 text-base font-semibold text-foreground">{matching ? "Steps to check" : "Steps to combine"}</p>
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
                <button type="button" onClick={() => setLanes(laneIds.filter((_, i) => i !== idx))} className="shrink-0 text-xs text-neutral-400 hover:text-destructive">
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
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:border-neutral-400 hover:text-foreground"
              >
                <span className="text-sm leading-none">+</span> Add another step
              </button>
            )}
            {datasetCandidates.length === 0 && inputs.length === 0 && <p className="text-xs text-neutral-400">Add a Get data step first, then combine it here.</p>}
          </div>
        </div>

        {/* The two jobs, named. Each is now its own entry in the step picker,
            so this control is for CHANGING one into the other rather than for
            discovering the second one exists — which is what a checkbox
            buried under the lane list was being asked to do. */}
        {matching && inputs.length !== 2 && (
          <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Match needs exactly 2 steps — {inputs.length} wired in.
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
        {paths.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border border-pink-200 bg-pink-50/40 px-2 py-1.5">
            <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-pink-700">Branch {i + 1}</span>
            <input value={p.label} onChange={(e) => setLabel(i, e.target.value)} className="min-w-0 flex-1 rounded-md border border-input px-2 py-1 text-xs font-medium" />
            {(p.mode ?? "custom") !== "custom" && (
              <span className="shrink-0 rounded bg-pink-100 px-1.5 py-0.5 text-micro font-medium text-pink-700">{p.mode === "always" ? "always runs" : "fallback"}</span>
            )}
            {paths.length > 1 && (
              <button onClick={() => onRemoveBranch(p.id)} className="shrink-0 text-micro text-destructive hover:underline" title="Remove this branch and its steps">Remove</button>
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

/**
 * THE COLUMNS THIS STEP ADDS UP — one, or several totalled together.
 *
 * A form writes one question per column, so "how many did you call (CRM)" and
 * "how many did you call (your phone)" are two columns meaning one thing.
 * Expressing that used to need two Get-data steps reading the same sheet
 * twice, two Calculates and a third to add them — and since a step with
 * something after it offers no way to branch, nobody found that path. Now it
 * is one step and a second picker.
 *
 * Each row totals into the same per-record number, so the aggregation above
 * still means what it says: Sum totals the combined column, Average averages
 * the combined per-record total.
 */
function NumberFieldList({
  cfg,
  groups,
  onChange,
}: {
  cfg: Record<string, unknown>;
  groups: DataGroup[];
  onChange: (p: Record<string, unknown>) => void;
}) {
  const extra = Array.isArray(cfg.extraFields) ? (cfg.extraFields as unknown[]).map(String) : [];
  const setExtra = (next: string[]) => onChange({ extraFields: next });
  /**
   * A LENGTH OF TIME READS ITS UNIT OFF THE FIELD NAME, so a second column
   * could be counted in something else entirely and the total would be
   * meaningless — and the tile derives that unit forever after. Totalling
   * columns stays a plain-number feature.
   */
  if (String(cfg.resultKind ?? "number") === "duration") {
    return (
      <Field label="Field to calculate">
        <FieldInput value={String(cfg.field ?? "value")} groups={groups} onChange={(v) => onChange({ field: v })} placeholder="Pick the number field…" />
      </Field>
    );
  }
  return (
    <Field label={extra.length > 0 ? "Fields to add up" : "Field to calculate"}>
      <div className="space-y-2">
        <FieldInput value={String(cfg.field ?? "value")} groups={groups} onChange={(v) => onChange({ field: v })} placeholder="Pick the number field…" />
        {extra.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-sm text-neutral-400">+</span>
            <div className="min-w-0 flex-1">
              <FieldInput
                value={f}
                groups={groups}
                onChange={(v) => setExtra(extra.map((x, j) => (j === i ? v : x)))}
                placeholder="Pick another number field…"
              />
            </div>
            <button
              type="button"
              onClick={() => setExtra(extra.filter((_, j) => j !== i))}
              className="rounded p-1 text-neutral-400 hover:text-neutral-700"
              title="Remove this field"
              aria-label="Remove this field"
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setExtra([...extra, ""])} className="text-xs font-medium text-blue-600 hover:underline">
          + Add another field
        </button>
        {/* The "+" between the pickers already says these are added; what it
            cannot say is the ORDER — per record first, then across records —
            which is the difference between an average of totals and a total
            of averages. Six words instead of a paragraph. */}
        {extra.length > 0 && <p className="text-xs text-muted-foreground">Added up per record, then across records.</p>}
      </div>
    </Field>
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
      {aggregationInputs(agg).numberField && <NumberFieldList cfg={cfg} groups={groups} onChange={onChange} />}
      {aggregationInputs(agg).distinctField && <Field label="Distinct by"><FieldInput value={(cfg.distinctField as string) ?? "subject"} groups={groups} onChange={(v) => onChange({ distinctField: v })} /></Field>}
      <Field label="Result">
        <Segmented
          value={gb?.type === "time" ? "time" : "none"}
          options={[{ value: "none", label: "One number" }, { value: "time", label: "A trend" }]}
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
      <div className="rounded border border-brand-200 bg-brand-50 p-2 text-xs text-brand-900">
        <p className="font-medium">{formulaExpression(op, inA?.title ?? (aFixed != null ? String(aFixed) : "First number"), inB?.title ?? (bFixed != null ? String(bFixed) : "Second number"))}</p>
      </div>
      <NumberPicker handle="a" label={labels.a} desc={inA} groups={numberGroups} fixed={aFixed} fieldPath={typeof cfg.aField === "string" ? cfg.aField : null} onSetInput={onSetInput} onSetFixed={(n) => onChange({ aFixed: n })} onSetField={(path) => onChange({ aField: path })} />
      <NumberPicker handle="b" label={labels.b} desc={inB} groups={numberGroups} fixed={bFixed} fieldPath={typeof cfg.bField === "string" ? cfg.bField : null} onSetInput={onSetInput} onSetFixed={(n) => onChange({ bFixed: n })} onSetField={(path) => onChange({ bField: path })} />
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
  fieldPath,
  onSetInput,
  onSetFixed,
  onSetField,
}: {
  handle: "a" | "b";
  label: string;
  desc?: InputDescriptor;
  groups: DataGroup[];
  fixed: number | null;
  /** A field read off the wired step instead of its record count (aField/bField). */
  fieldPath: string | null;
  onSetInput: (h: "a" | "b", id: string | null) => void;
  onSetFixed: (n: number | null) => void;
  onSetField: (path: string | null) => void;
}) {
  const chosen = groups.find((g) => g.stepId === desc?.nodeId);
  const pickedField = fieldPath ? chosen?.fields.find((f) => f.path === fieldPath) : undefined;
  // A picked column reads "3. Google Sheets · Total booked", not just the step —
  // the pill has to say WHICH value fills the slot, or a cell pick and a record
  // count are indistinguishable on the card.
  const stepLabel = chosen ? `${chosen.stepNo != null ? `${chosen.stepNo}. ` : ""}${chosen.title}` : desc ? desc.title : null;
  const chosenLabel = stepLabel && fieldPath ? `${stepLabel} · ${pickedField?.label ?? humanizeKey(fieldPath)}` : stepLabel;
  // The group sample is already the right number per step type (a scalar step's Result,
  // a dataset step's record count). Never fall back to recordCount — that shows a scalar
  // step's meaningless "1 record" instead of its actual value.
  const preview = fieldPath ? pickedField?.sample : chosen?.fields[0]?.sample ?? desc?.value;
  return (
    <Field label={label}>
      <DataBrowser
        groups={groups}
        // Numbers first, everything one chip away: this slot wants a number,
        // but a text cell holding "5" is still a number to the engine.
        initialType="number"
        onPick={(ref) => {
          onSetInput(handle, ref.producerStepId);
          // A "__"-prefixed pick is the step's own number (Output number /
          // Result); anything else is one of its columns, read off the
          // newest record by the engine.
          onSetField(ref.fieldPath.startsWith("__") ? null : ref.fieldPath);
          onSetFixed(null);
        }}
        trigger={({ toggle }) => (
          <div className="relative">
            {desc ? (
              <div className="flex w-full items-center justify-between gap-2 rounded-md border border-input bg-neutral-50 py-1.5 pl-2 pr-14 text-sm">
                <span className="min-w-0 truncate text-foreground">{chosenLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    onSetInput(handle, null);
                    // The field belongs to the cleared step — a later pick of a
                    // different step must not inherit a column it never had.
                    onSetField(null);
                  }}
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
              className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md border border-brand-200 bg-brand-50 p-1 text-brand-500 transition-colors hover:border-brand-300 hover:bg-brand-100 hover:text-brand-600"
            >
              <Database size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      />
      {desc && preview != null && <p className="mt-1 text-xs text-muted-foreground">= {String(preview)}</p>}
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
        <div key={i} className="space-y-2 rounded border border-border p-2">
          <input value={c.label} placeholder="Category name" onChange={(e) => setCat(i, { label: e.target.value })} className="w-full rounded-md border border-input px-2 py-1 text-xs font-medium" />
          <ConditionEditor value={asFilterConfig((c.filters as unknown as Record<string, unknown>) ?? {})} groups={groups} onChange={(v) => setCat(i, { filters: { combinator: v.combinator, rules: v.rules } })} />
          <button onClick={() => onChange({ categories: cats.filter((_, j) => j !== i) })} className="text-xs text-destructive hover:underline">Remove category</button>
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
  /** The picker is revealed on demand; the detector's answer is the default view. */
  const [editing, setEditing] = useState(false);
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

  /**
   * COLLAPSED TO ITS ANSWER, because it is almost never a question.
   *
   * A spreadsheet row carries no timestamp of its own, so something has to
   * decide which column dates it — and unlike everything else in this panel
   * that decision is made FOR the user, correctly, nearly always. Standing it
   * up as a full labelled field with a dropdown put a question mark next to
   * an answer, in the middle of the one step a first-timer has to get through.
   *
   * So the answer is the control: one grey line saying which column is dating
   * these rows, and a Change that reveals the picker for the sheet where the
   * detector guessed wrong. Nothing is hidden — what it decided is still the
   * first thing you read.
   */
  if (!editing) {
    // `note` is empty until the settings fetch lands. Rendering the row anyway
    // put a bare "Change" link beside nothing at all — an offer to edit a fact
    // the panel had not yet loaded.
    if (!note) return null;
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{note}</span>
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 font-medium text-brand-600 hover:underline">
          Change
        </button>
      </p>
    );
  }

  return (
    <Field label="Date column">
      <Select
        value={value}
        width={W}
        disabled={busy}
        options={[
          { value: "__auto", label: "Detect automatically" },
          { value: "__none", label: "Use import time (no date column)" },
          ...columns,
        ]}
        onChange={pick}
      />
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
        <p className="text-xs text-success-ink">History imported — everything the source still offers.</p>
        {historyNote && <p className="text-xs text-muted-foreground">{historyNote}</p>}
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
      {/* Four questions that read top to bottom as one sentence: keep THESE
          records, matched on THIS field, when it IS (or isn't) in THAT one.
          The labels were carrying the sentence on their own ("Keep a record
          when its value", "In 3. Google Sheets's field") and had grown longer
          than the controls under them. */}
      <Field label="Keep from">
        <Select
          value={keepPicked ? keepId : ""}
          width={W}
          placeholder="Whose records continue…"
          options={inputs.map((i) => ({ value: i.nodeId, label: stepLabel(i.nodeId) }))}
          // Flipping sides swaps BOTH lanes, so both picked fields go with it.
          onChange={(v) => onChange({ keepNodeId: v, keyField: "", lookupField: "" })}
        />
      </Field>
      {keepPicked && (
        <>
          <Field label="Match on">
            <FieldInput value={String(cfg.keyField ?? "")} groups={scopeFor(keepId)} onChange={(v) => onChange({ keyField: v })} placeholder="Field to look up…" />
          </Field>
          <Field label="Keep when it">
            <Segmented
              value={matchMode}
              options={[
                { value: "appears", label: "Is in", hint: `Keep records that appear in ${other ? stepLabel(other.nodeId) : "the other step"}` },
                { value: "missing", label: "Is not in", hint: `Keep records that do NOT appear in ${other ? stepLabel(other.nodeId) : "the other step"}` },
              ]}
              onChange={(v) => onChange({ matchMode: v })}
            />
          </Field>
          {other && (
            <Field label={stepLabel(other.nodeId)}>
              <FieldInput value={String(cfg.lookupField ?? "")} groups={scopeFor(other.nodeId)} onChange={(v) => onChange({ lookupField: v })} placeholder="Field holding the values…" />
            </Field>
          )}
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
          className="relative w-full rounded-control border border-input bg-white py-2 pl-3 pr-9 text-left text-sm transition-colors hover:border-neutral-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
        >
          {label ? (
            <span className="block truncate text-foreground">
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
      <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
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
      <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
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
      <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        Removed {d.removed.toLocaleString()} record{d.removed === 1 ? "" : "s"}, but <span className="font-medium">{orderName}</span> is empty on all of them — so which one survived was arbitrary. Pick a
        field that orders these records.
      </p>
    );
  }
  return (
    <p className="rounded-control border border-border bg-neutral-50 p-2.5 text-xs text-neutral-600">
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
      <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        Nothing was paired: none of the {p.keys.toLocaleString()} matched groups had a start time. Check the field picked for “Start the clock on”.
      </p>
    );
  }
  const bits = [`${p.matched.toLocaleString()} of ${p.started.toLocaleString()} matched a stop time`];
  if (p.noStop > 0) bits.push(`${p.noStop.toLocaleString()} never got one`);
  if (p.stopBeforeStart > 0) bits.push(`${p.stopBeforeStart.toLocaleString()} only had one before the start`);
  return (
    <p className="rounded-control border border-border bg-neutral-50 p-2.5 text-xs text-neutral-600">
      {bits.join(", ")}. The rest are not in this number.
    </p>
  );
}

/**
 * What Cross-reference actually did. "8 kept" against a list that supplied
 * zero values is the silent version of the bug this step replaces — so the
 * list size, the blanks, and where every record went are part of the answer.
 */
function CrossRefOutcome({ c }: { c: { mode: string; keyField: string; lookupField: string; checked: number; kept: number; dropped: number; blanks: number; listSize: number; listBlanks: number; phones?: number } }) {
  const key = c.keyField.replace(/^properties\./, "");
  const lookup = c.lookupField.replace(/^properties\./, "");
  if (c.checked === 0) return null; // an empty window is an empty window
  if (c.listSize === 0) {
    // The wrong-field case throws in the engine, so reaching here means the
    // other step genuinely had no records — an empty sheet, not a mistake.
    return (
      <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
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
  // The digit-matching is invisible in the numbers, so it has to be visible
  // in words — "+1 208-613-0936 matched 2086130936" must never read as a
  // mystery. The sentence states the MECHANISM (last 10 digits) and shows it,
  // rather than promising "prefixes don't matter": for a trunk-0 national
  // number vs its +33 form the last 10 differ, and a receipt reassuring a
  // French user about the exact divide that is failing them would be worse
  // than saying nothing.
  const phoneNote = (c.phones ?? 0) > 0 ? " Both fields hold phone numbers, so values were matched by their last 10 digits — “+1 208-613-0936” and “2086130936” count as the same." : "";
  return (
    <p className="rounded-control border border-border bg-neutral-50 p-2.5 text-xs text-neutral-600">
      Checked {c.checked.toLocaleString()} records against {c.listSize.toLocaleString()} values{listNote}. {outcome}
      {blankNote}
      {phoneNote}
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
    <div className="space-y-2 rounded-control border border-border p-2.5">
      <button type="button" onClick={() => onChange({ dedupe: !on })} className="flex items-center gap-2 text-xs font-medium text-neutral-700">
        <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300"}`}>
          {on ? "✓" : ""}
        </span>
        Remove duplicates
      </button>
      {on && (
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

/**
 * "Which period?" — asked first, in one dropdown, in the words people use.
 *
 * This replaces a collapsed accordion reading "Date range · off" that sat
 * BELOW the conditions, and which opened onto four stacked controls: a
 * checkbox to turn the window on, a Date-field picker, a Window mode, and
 * only then the range itself. Four answers for a question people arrive
 * already knowing the answer to ("last 30 days").
 *
 * So the mode and the preset are collapsed into ONE list — "All time" is the
 * off state and a real, selectable answer rather than an unticked box — and
 * the two controls that genuinely need asking (which days, and which date
 * column) appear only once a window is chosen. The date field stays available
 * because it is a real question on a record with several timestamps; it is
 * just no longer asked before the period is.
 *
 * The stored shape (`dateRange`), the engine, and `describeWindow`'s resolved
 * sentence are untouched.
 */
function TimePeriodSection({ cfg, groups, onChange }: { cfg: Record<string, unknown>; groups: DataGroup[]; onChange: (p: Record<string, unknown>) => void }) {
  const dr = (cfg.dateRange as DateRange) ?? {};
  const enabled = !!dr.enabled;
  const mode = dr.mode ?? "preset";
  const set = (patch: Partial<DateRange>) =>
    onChange({ dateRange: { enabled, dateField: dr.dateField ?? "occurredAt", mode, preset: dr.preset ?? "last_30_days", days: dr.days ?? 30, from: dr.from, to: dr.to, ...patch } });

  // Only date fields make sense here; fall back to the built-in when none are known yet.
  const dateGroups: DataGroup[] = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.type === "date") }))
    .filter((g) => g.fields.length > 0);
  if (dateGroups.length === 0) dateGroups.push({ stepId: "builtin", title: "Built-in", fields: [{ path: "occurredAt", label: "When it happened", type: "date" }] });

  const value = !enabled ? "all" : mode === "preset" ? `preset:${dr.preset ?? "last_30_days"}` : mode;
  const pick = (v: string) => {
    if (v === "all") return set({ enabled: false });
    if (v.startsWith("preset:")) return set({ enabled: true, mode: "preset", preset: v.slice(7) });
    set({ enabled: true, mode: v as DateRange["mode"] });
  };

  return (
    <div className="space-y-2.5">
      <FieldLabel>Time period</FieldLabel>
      <Select
        value={value}
        width={W}
        searchable
        options={[
          { value: "all", label: "All time" },
          ...DATE_PRESETS.map((p) => ({ value: `preset:${p.value}`, label: p.label, group: "Preset periods" })),
          { value: "rolling", label: "Last N days…", group: "Custom" },
          { value: "between", label: "Between two dates…", group: "Custom" },
        ]}
        onChange={pick}
      />
      {enabled && (
        <div className="space-y-2.5 rounded-control border border-border bg-white p-3">
          {mode === "rolling" && (
            <Field label="Number of days">
              <NumberField value={dr.days ?? 30} min={1} onChange={(n) => set({ days: n ?? 1 })} />
            </Field>
          )}
          {mode === "between" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><input type="date" value={dr.from ?? ""} onChange={(e) => set({ from: e.target.value })} className={INPUT} /></Field>
              {/* Empty "To" = up to right now. See the Time step's note. */}
              <Field label="To (optional)"><input type="date" value={dr.to ?? ""} onChange={(e) => set({ to: e.target.value })} className={INPUT} /></Field>
            </div>
          )}
          <Field label="Measured by which date?">
            <FieldInput value={dr.dateField ?? "occurredAt"} groups={dateGroups} onChange={(v) => set({ dateField: v })} />
          </Field>
          {/* THE WINDOW SAYS WHAT IT INCLUDES. A date range is the one
              control whose meaning cannot be read off its own inputs:
              "to 31 Aug" could reasonably mean midnight or midnight-plus-
              a-day, and it silently meant the first. Printing the resolved
              window is a permanent answer to "did this change?" that no
              one-off announcement can be. */}
          <p className="text-xs text-muted-foreground">{describeWindow(mode, dr)}</p>
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
    if (!dr.from && !dr.to) return "Pick a start date. Leaving “To” empty means no end — everything from then on.";
    const from = dr.from ? `${dr.from} 00:00` : "the earliest record";
    // An open end is genuinely open, so it has to say so — on a calendar that
    // is the difference between 9 meetings and 20.
    if (!dr.to) return `Includes everything from ${from} (UTC) onwards, with no end — scheduled dates included.`;
    return `Includes ${from} through ${dr.to} 23:59 (UTC) — the whole of the last day.`;
  }
  const preset = dr.preset ?? "last_30_days";
  if (RUNNING_PRESETS.has(preset)) {
    return "This period is still running, so it holds fewer records than a finished one. Comparing it to a completed period always reads low.";
  }
  // "last N days" ends at NOW, not at the last complete day — the engine
  // computes `now - N days … now` with no day rounding. The whole-days
  // sentence below is true only of yesterday / last week / last month, and
  // saying it here described the opposite of the window being applied.
  const rolling = /^last_(\d+)_days$/.exec(preset);
  if (rolling) return `Includes the last ${rolling[1]} days, up to right now (UTC).`;
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
        <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">{t.sourceNote}</p>
      )}
      {t.dedupe && <DedupeOutcome d={t.dedupe} />}
      {t.pairing && <PairingOutcome p={t.pairing} />}
      {t.crossRef && <CrossRefOutcome c={t.crossRef} />}
      {t.truncated && (
        <p className="rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          Only the newest 500,000 records were read, so this number is a floor, not a total. Narrow the step with a date range to measure a complete period.
        </p>
      )}
      <p className="rounded-card border border-border bg-neutral-50 p-3 text-center text-title font-semibold text-foreground">{resultLabel(type, t, node.data.config as Record<string, unknown>)}</p>
      {type === "app" ? (
        <RecordSamplePicker records={t.sample} selectedIndex={sampleIndex} onSelect={(i) => onChange({ sampleIndex: i })} />
      ) : (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">View sample data</summary>
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
        {recs.slice(0, 3).map((r, i) => <div key={i} className={`truncate rounded border p-1.5 text-micro ${tone}`}>{sampleLine(r)}</div>)}
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

/** The label is the QUESTION and the input under it is the ANSWER, so the
    label may never read lighter than the thing it labels. It matches the
    Configure tab above exactly — 14px semibold, true black — so the whole
    panel speaks in one voice. */
const FIELD_LABEL = "mb-1.5 block text-base font-semibold text-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </div>
  );
}

/**
 * The same label as `Field`, for the handful of places that lay their own
 * control out rather than passing it as a child — "Time period", the branch
 * mode, "Only continue if…". All three used `SectionLabel` before, which put
 * an 11px uppercase grey-400 question above a 14px black answer: the exact
 * inversion `Field` exists to prevent. Same string, so the two can never drift.
 */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className={FIELD_LABEL}>{children}</span>;
}

/** A small uppercase section heading, matching the step picker's group labels. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-micro font-semibold uppercase tracking-wider text-neutral-400">{children}</p>;
}

