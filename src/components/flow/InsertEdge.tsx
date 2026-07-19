"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

/** An edge whose "+" insert control appears only when you hover the midpoint. */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const onInsert = (data as { onInsert?: (edgeId: string) => void } | undefined)?.onInsert;
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
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
