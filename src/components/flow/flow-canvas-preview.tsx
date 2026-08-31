import { LineChart, Plus } from "lucide-react";
import { STATUS_META, type NodeStatus } from "./node-meta";
import { NodeIcon } from "./icons";
import { nodeAccent } from "./node-accent";

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
  const accent = nodeAccent(type, variant.includes("_") ? variant : undefined);
  // Duplicates the card box from src/components/flow/FlowNodeCard.tsx — width, radius, elevation, padding and mark size must track that file.
  // The elevation is the ring-free `card` rung: the card draws a real border,
  // and a ringed shadow under one is two hairlines reading as a dirty 2px rim.
  return (
    <div
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
      className="w-[300px] rounded-surface border border-border bg-card shadow-surface transition-shadow duration-(--duration-fast) hover:shadow-card-hover"
    >
      <div className="flex items-start gap-3 p-3.5">
        <NodeIcon type={type} source={source} variant={variant.includes("_") ? variant : undefined} size={44} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="flex items-center gap-1.5">
            {stepNo != null && (
              <span className="tnum rounded-control bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">{stepNo}</span>
            )}
            <span className="min-w-0 truncate text-md font-semibold text-foreground">{title}</span>
          </span>
          {body && (
            <span className={`mt-1 block truncate text-xs font-medium ${status === "setup" || status === "error" ? sm.hint : "text-muted-foreground"}`}>{body}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 pt-1">
          <span className={`h-2 w-2 rounded-full ${sm.dot}`} />
        </span>
      </div>
      {/* The strip's bottom corners are the INSIDE of the card's, so they are
          written as the radius minus the border rather than as a literal — a
          literal sat at 13px through a whole radius step.
          `bg-accent`/`text-accent-foreground` ARE marker-50/marker-700, and the
          hairline between them comes off that ramp too — a wash under coloured
          ink is drawing, which is the marker's half of the split. */}
      {publishes && (
        <div className="flex items-center gap-1.5 rounded-b-[calc(var(--radius-surface)-1px)] border-t border-brand-100 bg-accent px-3.5 py-2 text-xs font-semibold text-accent-foreground">
          <LineChart size={14} />
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
        style={{ backgroundImage: "radial-gradient(var(--color-canvas-dot) 0.8px, transparent 0.8px)", backgroundSize: "26px 26px" }}
      />
      <div className="relative flex flex-col items-center">
        <FlowNodeCard variant="app" title="Google Sheets" body="49 loaded" status="ready" stepNo={1} />
        <Connector />
        <FlowNodeCard variant="filter" title="Filter" body="24 passed" status="ready" stepNo={2} publishes />
        {/* No Connector here: the terminal "Add next step" hangs off the card at
            mt-8 (FlowNodeCard.tsx) — it is not an edge, so it has no "+". */}
        <span className="h-8 w-px border-l-2 border-dashed" style={{ borderColor: "var(--color-canvas-edge)" }} />
        {/* Duplicates the terminal "Add next step" button from src/components/flow/FlowNodeCard.tsx — it is an opaque, raised card there, not a wash, and it carries the same corner and the same ring-free elevation as the cards above it. */}
        <div className="flex w-[300px] items-center gap-2.5 rounded-surface border-2 border-dashed border-border bg-card p-3 text-sm font-semibold text-muted-foreground shadow-surface">
          <span className="flex h-8 w-8 items-center justify-center rounded-control border-2 border-dashed border-current opacity-70">
            <Plus size={16} />
          </span>
          Add next step
        </div>
      </div>
    </div>
  );
}

/**
 * The dashed run between two steps, with its always-visible "+" at the midpoint.
 *
 * 160px because that is the real number: `ROW` is 232 (graph-utils.ts) and a
 * card with no publish footer is 72px tall (p-3.5 around a 44px mark). This
 * section is sold as "the rhythm between them", so a convenient 56px would be
 * the one thing on the page that lies about the canvas. Colour comes from
 * `--color-canvas-edge`, the same token `.react-flow__edge-path` strokes with.
 */
function Connector() {
  return (
    <span className="relative flex h-[160px] w-px items-center justify-center">
      <span className="absolute inset-y-0 w-px border-l-2 border-dashed" style={{ borderColor: "var(--color-canvas-edge)" }} />
      {/* Duplicates the insert control from src/components/flow/InsertEdge.tsx — size, fill and glyph must track that file. */}
      {/* shrink-0: the parent is a w-px flex row, so without it the circle is
          squeezed to an oval — the one thing the real control cannot be. */}
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-card">
        <Plus size={14} />
      </span>
    </span>
  );
}
