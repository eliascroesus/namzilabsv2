"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BarChart3, Check, Filter, Hash, LayoutGrid, MoreHorizontal, PenLine, Plus, Repeat, Rows3, Target, Trash2 } from "lucide-react";
import { canvasCells, compact, GRID_COLS, type GridBox } from "@/lib/board/grid";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/flow/controls/Popover";
import { Toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/page";
import { CHARTS, asChartId, type ChartId } from "@/lib/board/charts";
import type { BoardTileRow, CustomTileOption } from "@/lib/board/types";
import type { TileConfig } from "@/lib/board/tile-config";
import { CustomTile, type CustomTileSource } from "@/components/custom-tile";
import { CANVAS_ATTR, CELL_ATTR, HANDLE_ATTR, useCanvasDrag } from "./canvas-drag";
import { useSettle } from "./board-settle";
import { MetricPicker } from "./add-tile-picker";
import {
  addCustomTileAction,
  deleteCustomTileAction,
  setCustomTileAction,
  setCustomTileLayoutAction,
} from "./board-actions";

/**
 * THE WRITES, AS A SEAM. The dashboard never passes this — the defaults are the
 * real server actions. It exists for `/design/canvas`, which injects fakes that
 * SUCCEED: the crash that shipped lived on the success path (a successful add,
 * then a render against a prop that had not caught up), and the specimen's real
 * actions can only fail there, having no session. A server-action response is
 * React flight protocol, so a Playwright `route.fulfill` cannot fake success
 * without hand-writing that wire format — this seam is the same mock at a
 * sturdier joint.
 */
export type CanvasActions = {
  addTile: typeof addCustomTileAction;
  deleteTile: typeof deleteCustomTileAction;
  editTile: typeof setCustomTileAction;
  writeLayout: typeof setCustomTileLayoutAction;
};

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
  /**
   * THE CARD'S DATA, NOT ITS MARKUP. The tile renders CLIENT-SIDE now — that is
   * what lets a chart or style edit apply the instant it is chosen, with no
   * server round-trip standing between a press and its pixel. The server still
   * paints the first HTML (client components SSR), and the twelve-second poll
   * still refreshes this prop, so the numbers stay as live as they ever were.
   */
  data: CustomTileSource | null;
  /** What it is drawn as now, so the menu can tick the current one. */
  chart: string;
  /** What its METRIC could be drawn as — computed on the server by `chartsFor`. */
  charts: string[];
  /** The metric's own name — the fallback when no title override is set. */
  metricName: string;
  /** The tile's parsed presentation bag. Optimistic edits overlay it. */
  config: TileConfig;
  /** The same rules the groups board sorts by: 3 error · 2 unpublished · 1 stale · 0 fine. */
  attention: 0 | 1 | 2 | 3;
};

export function CustomBoard({
  viewId,
  tiles,
  options,
  rangeKey,
  canEdit,
  viewStrip,
  actions: actionOverrides,
}: {
  /** Always a real id: the default view has no row and is always a groups view. */
  viewId: string;
  tiles: CanvasTile[];
  /** Every metric this viewer may see, with the charts each one supports. */
  options: CustomTileOption[];
  /** The board's active range — the tiles window their own data with it. */
  rangeKey: string;
  canEdit: boolean;
  /**
   * The same tabs the groups board wears. A view's whole promise is that you
   * can move between kinds without the furniture moving, so the strip is
   * rendered by the page and worn by whichever board is on screen.
   */
  viewStrip?: ReactNode;
  /** Test seam only — see `CanvasActions`. The dashboard leaves it unset. */
  actions?: Partial<CanvasActions>;
}) {
  const router = useRouter();
  const act: CanvasActions = {
    addTile: addCustomTileAction,
    deleteTile: deleteCustomTileAction,
    editTile: setCustomTileAction,
    writeLayout: setCustomTileLayoutAction,
    ...actionOverrides,
  };
  /**
   * POSITIONS are seeded once — the `useState` initialiser reads `tiles` on the
   * first render and ignores it on every one after, which is what stops the
   * twelve-second poller snapping a tile back mid-drag.
   *
   * MEMBERSHIP is not seeded, and that distinction is the fix for a crash that
   * shipped. "Seeded once" exists to protect a drag from a poll; freezing
   * WHICH tiles exist protected nothing and broke two ways: a tile added in
   * another tab never appeared, and a tile deleted in another tab left a ghost
   * box — which then made `setCustomTileLayoutAction` refuse every batch
   * wholesale, so one ghost bricked all movement on the board. Additions and
   * removals cannot clobber a gesture, so they reconcile from the live prop on
   * every render (see `boxes` below); positions never do.
   */
  const [layout, setLayout] = useState<GridBox[]>(() => tiles.map(({ x, y, w, h, id }) => ({ id, x, y, w, h })));
  /**
   * The two windows where THIS CLIENT knows better than its `tiles` prop:
   * a tile it just added (in layout, not yet read back) must survive the
   * removal reconcile, and one it just deleted (gone from layout, still in the
   * prop until a refresh) must not be re-added by the addition reconcile. Each
   * entry retires itself the moment the prop catches up.
   */
  const pending = useRef({ adds: new Set<string>(), removes: new Set<string>() });
  /**
   * The menu's moves read the RECONCILED list through this ref rather than the
   * raw state: after a remote add, the state may not know a box the screen is
   * already showing, and a nudge computed from a list missing a member would
   * write a layout that stacks two tiles.
   */
  const boxesRef = useRef<GridBox[]>([]);
  const [picking, setPicking] = useState(false);
  /**
   * OPTIMISTIC PRESENTATION, keyed by tile. A style or chart edit lands here
   * first and renders on the next frame; the server is told behind it, and a
   * refused write puts the PREVIOUS value back — a real revert now, where the
   * old server-rendered model could only shrug (`() => {}`) and let the next
   * refresh quietly undo the screen. An entry retires when the prop catches up
   * with what it says.
   */
  const [overlay, setOverlay] = useState<Map<string, { chart?: string; config?: TileConfig }>>(new Map());
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  useEffect(() => {
    // Retire overlay entries the server prop has caught up with — otherwise a
    // stale entry would mask a LATER edit from another tab forever.
    setOverlay((m) => {
      if (m.size === 0) return m;
      const next = new Map(m);
      for (const [id, o] of m) {
        const t = tilesRef.current.find((x) => x.id === id);
        if (!t) continue;
        const chartCaught = o.chart === undefined || o.chart === t.chart;
        const titleCaught = o.config?.title === undefined ? true : o.config.title === t.config.title;
        if (chartCaught && titleCaught) next.delete(id);
      }
      return next.size === m.size ? m : next;
    });
  }, [tiles]);
  /** The id of the tile being repointed at a different metric, if any. */
  const [repointing, setRepointing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /** See `useSettle` — one copy of the failure path, shared with the groups board. */
  const settle = useSettle(setToast);

  /**
   * ADD LANDS IMMEDIATELY — Looker's behaviour, and the correction of a flow
   * that shipped wrong. The old picker asked chart, then METRIC, then landed;
   * but the metric question does not need answering up front, because every
   * chart has an obvious opening move: the first metric on the board that can
   * be drawn that way, from the `options` list already in hand. Whoever wants
   * a different one clicks the tile and changes it — which is where that
   * decision belongs, next to the thing it changes.
   */
  const addTile = useCallback(
    async (tileKey: string, chart: ChartId) => {
      setBusy(true);
      // NOT optimistic: the id is the server's to mint, and a tile carrying a
      // placeholder id could not be deleted or moved until it was replaced.
      const r = await act.addTile(viewId, tileKey, chart).catch(() => null);
      setBusy(false);
      if (!r) return setToast("Couldn't add that chart — the page may be out of date. Reload and try again.");
      if (!r.ok) return setToast(r.error);
      setPicking(false);
      const t: BoardTileRow = r.tile;
      // Ours until the prop catches up — see `pending`.
      pending.current.adds.add(t.id);
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
      settle(act.writeLayout(viewId, packed), () => {
        setLayout(undo);
        // The one way this write fails wholesale is an id the view no longer
        // has — a tile deleted somewhere else that this tab has not heard
        // about. Refreshing brings the membership the reconcile needs to shed
        // it, so one stale id cannot go on failing every drag.
        router.refresh();
      });
    },
    [router, settle, viewId],
  );

  /**
   * THE RECONCILE — membership from the prop, positions from state.
   *
   * A box whose card has not arrived yet KEEPS ITS PLACE and renders a
   * skeleton with no menu. It must not collapse: gravity would pull every tile
   * below it up and push them all back a moment later, and the menu would be
   * reading fields off a tile that is not there — which was the crash.
   */
  const liveIds = new Set(tiles.map((t) => t.id));
  // Retire pending entries the prop has caught up with. A ref mutation during
  // render, deliberately: it is an idempotent cache prune, safe under strict
  // mode's double render, and an effect would leave one render reading stale.
  for (const id of pending.current.adds) if (liveIds.has(id)) pending.current.adds.delete(id);
  for (const id of pending.current.removes) if (!liveIds.has(id)) pending.current.removes.delete(id);
  const knownIds = new Set(layout.map((b) => b.id));
  const boxes: GridBox[] = [
    // Positions are the state's; a box leaves only when the server no longer
    // has it AND this client did not just add it.
    ...layout.filter((b) => liveIds.has(b.id) || pending.current.adds.has(b.id)),
    // A tile that arrived from elsewhere joins at its server position.
    ...tiles
      .filter((t) => !knownIds.has(t.id) && !pending.current.removes.has(t.id))
      .map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
  ];

  boxesRef.current = boxes;

  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * The gesture's preview is the LAYOUT, not a ghost floating over one: the
   * cells move under the pointer because `preview` replaces `layout` while a
   * gesture is live. That is only honest because both come from the same
   * `compact`, so what is on screen mid-drag is exactly what gets written.
   */
  const { gesture, preview, onPointerDown, swallowClick } = useCanvasDrag(rootRef, boxes, applyLayout);

  const nudge = useCallback(
    (id: string, dx: number, dy: number) => {
      const all = boxesRef.current;
      const box = all.find((b) => b.id === id);
      if (!box) return;
      const moved = { ...box, x: Math.max(0, Math.min(GRID_COLS - box.w, box.x + dx)), y: Math.max(0, box.y + dy) };
      applyLayout(all.map((b) => (b.id === id ? moved : b)), id);
    },
    [applyLayout],
  );

  const resize = useCallback(
    (id: string, w: number, h: number) => {
      const all = boxesRef.current;
      const box = all.find((b) => b.id === id);
      if (!box) return;
      const next = { ...box, w, h, x: Math.min(box.x, GRID_COLS - w) };
      applyLayout(all.map((b) => (b.id === id ? next : b)), id);
    },
    [applyLayout],
  );

  /** Chart, metric and name are one partial update of one already-walled row. */
  const editTile = useCallback(
    (id: string, patch: { chart?: string; tileKey?: string; title?: string }) => {
      /**
       * A METRIC REPOINT is the one edit whose DATA lives on the server — the
       * new metric's slices have to be fetched — so it refreshes. Chart and
       * title are presentation over data already in hand: they render now,
       * from the overlay, and never wait on a round trip.
       */
      if (patch.tileKey !== undefined) {
        settle(act.editTile(id, patch), () => {});
        router.refresh();
        return;
      }
      let prev: { chart?: string; config?: TileConfig } | undefined;
      setOverlay((m) => {
        prev = m.get(id);
        const next = new Map(m);
        next.set(id, {
          ...prev,
          ...(patch.chart !== undefined ? { chart: patch.chart } : {}),
          ...(patch.title !== undefined
            ? { config: { ...prev?.config, title: patch.title.trim() || undefined } }
            : {}),
        });
        return next;
      });
      settle(act.editTile(id, patch), () =>
        setOverlay((m) => {
          const next = new Map(m);
          if (prev) next.set(id, prev);
          else next.delete(id);
          return next;
        }),
      );
    },
    [router, settle],
  );

  const removeTile = useCallback(
    (id: string) => {
      let undo: GridBox | undefined;
      // Gone from here until the prop catches up — see `pending`. Without this
      // the addition reconcile would put the box straight back, and the delete
      // would appear to do nothing until the next refresh.
      pending.current.removes.add(id);
      setLayout((prev) => {
        undo = prev.find((b) => b.id === id);
        return prev.filter((b) => b.id !== id);
      });
      // The hole closes itself: every render compacts, so the tiles below float
      // up without a single other row being rewritten.
      settle(act.deleteTile(id), () => {
        pending.current.removes.delete(id);
        setLayout((prev) => (undo ? [...prev, undo] : prev));
      });
    },
    [settle],
  );

  /**
   * THE TILE AS THE SCREEN SHOULD SHOW IT — the server's row with this
   * client's optimistic presentation on top. The overlay retires itself the
   * moment the prop agrees with it, so a settled edit and a fresh read are
   * indistinguishable, which is the definition of optimistic done right.
   */
  const byId = new Map(
    tiles.map((t) => {
      const o = overlay.get(t.id);
      if (!o) return [t.id, t] as const;
      return [
        t.id,
        {
          ...t,
          chart: o.chart ?? t.chart,
          config: o.config ? { ...t.config, ...o.config, title: o.config.title } : t.config,
        },
      ] as const;
    }),
  );
  const cells = canvasCells(preview ?? boxes);
  const empty = cells.length === 0;

  return (
    <div ref={rootRef}>
      {/* The controls row, in the same place and shape the groups board puts it:
          the view strip on the left, the one door on the right. On a canvas
          that door reads "Add" rather than "New group". */}
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{viewStrip}</div>
        {canEdit && (
          <AddChartMenu
            open={picking}
            setOpen={setPicking}
            busy={busy}
            options={options}
            onPick={(chart, tileKey) => addTile(tileKey, chart)}
          />
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
              {/* THE GUARD THE CRASH CAME THROUGH. `byId` is the live prop and
                  `tile.id` is the reconciled layout, and in the add window the
                  prop has not caught up yet — `byId.get` is undefined, and the
                  old `!` fed it to a menu that read `.title` off it. A box in
                  that window gets a skeleton and NO menu. */}
              {canEdit && byId.has(tile.id) && (
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
              {(() => {
                const t = byId.get(tile.id);
                if (!t) return <PendingCard />;
                return (
                  <CustomTile
                    chart={t.chart}
                    title={t.config.title || t.metricName}
                    rangeKey={rangeKey}
                    source={t.data}
                    rows={tile.h}
                  />
                );
              })()}
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

      {repointing && (
        /* The chart is staying; only the data under it moves — and the list is
           filtered to metrics that can be drawn that way, which is what stops a
           repoint leaving a tile asking for a drawing its new metric cannot
           give. */
        <MetricPicker
          options={options}
          busy={busy}
          chart={asChartId(byId.get(repointing)?.chart)}
          onClose={() => setRepointing(null)}
          onPick={(tileKey) => {
            editTile(repointing, { tileKey });
            setRepointing(null);
          }}
        />
      )}
      {toast && <Toast action={{ label: "Dismiss", onClick: () => setToast(null) }}>{toast}</Toast>}
    </div>
  );
}

/** Chart id → its icon, shared by the Add menu and nothing else yet. */
const CHART_ICONS: Record<ChartId, typeof Hash> = {
  number: Hash,
  bar: BarChart3,
  category: Rows3,
  progress: Target,
  funnel: Filter,
};

/**
 * THE ADD MENU — chart types only, in the `+ view` menu's own shape.
 *
 * A compact popover rather than a modal, because the question is one press
 * deep: which drawing. There is deliberately NO metric step — see `addTile`.
 * A chart nothing on the board can draw is GREYED WITH THE REASON, never
 * hidden: "Breakdown" missing entirely reads as a product that does not do
 * breakdowns, while "no metric here can be drawn this way yet" reads as a fact
 * about this workspace's data, which is what it is.
 */
function AddChartMenu({
  open,
  setOpen,
  busy,
  options,
  onPick,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  busy: boolean;
  options: CustomTileOption[];
  onPick: (chart: ChartId, tileKey: string) => void;
}) {
  return (
    <Popover
      open={open}
      setOpen={setOpen}
      fixed
      align="right"
      width={288}
      anchor={
        <Button variant="secondary" size="sm" onClick={() => setOpen(!open)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
          <Plus />
          Add
        </Button>
      }
    >
      <div className="cursor-default p-1">
        {CHARTS.map((c) => {
          const Icon = CHART_ICONS[c.id];
          /** The opening move: the first metric that can draw this chart. */
          const first = options.find((o) => o.charts.includes(c.id));
          return (
            <Button
              key={c.id}
              variant="ghost"
              size="sm"
              disabled={busy || !first}
              onClick={() => {
                if (!first) return;
                setOpen(false);
                onPick(c.id, first.key);
              }}
              className="h-auto w-full items-start justify-start gap-2.5 whitespace-normal px-2 py-2 text-left"
              title={!first ? `No metric on this board can be drawn as a ${c.label.toLowerCase()}` : undefined}
            >
              <Icon className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-small font-semibold text-foreground">{c.label}</span>
                <span className="text-tiny font-normal text-muted-foreground">
                  {first ? c.blurb : "No metric here can be drawn this way yet."}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </Popover>
  );
}

/**
 * A box whose card has not arrived yet — the moment between this client
 * writing a row and the refresh carrying its server-rendered card. It holds
 * the tile's exact footprint so nothing below it moves when the card lands.
 */
function PendingCard() {
  return (
    <div className="h-full rounded-surface border border-border bg-card p-4 shadow-card" aria-busy="true">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="mt-3 h-9 w-1/2" />
      <Skeleton className="mt-3 h-10 w-full" />
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
  const title = tile.config.title || tile.metricName;
  const [draft, setDraft] = useState(title);

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
    if (next !== title) onRename(next);
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
            aria-label={`Options for ${title}`}
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
                aria-label={`Rename ${title}`}
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
                setDraft(title);
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
                aria-label={`Move ${title} ${label}`}
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
