"use client";

import { LineChart, MoreVertical, Plus } from "lucide-react";

import { useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { relativeTime } from "@/lib/format";
import { type NodeType } from "@/lib/flow/types";
import { isBinaryCalc } from "@/lib/flow/shapes";
import type { FNode, NodeData } from "./graph-utils";
import { STATUS_META, nodeTitle, nodeVariant, pathHandles, resultLabel, type NodeStatus } from "./node-meta";
import { NodeIcon } from "./icons";
import { nodeAccent } from "./node-accent";
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
          className="nodrag flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/40"
          title="Step actions"
          aria-label="Step actions"
        >
          <MoreVertical size={18} strokeWidth={2} />
        </button>
      }
    >
      <div className="nodrag p-1 text-base">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            data.onDuplicateNode?.(id);
          }}
          className="block w-full rounded-control px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/40"
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
          className="block w-full rounded-control px-2 py-1.5 text-left text-destructive outline-none transition-colors hover:bg-danger-soft/60 focus-visible:ring-4 focus-visible:ring-ring/40"
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
  /**
   * ONE HAIRLINE, ONE GREY, ALWAYS — and selection is a HALO, not a border.
   *
   * The border used to carry status (`sm.border`: orange for needs-setup, green
   * for tested), so a canvas of healthy steps was a wall of outlines and a card
   * changed its edge as you clicked around. Status is the dot and the hint line
   * under the title instead — both say it, neither shouts it.
   *
   * Selection was then a second border in a second colour, which against the
   * accent edge on the left gave the card two rims of different colours meeting
   * at one corner. So the border NEVER changes: the halo sits outside it, and
   * the card keeps exactly one edge in every state.
   */
  const border = selected ? "border-border ring-[3px] ring-primary/40" : "border-border";
  const accent = nodeAccent(t, nodeVariant(t, data.config as Record<string, unknown>));
  const freeHandles = (data.freeHandles as Array<{ id: string; label: string }> | undefined) ?? [];

  /**
   * A NUMBER WITH NO DATE ON IT IS THE TRAP THIS CARD USED TO SET.
   *
   * The count here is CACHED from the last Test — it is not recomputed on
   * render and nothing on the canvas ever refreshed it. So "6 passed" read the
   * same on the day it was measured and three days later, while the dashboard
   * (computed from the published version) said something else, and neither
   * surface looked wrong. The age is the whole fix: a figure that says when it
   * was measured cannot be mistaken for a live one.
   *
   * Older results carry no `testedAt`, and those render exactly as they always
   * did — no time rather than an invented one.
   */
  const measuredAt = typeof test?.testedAt === "string" ? new Date(test.testedAt) : null;
  const testedAge = measuredAt && !Number.isNaN(measuredAt.getTime()) ? relativeTime(measuredAt) : null;
  /** The step (or something above it) changed after this count was measured. */
  const superseded = (data as { superseded?: boolean }).superseded === true && test?.status === "ok";
  const count = test?.status === "ok" ? resultLabel(t, test, data.config as Record<string, unknown>) : null;

  // The single body line: the plain output when ready, a hint when setup, else nothing.
  // Its colour follows the status dot, so the amber pair reads as one signal.
  //
  // A superseded count is struck rather than dropped: the number is still the
  // last thing this step measured, and showing it crossed out beside the way
  // to refresh it says more than an empty line does. It stays MUTED — the step
  // blocks nothing, and colour on this canvas is reserved for what does.
  const bodyLine =
    status === "error" && test?.status === "error"
      ? { text: test.error, cls: sm.hint, struck: null }
      : status === "setup" && data.issue
        ? { text: data.issue, cls: sm.hint, struck: null }
        : superseded && count != null
          ? { text: " · re-test to update", cls: "text-muted-foreground", struck: count }
          : status === "ready" && count != null
            ? { text: testedAge ? `${count} · tested ${testedAge}` : count, cls: "text-muted-foreground", struck: null }
            : null;
  // The tooltip is the unabridged line — the card is 300px and truncates, and
  // what gets cut first is the age, which is the part worth reading twice.
  const bodyTitle = bodyLine?.struck ? `${bodyLine.struck}${testedAge ? ` · tested ${testedAge}` : ""}${bodyLine.text}` : (bodyLine?.text ?? "");

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
    /*
       * `has-[[data-add-btn]:hover]:shadow-card` is not a flourish. The "Add
       * next step" ghost and the branch chips are absolutely positioned CHILDREN
       * of this box — they have to be, a React Flow node is one element — so
       * hovering them satisfies this element's own `:hover` and lit the card
       * above them. You reached for empty canvas and a step lifted. `:has()`
       * pins the resting elevation back while the pointer is on one of them,
       * and outranks the `:hover` rule on specificity, so order is not load-
       * bearing.
       */
    <div
      /* The step's own colour on the edge you read first. The 44px mark carries
         type but sits INSIDE the card, so a column of steps was a column of
         white rectangles until you read each one. A left BORDER rather than an
         inner strip: the radius clips it for free and nothing inside the card
         can knock it out of alignment. */
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
      className={`group/card w-[300px] rounded-surface border bg-card shadow-surface transition-all duration-150 hover:shadow-card-hover has-[[data-add-btn]:hover]:shadow-surface ${border}`}
    >
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

      {/* ---- Head: the step, at a size you can actually read ----
          It was a 30px icon, a 14px title and a 2px dot crammed into one
          40px row — a list item, not a card, on a canvas made of nothing but
          these. Now: a 44px mark, the step number as its own chip so it stops
          eating the title's width, and the title on its own line. */}
      <div className="flex items-start gap-3 p-3.5">
        <NodeIcon type={t} source={String(data.config.source ?? "")} variant={nodeVariant(t, data.config as Record<string, unknown>)} size={44} />

        <span className="min-w-0 flex-1 pt-0.5">
          <span className="flex items-center gap-1.5">
            {data.stepNo != null && (
              <span className="tnum rounded-control bg-muted px-1.5 py-0.5 text-micro font-semibold text-muted-foreground">{data.stepNo}</span>
            )}
            <span className="min-w-0 truncate text-lead font-semibold text-foreground">{nodeTitle(t, data)}</span>
          </span>
          {bodyLine && (
            <span className={`mt-1 block truncate text-tiny font-medium ${bodyLine.cls}`} title={bodyTitle}>
              {bodyLine.struck && <span className="line-through">{bodyLine.struck}</span>}
              {bodyLine.text}
            </span>
          )}
          {refLine && (
            <span className="mt-0.5 block truncate text-tiny text-brand-600" title={refLine}>
              {refLine}
            </span>
          )}
          {sourceLine && (
            <span className="mt-0.5 block truncate text-tiny text-warn-ink" title={sourceLine}>
              {sourceLine}
            </span>
          )}
        </span>

        {/* The kebab appears on hover or while its own menu is open, so a
            resting canvas is cards and nothing else. The status dot stays
            put — it is information, not a control. */}
        <span className="flex shrink-0 items-center gap-1 pt-1">
          <span className={`h-2 w-2 rounded-full ${sm.dot}`} title={sm.label} aria-label={sm.label} />
          <span className="opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
            <NodeMenu id={id} data={data} />
          </span>
        </span>
      </div>

      {/* The publish rule, said on the canvas instead of only at the gate.
          The strip's own bottom corners have to be the INSIDE of the card's —
          the surface radius minus the 1px border — so it is written as that
          subtraction rather than as a literal. A literal sat at 13px (the
          inside of 12px) for a whole radius step after the card grew;
          `calc(var(--radius-surface) - 1px)` cannot fall behind.
          `bg-accent`/`text-accent-foreground` ARE brand-50/brand-700; the
          hairline between them has no token at the 100 step, so it stays raw. */}
      {publishes != null && (
        <div
          className={`flex items-center gap-1.5 rounded-b-[calc(var(--radius-surface)-1px)] border-t px-3.5 py-2 text-micro font-semibold ${
            publishes ? "border-brand-100 bg-accent text-accent-foreground" : "border-border bg-muted/50 text-muted-foreground"
          }`}
          title={publishes ? "This step's result becomes a tile when you publish." : "Switched off in Review & publish — this step publishes nothing."}
        >
          <LineChart size={14} strokeWidth={2.25} />
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
          className="nodrag absolute left-1/2 top-full z-10 mt-8 flex w-[300px] -translate-x-1/2 items-center gap-2.5 rounded-surface border-2 border-dashed border-border bg-card p-3 text-left text-base font-semibold text-muted-foreground shadow-surface outline-none transition-all hover:border-primary hover:text-primary focus-visible:ring-4 focus-visible:ring-ring/40"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-control border-2 border-dashed border-current opacity-70">
            <Plus size={16} strokeWidth={2} />
          </span>
          Add next step
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
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-dashed border-border bg-card px-3 py-1.5 text-tiny font-semibold text-muted-foreground outline-none transition-all hover:border-primary hover:text-primary focus-visible:ring-4 focus-visible:ring-ring/40"
            >
              <Plus size={14} strokeWidth={2.25} />
              {h.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
