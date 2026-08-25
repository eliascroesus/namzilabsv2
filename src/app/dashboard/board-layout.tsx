"use client";

import { useState } from "react";
import { arrangeBoard, type BoardLane } from "@/lib/board/arrange";
import type { BoardGroup, BoardTile, TilePlacement } from "@/lib/board/types";
import { groupAccent } from "@/components/flow/node-accent";
import { BOARD_GRID } from "@/components/ui/page";
import { COLUMN_W, LANE_GAP, SCROLLER_BLEED } from "./board-shape";

/**
 * THE DASHBOARD'S ARRANGEMENT, AND THE ONE THING THAT OWNS IT.
 *
 * The tiles are SERVER components. They arrive here already rendered, as the
 * `node` field on each `BoardTile`, and this component places them without ever
 * looking inside one — which is what lets an expensive server-rendered card sit
 * inside a layout that a pointer drag rearranges sixty times a second.
 *
 * IT IS MOUNTED EVEN WHEN THERE ARE NO GROUPS, and that is a correction to the
 * obvious design rather than an oversight. Leaving the zero-group case as plain
 * server markup would ship less JavaScript, and it would break as soon as a
 * second group was created: this component seeds its state ONCE and never
 * re-seeds (see below), so a `revalidatePath` from "New group" would re-render
 * the server component into props this one is deliberately ignoring, and the
 * new column would simply never appear. One owner, always mounted, no race. The
 * markup it emits with no groups is the grid the page emitted before this
 * feature existed, which is the promise that matters.
 *
 * SEEDED ONCE, NEVER RE-SEEDED. `FreshnessPoller` calls `router.refresh()`
 * every twelve seconds; React keeps this component mounted across that, so the
 * arrangement survives without flicker and a drag in flight is never overwritten
 * by a server render that started before it. The cost is that another tab's
 * rearrangement does not appear until reload, which is the right trade for v1 —
 * the honest upgrade is a `layoutRev` prop and a re-seed effect gated on "no
 * write in flight", and it is not worth building until someone asks.
 */
export function BoardLayout({
  tiles,
  groups: seedGroups,
  placements: seedPlacements,
}: {
  tiles: BoardTile[];
  groups: BoardGroup[];
  placements: TilePlacement[];
}) {
  // The `useState` initialisers are what "seeded once" means: the arguments are
  // read on the first render and ignored on every one after it.
  const [groups] = useState(seedGroups);
  const [placements] = useState(seedPlacements);

  const board = arrangeBoard(tiles, groups, placements);

  // Byte for byte the grid the dashboard rendered before groups existed. The
  // class string is IMPORTED rather than spelled — `tests/page-width.test.ts`
  // fails the build if this literal appears anywhere but `ui/page.tsx`.
  if (board.mode === "grid") {
    return <div className={`mt-4 items-start ${BOARD_GRID}`}>{board.tiles.map((t) => t.node)}</div>;
  }

  return (
    <div className="mt-4">
      {/* THE METRICS WITH NOWHERE TO BE, on one line above the board.
          Rendered only when it has something in it: an empty scroller is a
          horizontal rule that does nothing, and the state it represents —
          "everything is filed" — is worth seeing as an absence. */}
      {board.ungrouped.tiles.length > 0 && (
        <div className={`${SCROLLER_BLEED} overflow-x-auto pb-2`}>
          <div className={`flex items-start ${LANE_GAP}`}>
            {board.ungrouped.tiles.map((t) => (
              // `shrink-0` or the row compresses its tiles to fit instead of
              // scrolling, which is the failure mode that makes a scroller look
              // like a broken grid.
              <div key={t.key} className={`${COLUMN_W} shrink-0`}>
                {t.node}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${SCROLLER_BLEED} mt-4 overflow-x-auto pb-2`}>
        <div className={`flex items-start ${LANE_GAP}`}>
          {board.columns.map((lane) => (
            <Column key={lane.id} lane={lane} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** One group, as a column: a header row, then its tiles stacked under it. */
function Column({ lane }: { lane: BoardLane }) {
  const g = lane.group!;
  return (
    <section className={`${COLUMN_W} shrink-0`} aria-label={g.name}>
      {/* A ROW, NOT A CARD. A header inside a card inside a column is three
          boxes drawn for one label, and the column's tiles are already cards. */}
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: groupAccent(g.color) }}
          aria-hidden
        />
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{g.name}</h3>
        <span className="tnum shrink-0 text-tiny text-muted-foreground">{lane.tiles.length}</span>
      </div>

      {lane.tiles.length === 0 ? (
        /* An empty column is a header over nothing, which reads as a tile that
           failed to load. Saying what the space is for turns it into a target. */
        <div className="flex min-h-[120px] items-center justify-center rounded-surface border-2 border-dashed border-border px-4 text-center text-tiny text-muted-foreground">
          Nothing in this group yet
        </div>
      ) : (
        <div className={`flex flex-col ${LANE_GAP}`}>{lane.tiles.map((t) => t.node)}</div>
      )}
    </section>
  );
}
