"use client";

import { useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { type NodeType } from "@/lib/flow/types";
import { isBinaryCalc } from "@/lib/flow/shapes";
import type { FNode, NodeData } from "./graph-utils";
import { STATUS_META, nodeTitle, nodeVariant, pathHandles, resultLabel, type NodeStatus } from "./node-meta";
import { NodeIcon } from "./icons";
import { anchorFromRect } from "./NodeLibraryModal";
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
    isBinaryCalc(t, data.config as Record<string, unknown>) ||
    (t === "calculate" && String(data.config.mode ?? "") === "compare");
  const border = selected ? "border-blue-400 ring-2 ring-blue-500" : sm.border;
  const freeHandles = (data.freeHandles as Array<{ id: string; label: string }> | undefined) ?? [];

  // The single body line: the plain output when ready, a hint when setup, else nothing.
  // Its colour follows the status dot, so the amber pair reads as one signal.
  const bodyLine =
    status === "error" && test?.status === "error"
      ? { text: test.error, cls: sm.hint }
      : status === "setup" && data.issue
        ? { text: data.issue, cls: sm.hint }
        : status === "ready" && test?.status === "ok"
          ? { text: resultLabel(t, test, data.config as Record<string, unknown>), cls: "text-neutral-500" }
          : null;

  // A second line, only when the source itself has something to say — today
  // that is "still importing, covering N of M days". The count above it is a
  // floor while that is true, and a card that shows the floor alone is the
  // silent-zero shape: nothing on the canvas would indicate the number is
  // still moving. Rendered only when there IS a note, so quiet steps keep
  // their single line.
  const sourceLine = status === "ready" && test?.status === "ok" ? test.sourceNote : null;

  /**
   * A compare step's two inputs, on the card. Its links are drawn only while
   * it is selected (see ReferenceEdge), so without this the card is the one
   * place in the product that shows a number and not where it came from —
   * and "why is this 38%" is answered by opening the step rather than by
   * looking at it.
   */
  const refLine = (data as { refLine?: string }).refLine;
  /** True when this step's result becomes a dashboard tile on publish. */
  const publishes = (data as { publishes?: boolean }).publishes;

  return (
    /**
     * NEVER `overflow-hidden` ON THIS CARD.
     *
     * The kebab menu is a non-fixed Popover — absolutely positioned inside
     * this element — and so is clipped to it. Adding `overflow-hidden` here
     * (to round the footer strip's bottom corners) silently cut the menu off
     * at the card's edge: "Duplicate" survived, "Delete" did not, and nothing
     * about it looked broken.
     *
     * `position: fixed` is not the escape hatch it would be anywhere else,
     * either: React Flow's viewport is CSS-transformed, and a fixed child of a
     * transformed ancestor anchors to that ancestor rather than to the window
     * (the same trap `flow-pop-in` documents for the config panel). So the
     * rule is simply: this box does not clip.
     */
    <div className={`w-64 rounded-xl border bg-white shadow-sm transition-[border-color,box-shadow] duration-150 ${border}`}>
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
        <NodeIcon type={t} source={String(data.config.source ?? "")} variant={nodeVariant(t, data.config as Record<string, unknown>)} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-800">
            {data.stepNo != null ? `${data.stepNo}. ` : ""}
            {nodeTitle(t, data)}
          </span>
          {bodyLine && <span className={`block truncate text-xs ${bodyLine.cls}`} title={bodyLine.text}>{bodyLine.text}</span>}
          {refLine && <span className="block truncate text-xs text-indigo-600" title={refLine}>{refLine}</span>}
          {sourceLine && <span className="block truncate text-xs text-amber-700" title={sourceLine}>{sourceLine}</span>}
        </span>
        {/* A DOT, NOT A BADGE. "Needs setup" is 72px of a 256px card, and it
            was taking them from the title — a step read "2. Match ..." while
            spending most of its width on a word the border colour and the
            amber hint line already say. The full label lives in the tooltip
            and, in full, in the config panel's header, where there is room. */}
        <span className={`h-2 w-2 shrink-0 rounded-full ${sm.dot}`} title={sm.label} aria-label={sm.label} />
        <NodeMenu id={id} data={data} />
      </div>

      {/* The publish rule, said on the canvas instead of only at the gate. */}
      {publishes != null && (
        <div
          className={`flex items-center gap-1.5 border-t px-3 py-1.5 text-[10px] font-medium ${
            publishes ? "border-indigo-100 bg-indigo-50/70 text-indigo-700" : "border-neutral-100 bg-neutral-50 text-neutral-400"
          }`}
          title={publishes ? "This step's result becomes a tile when you publish." : "Switched off in Review & publish — this step publishes nothing."}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 3v18h18" />
            <path d="M7 15l4-5 3 3 5-7" />
          </svg>
          {publishes ? "On your dashboard" : "Not published"}
        </div>
      )}

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
          data-add-btn={id}
          onClick={(e) => {
            e.stopPropagation();
            (data as NodeData).onAddFrom?.(id, null, anchorFromRect(e.currentTarget.getBoundingClientRect()));
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
              data-add-btn={`${id}:${h.id}`}
              onClick={(e) => {
                e.stopPropagation();
                (data as NodeData).onAddFrom?.(id, h.id, anchorFromRect(e.currentTarget.getBoundingClientRect()));
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
