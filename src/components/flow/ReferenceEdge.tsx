"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

/**
 * WHERE A COMPARE STEP'S NUMBERS COME FROM, drawn only while you are looking
 * at that step.
 *
 * A Compare reads two earlier steps through named inputs, and those links were
 * drawn nowhere: `displayEdges` dropped them and `structuralEdges` hid them
 * from the layout. The reasoning was sound — reference lines run sideways
 * across a managed column and would turn a clean flow into spaghetti — but the
 * consequence was that the canvas could not show the relationship that most
 * often goes wrong. The product papered over it twice, with the panel's
 * "Reads records from 2. Calls dialed" note and with its expression line.
 *
 * So the line exists, and its cost is paid only when it is useful: it is
 * rendered for the SELECTED step alone. Default canvas stays a clean column;
 * click the step and its two inputs light up, labelled with the slot they
 * fill ("Count this" / "Out of this") rather than with a letter.
 *
 * Bezier rather than the chain edge's smoothstep, dashed rather than solid,
 * and indigo rather than grey — three signals that this is a data reference
 * and not a step's place in the line, because those are different things and
 * a user who reads one as the other will look for their bug in the wrong step.
 */
export function ReferenceEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const label = (data as { label?: string } | undefined)?.label;
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: "#818cf8", strokeWidth: 1.5, strokeDasharray: "5 4" }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "none" }}
            className="whitespace-nowrap rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-micro font-semibold text-indigo-600 shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
