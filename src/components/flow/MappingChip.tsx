"use client";

import { sourceStyle } from "./node-meta";

/** A basic, brand-coloured badge for a data source (app-agnostic; see node-meta). */
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
 * A Zapier-style data pill for a dynamic (mapped) value: source badge + step number
 * + field name + sample value. Never shows a raw field path.
 */
export function MappingChip({
  stepNo,
  source,
  label,
  sample,
  onClick,
  onClear,
}: {
  stepNo?: number;
  source?: string | null;
  label: string;
  sample?: unknown;
  onClick?: () => void;
  onClear?: () => void;
}) {
  const s = fmtSample(sample);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-1 text-xs text-blue-900">
      <SourceBadge source={source} size={14} />
      {stepNo != null && <span className="shrink-0 text-blue-500">{stepNo}.</span>}
      <button type="button" onClick={onClick} className="min-w-0 truncate font-medium hover:underline" title={label}>
        {label}
      </button>
      {s && <span className="min-w-0 truncate text-blue-500/80">· {s}</span>}
      {onClear && (
        <button type="button" onClick={onClear} className="ml-0.5 shrink-0 text-blue-400 hover:text-blue-700" title="Clear mapping" aria-label="Clear mapping">
          ✕
        </button>
      )}
    </span>
  );
}
