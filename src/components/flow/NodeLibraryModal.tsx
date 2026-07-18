"use client";

import { useState } from "react";
import type { NodeType } from "@/lib/flow/types";
import { ALL_TYPES, NODE_META } from "./node-meta";
import { STEP_LABEL, STAGES, stageOf } from "./outline";

/**
 * Add-step picker. When `allow` is given (adding after a step), it shows only the
 * valid next actions — the everyday ones prominently, advanced ones collapsed.
 * Otherwise it lists everything grouped by the four stages.
 */
export function NodeLibraryModal({
  onClose,
  onPick,
  allow,
}: {
  onClose: () => void;
  onPick: (type: NodeType) => void;
  allow?: { common: NodeType[]; advanced: NodeType[] };
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${STEP_LABEL[t]} ${m.blurb} ${m.keywords}`.toLowerCase().includes(query);
  };

  const Option = ({ t }: { t: NodeType }) => (
    <button key={t} onClick={() => onPick(t)} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2.5 text-left hover:border-neutral-400 hover:bg-neutral-50">
      <span className="text-lg leading-none">{NODE_META[t].icon}</span>
      <span>
        <span className="block text-sm font-medium">{STEP_LABEL[t]}</span>
        <span className="block text-xs text-neutral-500">{NODE_META[t].blurb}</span>
      </span>
    </button>
  );

  const common = (allow ? allow.common : ALL_TYPES).filter(matches);
  const advanced = (allow ? allow.advanced : []).filter(matches);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-neutral-100 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{allow ? "Add next step" : "Add a step"}</h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
              ✕
            </button>
          </div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search steps…" className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {allow ? (
            <>
              {common.length === 0 && advanced.length === 0 && <p className="p-4 text-center text-sm text-neutral-500">No steps can follow this one.</p>}
              <div className="grid grid-cols-2 gap-2">
                {common.map((t) => (
                  <Option key={t} t={t} />
                ))}
              </div>
              {advanced.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-400">Advanced steps</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {advanced.map((t) => (
                      <Option key={t} t={t} />
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            STAGES.map((stage) => {
              const types = ALL_TYPES.filter((t) => stageOf(t) === stage && matches(t));
              if (types.length === 0) return null;
              return (
                <div key={stage} className="mb-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{stage}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {types.map((t) => (
                      <Option key={t} t={t} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
