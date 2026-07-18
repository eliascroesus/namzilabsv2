"use client";

import { useState } from "react";
import type { NodeType } from "@/lib/flow/types";
import { ALL_TYPES, LIBRARY_ORDER, NODE_META } from "./node-meta";

export function NodeLibraryModal({ onClose, onPick }: { onClose: () => void; onPick: (type: NodeType) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = (t: NodeType) => {
    if (!query) return true;
    const m = NODE_META[t];
    return `${m.label} ${m.blurb} ${m.keywords} ${m.category}`.toLowerCase().includes(query);
  };
  const byCategory = LIBRARY_ORDER.map((cat) => ({ cat, types: ALL_TYPES.filter((t) => NODE_META[t].category === cat && matches(t)) })).filter((g) => g.types.length > 0);

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
            placeholder="Search apps and tools…"
            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {byCategory.length === 0 && <p className="p-4 text-center text-sm text-neutral-500">No matches.</p>}
          {byCategory.map(({ cat, types }) => (
            <div key={cat} className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{cat}</p>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => (
                  <button key={t} onClick={() => onPick(t)} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-left hover:border-neutral-400 hover:bg-neutral-50">
                    <span className="text-lg leading-none">{NODE_META[t].icon}</span>
                    <span>
                      <span className="block text-sm font-medium">{NODE_META[t].label}</span>
                      <span className="block text-xs text-neutral-500">{NODE_META[t].blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
