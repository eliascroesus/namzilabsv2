"use client";

import { useCallback, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { arrangeBoard, type BoardLane } from "@/lib/board/arrange";
import { compareKeys, keyBetween, keysBetween } from "@/lib/board/order";
import type { BoardGroup, BoardTile, GroupSortKey, TilePlacement } from "@/lib/board/types";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { BOARD_GRID } from "@/components/ui/page";
import { DragGhost } from "@/components/flow/drop-slot";
import { groupAccent } from "@/components/flow/node-accent";
import {
  createGroupAction,
  deleteGroupAction,
  renameGroupAction,
  setGroupColorAction,
  setGroupPositionsAction,
  setGroupSortAction,
  setTilePlacementsAction,
} from "./board-actions";
import { BoardColumn } from "./board-column";
import { DropGap, TileSlot } from "./board-tile-menu";
import { AXIS_ATTR, COLUMNS_LANE, LANE_ATTR, SCROLLER_ATTR, UNGROUPED, useBoardDrag } from "./board-drag";
import { COLUMN_W, LANE_GAP, SCROLLER_BLEED } from "./board-shape";

/**
 * THE DASHBOARD'S ARRANGEMENT, AND THE ONE THING THAT OWNS IT.
 *
 * The tiles are SERVER components. They arrive here already rendered, as the
 * `node` field on each `BoardTile`, and this component places them without ever
 * looking inside one — which is what lets an expensive server-rendered card sit
 * inside a layout the client rearranges.
 *
 * IT IS MOUNTED EVEN WHEN THERE ARE NO GROUPS, and that is a correction to the
 * obvious design rather than an oversight. Leaving the zero-group case as plain
 * server markup would ship less JavaScript, and it would break as soon as a
 * SECOND group was created: this component seeds its state once and never
 * re-seeds, so a `revalidatePath` from "New group" would re-render the server
 * component into props this one is deliberately ignoring, and the new column
 * would simply never appear. One owner, always mounted, no race. The markup it
 * emits with no groups is the grid the page emitted before this feature
 * existed, which is the promise that matters.
 *
 * SEEDED ONCE, NEVER RE-SEEDED. `FreshnessPoller` calls `router.refresh()`
 * every twelve seconds; React keeps this component mounted across that, so the
 * arrangement survives without flicker and a drag in flight is never
 * overwritten by a server render that started before it. The cost is that
 * another tab's rearrangement does not appear until reload — the right trade
 * for a first version, and the honest upgrade is a `layoutRev` prop plus a
 * re-seed gated on "no write in flight".
 *
 * Every write is OPTIMISTIC WITH A KEY-SCOPED REVERT, copied from RanksPanel:
 * only the rows a patch touched are put back on failure, never the whole
 * snapshot, because a neighbouring edit may be in flight.
 */
export function BoardLayout({
  tiles,
  groups: seedGroups,
  placements: seedPlacements,
  canEdit,
}: {
  tiles: BoardTile[];
  groups: BoardGroup[];
  placements: TilePlacement[];
  canEdit: boolean;
}) {
  // The `useState` initialisers are what "seeded once" means: the arguments are
  // read on the first render and ignored on every one after it.
  const [groups, setGroups] = useState(seedGroups);
  const [placements, setPlacements] = useState(seedPlacements);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const board = arrangeBoard(tiles, groups, placements);

  /** Replace the placements for these tiles, leaving every other one alone. */
  const applyPlacements = useCallback((next: TilePlacement[]) => {
    const keys = new Set(next.map((p) => p.tileKey));
    setPlacements((prev) => [...prev.filter((p) => !keys.has(p.tileKey)), ...next]);
  }, []);

  /**
   * PUT A TILE IN A LANE AT AN INDEX — the one place key arithmetic happens.
   *
   * Every way a tile moves goes through here: the "Move to" menu, move up and
   * down, and (once it exists) the drag. Centralised because a second opinion
   * about which two neighbours a new key sits between is how a board starts
   * disagreeing with itself.
   *
   * A LANE THAT HAS NEVER BEEN ARRANGED HAS NO KEYS AT ALL — its tiles are in
   * the server's default order with `pos` null — so there is nothing to compute
   * a midpoint against. Rather than inventing one, the whole lane is seeded in
   * the same single write: `setTilePlacementsAction` takes an array precisely so
   * this costs one round trip rather than one per tile.
   */
  const placeTile = useCallback(
    (tileKey: string, groupId: string | null, index: number) => {
      const lane = groupId == null ? board.mode === "board" && board.ungrouped : board.mode === "board" && board.columns.find((c) => c.id === groupId);
      if (!lane) return;
      const posOf = new Map(placements.map((p) => [p.tileKey, p.pos] as const));
      const rest = lane.tiles.filter((t) => t.key !== tileKey);
      const at = Math.max(0, Math.min(index, rest.length));

      let next: TilePlacement[];
      if (rest.every((t) => posOf.has(t.key))) {
        const before = at > 0 ? posOf.get(rest[at - 1].key)! : null;
        const after = at < rest.length ? posOf.get(rest[at].key)! : null;
        next = [{ tileKey, groupId, pos: keyBetween(before, after) }];
      } else {
        const order = [...rest.slice(0, at).map((t) => t.key), tileKey, ...rest.slice(at).map((t) => t.key)];
        const keys = keysBetween(null, null, order.length);
        next = order.map((k, i) => ({ tileKey: k, groupId, pos: keys[i] }));
      }

      const undo = placements.filter((p) => next.some((n) => n.tileKey === p.tileKey));
      const undoKeys = new Set(next.map((n) => n.tileKey));
      applyPlacements(next);
      setTilePlacementsAction(next).then((r) => {
        if (r.ok) return;
        // Key-scoped revert: put back only what this patch touched.
        setPlacements((prev) => [...prev.filter((p) => !undoKeys.has(p.tileKey)), ...undo]);
        setToast(r.error);
      });
    },
    [board, placements, applyPlacements],
  );

  const addGroup = useCallback(async () => {
    setBusy(true);
    // NOT optimistic: the id is the server's to mint, and a column that appears
    // with a placeholder id cannot be dropped into until it is replaced.
    const r = await createGroupAction("New group");
    setBusy(false);
    if (!r.ok) return setToast(r.error);
    setGroups((prev) => [...prev, r.group]);
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    let undo: string | undefined;
    setGroups((prev) => {
      undo = prev.find((g) => g.id === id)?.name;
      return prev.map((g) => (g.id === id ? { ...g, name } : g));
    });
    renameGroupAction(id, name).then((r) => {
      if (r.ok) return;
      setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, name: undo } : g)));
      setToast(r.error);
    });
  }, []);

  const recolourGroup = useCallback((id: string, color: string) => {
    let undo: string | undefined;
    setGroups((prev) => {
      undo = prev.find((g) => g.id === id)?.color;
      return prev.map((g) => (g.id === id ? { ...g, color } : g));
    });
    setGroupColorAction(id, color).then((r) => {
      if (r.ok) return;
      setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, color: undo } : g)));
      setToast(r.error);
    });
  }, []);

  /**
   * DELETING IS NOT OPTIMISTIC, and that is the RanksPanel rule applied to the
   * same kind of act: it moves other people's tiles, so the column only
   * disappears once the server agrees it has.
   *
   * The server returns the keys it actually wrote for the re-homed tiles.
   * Recomputing them here would be two implementations of one piece of
   * arithmetic, agreeing only until somebody edits one of them.
   */
  const removeGroup = useCallback(
    async (id: string) => {
      setBusy(true);
      const r = await deleteGroupAction(id);
      setBusy(false);
      if (!r.ok) return setToast(r.error);
      applyPlacements(r.moved.map((m) => ({ tileKey: m.tileKey, groupId: null, pos: m.pos })));
      setGroups((prev) => prev.filter((g) => g.id !== id));
    },
    [applyPlacements],
  );

  const setSort = useCallback((id: string, sortKey: GroupSortKey) => {
    let undo: GroupSortKey | undefined;
    setGroups((prev) => {
      undo = prev.find((g) => g.id === id)?.sortKey;
      return prev.map((g) => (g.id === id ? { ...g, sortKey } : g));
    });
    setGroupSortAction(id, sortKey).then((r) => {
      if (r.ok) return;
      setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, sortKey: undo } : g)));
      setToast(r.error);
    });
  }, []);

  /**
   * MOVE A COLUMN TO A POSITION IN THE ROW.
   *
   * The same shape as `placeTile` one level up: neighbours from the current
   * order, one key between them, one row written. A column order that has never
   * been touched always has keys — `createGroupAction` mints one per group — so
   * unlike a lane of tiles there is no seeding branch.
   */
  const moveGroup = useCallback(
    (id: string, index: number) => {
      const ordered = groups.slice().sort((a, b) => compareKeys(a.pos, b.pos) || compareKeys(a.id, b.id));
      const rest = ordered.filter((g) => g.id !== id);
      const at = Math.max(0, Math.min(index, rest.length));
      const before = at > 0 ? rest[at - 1].pos : null;
      const after = at < rest.length ? rest[at].pos : null;
      if (before === (ordered.find((g) => g.id === id)?.pos ?? null)) return;
      const pos = keyBetween(before, after);

      let undo: string | undefined;
      setGroups((prev) => {
        undo = prev.find((g) => g.id === id)?.pos;
        return prev.map((g) => (g.id === id ? { ...g, pos } : g));
      });
      setGroupPositionsAction([{ id, pos }]).then((r) => {
        if (r.ok) return;
        setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, pos: undo } : g)));
        setToast(r.error);
      });
    },
    [groups],
  );

  const laneNames = groups.map((g) => ({ id: g.id, name: g.name }));

  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * ONE ENGINE, TWO KINDS OF ITEM. A drop into the columns lane is a column
   * being reordered; anything else is a metric being filed. The engine does not
   * know the difference and does not need to — it answers "which lane, which
   * index", and this decides what that means.
   */
  const { drag, onPointerDown, swallowClick } = useBoardDrag(rootRef, (key, laneId, index) => {
    if (laneId === COLUMNS_LANE) moveGroup(key, index);
    else placeTile(key, laneId, index);
  });
  /** The gap belongs to exactly one lane at a time, at one index. */
  const gapAt = (laneId: string | null) => (drag?.target && drag.target.laneId === laneId ? drag.target.index : null);

  return (
    <div ref={rootRef}>
      {/* THE ONE DOOR to a new column. On the caption line rather than in the
          page header, because that line is already about the board as a whole —
          which is exactly what a group is — and because the header's two
          buttons are about the numbers, not their arrangement. */}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={addGroup} disabled={busy}>
            <Plus size={15} />
            New group
          </Button>
        </div>
      )}

      {board.mode === "grid" ? (
        /* Byte for byte the grid the dashboard rendered before groups existed.
           The class string is IMPORTED rather than spelled — page-width.test.ts
           fails the build if this literal appears anywhere but ui/page.tsx. */
        <div className={`mt-4 items-start ${BOARD_GRID}`}>{board.tiles.map((t) => t.node)}</div>
      ) : (
        <div className="mt-4">
          {/* THE METRICS WITH NOWHERE TO BE, on one line above the board.
              Rendered only when it holds something: an empty scroller is a rule
              that does nothing, and "everything is filed" is worth seeing as an
              absence rather than as an empty box. */}
          {(board.ungrouped.tiles.length > 0 || gapAt(null) != null) && (
            <div {...{ [SCROLLER_ATTR]: "row" }} className={`${SCROLLER_BLEED} overflow-x-auto pb-2`}>
              <div {...{ [LANE_ATTR]: UNGROUPED, [AXIS_ATTR]: "x" }} className={`flex items-start ${LANE_GAP}`}>
                {withGap(board.ungrouped.tiles, gapAt(null), drag?.tileKey ?? null).map((slot) =>
                  slot === null ? (
                    <div key="gap" className={`${COLUMN_W} shrink-0`}>
                      <DropGap />
                    </div>
                  ) : (
                    // `shrink-0` or the row compresses its tiles to fit instead
                    // of scrolling, which is what makes a scroller look like a
                    // broken grid.
                    <div key={slot.key} className={`${COLUMN_W} shrink-0`}>
                      <TileSlot
                        tile={slot}
                        canEdit={canEdit}
                        laneId={null}
                        index={board.ungrouped.tiles.indexOf(slot)}
                        count={board.ungrouped.tiles.length}
                        lanes={laneNames}
                        onPlace={placeTile}
                        accent={groupAccent("grey")}
                        held={drag?.tileKey === slot.key}
                        onGrab={onPointerDown}
                        swallowClick={swallowClick}
                      />
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          <div {...{ [SCROLLER_ATTR]: "columns" }} className={`${SCROLLER_BLEED} mt-4 overflow-x-auto pb-2`}>
            {/* The row of columns is a lane too, whose items are the columns —
                see COLUMNS_LANE. `items-stretch` so a column being dragged past
                a short one still hit-tests against a full-height band. */}
            <div
              {...{ [LANE_ATTR]: COLUMNS_LANE, [AXIS_ATTR]: "x" }}
              className={`flex items-start ${LANE_GAP}`}
            >
              {withGap(
                board.columns.map((l) => ({ key: l.id! }) as BoardTile),
                gapAt(COLUMNS_LANE),
                drag?.tileKey ?? null,
              ).map((slot) =>
                slot === null ? (
                  <div key="colgap" className={`${COLUMN_W} shrink-0 pt-11`}>
                    <DropGap />
                  </div>
                ) : (
                  <BoardColumn
                    key={slot.key}
                    lane={board.columns.find((c) => c.id === slot.key) as BoardLane & { group: BoardGroup }}
                    canEdit={canEdit}
                    busy={busy}
                    lanes={laneNames}
                    onRename={renameGroup}
                    onRecolour={recolourGroup}
                    onDelete={removeGroup}
                    onPlace={placeTile}
                    onSort={setSort}
                    onMoveColumn={moveGroup}
                    columnIndex={board.columns.findIndex((c) => c.id === slot.key)}
                    columnCount={board.columns.length}
                    gapIndex={gapAt(slot.key)}
                    heldKey={drag?.tileKey ?? null}
                    onGrab={onPointerDown}
                    swallowClick={swallowClick}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* THE HELD CARD, UNDER THE CURSOR. A sibling of the board rather than a
          child of a scroller, so it stays with the pointer in screen space
          instead of panning away inside an overflow container. The same reduced
          ghost the flow builder uses, imported unchanged. */}
      {drag && (
        <DragGhost
          x={drag.x}
          y={drag.y}
          title={drag.title}
          mark={<span className="size-5 shrink-0 rounded-control" style={{ background: drag.accent }} />}
        />
      )}

      {toast && <Toast action={{ label: "Dismiss", onClick: () => setToast(null) }}>{toast}</Toast>}
    </div>
  );
}

/**
 * The lane's tiles with the gap spliced in — as `null` — where the held tile
 * would land.
 *
 * THE INDEX COUNTS AMONG THE OTHER TILES, not among all of them, because that
 * is what the drag measured and what the placement maths will be handed: the
 * held card is still on screen (faded, where it was), so counting it would put
 * the gap one place out for every drop below its own position.
 *
 * One helper for both orientations, so a column and the row above it cannot
 * come to disagree about what "index 3" means.
 */
export function withGap(tiles: BoardTile[], gap: number | null, heldKey: string | null): Array<BoardTile | null> {
  if (gap == null) return tiles;
  const out: Array<BoardTile | null> = [];
  let seen = 0;
  let placed = false;
  for (const t of tiles) {
    if (!placed && seen === gap) {
      out.push(null);
      placed = true;
    }
    out.push(t);
    if (t.key !== heldKey) seen++;
  }
  if (!placed) out.push(null);
  return out;
}
