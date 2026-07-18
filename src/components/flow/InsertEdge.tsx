"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

/** An edge with a contextual "+" button at its midpoint to insert a step. */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const onInsert = (data as { onInsert?: (edgeId: string) => void } | undefined)?.onInsert;
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs leading-none text-neutral-600 shadow hover:bg-neutral-900 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onInsert?.(id);
          }}
          title="Insert a step here"
        >
          +
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
