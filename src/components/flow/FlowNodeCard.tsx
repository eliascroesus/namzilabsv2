"use client";

import { useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { isDatasetFormulaOp, type NodeType } from "@/lib/flow/types";
import type { FNode, NodeData } from "./graph-utils";
import { STATUS_META, nodeTitle, pathHandles, resultLabel, type NodeStatus } from "./node-meta";
import { NodeIcon } from "./icons";
import { Popover } from "./controls/Popover";

// Edges are auto-managed (never dragged), so the connection handles are visually
// hidden — they only anchor the edge geometry, they are not interactive affordances.
const HIDDEN_HANDLE: CSSProperties = { opacity: 0, pointerEvents: "none", width: 6, height: 6, minWidth: 0, minHeight: 0, border: "none" };

/** The kebab (⋮) menu on each card: Duplicate + Delete. Replaces the panel's Step options. */
function NodeMenu({ id, data }: { id: string; data: NodeData }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      setOpen={setOpen}
      width={150}
      align="right"
      anchor={
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className="nodrag rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          title="Step actions"
          aria-label="Step actions"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="8" cy="3" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="8" cy="13" r="1.4" />
          </svg>
        </button>
      }
    >
      <div className="nodrag p-1 text-sm">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            data.onDuplicateNode?.(id);
          }}
          className="block w-full rounded px-2 py-1.5 text-left hover:bg-neutral-100"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            data.onDeleteNode?.(id);
          }}
          className="block w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </Popover>
  );
}

export function FlowNodeCard({ id, type, data, selected }: NodeProps<FNode>) {
  const t = (type as NodeType) ?? "app";
  const status = (data.status ?? "setup") as NodeStatus;
  const sm = STATUS_META[status];
  const test = data.lastTest;
  const isPaths = t === "paths";
  const isCompare =
    (t === "formula" && !isDatasetFormulaOp(data.config.op ?? "percentage")) ||
    (t === "calculate" && String(data.config.mode ?? "") === "compare");
  const border = selected ? "border-blue-400 ring-2 ring-blue-500" : sm.border;
  const freeHandles = (data.freeHandles as Array<{ id: string; label: string }> | undefined) ?? [];

  // The single body line: the plain output when ready, a hint when setup, else nothing.
  const bodyLine =
    status === "error" && test?.status === "error"
      ? { text: test.error, cls: "text-red-600" }
      : status === "setup" && data.issue
        ? { text: data.issue, cls: "text-neutral-400" }
        : status === "ready" && test?.status === "ok"
          ? { text: resultLabel(t, test), cls: "text-neutral-500" }
          : null;

  return (
    <div className={`w-64 rounded-xl border bg-white shadow-sm ${border}`}>
      {isCompare ? (
        <>
          {/* Both number inputs anchor at top-centre; the edges enter straight down (no
              off-centre jog). The two numbers are chosen in the panel, not by port. */}
          <Handle type="target" id="a" position={Position.Top} style={HIDDEN_HANDLE} />
          <Handle type="target" id="b" position={Position.Top} style={HIDDEN_HANDLE} />
        </>
      ) : t !== "app" ? (
        <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      ) : null}

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <NodeIcon type={t} source={String(data.config.source ?? "")} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-800">
            {data.stepNo != null ? `${data.stepNo}. ` : ""}
            {nodeTitle(t, data)}
          </span>
          {bodyLine && <span className={`block truncate text-xs ${bodyLine.cls}`}>{bodyLine.text}</span>}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${sm.cls}`}>{sm.label}</span>
        <NodeMenu id={id} data={data} />
      </div>

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
            const r = e.currentTarget.getBoundingClientRect();
            (data as NodeData).onAddFrom?.(id, null, { x: r.right, y: r.top });
          }}
          title="Add the next step"
          className="nodrag absolute left-1/2 top-full z-10 mt-3 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
        >
          + Add next step
        </button>
      )}

      {/* For a branch hub, one "Add next step" per path that has no next step yet. */}
      {isPaths && freeHandles.length > 0 && (
        <div className="nodrag absolute left-1/2 top-full z-10 mt-3 flex -translate-x-1/2 flex-col items-center gap-1">
          {freeHandles.map((h) => (
            <button
              key={h.id}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                (data as NodeData).onAddFrom?.(id, h.id, { x: r.right, y: r.top });
              }}
              title={`Add a step to “${h.label}”`}
              className="flex items-center gap-1 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
            >
              + Add to “{h.label}”
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
