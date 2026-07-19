"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeType } from "@/lib/flow/types";
import type { FNode, NodeData } from "./graph-utils";
import { NODE_META, formulaHandleLabels, nodeTitle, pathHandles, resultLabel, statusOf, summary } from "./node-meta";
import { NodeGlyph } from "./icons";
import { SourceBadge } from "./MappingChip";

/** Border colour reserves colour for STATE only (blue configuring, green valid, amber stale, red error). */
function stateBorder(data: NodeData, selected: boolean): string {
  if (selected) return "border-blue-400 ring-2 ring-blue-500";
  if (data.dirty) return "border-amber-300";
  const t = data.lastTest;
  if (!t) return "border-neutral-200";
  return t.status === "error" ? "border-red-300" : "border-green-300";
}

export function FlowNodeCard({ id, type, data, selected }: NodeProps<FNode>) {
  const t = (type as NodeType) ?? "app";
  const meta = NODE_META[t];
  const s = statusOf(data);
  const test = data.lastTest;
  const isPaths = t === "paths";
  const isFormula = t === "formula";
  const fHandles = isFormula ? formulaHandleLabels(String(data.config.op ?? "percentage")) : null;

  return (
    <div className={`w-60 rounded-lg border bg-white shadow-sm ${stateBorder(data, selected)}`}>
      {/* input handles */}
      {isFormula ? (
        <>
          <Handle type="target" id="a" position={Position.Left} style={{ top: "35%" }} />
          <Handle type="target" id="b" position={Position.Left} style={{ top: "65%" }} />
        </>
      ) : t !== "app" ? (
        <Handle type="target" position={Position.Left} />
      ) : null}

      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-neutral-700">
          <span className="shrink-0 text-neutral-500">
            {t === "app" ? <SourceBadge source={String(data.config.source ?? "")} size={16} /> : <NodeGlyph type={t} className="h-4 w-4" />}
          </span>
          <span className="truncate">{data.stepNo != null ? `${data.stepNo}. ` : ""}{nodeTitle(t, data)}</span>
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
      </div>

      <div className="px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">{meta.label}</p>
        <p className="truncate text-sm text-neutral-700">{summary(t, data)}</p>

        {isFormula && fHandles && (
          <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>▸ {fHandles.a}</span>
            <span>▸ {fHandles.b}</span>
          </div>
        )}

        {isPaths && (
          <ul className="mt-1 space-y-0.5">
            {pathHandles(data).map((h) => (
              <li key={h.id} className="truncate text-right text-[10px] text-neutral-500">
                {h.label} &rarr;
              </li>
            ))}
          </ul>
        )}

        {test && test.status === "ok" && <p className="mt-1 text-xs text-neutral-500">{resultLabel(t, test)}</p>}
        {test && test.status === "error" && <p className="mt-1 truncate text-xs text-red-600">{test.error}</p>}
      </div>

      {/* output handle(s) */}
      {isPaths ? (
        pathHandles(data).map((h, i, arr) => (
          <Handle key={h.id} type="source" id={h.id} position={Position.Right} title={h.label} style={{ top: `${((i + 1) / (arr.length + 1)) * 100}%` }} />
        ))
      ) : t !== "output" ? (
        <Handle type="source" position={Position.Right} />
      ) : null}

      {/* One prominent "Add next step" control beneath the selected step (connectors stay secondary). */}
      {selected && t !== "output" && !isPaths && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            (data as NodeData).onAddFrom?.(id, null);
          }}
          title="Add a step after this one"
          className="nodrag absolute left-1/2 top-full z-10 mt-2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-900 hover:text-white"
        >
          + Add next step
        </button>
      )}
    </div>
  );
}
