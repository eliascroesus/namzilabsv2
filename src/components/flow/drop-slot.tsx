import { Plus } from "lucide-react";

/**
 * WHERE THE STEP WILL LAND, drawn in the flow rather than described beside it.
 *
 * A drag on this canvas chooses a place in the ORDER — positions are computed
 * from the wiring, so the coordinate a card is released at means nothing. That
 * makes the destination the one thing the user cannot infer from what they are
 * holding, and it has to be shown in the line itself: a gap the size of a real
 * card, opened where the step would go.
 *
 * Rendered as a React Flow node so the canvas places it in graph space for
 * free — no viewport transform to mirror, and it cannot drift out of step with
 * the cards around it when the view is panned or zoomed mid-drag.
 */
export function DropSlotNode() {
  return (
    <div className="pointer-events-none flex h-[86px] w-[300px] items-center justify-center rounded-surface border-2 border-dashed border-primary bg-accent/40">
      <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Plus size={16} strokeWidth={2.5} />
      </span>
    </div>
  );
}

/**
 * The card under the cursor while it is being carried.
 *
 * Deliberately a REDUCED copy — the mark, the step number and the name — not a
 * clone of the card. A full-size duplicate reads as a second real step and
 * covers the flow it is being dropped into; this reads as something held.
 *
 * `pointer-events-none` is load-bearing: the ghost sits under the cursor by
 * definition, so anything else would make it swallow the very drop it exists
 * to illustrate.
 */
export function DragGhost({ x, y, title, mark }: { x: number; y: number; title: string; mark: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed z-50 flex w-[240px] items-center gap-2.5 rounded-surface border border-border bg-card p-2.5 shadow-panel"
      style={{ left: x + 14, top: y + 14, opacity: 0.95 }}
    >
      {mark}
      <span className="min-w-0 truncate text-base font-semibold text-foreground">{title}</span>
    </div>
  );
}
