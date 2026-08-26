"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { canvasCells, type GridBox } from "@/lib/board/grid";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/flow/controls/Popover";
import { Toast } from "@/components/ui/toast";
import type { ChartId } from "@/lib/board/charts";
import type { BoardTileRow, CustomTileOption } from "@/lib/board/types";
import { AddTilePicker } from "./add-tile-picker";
import { addCustomTileAction, deleteCustomTileAction } from "./board-actions";

/**
 * A CUSTOM VIEW'S CANVAS — the client half.
 *
 * THE SEEDED/LIVE SPLIT IS THE WHOLE DESIGN, and it is the one `BoardLayout`
 * already uses for the groups board:
 *
 *   LAYOUT (x/y/w/h) is SEEDED CLIENT STATE. Read once on mount, never
 *   re-seeded. `FreshnessPoller` calls `router.refresh()` every twelve seconds
 *   in every open tab, and a re-seed mid-gesture would snap a tile back to
 *   where the server last saw it — the failure that rule exists to prevent.
 *
 *   NODES are a LIVE SERVER PROP. The cards are server-rendered — the data is a
 *   stored `flow_results` row or a live classic compute — so they must stay
 *   fresh under that same poll. `BoardLayout` treats `tiles` exactly this way.
 *
 * That split is what answers the awkward question of a tile the client just
 * added, which has no server-rendered card yet: it goes into the layout
 * immediately and its box renders empty until the refresh carrying its card
 * lands. Nothing to reconcile, because the two halves never describe the same
 * fact.
 */
export type CanvasTile = GridBox & {
  /** The server-rendered card. Placed, never inspected — same contract as `BoardTile.node`. */
  node: ReactNode;
};

export function CustomBoard({
  viewId,
  tiles,
  options,
  canEdit,
  viewStrip,
}: {
  /** Always a real id: the default view has no row and is always a groups view. */
  viewId: string;
  tiles: CanvasTile[];
  /** Every metric this viewer may see, with the charts each one supports. */
  options: CustomTileOption[];
  canEdit: boolean;
  /**
   * The same tabs the groups board wears. A view's whole promise is that you
   * can move between kinds without the furniture moving, so the strip is
   * rendered by the page and worn by whichever board is on screen.
   */
  viewStrip?: ReactNode;
}) {
  const router = useRouter();
  /**
   * Seeded once. The `useState` initialiser is what that means: the argument is
   * read on the first render and ignored on every one after it.
   */
  const [layout, setLayout] = useState<GridBox[]>(() => tiles.map(({ x, y, w, h, id }) => ({ id, x, y, w, h })));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /**
   * A WRITE THAT NEVER ANSWERED IS A WRITE THAT FAILED.
   *
   * Both halves matter. A server action can RESOLVE `{ ok: false }` — a refused
   * permission — and it can also REJECT outright, because Next mints a new
   * action id per deploy and a tab left open across one calls an id the server
   * has forgotten. Without the `.catch`, that second case leaves the optimistic
   * change on screen with nothing written behind it.
   *
   * `BoardLayout` carries the same helper for the same reason. Two copies is
   * how this bug comes back, and hoisting them into one hook is the last
   * tidying in the plan.
   */
  const settle = useCallback((p: Promise<{ ok: true } | { ok: false; error: string }>, revert: () => void) => {
    p.then((r) => {
      if (r.ok) return;
      revert();
      setToast(r.error);
    }).catch(() => {
      revert();
      setToast("Couldn't save that — the page may be out of date. Reload and try again.");
    });
  }, []);

  const addTile = useCallback(
    async (tileKey: string, chart: ChartId) => {
      setBusy(true);
      // NOT optimistic: the id is the server's to mint, and a tile carrying a
      // placeholder id could not be deleted or moved until it was replaced.
      const r = await addCustomTileAction(viewId, tileKey, chart).catch(() => null);
      setBusy(false);
      if (!r) return setToast("Couldn't add that chart — the page may be out of date. Reload and try again.");
      if (!r.ok) return setToast(r.error);
      setPicking(false);
      const t: BoardTileRow = r.tile;
      setLayout((prev) => [...prev, { id: t.id, x: t.x, y: t.y, w: t.w, h: t.h }]);
      // The box is ours; the CARD is the server's. This is what fetches it.
      router.refresh();
    },
    [router, viewId],
  );

  const removeTile = useCallback(
    (id: string) => {
      let undo: GridBox | undefined;
      setLayout((prev) => {
        undo = prev.find((b) => b.id === id);
        return prev.filter((b) => b.id !== id);
      });
      // The hole closes itself: every render compacts, so the tiles below float
      // up without a single other row being rewritten.
      settle(deleteCustomTileAction(id), () => setLayout((prev) => (undo ? [...prev, undo] : prev)));
    },
    [settle],
  );

  /**
   * The NODES come from props every render; the BOXES come from seeded state,
   * so the two can briefly disagree — a row this client added and the server
   * has not read back yet.
   *
   * A box whose card has not arrived KEEPS ITS PLACE and renders empty. It must
   * not collapse: gravity would pull every tile below it up and push them all
   * back a moment later, which reads as the board twitching rather than as one
   * card loading.
   */
  const nodeOf = new Map(tiles.map((t) => [t.id, t.node]));
  const cells = canvasCells(layout);
  const empty = cells.length === 0;

  return (
    <div>
      {/* The controls row, in the same place and shape the groups board puts it:
          the view strip on the left, the one door on the right. On a canvas
          that door reads "Add" rather than "New group". */}
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{viewStrip}</div>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)} disabled={busy}>
            <Plus />
            Add
          </Button>
        )}
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
            <div key={tile.id} className="board-cell group/cell relative" style={vars as React.CSSProperties}>
              {canEdit && <TileMenu onDelete={() => removeTile(tile.id)} />}
              {nodeOf.get(tile.id)}
            </div>
          ))}
        </div>
      )}

      {picking && <AddTilePicker options={options} busy={busy} onClose={() => setPicking(false)} onAdd={addTile} />}
      {toast && <Toast action={{ label: "Dismiss", onClick: () => setToast(null) }}>{toast}</Toast>}
    </div>
  );
}

/**
 * The tile's own menu. Remove only, for now — changing the chart, the metric
 * and the name each need the picker back and arrive with it.
 */
function TileMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-(--duration-fast) focus-within:opacity-100 group-hover/cell:opacity-100 pointer-coarse:opacity-100">
      <Popover
        open={open}
        setOpen={(o) => {
          setOpen(o);
          if (!o) setConfirming(false);
        }}
        fixed
        align="right"
        width={224}
        anchor={
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => setOpen((o) => !o)}
            aria-label="Chart options"
            aria-haspopup="menu"
          >
            <MoreHorizontal />
          </Button>
        }
      >
        <div className="cursor-default p-1.5">
          {confirming ? (
            /* Inline, the RanksPanel precedent. The sentence says what SURVIVES,
               because "remove" an inch from a number reads like it might take
               the metric with it. It never does. */
            <div className="px-1.5 py-1">
              <p className="text-tiny text-muted-foreground">Remove this chart? The metric itself stays on the board.</p>
              <div className="mt-2 flex gap-1.5">
                <Button variant="destructive" size="sm" onClick={onDelete}>
                  Remove
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="destructiveGhost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
              Remove chart
            </Button>
          )}
        </div>
      </Popover>
    </div>
  );
}
