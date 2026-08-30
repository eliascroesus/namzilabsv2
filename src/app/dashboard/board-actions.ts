"use server";

import { redirect } from "next/navigation";

import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import { dashboardGroups, dashboardTilePlacements, dashboardTiles, dashboardViews, flowResults } from "@/db/schema";
import { requireOrg, type OrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { boardGroupCap, boardPlacementCap, boardTileCap, boardViewCap } from "@/lib/limits";
import { compareKeys, keyBetween, keysBetween } from "@/lib/board/order";
import { adoptDefaultView } from "@/lib/board/store";
import { compact, GRID_COLS } from "@/lib/board/grid";
import { BLOCK_IDS, CHART_IDS, asChartId, blockKindOf, defaultSize, minSize } from "@/lib/board/charts";
import { parseTileConfig, TILE_CONFIG_KEYS } from "@/lib/board/tile-config";
import { asViewKind, type BoardTileRow } from "@/lib/board/types";
import { GROUP_ACCENT } from "@/components/flow/node-accent";
import type { BoardGroup } from "@/lib/board/types";

/**
 * EVERY WAY THE BOARD CAN BE REARRANGED, AND THE ONE GATE THEY ALL PASS.
 *
 * These carry an INTERACTIVE result — `{ ok }` rather than a redirect — because
 * every caller is a client component doing an optimistic write and needing to
 * know whether to put it back. Same channel `updateRankAction` uses, for the
 * same reason.
 *
 * NONE OF THEM CALL `revalidatePath("/dashboard")`, and that is deliberate
 * rather than forgotten. `BoardLayout` owns the arrangement: it seeds its state
 * once and never re-seeds, so a revalidation would re-render the server
 * component into props the client is ignoring — no update, and a race against
 * whatever drag is in flight. The client already knows the answer; the server's
 * job here is to remember it.
 *
 * EVERY EXPORT IS AN ASYNC FUNCTION, because Next.js requires it of a
 * "use server" module — a sync helper exported from here fails the build.
 */

const RANK_BLOCKS = "Your role doesn't allow changing the dashboard layout.";

/**
 * A NEW VIEW ROW, AS THE OPENING CTE OF A LARGER STATEMENT.
 *
 * WHY ANY OF THIS IS RAW SQL. Three writers here have to create a view AND the
 * rows that only make sense alongside it — a calendar's metric, a duplicate's
 * groups and placements. The obvious tool is `db.transaction()`, and it is not
 * available: the deployed driver is `neon-http` (DB_DRIVER defaults to "http" in
 * db/client.ts), which is stateless and answers `transaction()` with
 * `throw new Error("No transactions support in neon-http driver")`. It throws
 * rather than silently degrading, so `duplicateViewAction` has simply never
 * worked in production while passing every test in `board-duplicate.test.ts` —
 * PGlite is a real embedded Postgres WITH sessions, so the suite is GREENER THAN
 * PRODUCTION by construction. `adoptDefaultView` shipped the same bug and
 * `board-default-view.test.ts` now guards it on the SOURCE, which is the only
 * place the two environments differ.
 *
 * A data-modifying CTE is one statement and therefore atomic on every driver.
 * Not exported, because Next.js requires every export of a "use server" module
 * to be an async function.
 */
function newViewCte(id: string, orgId: string, name: string, pos: string, kind: string) {
  return sql`
    with v as (
      insert into ${dashboardViews} (id, org_id, name, pos, kind)
      values (${id}, ${orgId}, ${name}, ${pos}, ${kind})
      returning id
    )`;
}

/**
 * The gate: arranging the shared dashboard is editing the workspace's furniture,
 * so it takes the same permission as building the metrics on it. A member
 * without it still SEES the arrangement — reading is not editing — which is why
 * this is on the mutations only.
 *
 * Deliberately NOT `canSeeMetric`: a placement names a tile key, and a member
 * who cannot see that tile never receives it in the first place. The question
 * that matters here is whether they may rearrange at all.
 */
async function blocked(ctx: Pick<OrgContext, "orgId" | "userId" | "role">): Promise<boolean> {
  const access = await effectiveAccess(getDb(), ctx);
  return !access.can("create_flows");
}

type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Whatever went wrong, at the one length a toast can hold. */
const oops = (e: unknown) => fail((e instanceof Error ? e.message : String(e)).slice(0, 200));

const nameSchema = z.string().trim().min(1, "A group needs a name.").max(60, "That name is too long.");
const colorSchema = z.string().refine((c) => c in GROUP_ACCENT, "That colour isn't one of ours.");
const idSchema = z.string().min(1).max(64);

/**
 * A POSITION KEY, VALIDATED AS A KEY.
 *
 * The client computes these, so they arrive from a browser and are checked like
 * anything else that does. The alphabet is the scheme's whole safety property —
 * an uppercase character would order one way in Postgres and another in JS —
 * and the trailing-digit rule is what stops two strings meaning one position.
 */
const posSchema = z
  .string()
  .regex(/^[0-9a-z]{1,64}$/, "Bad position key.")
  .refine((p) => !p.endsWith("0"), "Bad position key.");

/**
 * `excluded` is the row Postgres was ASKED to insert, and it is the only way a
 * MULTI-ROW upsert can set each row to its own value: a literal in the `set`
 * would write one item's position onto every row in the batch.
 */
/**
 * WHICH VIEW A WRITE IS FOR, as a predicate.
 *
 * `= NULL` is never true in SQL, so the default view — whose `view_id` is NULL
 * — has to be asked for with `IS NULL`. Getting this wrong does not error; it
 * silently matches nothing, which on a board reads as "my groups vanished".
 */
const inView = (col: AnyPgColumn, viewId: string | null) => (viewId == null ? isNull(col) : eq(col, viewId));

const EXCLUDED_POS = sql.raw(`excluded."pos"`);
const EXCLUDED_GROUP = sql.raw(`excluded."group_id"`);
const EXCLUDED_VIEW = sql.raw(`excluded."view_id"`);
const EXCLUDED_X = sql.raw(`excluded."x"`);
const EXCLUDED_Y = sql.raw(`excluded."y"`);
const EXCLUDED_W = sql.raw(`excluded."w"`);
const EXCLUDED_H = sql.raw(`excluded."h"`);

export async function createGroupAction(name: string, viewId: string | null = null): Promise<Result<{ group: BoardGroup }>> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That name won't work.");

  try {
    const db = getDb();
    const existing = await db
      .select({ pos: dashboardGroups.pos })
      .from(dashboardGroups)
      .where(and(eq(dashboardGroups.orgId, ctx.orgId), inView(dashboardGroups.viewId, viewId)));
    const cap = boardGroupCap();
    if (existing.length >= cap) {
      return fail(`This workspace has reached its limit of ${cap} groups. Delete one to add another.`);
    }
    // Onto the END of the row of columns, which is where a new one is looked
    // for. One key, computed from the last position and nothing else.
    const last = existing.map((g) => g.pos).sort(compareKeys).at(-1) ?? null;
    const group: BoardGroup = {
      id: crypto.randomUUID(),
      name: parsed.data,
      // A new column arrives UNCOLOURED. Ten swatches at the moment of creation
      // is a decision demanded before there is anything to decide about; the
      // kebab is where a colour gets chosen, once the column means something.
      color: "grey",
      pos: keyBetween(last, null),
      sortKey: "manual",
    };
    await db.insert(dashboardGroups).values({ ...group, orgId: ctx.orgId, viewId });
    return { ok: true, group };
  } catch (e) {
    return oops(e);
  }
}

export async function renameGroupAction(id: string, name: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown group.");
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That name won't work.");
  try {
    // FILTERED BY ID **AND** ORG, every time. The id arrives from a browser, and
    // one belonging to another workspace must find nothing rather than
    // something — the discipline every rank mutation already follows.
    await getDb()
      .update(dashboardGroups)
      .set({ name: parsed.data, updatedAt: new Date() })
      .where(and(eq(dashboardGroups.id, id), eq(dashboardGroups.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

export async function setGroupColorAction(id: string, color: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown group.");
  const parsed = colorSchema.safeParse(color);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That colour isn't one of ours.");
  try {
    await getDb()
      .update(dashboardGroups)
      .set({ color: parsed.data, updatedAt: new Date() })
      .where(and(eq(dashboardGroups.id, id), eq(dashboardGroups.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * DELETING A COLUMN NEVER DELETES A METRIC.
 *
 * Its tiles are re-keyed onto the END of the ungrouped row first, in the order
 * they were sitting in, so the group's contents survive as a run rather than
 * scattering — and they land where somebody would look for them rather than
 * jumping to the front of a row they were never in.
 *
 * The re-key happens BEFORE the delete, and the FK's ON DELETE SET NULL is the
 * safety net behind it: if this ever stops running, the tiles still come home
 * to Ungrouped instead of pointing at a group that is gone.
 */
export async function deleteGroupAction(id: string, viewId: string | null = null): Promise<Result<{ moved: Array<{ tileKey: string; pos: string }> }>> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown group.");
  const db = getDb();
  try {
    const rows = await db
      .select({
        tileKey: dashboardTilePlacements.tileKey,
        groupId: dashboardTilePlacements.groupId,
        pos: dashboardTilePlacements.pos,
      })
      .from(dashboardTilePlacements)
      .where(and(eq(dashboardTilePlacements.orgId, ctx.orgId), inView(dashboardTilePlacements.viewId, viewId)));

    const leaving = rows.filter((r) => r.groupId === id).sort((a, b) => compareKeys(a.pos, b.pos));
    let moved: Array<{ tileKey: string; pos: string }> = [];
    if (leaving.length > 0) {
      const tail =
        rows
          .filter((r) => r.groupId === null)
          .map((r) => r.pos)
          .sort(compareKeys)
          .at(-1) ?? null;
      // `keysBetween` rather than a loop: sequential inserts against each other
      // grow a tower one character per tile, bisection keeps them short.
      const keys = keysBetween(tail, null, leaving.length);
      moved = leaving.map((r, i) => ({ tileKey: r.tileKey, pos: keys[i] }));
      await db
        .insert(dashboardTilePlacements)
        .values(moved.map((m) => ({ orgId: ctx.orgId, viewId, tileKey: m.tileKey, groupId: null, pos: m.pos })))
        .onConflictDoUpdate({
          target: [dashboardTilePlacements.orgId, dashboardTilePlacements.viewId, dashboardTilePlacements.tileKey],
          set: { groupId: EXCLUDED_GROUP, viewId: EXCLUDED_VIEW, pos: EXCLUDED_POS, updatedAt: new Date() },
        });
    }

    await db.delete(dashboardGroups).where(and(eq(dashboardGroups.id, id), eq(dashboardGroups.orgId, ctx.orgId)));
    /**
     * THE KEYS IT ACTUALLY WROTE GO BACK TO THE CLIENT.
     *
     * `BoardLayout` never re-seeds from the server, so after a delete it has to
     * mirror this re-home in its own state. Recomputing the same keys there
     * would be two implementations of one arithmetic, agreeing only for as long
     * as nobody edits either — so the server says what it did and the client
     * applies exactly that.
     */
    return { ok: true, moved };
  } catch (e) {
    return oops(e);
  }
}

/**
 * WHERE TILES SIT — the one write behind every drag, every "Move to" and every
 * move up or down.
 *
 * ONE STATEMENT, whatever the item count. A drag sends one item; re-homing a
 * lane sends the lane; a rebalance would send all of it. Making that one upsert
 * rather than three actions is what keeps a drag to a single round trip with no
 * read-modify-write — and the (org_id, tile_key) primary key is what makes two
 * people dragging DIFFERENT tiles unable to conflict at all.
 *
 * Two people dragging the SAME tile is last-write-wins, deliberately: there is
 * no meaningful merge of "put it here" and "no, here".
 */
export async function setTilePlacementsAction(
  items: Array<{ tileKey: string; groupId: string | null; pos: string }>,
  viewId: string | null = null,
): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);

  const cap = boardPlacementCap();
  const parsed = z
    .array(
      z.object({
        // The two shapes `tileKeyOfFlow` / `tileKeyOfMetric` produce. A key
        // matching no tile is harmless at read time, but there is no reason to
        // accept one, and the shape bounds what can be written here at all.
        tileKey: z
          .string()
          .max(200)
          .regex(/^(flow:[^:]+:.+|metric:[^:]+)$/, "Bad tile key."),
        groupId: idSchema.nullable(),
        pos: posSchema,
      }),
    )
    .min(1)
    .max(cap)
    .safeParse(items);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That move won't save.");

  const db = getDb();
  try {
    /**
     * A GROUP ID FROM THE BROWSER IS RE-WALLED TO THE ORG.
     *
     * Without this, a member of one workspace could file their tile into
     * another workspace's column id. It would never render — every read is
     * org-scoped either way — but it would be their row pointing at somebody
     * else's group, and the foreign key alone would allow it. One query, and
     * only when a placement actually names a group.
     */
    const named = [...new Set(parsed.data.map((i) => i.groupId).filter((g): g is string => g != null))];
    if (named.length > 0) {
      const mine = await db
        .select({ id: dashboardGroups.id })
        .from(dashboardGroups)
        .where(
          and(eq(dashboardGroups.orgId, ctx.orgId), inView(dashboardGroups.viewId, viewId), inArray(dashboardGroups.id, named)),
        );
      // A group id from a browser is re-walled to the org AND to the view: a
      // tile filed into a column that belongs to a different view would render
      // in neither.
      if (mine.length !== named.length) return fail("Unknown group.");
    }

    /**
     * The blast-radius bound, in the same spirit as `flowCap()`. Placements
     * outlive their tiles on purpose, so this table's ceiling is every tile the
     * workspace has ever published rather than the ones it has now — which is
     * bounded in practice and unbounded in principle. Counted before the write,
     * which can overshoot by a batch under a race; fine for a guard that is not
     * billing.
     */
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(dashboardTilePlacements)
      .where(eq(dashboardTilePlacements.orgId, ctx.orgId));
    if (Number(n) + parsed.data.length > cap) return fail("This workspace has too many saved tile positions.");

    await db
      .insert(dashboardTilePlacements)
      .values(parsed.data.map((i) => ({ orgId: ctx.orgId, viewId, tileKey: i.tileKey, groupId: i.groupId, pos: i.pos })))
      .onConflictDoUpdate({
        target: [dashboardTilePlacements.orgId, dashboardTilePlacements.viewId, dashboardTilePlacements.tileKey],
        set: { groupId: EXCLUDED_GROUP, viewId: EXCLUDED_VIEW, pos: EXCLUDED_POS, updatedAt: new Date() },
      });
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * WHERE THE COLUMNS SIT, left to right.
 *
 * The same shape as the tile write and for the same reasons: one statement, the
 * client computes the keys from the two neighbours it is already holding, and
 * moving a column is one row rather than a renumber of the row of them.
 */
export async function setGroupPositionsAction(items: Array<{ id: string; pos: string }>): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  const parsed = z
    .array(z.object({ id: idSchema, pos: posSchema }))
    .min(1)
    .max(boardGroupCap())
    .safeParse(items);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That move won't save.");

  const db = getDb();
  try {
    // An UPDATE per row rather than an upsert, deliberately: an upsert keyed on
    // `id` would CREATE a group for an id this workspace does not own, and the
    // org filter on each update is what makes that impossible instead of merely
    // unlikely. A handful of columns is a handful of statements.
    await Promise.all(
      parsed.data.map((i) =>
        db
          .update(dashboardGroups)
          .set({ pos: i.pos, updatedAt: new Date() })
          .where(and(eq(dashboardGroups.id, i.id), eq(dashboardGroups.orgId, ctx.orgId))),
      ),
    );
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * HOW A COLUMN ORDERS THE METRICS INSIDE IT.
 *
 * A view over the manual order, never a rewrite of it: `pos` is untouched here,
 * so switching back to Manual restores by hand exactly what was there before.
 * That is the whole reason this is a column on the group rather than a
 * re-keying of its tiles.
 */
export async function setGroupSortAction(id: string, sortKey: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown group.");
  const parsed = z.enum(["manual", "name_asc", "name_desc", "value_desc", "attention"]).safeParse(sortKey);
  if (!parsed.success) return fail("That sort isn't one of ours.");
  try {
    await getDb()
      .update(dashboardGroups)
      .set({ sortKey: parsed.data, updatedAt: new Date() })
      .where(and(eq(dashboardGroups.id, id), eq(dashboardGroups.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * A NEW WAY OF LOOKING AT THE SAME METRICS.
 *
 * It arrives empty of COLUMNS, not empty of metrics — every tile is still on
 * it, sitting in the ungrouped row until it is filed. That is what a view is:
 * one set of numbers, several arrangements. A view that owned which metrics
 * exist would be a second dashboard wearing a tab.
 *
 * A PLAIN FORM POST, so the `+` needs no client boundary of its own — the shape
 * "Refresh all" already uses. It carries the range and source as hidden fields
 * and hands them back on the redirect, because landing on a new view should not
 * also silently reset the period you were looking at.
 *
 * Its only voice is that redirect, so a refusal is a query param the page
 * renders as a banner — the convention every FormData action here follows.
 */
export async function addViewAction(fd: FormData): Promise<void> {
  const ctx = await requireOrg();
  const back = (extra: string) => {
    const p = new URLSearchParams();
    const range = String(fd.get("range") ?? "");
    const source = String(fd.get("source") ?? "");
    if (range) p.set("range", range);
    if (source) p.set("source", source);
    return `/dashboard?${p.toString()}${p.size ? "&" : ""}${extra}`;
  };
  if (await blocked(ctx)) redirect(back("error=rank"));

  const db = getDb();
  const existing = await db
    .select({ pos: dashboardViews.pos, isDefault: dashboardViews.isDefault })
    .from(dashboardViews)
    .where(eq(dashboardViews.orgId, ctx.orgId));

  const cap = boardViewCap();
  /**
   * EVERY VIEW IS A ROW, so the cap counts rows.
   *
   * This carried a `+ 1` for the default board that had no row of its own, then
   * a conditional `+ 1` once that board could be adopted into one. Neither is
   * needed: nothing is a view without being a row any more.
   */
  if (existing.length >= cap) redirect(back("error=view_limit"));

  const last = existing.map((v) => v.pos).sort(compareKeys).at(-1) ?? null;
  const id = crypto.randomUUID();
  /**
   * WHICH KIND OF BOARD, chosen at creation and never changed afterwards.
   *
   * The three kinds store their arrangements in different places — columns of
   * whole metrics in `dashboard_tile_placements`, charts on a grid in
   * `dashboard_tiles`, and a calendar's single metric back in placements again
   * — so switching an existing view would mean either discarding one
   * arrangement or inventing the other, and neither is a thing a customer asked
   * for. Making it a creation-time choice keeps that honest.
   *
   * Anything unrecognised reads as `groups`, the board every workspace already
   * had, so a hand-edited form post cannot mint a view nothing can render.
   * `asViewKind` is that rule, and it is the ONLY place the vocabulary lives —
   * the column itself is plain text with no CHECK constraint, so this function
   * is the whole of the validation.
   */
  const kind = asViewKind(fd.get("kind"));

  /**
   * A CALENDAR IS A VIEW OF ONE METRIC, and it is chosen in the same modal that
   * chose the kind — so the tile key arrives on this very post.
   *
   * Validated against the KEY FORMAT rather than against the metric list. A
   * post naming a metric that does not exist is not an error worth a round trip
   * to detect: a placement is explicitly allowed to outlive its tile (that is
   * how republishing a flow restores a board), so "points at nothing" is a
   * state the calendar already renders honestly. What must not get through is a
   * malformed key, which would sit in the table forever matching nothing.
   */
  const rawKey = String(fd.get("tileKey") ?? "");
  const tileKey = kind === "calendar" && /^flow:[\w-]+:[\w-]+$/.test(rawKey) ? rawKey : null;
  if (kind === "calendar" && !tileKey) redirect(back("error=no_metric"));

  /**
   * THE NAME. A calendar view is named after its metric, so the tab says which
   * calendar it is rather than `View 3` — three calendars called View 3, View 4
   * and View 5 is a tab strip that has to be clicked through to be read.
   *
   * Falls back to the counted name when the label is missing or unusable, which
   * keeps a hand-rolled post from minting a view with an empty tab.
   */
  const label = String(fd.get("label") ?? "").trim().slice(0, 60);
  const name = kind === "calendar" && label ? label : `View ${existing.length + 1}`;

  /**
   * ONE STATEMENT, NOT A TRANSACTION — see `newViewCte` for the whole argument.
   * The view and the metric it is a calendar OF cannot half-exist.
   *
   * Non-calendar kinds take the plain insert: there is no second row to keep in
   * step with the first.
   */
  if (tileKey) {
    await db.execute(sql`
      ${newViewCte(id, ctx.orgId, name, keyBetween(last, null), kind)}
      insert into ${dashboardTilePlacements} (org_id, tile_key, group_id, view_id, pos)
      select ${ctx.orgId}, ${tileKey}, null, v.id, ${keyBetween(null, null)} from v
    `);
  } else {
    await db.insert(dashboardViews).values({
      id,
      orgId: ctx.orgId,
      /**
       * PLAIN ARITHMETIC NOW, because there is no unrowed board to count around.
       *
       * This was `existing.length + (adopted ? 1 : 2)`: the `+2` existed because a
       * workspace's default board was View 1 WITHOUT having a row, so the first
       * real view was the second tab. The synthesised tab is gone (see
       * `viewStrip`), so every view is a row and the count is the count — the
       * first one a workspace makes is View 1.
       */
      name,
      pos: keyBetween(last, null),
      kind,
    });
  }
  // Straight onto it: a tab that appears somewhere else and waits to be found
  // is a worse answer than the one you just asked for.
  redirect(back(`view=${id}`));
}

/**
 * WHICH METRIC THIS CALENDAR IS FOR — the one thing a calendar view stores.
 *
 * Bound to its view on the SERVER and handed to `CalendarBoard` as a server
 * action, which is why the form carries only the metric: a server action
 * reference crosses the RSC boundary, an ordinary closure does not.
 *
 * REPLACE, NEVER APPEND. A calendar view holds exactly one placement, and that
 * arity is the writer's job — `dashboard_placements_key_uq` stops the SAME key
 * being stored twice but has nothing to say about two different ones. Both
 * statements run as one, for the reason `addViewAction` gives at length.
 */
export async function setCalendarMetricAction(viewId: string, fd: FormData): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(viewId).success) return fail("Unknown view.");
  const tileKey = String(fd.get("tileKey") ?? "");
  if (!/^flow:[\w-]+:[\w-]+$/.test(tileKey)) return fail("That isn't a metric we know.");

  try {
    await getDb().execute(sql`
      with cleared as (
        delete from ${dashboardTilePlacements}
         where org_id = ${ctx.orgId} and view_id = ${viewId}
      )
      insert into ${dashboardTilePlacements} (org_id, tile_key, group_id, view_id, pos)
      select ${ctx.orgId}, ${tileKey}, null, ${viewId}, ${keyBetween(null, null)}
       where exists (
         select 1 from ${dashboardViews}
          where id = ${viewId} and org_id = ${ctx.orgId} and kind = 'calendar'
       )
    `);
    /**
     * NO `revalidatePath` — the rule this whole module follows, and it holds
     * here for the same reason. `CalendarBoard` seeds its selection once and
     * ignores the prop afterwards, precisely so `FreshnessPoller`'s twelve-second
     * `router.refresh()` cannot yank a metric out from under somebody mid-read.
     * A revalidation would therefore re-render the entire dashboard — the tile
     * read included — into a prop the client is deliberately ignoring.
     *
     * Nothing goes stale by skipping it: the page is `force-dynamic` and Next's
     * client router cache does not reuse dynamic segments, so the next
     * navigation reads the row back from the database.
     */
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * RENAME A VIEW — including the default one, which is what `id: null` means.
 *
 * That case is not a rename at all on the first press: the default board has no
 * row to write a name onto, so it is ADOPTED into one (above) and the name lands
 * on that. Every press after the first is an ordinary update, because by then it
 * is an ordinary view.
 */
export async function renameViewAction(id: string | null, name: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (id !== null && !idSchema.safeParse(id).success) return fail("Unknown view.");
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That name won't work.");
  try {
    // The default board has no row to write a name onto, so the first rename
    // ADOPTS it into one. Every press after that is the ordinary update below,
    // because by then it is an ordinary view. The transaction lives in
    // `lib/board/store.ts` so it can be driven against real SQL in a test.
    if (id === null) {
      await adoptDefaultView(getDb(), ctx.orgId, parsed.data);
      return { ok: true };
    }
    // Id AND org, the same discipline every mutation in this file follows: an
    // id from another workspace must find nothing rather than something.
    await getDb()
      .update(dashboardViews)
      .set({ name: parsed.data, updatedAt: new Date() })
      .where(and(eq(dashboardViews.id, id), eq(dashboardViews.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    /**
     * The one failure worth naming: `dashboard_views_one_default_uq` rejecting a
     * second default because another tab adopted this board a moment ago. The
     * page is now describing a world that no longer exists, and the only useful
     * instruction is to go and get the new one.
     */
    if (String((e as { message?: string })?.message ?? "").includes("dashboard_views_one_default_uq")) {
      return fail("Someone else just renamed this board. Reload to see the current view.");
    }
    return oops(e);
  }
}

/**
 * THE SAME BOARD AGAIN, TO EDIT WITHOUT RISKING THE ONE PEOPLE READ.
 *
 * A view is an arrangement, and an arrangement is the thing customers are most
 * reluctant to experiment with — it is shared, and a bad afternoon of dragging
 * is visible to everyone. Duplicating is the answer: try it on the copy.
 *
 * ONE TRANSACTION, AND THAT IS THE WHOLE DESIGN OF THIS FUNCTION. A partial
 * copy is worse than a failure, and worse in a specific way: a failed
 * duplicate announces itself, while a view holding two of its eleven charts
 * looks like a finished view that somebody made badly. The customer cannot
 * tell it is half, so they fix it by hand — or worse, trust it.
 *
 * The two kinds store their arrangements in different tables and only one of
 * them needs an id remap:
 *
 *   custom — `dashboard_tiles` rows carry their own geometry and point at
 *            nothing inside the view, so they copy with new ids and the same
 *            boxes.
 *   groups — `dashboard_groups` rows are POINTED AT by placements, so the
 *            groups are copied first, an old id → new id map is built from
 *            that, and every placement is rewritten through it. Copying the
 *            placements with their original `group_id` would cross-link the
 *            new view's tiles into the ORIGINAL's columns: recolour a group on
 *            the copy and it moves on the original, and delete the original
 *            and the copy's placements go with it.
 */
export async function duplicateViewAction(id: string): Promise<Result<{ viewId: string }>> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown view.");

  try {
    const db = getDb();
    /**
     * THE TWO COLUMNS THIS ACTUALLY READS, NAMED.
     *
     * It was a bare `.select()`, which is not `SELECT *` — drizzle expands it
     * into an explicit column list built from `schema.ts`, so it names every
     * column the SCHEMA declares whether or not this function wants it. That
     * makes it break the moment a column is declared and before its migration
     * has been pasted, which is the exact shape of the 0012 outage in
     * drizzle/HAND_APPLY.md: adding `is_default` would have made duplicating a
     * view throw `column "is_default" does not exist` in production, on a path
     * with nothing to do with the new feature.
     *
     * Naming the two it reads also puts this on the same footing as every other
     * query in the file, and off the schema's critical path for good.
     */
    const [source] = await db
      .select({ name: dashboardViews.name, kind: dashboardViews.kind })
      .from(dashboardViews)
      .where(and(eq(dashboardViews.id, id), eq(dashboardViews.orgId, ctx.orgId)));
    if (!source) return fail("That view isn't on this board any more.");

    const views = await db
      .select({ pos: dashboardViews.pos })
      .from(dashboardViews)
      .where(eq(dashboardViews.orgId, ctx.orgId));
    const viewCap = boardViewCap();
    // The default view has no row, so it is not in `views` — hence the `+ 1`,
    // the same arithmetic `addViewAction` does for the same reason.
    if (views.length + 1 >= viewCap) {
      return fail(`This workspace has reached its limit of ${viewCap} views. Delete one to add another.`);
    }

    const newViewId = crypto.randomUUID();
    const last = views.map((v) => v.pos).sort(compareKeys).at(-1) ?? null;
    // Trimmed to the same 60 the schema allows, so copying a long name cannot
    // fail on a limit the customer never typed.
    const name = `${source.name} (copy)`.slice(0, 60);

    if (source.kind === "custom") {
      const tiles = await db
        .select()
        .from(dashboardTiles)
        .where(and(eq(dashboardTiles.orgId, ctx.orgId), eq(dashboardTiles.viewId, id)));
      const tileCap = boardTileCap();
      if (tiles.length > tileCap) {
        return fail(`This view has more than the limit of ${tileCap} charts, so it can't be copied.`);
      }

      /**
       * ONE STATEMENT — see `copyStatement` below for why this cannot be
       * `db.transaction()`.
       */
      if (tiles.length === 0) {
        await db
          .insert(dashboardViews)
          .values({ id: newViewId, orgId: ctx.orgId, name, pos: keyBetween(last, null), kind: "custom" });
      } else {
        await db.execute(sql`
          ${newViewCte(newViewId, ctx.orgId, name, keyBetween(last, null), "custom")}
          insert into ${dashboardTiles} (id, org_id, view_id, tile_key, chart, config, x, y, w, h)
          select t.id, ${ctx.orgId}, v.id, t.tile_key, t.chart, t.config, t.x, t.y, t.w, t.h
            from v cross join (values ${sql.join(
              tiles.map(
                (t) =>
                  sql`(${crypto.randomUUID()}::text, ${t.tileKey}::text, ${t.chart}::text, ${JSON.stringify(
                    t.config ?? {},
                  )}::jsonb, ${t.x}::int, ${t.y}::int, ${t.w}::int, ${t.h}::int)`,
              ),
              sql`, `,
            )}) as t(id, tile_key, chart, config, x, y, w, h)
        `);
      }
      return { ok: true, viewId: newViewId };
    }

    const groups = await db
      .select()
      .from(dashboardGroups)
      .where(and(eq(dashboardGroups.orgId, ctx.orgId), inView(dashboardGroups.viewId, id)));
    const placements = await db
      .select()
      .from(dashboardTilePlacements)
      .where(and(eq(dashboardTilePlacements.orgId, ctx.orgId), inView(dashboardTilePlacements.viewId, id)));

    const groupCap = boardGroupCap();
    if (groups.length > groupCap) {
      return fail(`This view has more than the limit of ${groupCap} groups, so it can't be copied.`);
    }
    const placementCap = boardPlacementCap();
    if (placements.length > placementCap) {
      return fail(`This view has more than the limit of ${placementCap} tiles, so it can't be copied.`);
    }

    /** old group id → new group id. Built BEFORE the write, used inside it. */
    const remap = new Map(groups.map((g) => [g.id, crypto.randomUUID()]));

    const view = newViewCte(newViewId, ctx.orgId, name, keyBetween(last, null), "groups");
    const groupsInsert = sql`
      insert into ${dashboardGroups} (id, org_id, view_id, name, color, pos, sort_key)
      select g.id, ${ctx.orgId}, v.id, g.name, g.color, g.pos, g.sort_key
        from v cross join (values ${sql.join(
          groups.map(
            (g) =>
              sql`(${remap.get(g.id)!}::text, ${g.name}::text, ${g.color}::text, ${g.pos}::text, ${g.sortKey}::text)`,
          ),
          sql`, `,
        )}) as g(id, name, color, pos, sort_key)`;
    const placementsInsert = sql`
      insert into ${dashboardTilePlacements} (org_id, tile_key, group_id, view_id, pos)
      select ${ctx.orgId}, p.tile_key, p.group_id, v.id, p.pos
        from v cross join (values ${sql.join(
          placements.map(
            (p) =>
              // THE REMAP. `?? null` rather than `?? p.groupId`: an ungrouped
              // placement has a null group and stays ungrouped, and a placement
              // whose group somehow is not in this view must NOT keep pointing
              // at it — that is the cross-link this branch exists to avoid.
              sql`(${p.tileKey}::text, ${p.groupId ? (remap.get(p.groupId) ?? null) : null}::text, ${p.pos}::text)`,
          ),
          sql`, `,
        )}) as p(tile_key, group_id, pos)`;

    /**
     * THE FOUR SHAPES A COPY CAN TAKE, and each is ONE statement.
     *
     * A data-modifying CTE runs exactly once whether or not the primary query
     * reads it (Postgres docs), which is what lets the groups insert ride as a
     * CTE with the placements insert as the statement proper.
     */
    if (groups.length === 0 && placements.length === 0) {
      await db
        .insert(dashboardViews)
        .values({ id: newViewId, orgId: ctx.orgId, name, pos: keyBetween(last, null), kind: "groups" });
    } else if (placements.length === 0) {
      await db.execute(sql`${view} ${groupsInsert}`);
    } else if (groups.length === 0) {
      await db.execute(sql`${view} ${placementsInsert}`);
    } else {
      await db.execute(sql`${view}, g as (${groupsInsert} returning 1) ${placementsInsert}`);
    }
    return { ok: true, viewId: newViewId };
  } catch (e) {
    return oops(e);
  }
}

/**
 * DELETE A VIEW, AND WITH IT THE ARRANGEMENT THAT ONLY EXISTED INSIDE IT.
 *
 * The groups and placements go too, and that is the FOREIGN KEY's doing rather
 * than this function's: `view_id` cascades on both tables (migration 0027), so
 * there is no window in which a group survives the view it belonged to. Two
 * deletes here could half-succeed; one delete cannot.
 *
 * NO METRIC IS DELETED, EVER. A view is an arrangement of tiles, and the tiles
 * belong to the board — the same promise `deleteGroupAction` makes one level
 * down, and the reason the confirmation says so out loud.
 */
export async function deleteViewAction(id: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown view.");
  try {
    await getDb().delete(dashboardViews).where(and(eq(dashboardViews.id, id), eq(dashboardViews.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * The same vocabulary `dashboard_tile_placements` validates, for the same keys,
 * plus the `block:` sentinel.
 *
 * A block points at nothing — a heading has no metric — so its key names the
 * KIND instead. The three are spelled out rather than admitted as `block:.+`
 * on purpose: a loosened pattern would accept `block:sunburst`, which reaches
 * the renderer as a tile that is neither a chart nor anything drawable, and the
 * whole reason this schema is strict is that a tile key arrives from a browser.
 */
const tileKeySchema = z
  .string()
  .max(200)
  .regex(new RegExp(`^(flow:[^:]+:.+|metric:[^:]+|block:(${BLOCK_IDS.join("|")}))$`), "Bad tile key.");

/**
 * A BLOCK'S CHART AND ITS KEY MUST BE THE SAME WORD.
 *
 * The row says what it is twice — `chart: "heading"` and
 * `tile_key: "block:heading"` — and two representations of one fact disagree
 * eventually unless something refuses the disagreement. The renderer branches
 * on the chart; the page's row classifier branches on the key; a row carrying
 * `chart: "heading"` with a flow's key would be furniture bound to a metric,
 * which is not a thing, and would render differently depending on which half
 * was consulted.
 *
 * Both directions are refused: a block chart demands its own sentinel, and a
 * block sentinel demands its own chart.
 */
function blockMismatch(chart: string, tileKey: string): boolean {
  const byChart = (BLOCK_IDS as readonly string[]).includes(chart);
  const byKey = blockKindOf(tileKey);
  return byChart !== (byKey !== null) || (byKey !== null && byKey !== chart);
}

const chartSchema = z.string().refine((c) => (CHART_IDS as string[]).includes(c), "That isn't a chart we draw.");

/**
 * THE VIEW A WRITE IS FOR, RE-WALLED TO THE ORG AND CHECKED FOR ITS KIND.
 *
 * The id arrives from a browser, so one belonging to another workspace must
 * find nothing rather than something. The KIND check is the second half: a
 * groups view stores its arrangement in a different table entirely, and a chart
 * written against one would be a row nothing renders and nothing can reach.
 */
async function customView(orgId: string, viewId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ kind: dashboardViews.kind })
    .from(dashboardViews)
    .where(and(eq(dashboardViews.id, viewId), eq(dashboardViews.orgId, orgId)));
  return row?.kind === "custom";
}

/**
 * ADD A CHART TO A CUSTOM VIEW.
 *
 * NOT OPTIMISTIC, and for the reason `createGroupAction` states: the id is the
 * server's to mint, and a tile that appears under a placeholder id cannot be
 * dragged, resized or deleted until it is replaced.
 *
 * IT LANDS AT THE BOTTOM-LEFT and gravity does the rest. Placing it there and
 * letting `compact` float it up is what makes a new chart slot into the gap
 * beside the last row instead of starting a lonely new one — and it means the
 * board has exactly one placement algorithm, shared by this action, the drag
 * preview and every render.
 */
export async function addCustomTileAction(
  viewId: string,
  tileKey: string,
  chart: string,
): Promise<Result<{ tile: BoardTileRow }>> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(viewId).success) return fail("Unknown view.");
  const key = tileKeySchema.safeParse(tileKey);
  if (!key.success) return fail(key.error.issues[0]?.message ?? "Unknown metric.");
  const kind = chartSchema.safeParse(chart);
  if (!kind.success) return fail(kind.error.issues[0]?.message ?? "Unknown chart.");

  try {
    const db = getDb();
    if (!(await customView(ctx.orgId, viewId))) return fail("That view can't hold charts.");

    const existing = await db
      .select({ y: dashboardTiles.y, h: dashboardTiles.h })
      .from(dashboardTiles)
      .where(and(eq(dashboardTiles.orgId, ctx.orgId), eq(dashboardTiles.viewId, viewId)));

    const cap = boardTileCap();
    if (existing.length >= cap) {
      return fail(`This view has reached its limit of ${cap} charts. Remove one to add another.`);
    }

    const size = defaultSize(kind.data as (typeof CHART_IDS)[number]);
    /**
     * THE FLOW SPEC SEEDS THE TILE'S DEFAULTS — the facts/presentation seam's
     * founding rule: the data source suggests, the chart decides. A new tile
     * starts from the precision and target the publisher chose, held in its
     * own config from then on, so a later change on the flow does not silently
     * restyle a tile someone already tuned. One narrow jsonb read, on a
     * user-initiated add, never on the render path.
     */
    let config: Record<string, unknown> = {};
    if (blockMismatch(kind.data, key.data)) return fail("That isn't a chart we draw.");

    const flowKey = key.data.match(/^flow:([^:]+):(.+)$/);
    // BEST-EFFORT, in its own try: the seed is decoration on the add, and a
    // failure here — a malformed flow id, a dangling key — must cost the tile
    // its defaults, never its existence.
    try {
      if (flowKey) {
        const [seed] = await db
          .select({
            // `->>` and not `->`: a spec with `target: null` stores jsonb null,
            // which `->` hands to the cast as the text "null" — an error —
            // while `->>` yields SQL NULL, which is the fact being expressed.
            precision: sql<string | null>`(${flowResults.tile} ->> 'precision')::int`,
            target: sql<string | null>`(${flowResults.tile} ->> 'target')::numeric`,
          })
          .from(flowResults)
          .where(
            and(
              eq(flowResults.orgId, ctx.orgId),
              eq(flowResults.flowId, flowKey[1]),
              eq(flowResults.outputNodeId, flowKey[2]),
            ),
          );
        config = parseTileConfig({
          ...(seed?.precision != null ? { precision: Number(seed.precision) } : {}),
          ...(seed?.target != null ? { target: Number(seed.target) } : {}),
        });
      }
    } catch {
      config = {};
    }

    const row: BoardTileRow = {
      id: crypto.randomUUID(),
      tileKey: key.data,
      chart: kind.data,
      config,
      x: 0,
      y: existing.reduce((n, b) => Math.max(n, b.y + b.h), 0),
      ...size,
    };
    await db.insert(dashboardTiles).values({ ...row, orgId: ctx.orgId, viewId });
    return { ok: true, tile: row };
  } catch (e) {
    return oops(e);
  }
}

/**
 * REMOVE A CHART. The metric is untouched — a layout act never deletes a
 * metric, the same promise `deleteGroupAction` makes one level up.
 *
 * The hole it leaves closes itself: every render compacts, so the tiles below
 * float up without this action rewriting a single other row.
 */
export async function deleteCustomTileAction(id: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown chart.");
  try {
    await getDb()
      .delete(dashboardTiles)
      .where(and(eq(dashboardTiles.id, id), eq(dashboardTiles.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

/**
 * THE SAME CHART AGAIN, BESIDE THE ONE IT CAME FROM.
 *
 * Two drawings of one metric is the whole reason a custom view exists — the
 * same number as a headline and as a trend, side by side — and getting there
 * meant adding a chart and repointing it. This is that in one press.
 *
 * WHERE IT LANDS: to the right if the row has room, directly below if it does
 * not, and then the WHOLE VIEW goes through `compact` — the same function every
 * render and every drag already uses. Placing it by hand and trusting the
 * arithmetic would be a second definition of "where do tiles go", and the two
 * would disagree the first time a neighbour was in the way. Here the copy is
 * placed approximately and the packer decides for real, so a duplicate lands
 * exactly where dropping one there would have.
 *
 * The layout write is part of the same statement batch as the insert: a copy
 * that exists at an overlapping position, because the compaction failed after
 * the insert succeeded, is a board the customer has to repair by hand.
 */
export async function duplicateCustomTileAction(id: string): Promise<Result<{ tile: BoardTileRow }>> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown chart.");

  try {
    const db = getDb();
    // Id AND org, like every other read behind a mutation here.
    const [source] = await db
      .select()
      .from(dashboardTiles)
      .where(and(eq(dashboardTiles.id, id), eq(dashboardTiles.orgId, ctx.orgId)));
    if (!source) return fail("That chart isn't on this board any more.");

    const siblings = await db
      .select()
      .from(dashboardTiles)
      .where(and(eq(dashboardTiles.orgId, ctx.orgId), eq(dashboardTiles.viewId, source.viewId)));

    const cap = boardTileCap();
    if (siblings.length >= cap) {
      return fail(`This view has reached its limit of ${cap} charts. Remove one to add another.`);
    }

    /**
     * BESIDE, THEN BELOW. `x + w` is where a second copy visually belongs; it
     * is only wrong when the original already reaches the right edge, and then
     * the honest fallback is the next row rather than a squeeze.
     */
    const fits = source.x + source.w * 2 <= GRID_COLS;
    const copy: BoardTileRow = {
      id: crypto.randomUUID(),
      tileKey: source.tileKey,
      chart: source.chart,
      config: parseTileConfig(source.config),
      x: fits ? source.x + source.w : source.x,
      y: fits ? source.y : source.y + source.h,
      w: source.w,
      h: source.h,
    };

    /**
     * NO `first` ARGUMENT, deliberately. It exists so a DRAGGED tile wins ties
     * against the neighbours it is being dropped among; handing it to the copy
     * here does the opposite of what a duplicate should do — `orderOf` sorts by
     * `y`, then the flag, then `x`, so a copy that collides with its original
     * would take the higher slot and push the ORIGINAL down. Nothing about
     * copying a chart should move the chart it was copied from. Plain reading
     * order already puts the original first and packs the copy after it.
     */
    const packed = compact([...siblings.map(({ id: i, x, y, w, h }) => ({ id: i, x, y, w, h })), { ...copy }], GRID_COLS);

    /**
     * ONE STATEMENT — the same argument `newViewCte` makes, and this one was
     * broken in production for the same reason: `db.transaction()` THROWS on
     * `neon-http`, so duplicating a chart has never worked, while PGlite (a real
     * embedded Postgres with sessions) ran the tests green.
     *
     * THE COPY IS INSERTED AT ITS FINAL POSITION rather than inserted and then
     * moved, and that ordering is forced by Postgres rather than chosen: a
     * data-modifying CTE's rows are NOT visible to the rest of the statement —
     * everything reads one snapshot — so an UPDATE here could never see the row
     * the CTE just inserted. `compact` already computed where the copy lands, so
     * the insert simply uses it and the UPDATE touches only the siblings that
     * actually moved.
     */
    const placed = packed.find((b) => b.id === copy.id) ?? copy;
    const moved = packed.filter((b) => b.id !== copy.id);
    const insertCopy = sql`
      insert into ${dashboardTiles} (id, org_id, view_id, tile_key, chart, config, x, y, w, h)
      values (${copy.id}, ${ctx.orgId}, ${source.viewId}, ${copy.tileKey}, ${copy.chart},
              ${JSON.stringify(copy.config)}::jsonb, ${placed.x}, ${placed.y}, ${placed.w}, ${placed.h})`;

    if (moved.length === 0) {
      await db.execute(insertCopy);
    } else {
      await db.execute(sql`
        with ins as (${insertCopy})
        update ${dashboardTiles} as t
           set x = p.x, y = p.y, w = p.w, h = p.h, updated_at = now()
          from (values ${sql.join(
            moved.map((b) => sql`(${b.id}::text, ${b.x}::int, ${b.y}::int, ${b.w}::int, ${b.h}::int)`),
            sql`, `,
          )}) as p(id, x, y, w, h)
         where t.id = p.id and t.org_id = ${ctx.orgId}
      `);
    }

    return { ok: true, tile: { ...copy, x: placed.x, y: placed.y, w: placed.w, h: placed.h } };
  } catch (e) {
    return oops(e);
  }
}

const titleSchema = z.string().trim().max(60, "That name is too long.");

/**
 * CHANGE WHAT A CHART IS — its drawing, its metric, or its name.
 *
 * ONE ACTION FOR THREE EDITS, because they are one edit as far as the database
 * is concerned: a partial update of a row already re-walled to the org. Three
 * actions would be three copies of the same gate, and every export in a
 * "use server" module is a public endpoint, so fewer is safer as well as
 * shorter.
 *
 * The TITLE lives in `config` rather than in a column of its own. An empty one
 * CLEARS the override rather than storing "", so the tile goes back to
 * following the metric's own name — otherwise renaming a flow would silently
 * stop updating a chart that had once been renamed and then renamed back.
 */
export async function setCustomTileAction(
  id: string,
  patch: { chart?: string; tileKey?: string; title?: string; config?: unknown; clear?: string[] },
): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown chart.");

  const next: { chart?: string; tileKey?: string; config?: unknown; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.chart !== undefined) {
    const c = chartSchema.safeParse(patch.chart);
    if (!c.success) return fail(c.error.issues[0]?.message ?? "Unknown chart.");
    next.chart = c.data;
  }
  if (patch.tileKey !== undefined) {
    const k = tileKeySchema.safeParse(patch.tileKey);
    if (!k.success) return fail(k.error.issues[0]?.message ?? "Unknown metric.");
    next.tileKey = k.data;
  }
  /**
   * A TILE CANNOT BE HALF-TURNED INTO A BLOCK. Chart and key must move
   * together or not at all — see `blockMismatch`. Nothing in the interface asks
   * for this (a block's panel offers no chart list, and `chartsFor` never
   * returns a block for a metric), so a patch touching one side alone is a
   * caller doing something the product does not do, and it would leave a row
   * whose two halves disagree about what it is.
   */
  if (next.chart !== undefined || next.tileKey !== undefined) {
    const touchesBlock =
      (next.chart !== undefined && (BLOCK_IDS as readonly string[]).includes(next.chart)) ||
      (next.tileKey !== undefined && blockKindOf(next.tileKey) !== null);
    if (touchesBlock && (next.chart === undefined || next.tileKey === undefined)) {
      return fail("That isn't a chart we draw.");
    }
    if (next.chart !== undefined && next.tileKey !== undefined && blockMismatch(next.chart, next.tileKey)) {
      return fail("That isn't a chart we draw.");
    }
  }

  /**
   * THE PRESENTATION BAG — set some keys, remove others, in ONE statement.
   *
   * `title` is no longer special. It was the first key to need "an empty value
   * REMOVES the override rather than storing it", and every other setting needs
   * the same thing for the same reason: a cleared goal must go back to
   * following the flow's, not store a goal of nothing. So the title's mechanism
   * became the general one, and the `title` argument is now just a shorthand
   * that funnels into it — one code path, which is what stops the two drifting.
   *
   * MERGED, NEVER REPLACED, and the merge happens in POSTGRES rather than here.
   * A read-modify-write would lose a concurrent edit from another tab between
   * the two statements; `||` and `-` compose into one atomic update, and `||`
   * preserves keys this build has never heard of, which is the forward half of
   * the compatibility promise `parseTileConfig` makes on the read side.
   */
  const set: Record<string, unknown> = {};
  const drop: string[] = [];

  if (patch.title !== undefined) {
    const t = titleSchema.safeParse(patch.title);
    if (!t.success) return fail(t.error.issues[0]?.message ?? "That name won't work.");
    if (t.data) set.title = t.data;
    else drop.push("title");
  }

  if (patch.config !== undefined) {
    /**
     * VALIDATED BY THE SAME PARSER THE RENDERER USES, then checked for
     * SHRINKAGE. `parseTileConfig` silently drops what it cannot parse — right
     * for reading a row written by an older build, wrong for accepting a write:
     * a panel sending a bad `limit` would get `{ ok: true }` and no limit. So
     * anything that does not survive the parse is refused out loud instead.
     */
    const raw = patch.config;
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return fail("That setting won't work.");
    const parsed = parseTileConfig(raw) as Record<string, unknown>;
    const sent = Object.keys(raw as Record<string, unknown>);
    const kept = new Set(Object.keys(parsed));
    const rejected = sent.filter((k) => !kept.has(k));
    if (rejected.length) return fail(`That setting won't work: ${rejected.join(", ")}.`);
    Object.assign(set, parsed);
  }

  if (patch.clear !== undefined) {
    // Every export of a "use server" module is a public endpoint, so the SHAPE
    // is checked before it is used: `.filter` on a non-array throws, and a
    // throw here escapes the try/catch below and rejects the action rather than
    // returning a refusal the client knows how to show.
    if (!Array.isArray(patch.clear)) return fail("That setting won't work.");
    // Only keys this build KNOWS are removable — an arbitrary string here would
    // let a caller strip anything out of the bag, including a future build's.
    const unknown = patch.clear.filter((k) => !(TILE_CONFIG_KEYS as string[]).includes(k));
    if (unknown.length) return fail(`That setting won't work: ${unknown.join(", ")}.`);
    drop.push(...patch.clear);
  }

  if (drop.length || Object.keys(set).length) {
    let expr = sql`${dashboardTiles.config}`;
    // Remove first, then overlay: a key in both lists ends up SET, which is the
    // only reading that makes sense for a single patch.
    for (const key of drop) expr = sql`${expr} - ${key}`;
    if (Object.keys(set).length) expr = sql`${expr} || ${JSON.stringify(set)}::jsonb`;
    next.config = expr;
  }

  try {
    await getDb()
      .update(dashboardTiles)
      .set(next)
      .where(and(eq(dashboardTiles.id, id), eq(dashboardTiles.orgId, ctx.orgId)));
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}

const boxSchema = z.object({
  id: idSchema,
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(400),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(60),
});

/**
 * WHERE THE CHARTS SIT — the one write every move and every resize goes through,
 * whether it came from a menu or a pointer.
 *
 * A BATCH, because moving one tile can move its neighbours: gravity is applied
 * by `compact` on the client, and what it returns is what gets written, so the
 * board never has to be recompacted from a partial answer.
 *
 * EVERY ID IS RE-WALLED BEFORE ANYTHING IS WRITTEN, and the batch is refused
 * WHOLESALE if any one of them does not belong to this org and view. A
 * per-row `where` would silently write the rows it was allowed to and skip the
 * rest, leaving a layout half-applied — which on a compacted grid means
 * overlapping tiles that nothing will fix until the next drag.
 */
export async function setCustomTileLayoutAction(
  viewId: string,
  items: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(viewId).success) return fail("Unknown view.");
  const parsed = z.array(boxSchema).max(boardTileCap()).safeParse(items);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That layout won't work.");
  if (parsed.data.length === 0) return { ok: true };

  try {
    const db = getDb();
    const ids = parsed.data.map((i) => i.id);
    const mine = await db
      .select({ id: dashboardTiles.id, chart: dashboardTiles.chart })
      .from(dashboardTiles)
      .where(
        and(eq(dashboardTiles.orgId, ctx.orgId), eq(dashboardTiles.viewId, viewId), inArray(dashboardTiles.id, ids)),
      );
    if (mine.length !== ids.length) return fail("Some of those charts aren't on this view.");

    /**
     * THE FLOOR IS ENFORCED HERE, WHICH IS THE ONLY PLACE IT CAN BE.
     *
     * The drag clamps and the menu's presets clamp, but both are the client
     * asking politely — `boxSchema` accepts `w: 1, h: 1` for anything, and this
     * is a "use server" export, so a stale tab or a hand-made call could still
     * write a chart into a box too small to draw it. Below its minimum a
     * cartesian tile has no height left for its axis frame and
     * `overflow-hidden` eats the plot: the card keeps its border and its number
     * and silently loses its chart.
     *
     * Clamped rather than refused. A batch is the whole board — one undersized
     * box must not reject a legitimate rearrangement of forty others — and the
     * floor is a fact about the chart, not a mistake the customer made.
     */
    const chartOf = new Map(mine.map((r) => [r.id, r.chart]));
    const boxes = parsed.data.map((i) => {
      const min = minSize(asChartId(chartOf.get(i.id)));
      const w = Math.max(min.w, i.w);
      const h = Math.max(min.h, i.h);
      // Widening can push a right-hand tile off the grid.
      return { ...i, w, h, x: Math.min(i.x, GRID_COLS - w) };
    });

    // One statement whatever the item count. `excluded` is the row Postgres was
    // ASKED to insert, and it is the only way a multi-row upsert can give each
    // row its own value — a literal here would write one tile's box onto every
    // row in the batch. The re-wall above is what makes the insert branch
    // unreachable for a foreign id.
    await db
      .insert(dashboardTiles)
      .values(boxes.map((i) => ({ ...i, orgId: ctx.orgId, viewId, tileKey: "", chart: "number", config: {} })))
      .onConflictDoUpdate({
        target: dashboardTiles.id,
        set: {
          x: EXCLUDED_X,
          y: EXCLUDED_Y,
          w: EXCLUDED_W,
          h: EXCLUDED_H,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  } catch (e) {
    return oops(e);
  }
}
