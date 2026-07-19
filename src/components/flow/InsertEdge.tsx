"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

/** An edge whose "+" insert control appears only when you hover the midpoint. */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const d = data as { onInsert?: (edgeId: string) => void; label?: string } | undefined;
  const onInsert = d?.onInsert;
  const branchLabel = d?.label;
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {branchLabel && (
        <EdgeLabelRenderer>
          <div
            style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${sourceX}px, ${sourceY + 16}px)`, pointerEvents: "none" }}
            className="max-w-[120px] truncate rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-[10px] font-medium text-pink-700"
          >
            {branchLabel}
          </div>
        </EdgeLabelRenderer>
      )}
      <EdgeLabelRenderer>
        <div
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
          className="group flex h-8 w-8 items-center justify-center"
        >
          <button
            className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs leading-none text-neutral-600 opacity-0 shadow transition-opacity hover:bg-neutral-900 hover:text-white group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onInsert?.(id);
            }}
            title="Insert a step here"
          >
            +
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
