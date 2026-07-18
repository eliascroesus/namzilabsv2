"use client";

import type { ReactNode } from "react";
import type { Edge } from "@xyflow/react";
import type { NodeType } from "@/lib/flow/types";
import type { FNode } from "./graph-utils";
import { NODE_META, statusOf } from "./node-meta";
import { OUTCOMES, STAGES, STAGE_BLURB, STEP_LABEL, type OutcomeKey, sentenceFor, stageOf } from "./outline";

/**
 * The default builder experience: a structured, auto-arranged outline of the
 * metric. Steps are grouped into the four stages and read as sentences; only the
 * selected step opens its detail panel (rendered by the parent). Free positioning
 * lives under the Advanced canvas view.
 */
export function OutlineView({
  nodes,
  edges,
  selectedId,
  stepNoById,
  onSelect,
  onAddAfter,
  onInsertBetween,
  onPickOutcome,
}: {
  nodes: FNode[];
  edges: Edge[];
  selectedId: string | null;
  stepNoById: Map<string, number>;
  onSelect: (id: string) => void;
  onAddAfter: (nodeId: string) => void;
  onInsertBetween: (edgeId: string) => void;
  onPickOutcome: (key: OutcomeKey) => void;
}) {
  if (nodes.length === 0) return <OutcomeStarter onPick={onPickOutcome} />;

  const ordered = [...nodes].sort((a, b) => (stepNoById.get(a.id) ?? 0) - (stepNoById.get(b.id) ?? 0));

  const rows: ReactNode[] = [];
  let lastStage: string | null = null;
  ordered.forEach((n, i) => {
    const stage = stageOf(n.type as NodeType);
    if (stage !== lastStage) {
      lastStage = stage;
      rows.push(
        <div key={`stage-${stage}`} className="mb-1 mt-4 first:mt-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{stage}</p>
          <p className="text-xs text-neutral-400">{STAGE_BLURB[stage]}</p>
        </div>,
      );
    }
    rows.push(<StepCard key={n.id} node={n} stepNo={stepNoById.get(n.id)} selected={n.id === selectedId} onSelect={() => onSelect(n.id)} onAddAfter={() => onAddAfter(n.id)} />);

    const next = ordered[i + 1];
    if (next) {
      const e = edges.find((ed) => ed.source === n.id && ed.target === next.id);
      if (e) rows.push(<InsertGap key={`gap-${e.id}`} onInsert={() => onInsertBetween(e.id)} />);
    }
  });

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <div className="space-y-1">{rows}</div>
    </div>
  );
}

function StepCard({ node, stepNo, selected, onSelect, onAddAfter }: { node: FNode; stepNo?: number; selected: boolean; onSelect: () => void; onAddAfter: () => void }) {
  const type = node.type as NodeType;
  const meta = NODE_META[type];
  const s = statusOf(node.data);
  const isTerminal = type === "output";
  return (
    <div>
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-lg border bg-white px-4 py-3 text-left transition ${selected ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-300"}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-base">{meta.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-800">
            {stepNo != null ? `${stepNo}. ` : ""}
            {sentenceFor(type, node.data)}
          </span>
          <span className="block text-xs text-neutral-400">{STEP_LABEL[type]}</span>
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
      </button>

      {selected && (
        <div className="mt-1.5 flex justify-center">
          {isTerminal ? (
            <span className="text-xs text-neutral-400">This step shows on your dashboard.</span>
          ) : (
            <button onClick={onAddAfter} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-900 hover:text-white">
              + Add next step
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A hover-revealed insert control between two connected steps. */
function InsertGap({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="group flex h-4 items-center justify-center">
      <button
        onClick={onInsert}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs leading-none text-neutral-500 opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-neutral-900 hover:text-white"
        title="Insert a step here"
      >
        +
      </button>
    </div>
  );
}

function OutcomeStarter({ onPick }: { onPick: (key: OutcomeKey) => void }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h2 className="text-center text-xl font-semibold tracking-tight text-neutral-800">What do you want to measure?</h2>
      <p className="mt-1 text-center text-sm text-neutral-500">Pick a starting point — we&rsquo;ll set up the steps for you.</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {OUTCOMES.map((o) => (
          <button key={o.key} onClick={() => onPick(o.key)} className="flex items-start gap-3 rounded-lg border border-neutral-200 p-4 text-left hover:border-neutral-400 hover:bg-neutral-50">
            <span className="text-2xl leading-none">{o.icon}</span>
            <span>
              <span className="block font-medium text-neutral-800">{o.label}</span>
              <span className="block text-sm text-neutral-500">{o.blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
