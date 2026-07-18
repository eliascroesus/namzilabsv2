"use client";

import { useState } from "react";
import type { FieldGroup } from "./graph-utils";

/** Field input with a searchable variable picker grouped by previous step. */
export function FieldPicker({ value, fieldGroups, onChange }: { value: string; fieldGroups: FieldGroup[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = fieldGroups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !query || `${f.label} ${f.path}`.toLowerCase().includes(query)) }))
    .filter((g) => g.fields.length > 0);

  const example = (ex: unknown) => {
    if (ex == null) return null;
    const s = String(ex);
    return s.length > 22 ? `${s.slice(0, 22)}…` : s;
  };

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="field (e.g. subject or properties.plan)" className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
        <button type="button" onClick={() => setOpen((o) => !o)} title="Insert a field from a previous step" className="w-7 rounded-md border border-neutral-300 text-xs hover:bg-neutral-50">
          +
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
          {groups.length === 0 && <p className="p-2 text-center text-xs text-neutral-400">No fields. Test upstream steps to load their fields.</p>}
          {groups.map((g) => (
            <div key={g.from} className="mb-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {g.stepNo != null ? `${g.stepNo}. ` : ""}{g.from}
              </p>
              <div className="space-y-0.5">
                {g.fields.map((f) => (
                  <button
                    key={`${g.from}:${f.path}`}
                    type="button"
                    onClick={() => {
                      onChange(f.path);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-neutral-700">{f.label}</span>
                      {f.example != null && <span className="block truncate text-[10px] text-neutral-400">{example(f.example)}</span>}
                    </span>
                    {f.type && <span className="shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-[9px] uppercase text-neutral-500">{f.type}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
