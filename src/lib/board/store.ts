import { and, eq, isNull, sql } from "drizzle-orm";
import { compareKeys, keyBetween } from "./order";
import { dashboardGroups, dashboardTilePlacements, dashboardViews } from "@/db/schema";
import type { DB } from "@/db/types";
import { asViewKind } from "./types";
import type { BoardGroup, BoardView, GroupSortKey, TilePlacement } from "./types";

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
/**
 * THE VIEWS A WORKSPACE HAS MADE.
 *
 * Not counting the default one WHILE IT IS STILL THE ABSENCE OF A ROW — the
 * page prepends a synthetic tab for it, so the strip always has at least one.
 * Once it has been adopted (renamed, which mints a row) it is in here like any
 * other view, flagged `is_default`, and the page stops prepending.
 */
export async function listBoardViews(db: DB, orgId: string): Promise<BoardView[]> {
  const rows = await db
    // `kind` and `is_default` ride along inside the SAME projection rather than
    // in a second read: one short string and one boolean per view, on a query
    // that already runs, against the alternative of a query per poll to learn
    // which board to draw and which tab to land on.
    .select({
      id: dashboardViews.id,
      name: dashboardViews.name,
      pos: dashboardViews.pos,
      kind: dashboardViews.kind,
      isDefault: dashboardViews.isDefault,
    })
    .from(dashboardViews)
    .where(eq(dashboardViews.orgId, orgId));
  return rows.map((r) => ({ ...r, kind: asViewKind(r.kind) }));
}

/**
 * `viewId` of null is the default view, and `IS NULL` is how it is asked for —
 * `= NULL` is never true in SQL and would silently return an empty board.
 */
export async function listBoardGroups(db: DB, orgId: string, viewId: string | null): Promise<BoardGroup[]> {
  const rows = await db
    .select({
      id: dashboardGroups.id,
      name: dashboardGroups.name,
      color: dashboardGroups.color,
      pos: dashboardGroups.pos,
      sortKey: dashboardGroups.sortKey,
    })
    .from(dashboardGroups)
    .where(and(eq(dashboardGroups.orgId, orgId), viewId == null ? isNull(dashboardGroups.viewId) : eq(dashboardGroups.viewId, viewId)));
  // Ordering is `arrangeBoard`'s job, not SQL's — see the collation note in
  // order.ts. The comparator that puts these in order is the same one the
  // client uses, which is the entire point of not doing it here.
  return rows.map((r) => ({ ...r, sortKey: r.sortKey as GroupSortKey }));
}

export async function listTilePlacements(db: DB, orgId: string, viewId: string | null): Promise<TilePlacement[]> {
  return db
    .select({
      tileKey: dashboardTilePlacements.tileKey,
      groupId: dashboardTilePlacements.groupId,
      pos: dashboardTilePlacements.pos,
    })
    .from(dashboardTilePlacements)
    .where(
      and(
        eq(dashboardTilePlacements.orgId, orgId),
        viewId == null ? isNull(dashboardTilePlacements.viewId) : eq(dashboardTilePlacements.viewId, viewId),
      ),
    );
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

/**
 * TURN THE DEFAULT BOARD INTO A REAL VIEW — once, lazily, on the first rename.
 *
 * The default board is the ABSENCE of a row: `view_id IS NULL` on this org's
 * groups and placements. That is what made views additive (migration 0027), and
 * the cost was written into the schema at the time — the one board every
 * workspace starts with was the one board nobody could rename. This is the
 * other half of that trade, deferred to the moment it is actually needed: mint
 * the row, flag it, and re-point the org's null rows at it. A workspace that
 * never renames its dashboard is still never written to on a page load, which
 * is what the original design was protecting.
 *
 * IT LIVES HERE RATHER THAN IN `board-actions.ts` for the reason the header of
 * this file gives about the reads: it takes its DB handle as an argument, so
 * `tests/board-default-view.test.ts` drives it against real SQL in PGlite. An
 * action that can only be exercised through `requireOrg()` is an action whose
 * transaction is never tested, and this one moves a customer's stored layout.
 *
 * ONE TRANSACTION, and the reason is the one `duplicateViewAction` gives at
 * length: a half-adoption is worse than a failure. A view row minted without its
 * groups following would show the customer an empty board under their own
 * board's new name, and the groups left behind would be unreachable by any tab,
 * because nothing renders `view_id IS NULL` for an org that has adopted.
 *
 * IT SORTS FIRST, DELIBERATELY. The synthetic tab it replaces was always
 * leftmost, and a rename that also silently moved the tab to the end of the
 * strip would read as two changes for one action.
 */
export async function adoptDefaultView(db: DB, orgId: string, name: string): Promise<string> {
  const rows = await db
    .select({ id: dashboardViews.id, pos: dashboardViews.pos, isDefault: dashboardViews.isDefault })
    .from(dashboardViews)
    .where(eq(dashboardViews.orgId, orgId));

  /**
   * ALREADY ADOPTED — by another tab, or by the request that lost a race to
   * this one. Renaming the existing row is the honest answer: the customer
   * asked for this board to be called that, and it now is. An error here would
   * be technically accurate and useless.
   */
  const existing = rows.find((r) => r.isDefault);
  if (existing) {
    await db
      .update(dashboardViews)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(dashboardViews.id, existing.id), eq(dashboardViews.orgId, orgId)));
    return existing.id;
  }

  const first = rows.map((v) => v.pos).sort(compareKeys).at(0) ?? null;
  const id = crypto.randomUUID();
  const pos = keyBetween(null, first);

  /**
   * ONE STATEMENT, NOT ONE TRANSACTION — and the difference is the whole reason
   * this is written in raw SQL rather than three drizzle calls.
   *
   * IT WAS `db.transaction()`, WHICH THROWS IN PRODUCTION. `DB_DRIVER` defaults
   * to `http` (see db/client.ts), and drizzle's neon-http session answers
   * `transaction()` with `throw new Error("No transactions support in
   * neon-http driver")` — it is a stateless one-statement-per-request driver
   * and cannot hold a session open. So the rename failed on every press, the
   * action returned `{ ok: false }`, and the title snapped back to "Dashboard"
   * with nothing on screen to say why.
   *
   * It passed its tests because PGlite is a real embedded Postgres WITH
   * sessions: the suite was greener than production by construction. That is
   * the gap this file now closes by not needing a session at all.
   *
   * A single statement is atomic in Postgres by definition, so the three writes
   * still land together or not at all — which is the property that mattered.
   * Data-modifying CTEs "are executed exactly once, and always to completion,
   * independently of whether the primary query reads their output", so the
   * INSERT runs even though nothing selects from `v`.
   *
   * THE UPDATES NAME `id` DIRECTLY rather than reading it back out of `v`. The
   * id is minted here, so there is nothing to learn from the RETURNING; and the
   * foreign key on `view_id` is satisfied because constraint triggers fire at
   * the END of the statement, by which time the row exists. Verified against
   * real SQL in tests/board-default-view.test.ts rather than reasoned about.
   *
   * A LOST RACE STILL FAILS SAFELY: `dashboard_views_one_default_uq` rejects the
   * INSERT, the whole statement rolls back, and neither UPDATE is applied.
   */
  await db.execute(sql`
    WITH v AS (
      INSERT INTO ${dashboardViews} (id, org_id, name, pos, kind, is_default, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${name}, ${pos}, 'groups', true, now(), now())
      RETURNING id
    ), g AS (
      UPDATE ${dashboardGroups} SET view_id = ${id}, updated_at = now()
      WHERE org_id = ${orgId} AND view_id IS NULL
    )
    UPDATE ${dashboardTilePlacements} SET view_id = ${id}, updated_at = now()
    WHERE org_id = ${orgId} AND view_id IS NULL
  `);
  return id;
}

/**
 * IS THERE A BOARD HERE THAT PREDATES VIEWS? — one round trip, on a write path.
 *
 * `addViewAction` needs this to answer two questions about the FIRST view a
 * workspace creates: what to call it, and whether it is that workspace's default
 * board.
 *
 * The distinction it draws cannot be skipped. Two workspaces both have zero
 * rows in `dashboard_views`:
 *
 *   · one is genuinely new — nothing at `view_id IS NULL`, so the view being
 *     created is the first board it has ever had. It is View 1, and it IS the
 *     default: flagged, so `viewStrip` stops synthesising a "Dashboard" tab that
 *     would sit beside it pointing at nothing.
 *   · the other has a board from before views existed, reachable only through
 *     that synthesised tab. THAT board is View 1, the new one is View 2, and
 *     flagging the new one default would stop the tab being synthesised and
 *     leave the old board reachable from nowhere.
 *
 * Which is why this is a server read and not a hint from the client. A forged
 * "I was on the empty screen" field would take the second workspace's board off
 * the screen entirely — a visibility bug from a checkbox.
 *
 * COLUMNS ONLY, WHICH IS WHAT THE PAGE ASKS TOO. A placement with no group is
 * ignored by the renderer, so it is not an arrangement anybody can see — and
 * more importantly the two questions have to agree: the page decides the
 * workspace is empty on `groups.length === 0`, and if this counted placements as
 * well it would answer "not empty" for the same workspace, name its first view
 * "View 2" and leave the synthesised tab in place beside it.
 */
export async function hasLegacyBoard(db: DB, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({
      groups: sql<boolean>`exists (select 1 from ${dashboardGroups} where ${dashboardGroups.orgId} = ${orgId} and ${dashboardGroups.viewId} is null)`,
    })
    .from(sql`(select 1) as one`);
  return Boolean(row?.groups);
}
