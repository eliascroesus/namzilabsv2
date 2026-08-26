"use client";

import { useState, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { canvasCells, type GridBox } from "@/lib/board/grid";

/**
 * A CUSTOM VIEW'S CANVAS — the client half.
 *
 * THE SEEDED/LIVE SPLIT IS THE WHOLE DESIGN, and it is the one `BoardLayout`
 * already uses for the groups board:
 *
 *   LAYOUT (x/y/w/h) is SEEDED CLIENT STATE. Read once on mount, never
 *   re-seeded. `FreshnessPoller` calls `router.refresh()` every twelve seconds
 *   in every open tab, and a re-seed mid-drag would snap a tile back to where
 *   the server last saw it — the failure that rule exists to prevent.
 *
 *   NODES are a LIVE SERVER PROP. The cards are server-rendered — the data is a
 *   stored `flow_results` row or a live classic compute — so they must stay
 *   fresh under that same poll. `BoardLayout` treats `tiles` exactly this way.
 *
 * That split is also what answers the awkward question of a tile added by the
 * client, which has no server-rendered card yet: it goes into the layout
 * immediately and renders as an empty box until the refresh carrying its node
 * lands. Nothing to reconcile, because the two halves never describe the same
 * fact.
 *
 * Gestures arrive in a later step. What this owns today is the geometry and
 * the empty state.
 */
export type CanvasTile = GridBox & {
  /** The server-rendered card. Placed, never inspected — same contract as `BoardTile.node`. */
  node: ReactNode;
};

export function CustomBoard({
  tiles,
  canEdit,
  viewStrip,
}: {
  tiles: CanvasTile[];
  canEdit: boolean;
  /**
   * The same tabs the groups board wears. A view's whole promise is that you
   * can move between kinds without the furniture moving, so the strip is
   * rendered by the page and worn by whichever board is on screen.
   */
  viewStrip?: ReactNode;
}) {
  /**
   * Seeded once. The `useState` initialiser is what that means: the argument is
   * read on the first render and ignored on every one after it.
   */
  const [layout] = useState<GridBox[]>(() => tiles.map(({ x, y, w, h, id }) => ({ id, x, y, w, h })));

  /**
   * The NODES come from props every render; the BOXES come from seeded state,
   * so the two can briefly disagree — a row this client added and the server
   * has not read back yet.
   *
   * A box whose card has not arrived KEEPS ITS PLACE and renders empty. It must
   * not collapse: gravity would pull every tile below it up and push them all
   * back a moment later, which reads as the board twitching rather than as one
   * card loading. A box the layout has never heard of is simply not drawn.
   */
  const nodeOf = new Map(tiles.map((t) => [t.id, t.node]));
  const cells = canvasCells(layout.filter((b) => nodeOf.has(b.id)));

  const empty = cells.length === 0;

  return (
    <div>
      {/* The controls row, in the same place and the same shape the groups
          board puts it — the view strip on the left, the one door on the right.
          On a custom view that door reads "Add" and opens the chart picker; it
          arrives with the picker in the next step. */}
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{viewStrip}</div>
      </div>

      {empty ? (
      <div className="mt-4 flex flex-col items-center justify-center rounded-surface border border-dashed border-border py-16 text-center">
        <LayoutGrid className="size-5 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-small font-semibold text-foreground">Nothing on this view yet</p>
        <p className="mt-1 max-w-sm text-tiny text-muted-foreground">
          {canEdit
            ? "Add a chart to start building it. The same metric can appear more than once, drawn a different way each time."
            : "Nobody has added a chart to this view yet."}
        </p>
      </div>
      ) : (
        <div className="board-canvas mt-4">
          {cells.map(({ tile, vars }) => (
            <div key={tile.id} className="board-cell" style={vars as React.CSSProperties}>
              {nodeOf.get(tile.id)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
