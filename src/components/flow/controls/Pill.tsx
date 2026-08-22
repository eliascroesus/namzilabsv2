"use client";

import { AlertTriangle, X } from "lucide-react";
import { sourceStyle } from "./source-style";

/** A small brand-coloured badge for a data source (app icon stand-in). */
export function SourceBadge({ source, size = 16 }: { source?: string | null; size?: number }) {
  const s = sourceStyle(source);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white"
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
  const tone = stale ? "border-warn-soft bg-warn-soft/50 text-warn-ink" : "border-border bg-muted/50 text-foreground";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-control border px-1.5 py-1 text-tiny ${tone}`} title={stale ? "This field's source is missing — pick it again" : label}>
      {stale ? <AlertTriangle size={12} strokeWidth={2.25} className="shrink-0" aria-hidden /> : <SourceBadge source={source} size={14} />}
      {stepNo != null && <span className="shrink-0 opacity-60">{stepNo}.</span>}
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 truncate rounded-control font-medium outline-none hover:underline focus-visible:ring-4 focus-visible:ring-ring/40"
      >
        {label}
      </button>
      {!stale && s && <span className="min-w-0 truncate opacity-70">· {s}</span>}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 flex shrink-0 items-center justify-center rounded-full p-0.5 opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:ring-4 focus-visible:ring-ring/40"
          title="Clear"
          aria-label="Clear"
        >
          <X size={12} strokeWidth={2.25} />
        </button>
      )}
    </span>
  );
}
