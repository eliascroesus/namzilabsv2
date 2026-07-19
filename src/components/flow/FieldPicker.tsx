"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldGroup, PickField } from "./graph-utils";
import { resolveSampleField, fieldProvenance } from "./graph-utils";
import { SourceBadge, MappingChip } from "./MappingChip";

function clientKind(v: unknown): string {
  if (Array.isArray(v)) return "list";
  if (v && typeof v === "object") return "object";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "text";
}
function isContainer(v: unknown): boolean {
  return Array.isArray(v) || (!!v && typeof v === "object");
}
/** Enumerate one level of nested children (object keys / array items) from the sample. */
function childrenOf(sampleRecord: unknown, path: string): PickField[] {
  const val = resolveSampleField(sampleRecord, path);
  if (Array.isArray(val)) {
    return val.slice(0, 10).map((item, i) => ({ path: `${path}.${i}`, label: `Item ${i + 1}`, type: clientKind(item), example: item, container: isContainer(item) }));
  }
  if (val && typeof val === "object") {
    return Object.entries(val as Record<string, unknown>)
      .slice(0, 50)
      .map(([k, v]) => ({ path: `${path}.${k}`, label: k, type: clientKind(v), example: v, container: isContainer(v) }));
  }
  return [];
}
function fmt(ex: unknown): string | null {
  if (ex == null || ex === "") return null;
  const s = typeof ex === "object" ? JSON.stringify(ex) : String(ex);
  return s.length > 28 ? `${s.slice(0, 28)}…` : s;
}

/**
 * A Zapier-style data field: empty shows "+ Insert data"; once chosen it renders as a
 * data pill with the human field name (never a raw path). Clicking opens the Insert-data
 * browser — fields grouped by app + step, with sample values and nested drill-in.
 */
export function FieldPicker({ value, fieldGroups, onChange, onCommit }: { value: string; fieldGroups: FieldGroup[]; onChange: (v: string) => void; onCommit?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const query = q.trim().toLowerCase();
  const groups = fieldGroups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !query || `${f.label} ${f.path}`.toLowerCase().includes(query)) }))
    .filter((g) => g.fields.length > 0);
  const nonSystem = groups.filter((g) => !g.system);
  const collapseGroups = nonSystem.length > 1;
  const prov = value ? fieldProvenance(fieldGroups, value) : null;

  const pick = (f: PickField) => {
    onChange(f.path);
    onCommit?.();
    setOpen(false);
    setQ("");
  };
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderField = (g: FieldGroup, f: PickField, depth: number): React.ReactNode => (
    <div key={`${g.from}:${f.path}`}>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {f.container ? (
          <button type="button" onClick={() => toggle(f.path)} className="w-4 shrink-0 text-neutral-400 hover:text-neutral-700" title="Expand">
            {expanded.has(f.path) ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button type="button" onClick={() => pick(f)} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100">
          <span className="min-w-0">
            <span className="block truncate font-medium text-neutral-700">{f.label}</span>
            {fmt(f.example) != null && <span className="block truncate text-[10px] text-neutral-400">{fmt(f.example)}</span>}
          </span>
          {f.type && <span className="shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-[9px] uppercase text-neutral-500">{f.type}</span>}
        </button>
      </div>
      {f.container && expanded.has(f.path) && childrenOf(g.sampleRecord, f.path).map((c) => renderField(g, c, depth + 1))}
    </div>
  );

  const groupHeader = (g: FieldGroup) => (
    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
      {!g.system && <SourceBadge source={g.appSource} size={14} />}
      {g.stepNo != null ? `${g.stepNo}. ` : ""}
      {g.from}
    </span>
  );

  return (
    <div className="relative" ref={wrapRef}>
      {value ? (
        <MappingChip stepNo={prov?.stepNo} source={prov?.source} label={prov?.label ?? value} sample={prov?.sample} onClick={() => setOpen((o) => !o)} onClear={() => onChange("")} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"
        >
          <span className="text-sm leading-none">+</span> Insert data
        </button>
      )}
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-80 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search data…" className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
          {groups.length === 0 && <p className="p-2 text-center text-xs text-neutral-400">No data yet. Test the earlier steps to load their fields.</p>}
          {groups.map((g) =>
            g.system ? (
              <details key={g.from} open={nonSystem.length === 0 || query.length > 0} className="mb-1">
                <summary className="cursor-pointer">{groupHeader(g)}</summary>
                <div className="mt-1 space-y-0.5">{g.fields.map((f) => renderField(g, f, 0))}</div>
              </details>
            ) : collapseGroups ? (
              <details key={g.from} open={query.length > 0} className="mb-1.5 rounded border border-neutral-100">
                <summary className="cursor-pointer px-1.5 py-1">{groupHeader(g)}</summary>
                <div className="space-y-0.5 px-1 pb-1">{g.fields.map((f) => renderField(g, f, 0))}</div>
              </details>
            ) : (
              <div key={g.from} className="mb-2">
                <p className="mb-1 px-1">{groupHeader(g)}</p>
                <div className="space-y-0.5">{g.fields.map((f) => renderField(g, f, 0))}</div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
