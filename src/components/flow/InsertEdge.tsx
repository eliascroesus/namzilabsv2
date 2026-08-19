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
  return (
    <>
      {/* Colour, width and the dashed pattern come from `.react-flow__edge-path`
          in globals.css, so hover/selected states brighten the whole edge. */}
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {onInsert && (
        <EdgeLabelRenderer>
          <div
            style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            className="group flex h-10 w-10 items-center justify-center"
          >
            <button
              className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-raised transition-all hover:scale-110 hover:border-brand-400 hover:bg-brand-500 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                onInsert(id, anchorFromRect(e.currentTarget.getBoundingClientRect()));
              }}
              title="Insert a step here"
            >
              <Plus size={15} strokeWidth={2.6} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
