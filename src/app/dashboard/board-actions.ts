"use server";

import { redirect } from "next/navigation";

import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import { dashboardGroups, dashboardTilePlacements, dashboardViews } from "@/db/schema";
import { requireOrg, type OrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { boardGroupCap, boardPlacementCap, boardViewCap } from "@/lib/limits";
import { compareKeys, keyBetween, keysBetween } from "@/lib/board/order";
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
    .select({ pos: dashboardViews.pos })
    .from(dashboardViews)
    .where(eq(dashboardViews.orgId, ctx.orgId));

  const cap = boardViewCap();
  // The default view has no row, so it is not in `existing` — hence the `+ 1`.
  if (existing.length + 1 >= cap) redirect(back("error=view_limit"));

  const last = existing.map((v) => v.pos).sort(compareKeys).at(-1) ?? null;
  const id = crypto.randomUUID();
  await db.insert(dashboardViews).values({
    id,
    orgId: ctx.orgId,
    // "View 2" because the default one is View 1 and has no row to count.
    name: `View ${existing.length + 2}`,
    pos: keyBetween(last, null),
  });
  // Straight onto it: a tab that appears somewhere else and waits to be found
  // is a worse answer than the one you just asked for.
  redirect(back(`view=${id}`));
}

/**
 * RENAME A VIEW. The default view is not renameable and has no id to pass —
 * it has no row at all, which is what makes it free (see the schema note).
 */
export async function renameViewAction(id: string, name: string): Promise<Result> {
  const ctx = await requireOrg();
  if (await blocked(ctx)) return fail(RANK_BLOCKS);
  if (!idSchema.safeParse(id).success) return fail("Unknown view.");
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That name won't work.");
  try {
    // Id AND org, the same discipline every mutation in this file follows: an
    // id from another workspace must find nothing rather than something.
    await getDb()
      .update(dashboardViews)
      .set({ name: parsed.data, updatedAt: new Date() })
      .where(and(eq(dashboardViews.id, id), eq(dashboardViews.orgId, ctx.orgId)));
    return { ok: true };
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
