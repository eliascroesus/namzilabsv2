"use client";

import { sourceStyle } from "./source-style";

/** A small brand-coloured badge for a data source (app icon stand-in). */
export function SourceBadge({ source, size = 16 }: { source?: string | null; size?: number }) {
  const s = sourceStyle(source);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded font-semibold leading-none text-white"
      style={{ background: s.color, width: size, height: size, fontSize: Math.round(size * 0.5) }}
      title={s.label}
      aria-hidden
    >
      {s.short}
    </span>
  );
}

function fmtSample(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

/**
 * A Zapier-style data pill for a mapped value: source badge + step number + human field
 * name + sample value. `stale` renders an amber warning state when the producing step or
 * field is gone (references are never silently remapped). Never shows a raw path.
 */
export function DataPill({
  stepNo,
  source,
  label,
  sample,
  stale = false,
  onClick,
  onClear,
}: {
  stepNo?: number;
  source?: string | null;
  label: string;
  sample?: unknown;
  stale?: boolean;
  onClick?: () => void;
  onClear?: () => void;
}) {
  const s = fmtSample(sample);
  const tone = stale ? "border-amber-300 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-1 text-xs ${tone}`} title={stale ? "This field's source is missing — pick it again" : label}>
      {stale ? <span className="shrink-0">⚠</span> : <SourceBadge source={source} size={14} />}
      {stepNo != null && <span className="shrink-0 opacity-60">{stepNo}.</span>}
      <button type="button" onClick={onClick} className="min-w-0 truncate font-medium hover:underline">
        {label}
      </button>
      {!stale && s && <span className="min-w-0 truncate opacity-70">· {s}</span>}
      {onClear && (
        <button type="button" onClick={onClear} className="ml-0.5 shrink-0 opacity-60 hover:opacity-100" title="Clear" aria-label="Clear">
          ✕
        </button>
      )}
    </span>
  );
}
