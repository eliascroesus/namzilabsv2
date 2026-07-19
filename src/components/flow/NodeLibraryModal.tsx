"use client";

import { useState } from "react";
import type { NodeType } from "@/lib/flow/types";
import { ALL_TYPES, NODE_META, STAGES } from "./node-meta";
import { NodeGlyph } from "./icons";

const STAGE_BLURB: Record<string, string> = {
  Data: "Bring records in",
  Conditions: "Narrow down which records count",
  Calculation: "Turn records into a number",
  Dashboard: "Show the result",
};

export function NodeLibraryModal({ onClose, onPick }: { onClose: () => void; onPick: (type: NodeType) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${m.label} ${m.blurb} ${m.keywords} ${m.stage}`.toLowerCase().includes(query);
  };

  const byStage = STAGES.map((stage) => ({ stage, types: ALL_TYPES.filter((t) => NODE_META[t].stage === stage && !NODE_META[t].advanced && matches(t)) })).filter((g) => g.types.length > 0);
  const advanced = ALL_TYPES.filter((t) => NODE_META[t].advanced && matches(t));

  const card = (t: NodeType) => (
    <button key={t} onClick={() => onPick(t)} className="flex items-start gap-2.5 rounded-md border border-neutral-200 p-2.5 text-left hover:border-neutral-400 hover:bg-neutral-50">
      <span className="mt-0.5 shrink-0 text-neutral-500">
        <NodeGlyph type={t} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{NODE_META[t].label}</span>
        <span className="block text-xs text-neutral-500">{NODE_META[t].blurb}</span>
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-neutral-100 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Add a step</h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
              ✕
            </button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search steps…"
            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {byStage.length === 0 && advanced.length === 0 && <p className="p-4 text-center text-sm text-neutral-500">No matches.</p>}
          {byStage.map(({ stage, types }) => (
            <div key={stage} className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{stage}</p>
              <p className="mb-1.5 text-[11px] text-neutral-400">{STAGE_BLURB[stage]}</p>
              <div className="grid grid-cols-2 gap-2">{types.map(card)}</div>
            </div>
          ))}
          {advanced.length > 0 && (
            <details open={query.length > 0} className="mt-1">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-400">Advanced steps</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">{advanced.map(card)}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
