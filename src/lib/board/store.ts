import { and, eq, sql } from "drizzle-orm";
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

/**
 * FORGET WHERE A DELETED METRIC USED TO SIT.
 *
 * THE ONLY CLEANUP PATH THERE IS, and deliberately so. A placement is allowed
 * to outlive its tile — that is exactly how republishing a flow returns its
 * metric to the column it was in — so `materializeFlow` must never call this;
 * it is a hot background path that knows nothing about layout, and hooking it
 * would turn "I re-added that Output" into "and it lost its place".
 *
 * Deleting the flow or the metric ITSELF is the different case: nothing is
 * coming back, and it is a deliberate, rare, user-initiated act with a natural
 * home for the tidying. No sweep job, no scheduled prune.
 *
 * The prefix is `flow:<flowId>:` for a flow — one flow can publish several
 * Outputs and each is its own tile — or `metric:<metricId>` for a classic one.
 * The trailing colon on the flow form matters: without it, deleting flow "ab"
 * would also forget flow "abc".
 *
 * DELIBERATELY NOT A SERVER ACTION. It lives here rather than in
 * `board-actions.ts` because every exported async function in a "use server"
 * module is a public endpoint, and "delete rows matching a prefix I hand you"
 * is not something a browser should be able to ask for.
 */
export async function forgetTilePlacements(db: DB, orgId: string, prefix: string): Promise<void> {
  /**
   * THE WILDCARDS IN THE PREFIX ARE ESCAPED, and binding it as a parameter is
   * NOT what does that.
   *
   * A bound parameter stops the string being read as SQL; it does not stop it
   * being read as a LIKE PATTERN, which is a separate language. `metric:%`
   * passed straight through matches every classic metric the workspace has —
   * a test caught exactly that. Ids are uuids today so nothing can carry a
   * `%` or `_`, but "the caller happens to pass safe input" is not a property
   * this function should depend on when one `replace` makes it true.
   */
  const literal = prefix.replace(/([\\%_])/g, "\\$1");
  await db
    .delete(dashboardTilePlacements)
    .where(
      and(
        eq(dashboardTilePlacements.orgId, orgId),
        sql`${dashboardTilePlacements.tileKey} LIKE ${literal + "%"} ESCAPE '\\'`,
      ),
    );
}
