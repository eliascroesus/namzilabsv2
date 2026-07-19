"use client";

import { useState } from "react";
import type { FlowCheck } from "./graph-utils";

/**
 * A persistent, floating "Flow check" rail. Lists what's wrong, what each issue
 * changes, and one action that jumps to the exact step. Collapsible; shows a green
 * all-clear when there are no issues.
 */
export function FlowCheckRail({ checks, onFix }: { checks: FlowCheck[]; onFix: (nodeId?: string) => void }) {
  const [open, setOpen] = useState(true);
  const n = checks.length;
  return (
    <div className="absolute right-4 top-4 z-10 w-72 overflow-hidden rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-sm font-medium">
          {n === 0 ? (
            <>
              <span className="text-green-600">✓</span> Flow check: all clear
            </>
          ) : (
            <>
              <span className="text-amber-600">⚠</span> {n} thing{n === 1 ? "" : "s"} to fix
            </>
          )}
        </span>
        <span className="text-neutral-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && n > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto border-t border-neutral-100 p-2">
          {checks.map((c, i) => (
            <div key={i} className="rounded border border-neutral-200 p-2">
              <p className="text-xs font-medium text-neutral-800">{c.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{c.impact}</p>
              <button onClick={() => onFix(c.nodeId)} className="mt-1.5 rounded bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-neutral-800">
                {c.fixLabel} →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
