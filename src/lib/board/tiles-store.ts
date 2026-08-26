import { and, eq } from "drizzle-orm";
import { dashboardTiles } from "@/db/schema";
import type { DB } from "@/db/types";
import type { BoardTileRow } from "./types";

/**
 * THE CUSTOM CANVAS'S ONE READ.
 *
 * IT LIVES BESIDE `store.ts` RATHER THAN IN IT, and that is a real distinction
 * rather than filing. That module's header describes THREE reads that fire on
 * every twelve-second poll in every open tab, and its budget argument depends
 * on the number being three. This one is CONDITIONAL and mutually exclusive
 * with two of them: a groups view never runs it, and a custom view never runs
 * groups or placements, because it has neither. Adding it there would make the
 * count four and the sentence explaining the count false.
 *
 * The same discipline applies regardless, because the same poller pays for it:
 *   · COLUMNS ARE LISTED OUT, never `select()`. `config` is a jsonb blob that
 *     will grow as charts gain settings, and it is already the widest thing
 *     here; a `select()` would put every future column on the hot path for
 *     free.
 *   · NO ORDER BY. `compact` in grid.ts returns canonical reading order, and it
 *     has to run anyway — sorting in SQL would be the same work done twice, in
 *     the one place that costs egress.
 *   · NO JOIN TO `flow_results`. A tile's numbers come from the reads the page
 *     already does; joining would double the cost of the board to save a lookup
 *     in a Map.
 *
 * `view_id` IS NOT NULL on this table, so this is the one board read with no
 * `IS NULL` branch at all — NULL means "the default view" on the other two, and
 * the default view is always a groups view and can hold none of these.
 *
 * THROWS rather than returning `[]`. An empty array here would render an empty
 * canvas over a customer's real arrangement and call it their layout — the same
 * lie `publishedFlowTiles` and `store.ts` both document at length.
 */
export async function listBoardTiles(db: DB, orgId: string, viewId: string): Promise<BoardTileRow[]> {
  const rows = await db
    .select({
      id: dashboardTiles.id,
      tileKey: dashboardTiles.tileKey,
      chart: dashboardTiles.chart,
      config: dashboardTiles.config,
      x: dashboardTiles.x,
      y: dashboardTiles.y,
      w: dashboardTiles.w,
      h: dashboardTiles.h,
    })
    .from(dashboardTiles)
    .where(and(eq(dashboardTiles.orgId, orgId), eq(dashboardTiles.viewId, viewId)));
  return rows.map((r) => ({ ...r, config: (r.config ?? {}) as Record<string, unknown> }));
}
