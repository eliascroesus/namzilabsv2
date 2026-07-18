"use client";

import { useState } from "react";
import type { FieldGroup, PickField } from "./graph-utils";

function valueType(v: unknown): string {
  if (Array.isArray(v)) return "list";
  if (v === null || v === undefined) return "empty";
  if (typeof v === "object") return "object";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "text";
}

function preview(ex: unknown): string | null {
  if (ex == null) return null;
  if (Array.isArray(ex)) return `[${ex.length} items]`;
  if (typeof ex === "object") return "{…}";
  const s = String(ex);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

/** Nested fields inside an object/array sample value (one level down). */
function childrenOf(path: string, example: unknown): PickField[] | null {
  if (example == null || typeof example !== "object") return null;
  if (Array.isArray(example)) {
    if (example.length === 0) return null;
    const first = example[0];
    if (first != null && typeof first === "object" && !Array.isArray(first)) {
      return Object.entries(first).map(([k, v]) => ({ path: `${path}.0.${k}`, label: k, type: valueType(v), example: v }));
    }
    return [{ path: `${path}.0`, label: "first item", type: valueType(first), example: first }];
  }
  return Object.entries(example as Record<string, unknown>).map(([k, v]) => ({ path: `${path}.${k}`, label: k, type: valueType(v), example: v }));
}

/** Look up a field's display metadata (for rendering a mapped-value chip). */
export function findFieldMeta(fieldGroups: FieldGroup[], path: string): { label: string; example?: unknown; icon?: string; stepNo?: number } | null {
  for (const g of fieldGroups) {
    const f = g.fields.find((x) => x.path === path);
    if (f) return { label: f.label, example: f.example, icon: g.icon, stepNo: g.stepNo };
  }
  return null;
}

/** The searchable, hierarchical data browser popover (grouped by step). */
export function FieldBrowser({ fieldGroups, onPick }: { fieldGroups: FieldGroup[]; onPick: (f: PickField) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = fieldGroups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !query || `${f.label} ${f.path}`.toLowerCase().includes(query)) }))
    .filter((g) => g.fields.length > 0);
  return (
    <div className="absolute right-0 z-20 mt-1 max-h-80 w-80 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
      {groups.length === 0 && <p className="p-2 text-center text-xs text-neutral-400">No fields yet. Preview upstream steps to load their fields.</p>}
      {groups.map((g) =>
        g.system ? (
          <details key={g.from} open={groups.length === 1 || query.length > 0} className="mb-1">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.icon ?? "⚙️"} System fields</summary>
            <div className="mt-1 space-y-0.5">
              {g.fields.map((f) => (
                <FieldRow key={f.path} field={f} depth={0} onPick={onPick} />
              ))}
            </div>
          </details>
        ) : (
          <div key={g.from} className="mb-2">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              <span className="text-sm leading-none">{g.icon ?? "▸"}</span>
              {g.stepNo != null ? `${g.stepNo}. ` : ""}
              {g.from}
            </p>
            <div className="space-y-0.5">
              {g.fields.map((f) => (
                <FieldRow key={f.path} field={f} depth={0} onPick={onPick} />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** Field input with a searchable, hierarchical data browser grouped by step. */
export function FieldPicker({ value, fieldGroups, onChange }: { value: string; fieldGroups: FieldGroup[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="flex gap-1">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="field (e.g. subject or properties.plan)" className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
        <button type="button" onClick={() => setOpen((o) => !o)} title="Browse fields from a previous step" className="w-7 rounded-md border border-neutral-300 text-xs hover:bg-neutral-50">
          +
        </button>
      </div>
      {open && (
        <FieldBrowser
          fieldGroups={fieldGroups}
          onPick={(f) => {
            onChange(f.path);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** A value input that is either a fixed literal or a mapped field (rendered as a chip). */
export function ValueInput({ value, valueField, fieldGroups, onChange }: { value: string; valueField?: string; fieldGroups: FieldGroup[]; onChange: (patch: { value?: string; valueField?: string }) => void }) {
  const [open, setOpen] = useState(false);
  if (valueField) {
    const meta = findFieldMeta(fieldGroups, valueField);
    const ex = meta?.example != null ? String(meta.example) : null;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="flex min-w-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-900" title={valueField}>
          <span>{meta?.icon ?? "▸"}</span>
          {meta?.stepNo != null && <span className="text-blue-400">{meta.stepNo}.</span>}
          <span className="truncate font-medium">{meta?.label ?? valueField}</span>
          {ex && <span className="truncate text-blue-400">· {ex.length > 14 ? `${ex.slice(0, 14)}…` : ex}</span>}
        </span>
        <button type="button" onClick={() => onChange({ valueField: undefined })} title="Use a fixed value instead" className="shrink-0 text-neutral-400 hover:text-neutral-700">
          ✕
        </button>
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1">
      <input value={value ?? ""} placeholder="value" onChange={(e) => onChange({ value: e.target.value })} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
      <button type="button" onClick={() => setOpen((o) => !o)} title="Use a field instead" className="shrink-0 rounded-md border border-neutral-300 px-1.5 py-1 text-[10px] font-medium text-neutral-500 hover:bg-neutral-50">
        𝑓
      </button>
      {open && (
        <FieldBrowser
          fieldGroups={fieldGroups}
          onPick={(f) => {
            onChange({ valueField: f.path, value: "" });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function FieldRow({ field, depth, onPick }: { field: PickField; depth: number; onPick: (f: PickField) => void }) {
  const [expanded, setExpanded] = useState(false);
  const kids = depth < 3 ? childrenOf(field.path, field.example) : null;
  const ex = preview(field.example);
  return (
    <div style={{ marginLeft: depth * 10 }}>
      <div className="flex items-center gap-1">
        {kids ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="w-3 shrink-0 text-[10px] text-neutral-400" title="Expand">
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button type="button" onClick={() => onPick(field)} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100">
          <span className="min-w-0">
            <span className="block truncate font-medium text-neutral-700">{field.label}</span>
            {ex != null && <span className="block truncate text-[10px] text-neutral-400">{ex}</span>}
          </span>
          {field.type && <span className="shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-[9px] uppercase text-neutral-500">{field.type}</span>}
        </button>
      </div>
      {expanded && kids && (
        <div className="space-y-0.5">
          {kids.map((k) => (
            <FieldRow key={k.path} field={k} depth={depth + 1} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}
