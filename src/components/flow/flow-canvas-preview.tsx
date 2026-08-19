import { LineChart } from "lucide-react";
import { STATUS_META, type NodeStatus } from "./node-meta";
import { NodeIcon } from "./icons";

/**
 * A step card for the UI kit page — layout only.
 *
 * The real `FlowNodeCard` is a React Flow node: it needs `NodeProps`, edge
 * handles, a live graph and callbacks, none of which exist on a static page.
 * So this mirrors its BOX, and imports everything that carries meaning —
 * `STATUS_META` for the dot and border, `NodeIcon` for the glyph and accent —
 * from the same modules the canvas uses.
 *
 * That split is the point: if someone changes a status colour or a step
 * glyph, this page changes with it, and if someone changes the card's padding
 * only the canvas moves. The first is the drift worth catching; the second is
 * not worth coupling two files over.
 */
export function FlowNodeCard({
  variant,
  title,
  body,
  status,
  publishes,
}: {
  variant: "app" | "filter" | "unite" | "unite_match" | "formula" | "formula_compare" | "paths" | "time_between";
  title: string;
  body?: string;
  status: NodeStatus;
  publishes?: boolean;
}) {
  const sm = STATUS_META[status];
  const type = variant.startsWith("unite") ? "unite" : variant.startsWith("formula") ? "formula" : variant;
  const source = variant === "app" ? "gsheets" : undefined;
  return (
    <div className={`w-64 rounded-card border bg-white shadow-sm ${sm.border}`}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <NodeIcon type={type} source={source} variant={variant.includes("_") ? variant : undefined} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-neutral-800">{title}</span>
          {body && <span className={`block truncate text-tiny ${status === "setup" ? sm.hint : "text-neutral-500"}`}>{body}</span>}
        </span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${sm.dot}`} />
        <span className="text-neutral-400" aria-hidden>
          ⋮
        </span>
      </div>
      {publishes && (
        <div className="flex items-center gap-1.5 border-t border-brand-100 bg-brand-50/70 px-3 py-1.5 text-micro font-medium text-brand-700">
<LineChart size={11} strokeWidth={2.4} />
          On your dashboard
        </div>
      )}
    </div>
  );
}
