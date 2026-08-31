"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { anchorFromRect } from "./NodeLibraryModal";

/**
 * An edge whose "+" insert control sits at the midpoint and is always visible. It used to
 * sit at 40% opacity until hover, but against the dotted canvas the dots showed straight
 * through it — that reads as a smudge on the line, not as something you can press. And the
 * "+" between steps is the single most important discovery affordance in the builder: hide
 * it until hover and a first-time user never learns that steps can be inserted mid-flow at
 * all. The control is omitted entirely when `onInsert` is not provided (e.g. between a Paths
 * hub and its mandatory branch step, where inserting isn't allowed) — keeping branch lines
 * clean.
 */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps) {
  // Generously rounded corners give the line a calm, modern turn instead of a
  // hard right angle.
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 22 });
  const onInsert = (data as { onInsert?: (edgeId: string, anchor?: { x: number; y: number; leftX?: number }) => void } | undefined)?.onInsert;
  /**
   * While a step is being carried, every `+` steps aside. The drop placeholder
   * IS the insert affordance for the length of the drag, and two of them in
   * the same gap — one round, one dashed — reads as two different things you
   * could do rather than one thing about to happen.
   */
  const carrying = (data as { carrying?: boolean } | undefined)?.carrying === true;
  return (
    <>
      {/* Colour, width and the dashed pattern come from `.react-flow__edge-path`
          in globals.css, so hover/selected states brighten the whole edge. */}
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {onInsert && !carrying && (
        <EdgeLabelRenderer>
          <div
            style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            className="group flex h-10 w-10 items-center justify-center"
          >
            {/* HOVER FILLS, SO HOVER IS THE BRAND. This is the same object as
                the drop placeholder's plus (drop-slot.tsx) — a small round
                filled affordance carrying a glyph — and the two are a foot
                apart on the same canvas, so they cannot be two different
                colours. The ink moves from white to `primary-foreground` with
                it: white on #eecf00 measures 1.4:1, where the near-black the
                brand is built to carry measures 11.24:1. The rim keeps its
                lighter step, now off the yellow ramp. */}
            <button
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-card transition-[transform,background-color,border-color,color] duration-(--duration-fast) hover:scale-110 hover:border-brand-400 hover:bg-primary hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onInsert(id, anchorFromRect(e.currentTarget.getBoundingClientRect()));
              }}
              title="Insert a step here"
            >
              <Plus size={14} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
