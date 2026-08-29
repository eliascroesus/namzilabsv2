"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useSettle } from "./board-settle";
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
import { ACCEPTS_ATTR, AXIS_ATTR, COLUMNS_LANE, LANE_ATTR, SCROLLER_ATTR, UNGROUPED, useBoardDrag } from "./board-drag";
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
  viewId,
  viewStrip,
  boardActions,
}: {
  tiles: BoardTile[];
  groups: BoardGroup[];
  placements: TilePlacement[];
  canEdit: boolean;
  /**
   * Which view this board IS. `null` is the default one.
   *
   * Every write carries it, because a column and a position belong to a view.
   * The page also passes it as this component's `key` — see the note above
   * about seeding once: without a remount, switching views would leave the
   * previous view's board on screen with the new view's props ignored.
   */
  viewId: string | null;
  /**
   * The view tabs, rendered on the SERVER and passed through — same trick the
   * tiles use, and for the same reason: they are links that must work without
   * JavaScript, and this component is the only thing that knows where the
   * board's own controls sit.
   *
   * They live on this row rather than up in the page header because the header
   * asks a different question: it narrows WHICH NUMBERS (the period), while
   * everything on this row is about the board those numbers land on.
   */
  viewStrip?: ReactNode;
  /**
   * The source picker and Refresh all — the right half of the same row.
   *
   * They arrive as a node for exactly the reason `viewStrip` does: the source
   * rows are real anchors and Refresh all is a plain form post, so both are
   * rendered on the SERVER, and this component is the only thing that knows
   * where the board's own control row sits. They used to live in a white filter
   * island above the board, alongside the period pills; the island is gone (see
   * the note on `boardActions` in page.tsx) and the period went upstairs, so
   * what is left of it is these two, on the row that was already here.
   *
   * "New group" stays a child of this file rather than joining them, because it
   * is the one control on the row that is CLIENT state: it calls `addGroup`
   * below, which writes optimistically into the same `groups` this component
   * owns. It renders FIRST of the three, so the row runs
   * arrangement → filter → action from left to right and the yellow lands on
   * the outside edge where a hero belongs.
   */
  boardActions?: ReactNode;
}) {
  // The `useState` initialisers are what "seeded once" means: the arguments are
  // read on the first render and ignored on every one after it.
  const [groups, setGroups] = useState(seedGroups);
  const [placements, setPlacements] = useState(seedPlacements);
  const [toast, setToast] = useState<string | null>(null);

  /**
   * A WRITE THAT NEVER ANSWERED IS A WRITE THAT FAILED.
   *
   * Every action here was `.then(revert-if-not-ok)` with no `.catch()`, and a
   * server action does not only RESOLVE to `{ok:false}` — it REJECTS. A session
   * that expired, a network blip, and above all a deployment: Next mints a new
   * id for every server action it builds, so a tab that was open across a
   * deploy calls an id the server no longer knows and the fetch simply fails.
   *
   * With no catch, that rejection was silent AND invisible: the optimistic move
   * stayed on screen, nothing was written, and the arrangement was back where
   * it started on the next load. Which is indistinguishable, from the outside,
   * from "the drag doesn't work".
   *
   * So every write goes through here. A rejection is treated exactly like
   * `{ok:false}` — put it back, and SAY so.
   *
   * THE IMPLEMENTATION MOVED, and only the implementation. It lives in
   * `useSettle` now because the custom canvas makes optimistic writes too and
   * needs the identical answer — and two copies of this is precisely how the
   * missing `.catch` comes back.
   */
  const settle = useSettle(setToast);
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
      // Key-scoped revert: put back only what this patch touched.
      settle(setTilePlacementsAction(next, viewId), () =>
        setPlacements((prev) => [...prev.filter((p) => !undoKeys.has(p.tileKey)), ...undo]),
      );
    },
    [board, placements, applyPlacements, settle, viewId],
  );

  const addGroup = useCallback(async () => {
    setBusy(true);
    // NOT optimistic: the id is the server's to mint, and a column that appears
    // with a placeholder id cannot be dropped into until it is replaced.
    const r = await createGroupAction("New group", viewId).catch(() => null);
    setBusy(false);
    if (!r) return setToast("Couldn't add a group — the page may be out of date. Reload and try again.");
    if (!r.ok) return setToast(r.error);
    setGroups((prev) => [...prev, r.group]);
  }, [viewId]);

  const renameGroup = useCallback((id: string, name: string) => {
    let undo: string | undefined;
    setGroups((prev) => {
      undo = prev.find((g) => g.id === id)?.name;
      return prev.map((g) => (g.id === id ? { ...g, name } : g));
    });
    settle(renameGroupAction(id, name), () =>
      setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, name: undo } : g))),
    );
  }, [settle]);

  const recolourGroup = useCallback((id: string, color: string) => {
    let undo: string | undefined;
    setGroups((prev) => {
      undo = prev.find((g) => g.id === id)?.color;
      return prev.map((g) => (g.id === id ? { ...g, color } : g));
    });
    settle(setGroupColorAction(id, color), () =>
      setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, color: undo } : g))),
    );
  }, [settle]);

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
      const r = await deleteGroupAction(id, viewId).catch(() => null);
      setBusy(false);
      if (!r) return setToast("Couldn't delete that group — the page may be out of date. Reload and try again.");
      if (!r.ok) return setToast(r.error);
      applyPlacements(r.moved.map((m) => ({ tileKey: m.tileKey, groupId: null, pos: m.pos })));
      setGroups((prev) => prev.filter((g) => g.id !== id));
    },
    [applyPlacements, viewId],
  );

  const setSort = useCallback((id: string, sortKey: GroupSortKey) => {
    let undo: GroupSortKey | undefined;
    setGroups((prev) => {
      undo = prev.find((g) => g.id === id)?.sortKey;
      return prev.map((g) => (g.id === id ? { ...g, sortKey } : g));
    });
    settle(setGroupSortAction(id, sortKey), () =>
      setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, sortKey: undo } : g))),
    );
  }, [settle]);

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
      settle(setGroupPositionsAction([{ id, pos }]), () =>
        setGroups((prev) => prev.map((g) => (g.id === id && undo != null ? { ...g, pos: undo } : g))),
      );
    },
    [groups, settle],
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
  /**
   * A sorted column gets no positional gap — see BoardColumn. It still gets the
   * drop; what it cannot honestly show is WHERE, because the sort decides that
   * on the next render and the placeholder would have promised otherwise.
   */
  const sortedIds = new Set(groups.filter((g) => g.sortKey !== "manual").map((g) => g.id));

  return (
    // `select-none` ONLY while something is in the air. A press moves a few
    // pixels before it counts as a drag, which is enough for the browser to
    // start selecting text — so a frozen drag came with a blue smear across the
    // card's own name. Permanent `select-none` would be the lazy fix and would
    // cost the ability to copy a number off the board.
    <div ref={rootRef} className={drag ? "select-none" : undefined}>
      {/* ── THE TAB / ACTION ROW ────────────────────────────────────────────
          WHICH VIEW on the left, WHAT IS ON IT on the right, and everything
          here is about THIS BOARD. The one question that is not — over what
          period — moved up to the page header, where it sits beside the title
          as the pill group. One question per row, which is what lets a reader
          stop looking for the third control.

          The right half arrives in two pieces from two places, and the seam is
          real rather than incidental: `boardActions` is server markup (real
          anchors, a real form post), "New group" is client state. They are
          spelled as one 16px group because from the outside they are one.

          `items-start`, not centre: the tab strip can wrap to a second line and
          the buttons must stay on the first one, level with the tabs rather
          than floating half-way down a two-line strip.

          NO TOP MARGIN — THE HEADER ALREADY OWNS THIS GAP. `PageHeader` ends in
          `pb-4`, which is the 16px step this row is meant to sit at; the `mt-4`
          that used to be here added a second one, so the title block and the
          tabs stood 32px apart and the top of the page read as two unrelated
          bands rather than one head. One owner for the distance, and it is the
          header, because every page in the product gets that same 16px from it.
          The board below keeps its own `mt-4` — that gap is this row's, not the
          header's. */}
      {(viewStrip || boardActions || canEdit) && (
                <div className="flex items-center justify-between gap-4">
          {/* CENTRED, NOT TOP-ALIGNED. `items-start` put the two halves of this
              row on a shared TOP edge, and they are not the same height — the
              tab strip measures 32px against the 36px action pills, so the tab
              labels sat exactly 2px below the button labels. Two rows of text
              that nearly share a baseline read as a mistake rather than as a
              hierarchy. `items-center` gives them a shared MIDDLE, which is the
              line the eye actually uses. Wrapping is unaffected: a folded block
              of actions centres against the tabs the same way one row does. */}
          {/* WRAPS RATHER THAN SCROLLS. A scroller here put a grey bar under
              two tabs and capped the strip at a width nothing asked for; tabs
              are short and there is a whole row of space, so they simply fill
              it and fold onto a second line when there are enough of them. */}
          <div className="min-w-0 flex-1">{viewStrip}</div>
          {(boardActions || canEdit) && (
            /* 16px, and it wraps: three pills at ~110px each is a third of a
               narrow viewport, and a row that cannot fold would push the page
               into horizontal scroll — the failure the period track upstairs
               carries its own scroller to avoid. `justify-end` so a folded
               second line stays against the right edge rather than drifting
               back under the tabs. */
            <div className="flex flex-wrap items-center justify-end gap-4">
              {canEdit && (
                <Button variant="secondary" size="sm" onClick={addGroup} disabled={busy} className="shrink-0">
                  <Plus size={15} />
                  New group
                </Button>
              )}
              {boardActions}
            </div>
          )}
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
            <>
              {/* A HEADING, ON THE SAME LINE THE COLUMNS WEAR THEIRS.
                  Without it this row is just "the dashboard" with a set of
                  columns under it, and nothing on screen says the two are the
                  same pile of metrics in two states. The badge is deliberately
                  the plain neutral one: ungrouped is not a group, and giving it
                  a colour would make it look like the eleventh. */}
              <div className="mb-3 flex h-8 items-center gap-2 px-0.5">
                {/* `bg-foreground/5`, NOT `bg-muted`. Both `--muted` and the
                    page are #f5f5f5 now, so the badge was painting the
                    background onto itself: a neutral pill that was, on this
                    surface, no pill at all. An alpha of the near-black reads on
                    the off-white page and inverts with the theme for free,
                    which no fixed step of the grey ramp does — the same
                    correction `Chip`'s own count pill carries.
                    The count sits INSIDE it, like the columns' do. */}
                <span className="flex items-center gap-1.5 rounded-full bg-foreground/5 py-1 pl-2 pr-2">
                  <span className="size-2 shrink-0 rounded-full bg-neutral-400" aria-hidden />
                  <span className="text-small font-semibold text-muted-foreground">Ungrouped</span>
                  <span className="tnum shrink-0 pl-0.5 text-tiny font-semibold text-muted-foreground opacity-70">
                    {board.ungrouped.tiles.length}
                  </span>
                </span>
              </div>
              <div {...{ [SCROLLER_ATTR]: "row" }} className={`${SCROLLER_BLEED} quiet-scroll overflow-x-auto pb-3`}>
                <div {...{ [LANE_ATTR]: UNGROUPED, [AXIS_ATTR]: "x", [ACCEPTS_ATTR]: "tile" }} className={`flex items-start ${LANE_GAP}`}>
                  {withGap(board.ungrouped.tiles, gapAt(null), drag?.tileKey ?? null).map((slot) =>
                    slot === null ? (
                      <div key="gap" className={`${COLUMN_W} shrink-0`}>
                        <DropGap height={drag?.height} />
                      </div>
                    ) : (
                      // `shrink-0` or the row compresses its tiles to fit
                      // instead of scrolling, which is what makes a scroller
                      // look like a broken grid.
                      <div key={slot.key} className={`${COLUMN_W} shrink-0`}>
                        <TileSlot
                          tile={slot}
                          canEdit={canEdit}
                          laneId={null}
                          index={board.ungrouped.tiles.indexOf(slot)}
                          count={board.ungrouped.tiles.length}
                          lanes={laneNames}
                          onPlace={placeTile}
                          held={drag?.tileKey === slot.key}
                          onGrab={onPointerDown}
                          swallowClick={swallowClick}
                        />
                      </div>
                    ),
                  )}
                </div>
              </div>
            </>
          )}

          <div {...{ [SCROLLER_ATTR]: "columns" }} className={`${SCROLLER_BLEED} quiet-scroll mt-6 overflow-x-auto pb-3`}>
            {/* The row of columns is a lane too, whose items are the columns —
                see COLUMNS_LANE.

                `items-start`: A COLUMN IS AS TALL AS WHAT IT HOLDS. This was
                briefly `items-stretch`, on the argument that ragged bottoms are
                the first thing you see on a board and that a short column offers
                the drag a short target. Both are true of a board whose columns
                are within a card or two of each other, and neither survives real
                data: one column of eight metrics beside one of two paints a
                three-quarter-height wash of tinted nothing under the short one,
                and a large empty panel reads as a column that failed to load —
                which is a worse thing to say than "these two columns differ in
                length", a fact the customer already knows because they filed
                them. The drag's own floor is `min-h-[140px]` on the lane (see
                BoardColumn), which is what keeps an empty column aimable.

                It is the same rule the tile grid states one screen up: a tile is
                as tall as what it has to say. */}
            <div
              {...{ [LANE_ATTR]: COLUMNS_LANE, [AXIS_ATTR]: "x", [ACCEPTS_ATTR]: "column" }}
              className={`flex items-start ${LANE_GAP}`}
            >
              {withGap(
                board.columns.map((l) => ({ key: l.id! }) as BoardTile),
                gapAt(COLUMNS_LANE),
                drag?.tileKey ?? null,
              ).map((slot) =>
                slot === null ? (
                  <div key="colgap" className={`${COLUMN_W} shrink-0 pt-11`}>
                    <DropGap accent={groupAccent("grey")} />
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
                    gapIndex={sortedIds.has(slot.key) ? null : gapAt(slot.key)}
                    dropping={gapAt(slot.key) != null}
                    gapHeight={drag?.height}
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
          // The mark carries the colour of the lane it came FROM, so a card in
          // the air still says where it belongs until it lands somewhere else.
          // Ungrouped tiles have no colour and get the neutral one rather than
          // a smudge of grey pretending to be a group.
          mark={
            <span
              className="size-5 shrink-0 rounded-control"
              style={{ background: drag.accent || "var(--color-neutral-300)" }}
            />
          }
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
