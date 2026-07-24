"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { anchorFromRect } from "./NodeLibraryModal";

/**
 * An edge whose "+" insert control appears only when you hover the midpoint. The control
 * is omitted entirely when `onInsert` is not provided (e.g. between a Paths hub and its
 * mandatory branch step, where inserting isn't allowed) — keeping branch lines clean.
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
            className="group flex h-8 w-8 items-center justify-center"
          >
            <button
              className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm leading-none text-neutral-500 opacity-0 shadow-sm transition-all hover:scale-110 hover:border-indigo-400 hover:bg-indigo-500 hover:text-white group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onInsert(id, anchorFromRect(e.currentTarget.getBoundingClientRect()));
              }}
              title="Insert a step here"
            >
              +
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
