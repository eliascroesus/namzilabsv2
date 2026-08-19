import { LineChart, Plus } from "lucide-react";
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
  stepNo,
}: {
  variant: "app" | "filter" | "unite" | "unite_match" | "formula" | "formula_compare" | "paths" | "time_between";
  title: string;
  body?: string;
  status: NodeStatus;
  publishes?: boolean;
  stepNo?: number;
}) {
  const sm = STATUS_META[status];
  const type = variant.startsWith("unite") ? "unite" : variant.startsWith("formula") ? "formula" : variant;
  const source = variant === "app" ? "gsheets" : undefined;
  return (
    <div className={`w-[300px] rounded-card border bg-card shadow-raised ${sm.border}`}>
      <div className="flex items-start gap-3 p-3.5">
        <NodeIcon type={type} source={source} variant={variant.includes("_") ? variant : undefined} size={44} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="flex items-center gap-1.5">
            {stepNo != null && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-micro font-bold tabular-nums text-muted-foreground">{stepNo}</span>
            )}
            <span className="min-w-0 truncate text-lead font-semibold text-foreground">{title}</span>
          </span>
          {body && (
            <span className={`mt-1 block truncate text-tiny font-medium ${status === "setup" ? sm.hint : "text-muted-foreground"}`}>{body}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 pt-1">
          <span className={`h-2 w-2 rounded-full ${sm.dot}`} />
        </span>
      </div>
      {publishes && (
        <div className="flex items-center gap-1.5 rounded-b-[13px] border-t border-brand-100 bg-brand-50 px-3.5 py-2 text-micro font-semibold text-brand-700">
          <LineChart size={12} strokeWidth={2.4} />
          On your dashboard
        </div>
      )}
    </div>
  );
}

/**
 * A slice of the real canvas: two connected steps, the dashed connector, and
 * the ghost "Add next step" card. The cards in isolation could not show what
 * actually needed fixing — the RHYTHM between them, which is most of what a
 * canvas is.
 */
export function CanvasPreview() {
  return (
    <div className="relative overflow-hidden rounded-card bg-canvas-bg p-8">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 1px, transparent 1px)", backgroundSize: "26px 26px" }}
      />
      <div className="relative flex flex-col items-center">
        <FlowNodeCard variant="app" title="Google Sheets" body="49 loaded" status="ready" stepNo={1} />
        <Connector />
        <FlowNodeCard variant="filter" title="Filter" body="24 passed" status="ready" stepNo={2} publishes />
        <Connector />
        <div className="flex w-[300px] items-center gap-2.5 rounded-card border-2 border-dashed border-neutral-300 bg-white/60 p-3 text-base font-semibold text-neutral-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-control border-2 border-dashed border-current opacity-70">
            <Plus size={16} strokeWidth={2.5} />
          </span>
          Add next step
        </div>
      </div>
    </div>
  );
}

/** The dashed run between two steps, with its hover "+" at the midpoint. */
function Connector() {
  return (
    <span className="relative flex h-14 w-px items-center justify-center">
      <span className="absolute inset-y-0 w-px border-l-2 border-dashed border-neutral-300" />
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm">
        <Plus size={13} strokeWidth={2.5} />
      </span>
    </span>
  );
}
