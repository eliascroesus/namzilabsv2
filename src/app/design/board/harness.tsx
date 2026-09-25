"use client";

import { BoardLayout, type BoardActions } from "@/app/dashboard/board-layout";
import type { BoardTile, BoardGroup, TilePlacement } from "@/lib/board/types";

/**
 * THE GROUPS BOARD, WITH WRITES THAT FAIL WHERE THEY STAND.
 *
 * This page has no session, so the real server actions do not fail — they
 * REDIRECT to WorkOS sign-in, and `pnpm board:drag` spent every drop racing a
 * navigation away from the board it was measuring. These stand-ins fail the way
 * a rejected write fails for a signed-in person: after a beat, with the
 * sentence the board shows. That beat is on purpose — it leaves the optimistic
 * move on screen long enough to be measured, and then the revert and the toast
 * are what the next check measures.
 *
 * A module-level constant, so the board's `useMemo` over it never re-runs.
 */
const refuse = async () => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  return { ok: false as const, error: "Couldn't save — this board is a design fixture, so nothing is written." };
};

const FIXTURE_ACTIONS: Partial<BoardActions> = {
  place: refuse,
  createGroup: refuse,
  renameGroup: refuse,
  noteGroup: refuse,
  recolourGroup: refuse,
  deleteGroup: refuse,
  sortGroup: refuse,
  moveGroups: refuse,
};

export function BoardHarness(props: {
  tiles: BoardTile[];
  groups: BoardGroup[];
  placements: TilePlacement[];
  connectedApps?: string[];
}) {
  return <BoardLayout {...props} canEdit viewId={null} actions={FIXTURE_ACTIONS} />;
}
