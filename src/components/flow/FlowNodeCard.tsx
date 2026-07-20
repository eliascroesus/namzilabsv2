"use client";

import type { CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeType } from "@/lib/flow/types";
import type { FNode, NodeData } from "./graph-utils";
import { NODE_META, STATUS_META, nodeTitle, pathHandles, resultLabel, summary, type NodeStatus } from "./node-meta";
import { NodeGlyph } from "./icons";
import { SourceBadge } from "./controls";

// Edges are auto-managed (never dragged), so the connection handles are visually
// hidden — they only anchor the edge geometry, they are not interactive affordances.
const HIDDEN_HANDLE: CSSProperties = { opacity: 0, pointerEvents: "none", width: 6, height: 6, minWidth: 0, minHeight: 0, border: "none" };

export function FlowNodeCard({ id, type, data, selected }: NodeProps<FNode>) {
  const t = (type as NodeType) ?? "app";
  const meta = NODE_META[t];
  const status = (data.status ?? "setup") as NodeStatus;
  const sm = STATUS_META[status];
  const test = data.lastTest;
  const isPaths = t === "paths";
  const isCompare = t === "formula" || (t === "calculate" && String(data.config.mode ?? "") === "compare");
  const border = selected ? "border-blue-400 ring-2 ring-blue-500" : sm.border;
  const freeHandles = (data.freeHandles as Array<{ id: string; label: string }> | undefined) ?? [];

  return (
    <div className={`w-64 rounded-lg border bg-white shadow-sm ${border}`}>
      {/* input handle(s) on top — hidden; edges are auto-managed, never dragged */}
      {isCompare ? (
        <>
          <Handle type="target" id="a" position={Position.Top} style={{ ...HIDDEN_HANDLE, left: "35%" }} />
          <Handle type="target" id="b" position={Position.Top} style={{ ...HIDDEN_HANDLE, left: "65%" }} />
        </>
      ) : t !== "app" ? (
        <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      ) : null}

      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-neutral-700">
          <span className="shrink-0 text-neutral-500">
            {t === "app" ? <SourceBadge source={String(data.config.source ?? "")} size={16} /> : <NodeGlyph type={t} className="h-4 w-4" />}
          </span>
          <span className="truncate">{data.stepNo != null ? `${data.stepNo}. ` : ""}{nodeTitle(t, data)}</span>
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${sm.cls}`}>{sm.label}</span>
      </div>

      <div className="px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">{meta.label}</p>
        <p className="truncate text-sm text-neutral-700">{summary(t, data)}</p>

        {isPaths && (
          <div className="mt-1.5 space-y-1 rounded-md border border-pink-100 bg-pink-50/50 p-1.5">
            {((data.config.paths as Array<{ id: string; label: string }>) ?? []).map((p) => (
              <div key={p.id} className="truncate rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 shadow-sm">↳ {p.label}</div>
            ))}
            {data.config.fallbackId != null && (
              <div className="truncate px-1.5 py-0.5 text-[10px] text-neutral-500">↳ {String(data.config.fallbackLabel ?? "Fallback")} · everything else</div>
            )}
          </div>
        )}

        {/* The problem lives inside the affected step (no separate rail). */}
        {status === "error" && test?.status === "error" && <p className="mt-1 rounded bg-red-50 px-1.5 py-1 text-xs text-red-700">{test.error}</p>}
        {status === "setup" && data.issue && <p className="mt-1 rounded bg-neutral-50 px-1.5 py-1 text-xs text-neutral-600">{data.issue}</p>}
        {status === "ready" && test?.status === "ok" && <p className="mt-1 text-xs text-neutral-500">{resultLabel(t, test)}</p>}
      </div>

      {/* output handle(s) on bottom — hidden */}
      {isPaths ? (
        pathHandles(data).map((h, i, arr) => (
          <Handle key={h.id} type="source" id={h.id} position={Position.Bottom} title={h.label} style={{ ...HIDDEN_HANDLE, left: `${((i + 1) / (arr.length + 1)) * 100}%` }} />
        ))
      ) : t !== "output" ? (
        <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
      ) : null}

      {/* One "Add next step" at the end of a plain branch. */}
      {data.isTerminal && t !== "output" && !isPaths && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            (data as NodeData).onAddFrom?.(id, null);
          }}
          title="Add the next step"
          className="nodrag absolute left-1/2 top-full z-10 mt-3 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-900 hover:text-white"
        >
          + Add next step
        </button>
      )}

      {/* For a branch step, one "Add next step" per path that has no next step yet. */}
      {isPaths && freeHandles.length > 0 && (
        <div className="nodrag absolute left-1/2 top-full z-10 mt-3 flex -translate-x-1/2 flex-col items-center gap-1">
          {freeHandles.map((h) => (
            <button
              key={h.id}
              onClick={(e) => {
                e.stopPropagation();
                (data as NodeData).onAddFrom?.(id, h.id);
              }}
              title={`Add a step to “${h.label}”`}
              className="flex items-center gap-1 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-900 hover:text-white"
            >
              + Add to “{h.label}”
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
