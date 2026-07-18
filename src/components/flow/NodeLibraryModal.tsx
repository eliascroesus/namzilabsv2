"use client";

import { useState } from "react";
import type { NodeType } from "@/lib/flow/types";
import { ADDABLE_TYPES, NODE_META } from "./node-meta";
import { STEP_LABEL, STAGES, stageOf } from "./outline";
import { incompatReason } from "./graph-utils";

/**
 * Add-step picker. Recommended (compatible) steps sit at the top; the full list is
 * always available underneath. Any step can be added — an incompatible one explains
 * what input it needs and is dropped in unconnected so nothing breaks.
 */
export function NodeLibraryModal({
  onClose,
  onPick,
  allow,
  sourceType,
}: {
  onClose: () => void;
  onPick: (type: NodeType) => void;
  allow?: { common: NodeType[]; advanced: NodeType[] };
  sourceType?: NodeType;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${STEP_LABEL[t]} ${m.blurb} ${m.keywords}`.toLowerCase().includes(query);
  };

  const recommended = allow ? [...allow.common, ...allow.advanced] : sourceType ? [] : (["app"] as NodeType[]);

  const Option = ({ t }: { t: NodeType }) => {
    const reason = incompatReason(sourceType, t);
    return (
      <button
        onClick={() => onPick(t)}
        className={`flex items-start gap-2 rounded-md border p-2.5 text-left hover:bg-neutral-50 ${reason ? "border-neutral-200" : "border-neutral-200 hover:border-neutral-400"}`}
      >
        <span className="text-lg leading-none">{NODE_META[t].icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{STEP_LABEL[t]}</span>
          <span className="block text-xs text-neutral-500">{NODE_META[t].blurb}</span>
          {reason && <span className="mt-0.5 block text-[11px] text-amber-600">{reason}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-neutral-100 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{sourceType ? "Add next step" : "Add a step"}</h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
          </div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search steps…" className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {recommended.filter(matches).length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Recommended next</p>
              <div className="grid grid-cols-2 gap-2">
                {recommended.filter(matches).map((t) => (
                  <Option key={t} t={t} />
                ))}
              </div>
            </div>
          )}

          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">All steps</p>
          {STAGES.map((stage) => {
            const types = ADDABLE_TYPES.filter((t) => stageOf(t) === stage && matches(t) && !recommended.includes(t));
            if (types.length === 0) return null;
            return (
              <div key={stage} className="mb-3">
                <p className="mb-1 text-[11px] font-medium text-neutral-400">{stage}</p>
                <div className="grid grid-cols-2 gap-2">
                  {types.map((t) => (
                    <Option key={t} t={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
