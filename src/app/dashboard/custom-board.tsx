"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, LayoutGrid, MoreHorizontal, PenLine, Plus, Repeat, Trash2 } from "lucide-react";
import { canvasCells, compact, GRID_COLS, type GridBox } from "@/lib/board/grid";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/flow/controls/Popover";
import { Toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/page";
import { CHARTS, asChartId, type ChartId } from "@/lib/board/charts";
import type { BoardTileRow, CustomTileOption } from "@/lib/board/types";
import { CANVAS_ATTR, CELL_ATTR, HANDLE_ATTR, useCanvasDrag } from "./canvas-drag";
import { AddTilePicker } from "./add-tile-picker";
import {
  addCustomTileAction,
  deleteCustomTileAction,
  setCustomTileAction,
  setCustomTileLayoutAction,
} from "./board-actions";

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
  /** What it is drawn as now, so the menu can tick the current one. */
  chart: string;
  /** What its METRIC could be drawn as — computed on the server by `chartsFor`. */
  charts: string[];
  /** The name on the card: the override, or the metric's own. */
  title: string;
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
  /** The id of the tile being repointed at a different metric, if any. */
  const [repointing, setRepointing] = useState<string | null>(null);
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

  /**
   * WRITE A WHOLE LAYOUT, because moving one tile moves its neighbours.
   *
   * Gravity is applied HERE, by the same `compact` every render uses and the
   * pointer gestures will preview with, and what it returns is exactly what is
   * written. So the board can never be recompacted from a partial answer, and
   * what you asked for is what gets stored.
   *
   * `first` is the tile being moved: it wins ties on its row, which is what
   * makes "move up" put it ABOVE the tile it was under rather than settling
   * back where it started.
   */
  const applyLayout = useCallback(
    (next: GridBox[], movedId: string) => {
      const packed = compact(next, GRID_COLS, movedId);
      let undo: GridBox[] = [];
      setLayout((prev) => {
        undo = prev;
        return packed;
      });
      settle(setCustomTileLayoutAction(viewId, packed), () => setLayout(undo));
    },
    [settle, viewId],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * The gesture's preview is the LAYOUT, not a ghost floating over one: the
   * cells move under the pointer because `preview` replaces `layout` while a
   * gesture is live. That is only honest because both come from the same
   * `compact`, so what is on screen mid-drag is exactly what gets written.
   */
  const { gesture, preview, onPointerDown, swallowClick } = useCanvasDrag(rootRef, layout, applyLayout);

  const nudge = useCallback(
    (id: string, dx: number, dy: number) => {
      const box = layout.find((b) => b.id === id);
      if (!box) return;
      const moved = { ...box, x: Math.max(0, Math.min(GRID_COLS - box.w, box.x + dx)), y: Math.max(0, box.y + dy) };
      applyLayout(layout.map((b) => (b.id === id ? moved : b)), id);
    },
    [applyLayout, layout],
  );

  const resize = useCallback(
    (id: string, w: number, h: number) => {
      const box = layout.find((b) => b.id === id);
      if (!box) return;
      const next = { ...box, w, h, x: Math.min(box.x, GRID_COLS - w) };
      applyLayout(layout.map((b) => (b.id === id ? next : b)), id);
    },
    [applyLayout, layout],
  );

  /** Chart, metric and name are one partial update of one already-walled row. */
  const editTile = useCallback(
    (id: string, patch: { chart?: string; tileKey?: string; title?: string }) => {
      settle(setCustomTileAction(id, patch), () => {});
      // The CARD is the server's, and all three of these change it.
      router.refresh();
    },
    [router, settle],
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
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const cells = canvasCells(preview ?? layout);
  const empty = cells.length === 0;

  return (
    <div ref={rootRef}>
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
        <div className="board-canvas mt-4" {...{ [CANVAS_ATTR]: "" }}>
          {cells.map(({ tile, vars }, i) => (
            <div
              key={tile.id}
              {...{ [CELL_ATTR]: tile.id }}
              style={vars as React.CSSProperties}
              className={`board-cell group/cell relative transition-opacity duration-(--duration-fast) ${
                gesture?.id === tile.id ? "opacity-70" : ""
              } ${canEdit ? "cursor-grab [touch-action:none]" : ""}`}
              onPointerDown={(e) => {
                if (!canEdit) return;
                // The whole card is the move handle, so the controls inside it
                // have to be protected by name — the same guard, and the same
                // reason, as the groups board's TileSlot. The RESIZE handle is
                // in this list too: it starts its own gesture.
                if ((e.target as HTMLElement).closest(`button, a, input, [${HANDLE_ATTR}]`)) return;
                onPointerDown(e, { id: tile.id, mode: "move" });
              }}
            >
              {canEdit && (
                <TileMenu
                  tile={byId.get(tile.id)!}
                  index={i}
                  onChart={(c) => editTile(tile.id, { chart: c })}
                  onRename={(t) => editTile(tile.id, { title: t })}
                  onChangeMetric={() => setRepointing(tile.id)}
                  onNudge={(dx, dy) => nudge(tile.id, dx, dy)}
                  onResize={(w, h) => resize(tile.id, w, h)}
                  onDelete={() => removeTile(tile.id)}
                  swallowClick={swallowClick}
                />
              )}
              {nodeOf.get(tile.id)}
              {canEdit && (
                /* The corner grip. Deliberately NOT `.fixed.z-50` and NOT
                   `border-dashed`: `scripts/board-drag-check.mjs` counts
                   elements by those exact selectors to find the groups board's
                   ghost and placeholder, and a second thing wearing them would
                   quietly change what that harness measures. */
                <span
                  {...{ [HANDLE_ATTR]: tile.id }}
                  role="presentation"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onPointerDown(e, { id: tile.id, mode: "resize" });
                  }}
                  className="absolute bottom-0.5 right-0.5 z-10 size-4 cursor-se-resize rounded-control opacity-0 [touch-action:none] after:absolute after:bottom-1 after:right-1 after:size-2 after:rounded-control after:border-b-2 after:border-r-2 after:border-neutral-400 focus-within:opacity-100 group-hover/cell:opacity-100 pointer-coarse:opacity-100"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {picking && <AddTilePicker options={options} busy={busy} onClose={() => setPicking(false)} onAdd={addTile} />}
      {repointing && (
        /* The same picker, opened at its SECOND step: the chart is already
           chosen, so the only question is which metric — and the list is
           filtered to metrics that can be drawn that way, which is what stops a
           repoint leaving a tile asking for a drawing its new metric cannot
           give. */
        <AddTilePicker
          options={options}
          busy={busy}
          lockedChart={asChartId(byId.get(repointing)?.chart)}
          onClose={() => setRepointing(null)}
          onAdd={(tileKey) => {
            editTile(repointing, { tileKey });
            setRepointing(null);
          }}
        />
      )}
      {toast && <Toast action={{ label: "Dismiss", onClick: () => setToast(null) }}>{toast}</Toast>}
    </div>
  );
}

/**
 * THE TILE'S OWN MENU — and the whole feature, without a pointer.
 *
 * Built BEFORE the drag and the resize, deliberately, which is the `TileSlot`
 * precedent one level up: every arrangement a gesture can reach is reachable
 * here too, so the hardest part of the feature stays optional rather than
 * load-bearing. It is also simply the better path for anyone who dislikes
 * dragging, and the only path for anyone who cannot.
 *
 * Change chart is an inline list rather than a second modal, because the answer
 * is four items long and already known — the metric's legal charts were
 * computed on the server. Change METRIC is the modal, because that list is as
 * long as the workspace's metrics and wants a search box.
 */
function TileMenu({
  tile,
  index,
  onChart,
  onRename,
  onChangeMetric,
  onNudge,
  onResize,
  onDelete,
  swallowClick,
}: {
  tile: CanvasTile;
  index: number;
  /** True when the press that just ended was a drag, so it must not open this. */
  swallowClick: () => boolean;
  onChart: (c: ChartId) => void;
  onRename: (title: string) => void;
  onChangeMetric: () => void;
  onNudge: (dx: number, dy: number) => void;
  onResize: (w: number, h: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tile.title);

  /** Do it, then get out of the way — every item below moves what is underneath. */
  const act = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name CLEARS the override, so the tile follows its metric again.
    // Unchanged means nothing happened, which is true.
    if (next !== tile.title) onRename(next);
  };

  const legal = CHARTS.filter((c) => tile.charts.includes(c.id));

  return (
    <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-(--duration-fast) focus-within:opacity-100 group-hover/cell:opacity-100 pointer-coarse:opacity-100">
      <Popover
        open={open}
        setOpen={(o) => {
          setOpen(o);
          if (!o) {
            setConfirming(false);
            setEditing(false);
          }
        }}
        fixed
        align="right"
        width={248}
        anchor={
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => {
              if (swallowClick()) return;
              setOpen((o) => !o);
            }}
            aria-label={`Options for ${tile.title}`}
            aria-haspopup="menu"
          >
            <MoreHorizontal />
          </Button>
        }
      >
        <div className="cursor-default overflow-y-auto p-1.5">
          {editing ? (
            <div className="px-1 py-1">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                aria-label={`Rename ${tile.title}`}
                placeholder="Follow the metric's name"
                className="h-8 text-small"
              />
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setDraft(tile.title);
                setEditing(true);
              }}
            >
              <PenLine />
              Rename
            </Button>
          )}

          {legal.length > 1 && (
            <>
              <SectionHeading className="px-1.5 pb-1 pt-2">Draw as</SectionHeading>
              {legal.map((c) => (
                <Button
                  key={c.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => act(() => onChart(c.id))}
                >
                  <Check className={tile.chart === c.id ? "" : "invisible"} />
                  {c.label}
                </Button>
              ))}
            </>
          )}

          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => act(onChangeMetric)}>
            <Repeat />
            Change metric
          </Button>

          <SectionHeading className="px-1.5 pb-1 pt-2">Width</SectionHeading>
          <div className="flex gap-1 px-1">
            {[
              { label: "¼", w: 3 },
              { label: "½", w: 6 },
              { label: "⅔", w: 8 },
              { label: "Full", w: 12 },
            ].map((o) => (
              <Button
                key={o.w}
                variant={tile.w === o.w ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 justify-center px-0"
                aria-label={`${o.label} width`}
                onClick={() => act(() => onResize(o.w, tile.h))}
              >
                {o.label}
              </Button>
            ))}
          </div>

          <SectionHeading className="px-1.5 pb-1 pt-2">Height</SectionHeading>
          <div className="flex gap-1 px-1">
            {[
              { label: "Short", h: 4 },
              { label: "Medium", h: 6 },
              { label: "Tall", h: 9 },
            ].map((o) => (
              <Button
                key={o.h}
                variant={tile.h === o.h ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 justify-center px-0"
                onClick={() => act(() => onResize(tile.w, o.h))}
              >
                {o.label}
              </Button>
            ))}
          </div>

          <SectionHeading className="px-1.5 pb-1 pt-2">Move</SectionHeading>
          <div className="flex gap-1 px-1">
            {[
              { Icon: ArrowLeft, dx: -1, dy: 0, label: "left" },
              { Icon: ArrowRight, dx: 1, dy: 0, label: "right" },
              { Icon: ArrowUp, dx: 0, dy: -1, label: "up" },
              { Icon: ArrowDown, dx: 0, dy: 1, label: "down" },
            ].map(({ Icon, dx, dy, label }) => (
              <Button
                key={label}
                variant="ghost"
                size="sm"
                className="flex-1 justify-center px-0"
                aria-label={`Move ${tile.title} ${label}`}
                disabled={(dx === -1 && tile.x === 0) || (dy === -1 && index === 0)}
                onClick={() => act(() => onNudge(dx, dy))}
              >
                <Icon />
              </Button>
            ))}
          </div>

          <div className="my-1.5 h-px bg-border" />

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
