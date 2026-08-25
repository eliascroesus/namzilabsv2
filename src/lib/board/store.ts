import { eq } from "drizzle-orm";
import { dashboardGroups, dashboardTilePlacements } from "@/db/schema";
import type { DB } from "@/db/types";
import type { BoardGroup, GroupSortKey, TilePlacement } from "./types";

/**
 * THE BOARD'S TWO READS, AND THE BUDGET THEY LIVE INSIDE.
 *
 * `FreshnessPoller` calls `router.refresh()` every twelve seconds, in every open
 * tab, which re-runs the whole dashboard server component — so anything added
 * here is not a query, it is a standing rate. Neon bills every byte returned.
 *
 * Hence, and these are rules rather than observations:
 *   · COLUMNS ARE LISTED OUT, never `select()`. A wide column added to either
 *     table later must not ride along on the hottest page in the product. This
 *     is the discipline `tests/dashboard-tiles.test.ts` already pins for the
 *     tile reads.
 *   · NO `count(*)` PER GROUP. The counts on the column headers are computed in
 *     JS from rows already in hand.
 *   · NO JOIN FROM PLACEMENTS TO `flow_results`. It is tempting for a badge and
 *     it would double the cost of the board on every poll; a placement whose
 *     tile no longer exists is dropped by `arrangeBoard` for free.
 *   · NO PER-TILE QUERY, ever.
 *
 * Neither function is `"server-only"`, deliberately: both take their DB handle
 * as an argument, and `tests/board-groups-db.test.ts` drives them against
 * PGlite the way the engine's readers are driven.
 *
 * Both THROW rather than returning `[]` on failure. The dashboard turns a
 * rejection into its load-error banner; an empty array here would render an
 * ungrouped board over a customer's real arrangement and call it their layout —
 * the same lie `publishedFlowTiles` documents at length for tiles.
 */
export async function listBoardGroups(db: DB, orgId: string): Promise<BoardGroup[]> {
  const rows = await db
    .select({
      id: dashboardGroups.id,
      name: dashboardGroups.name,
      color: dashboardGroups.color,
      pos: dashboardGroups.pos,
      sortKey: dashboardGroups.sortKey,
    })
    .from(dashboardGroups)
    .where(eq(dashboardGroups.orgId, orgId));
  // Ordering is `arrangeBoard`'s job, not SQL's — see the collation note in
  // order.ts. The comparator that puts these in order is the same one the
  // client uses, which is the entire point of not doing it here.
  return rows.map((r) => ({ ...r, sortKey: r.sortKey as GroupSortKey }));
}

export async function listTilePlacements(db: DB, orgId: string): Promise<TilePlacement[]> {
  return db
    .select({
      tileKey: dashboardTilePlacements.tileKey,
      groupId: dashboardTilePlacements.groupId,
      pos: dashboardTilePlacements.pos,
    })
    .from(dashboardTilePlacements)
    .where(eq(dashboardTilePlacements.orgId, orgId));
}
