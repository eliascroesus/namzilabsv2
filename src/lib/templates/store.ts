import { randomBytes } from "node:crypto";
import { unstable_cache } from "next/cache";
import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import {
  dashboardGroups,
  dashboardNotes,
  dashboardTilePlacements,
  dashboardTiles,
  dashboardViews,
  flowResults,
  flows,
  metrics,
  workspaceTemplateUses,
  workspaceTemplates,
} from "@/db/schema";
import type { DB } from "@/db/types";
import { isUndefinedTableError } from "@/lib/db-errors";
import { boardGroupCap, boardViewCap } from "@/lib/limits";
import { compareKeys, keysBetween } from "@/lib/board/order";
import { asViewKind, visibilityKeyOf } from "@/lib/board/types";
import { parseGraph } from "@/lib/flow/types";
import { MetricDefinitionSchema } from "@/lib/metrics/types";
import { parseTileConfig } from "@/lib/board/tile-config";
import {
  buildSnapshot,
  parseSnapshot,
  planApply,
  storable,
  type MetricFacts,
  type SourceView,
  type TemplateSnapshot,
} from "./snapshot";

/**
 * EVERY READ AND WRITE A TEMPLATE MAKES — the one module that touches the
 * three sharing tables, so the "not switched on yet" rule lives in one place.
 *
 * ═══ THE WINDOW BEFORE THE PASTE ═══
 *
 * Migrations here are pasted into Neon by hand (drizzle/HAND_APPLY.md), so this
 * code can be live before `workspace_templates` exists. Every function below
 * turns exactly that error — "relation does not exist" — into
 * `TemplatesUnavailable`, which the actions and the public page answer with a
 * sentence rather than a 500. Any OTHER error is a real bug and is rethrown.
 *
 * ═══ TENANCY ═══
 *
 * Everything the author manages is walled by the SESSION's `orgId`. The two
 * reads that are not are named for it: `getTemplateByCode`, whose wall is the
 * random code itself (a capability, like a share link — knowing it is the
 * permission), and the per-template use COUNT, which reads rows belonging to
 * the recipients' workspaces but returns only a number per template.
 */

export class TemplatesUnavailable extends Error {
  constructor() {
    super("Templates aren't switched on yet — the database update for them is still pending.");
    this.name = "TemplatesUnavailable";
  }
}

/**
 * A refusal the person can act on — a cap, or a link its author turned off.
 * `reason` is what a page shows when it must not print a message it was handed
 * (see `src/app/t/actions.ts`); the message is for pages that may.
 */
export type RefusalReason = "limit" | "groups" | "off" | "views" | "size" | "shape";

export class TemplateRefusal extends Error {
  constructor(
    message: string,
    readonly reason: RefusalReason = "limit",
  ) {
    super(message);
    this.name = "TemplateRefusal";
  }
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isUndefinedTableError(e)) throw new TemplatesUnavailable();
    throw e;
  }
}

// ─── The link ────────────────────────────────────────────────────────────

/**
 * Crockford's alphabet, the one `referral.ts` uses: no I, L, O or U, so a code
 * read aloud or retyped from a screenshot cannot be misread as another.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/**
 * TEN CHARACTERS — fifty bits. The code is the only thing standing between a
 * stranger and a template's page, and unlike a referral code it is not derived
 * from anything, so guessing is the only attack. At 2^50 there is nothing to
 * guess; eight (a referral's length) would still be forty bits of a space that
 * is not supposed to be enumerable at all.
 */
const CODE_LENGTH = 10;

export function newTemplateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** A code off a URL, normalised — anything that is not one comes back null. */
export function normaliseTemplateCode(raw: string | null | undefined): string | null {
  const c = (raw ?? "").trim().toUpperCase();
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(c) ? c : null;
}

export function templatePath(code: string): string {
  return `/t/${code}`;
}

// ─── Rows ────────────────────────────────────────────────────────────────

export type TemplateRow = {
  id: string;
  orgId: string;
  code: string;
  createdBy: string;
  authorName: string | null;
  name: string;
  description: string | null;
  /** Null when the stored snapshot no longer parses — treat as unavailable. */
  snapshot: TemplateSnapshot | null;
  sourceViewIds: string[];
  version: number;
  enabled: boolean;
  updatedAt: Date;
};

const COLUMNS = {
  id: workspaceTemplates.id,
  orgId: workspaceTemplates.orgId,
  code: workspaceTemplates.code,
  createdBy: workspaceTemplates.createdBy,
  authorName: workspaceTemplates.authorName,
  name: workspaceTemplates.name,
  description: workspaceTemplates.description,
  snapshot: workspaceTemplates.snapshot,
  sourceViewIds: workspaceTemplates.sourceViewIds,
  version: workspaceTemplates.version,
  enabled: workspaceTemplates.enabled,
  updatedAt: workspaceTemplates.updatedAt,
};

function toRow(r: Omit<TemplateRow, "snapshot" | "sourceViewIds"> & { snapshot: unknown; sourceViewIds: unknown }): TemplateRow {
  return {
    ...r,
    snapshot: parseSnapshot(r.snapshot),
    sourceViewIds: Array.isArray(r.sourceViewIds) ? r.sourceViewIds.filter((v): v is string => typeof v === "string") : [],
  };
}

/** The template a link names — enabled or not; the caller decides what that means. */
export async function getTemplateByCode(db: DB, rawCode: string | null | undefined): Promise<TemplateRow | null> {
  const code = normaliseTemplateCode(rawCode);
  if (!code) return null;
  return guarded(async () => {
    const [row] = await db.select(COLUMNS).from(workspaceTemplates).where(eq(workspaceTemplates.code, code)).limit(1);
    return row ? toRow(row) : null;
  });
}

/** The cache tag for one template's public read — cleared by every act that changes it. */
export const templateTag = (code: string) => `template:${code}`;

/**
 * THE SAME READ, FOR PAGES STRANGERS OPEN — cached across requests.
 *
 * `/t/<code>` is `force-dynamic` and passed round a whole course; uncached, it
 * would read the snapshot from the database on every visit, and every byte of
 * it is billed against the account-wide egress allowance. Cached per code for
 * an hour, and cleared the moment the author changes anything (`templateTag`,
 * via `updateTag` in the Settings actions), so an update or a link switched
 * off is seen on the very next visit rather than within the hour.
 *
 * WHAT IS CACHED IS THE ROW, NOT A DECISION: a disabled template is cached as
 * disabled, and the page decides. An error is never cached (`unstable_cache`
 * does not store a throw), so "not switched on yet" cannot outlive the paste.
 */
export async function getPublicTemplate(db: DB, rawCode: string | null | undefined): Promise<TemplateRow | null> {
  const code = normaliseTemplateCode(rawCode);
  if (!code) return null;
  const read = unstable_cache(
    async () => {
      const row = await getTemplateByCode(db, code);
      // Dates do not survive the cache's JSON; send the one this page never reads as a string.
      return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
    },
    ["template-by-code", code],
    { revalidate: 3600, tags: [templateTag(code)] },
  );
  const row = await read();
  return row ? { ...row, updatedAt: new Date(row.updatedAt) } : null;
}

export async function getTemplate(db: DB, orgId: string, id: string): Promise<TemplateRow | null> {
  return guarded(async () => {
    const [row] = await db
      .select(COLUMNS)
      .from(workspaceTemplates)
      .where(and(eq(workspaceTemplates.orgId, orgId), eq(workspaceTemplates.id, id)))
      .limit(1);
    return row ? toRow(row) : null;
  });
}

export type TemplateListRow = Omit<TemplateRow, "snapshot" | "sourceViewIds"> & { views: number; uses: number };

/**
 * This workspace's templates, newest first, each with how many views it holds
 * and how many times it was used. THE SNAPSHOT ITSELF IS NOT READ — the list
 * shows a count, and Postgres can count a jsonb array without shipping it.
 */
export async function listTemplates(db: DB, orgId: string): Promise<TemplateListRow[]> {
  return guarded(async () => {
    const rows = await db
      .select({
        id: workspaceTemplates.id,
        orgId: workspaceTemplates.orgId,
        code: workspaceTemplates.code,
        createdBy: workspaceTemplates.createdBy,
        authorName: workspaceTemplates.authorName,
        name: workspaceTemplates.name,
        description: workspaceTemplates.description,
        version: workspaceTemplates.version,
        enabled: workspaceTemplates.enabled,
        updatedAt: workspaceTemplates.updatedAt,
        views: sql<number>`coalesce(jsonb_array_length(${workspaceTemplates.snapshot} -> 'views'), 0)::int`,
      })
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.orgId, orgId));
    if (rows.length === 0) return [];
    const counts = await db
      .select({ templateId: workspaceTemplateUses.templateId, n: count() })
      .from(workspaceTemplateUses)
      .where(inArray(workspaceTemplateUses.templateId, rows.map((r) => r.id)))
      .groupBy(workspaceTemplateUses.templateId);
    const uses = new Map(counts.map((c) => [c.templateId, Number(c.n)]));
    return rows
      .map((r) => ({ ...r, views: Number(r.views), uses: uses.get(r.id) ?? 0 }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  });
}

export async function createTemplate(
  db: DB,
  input: {
    orgId: string;
    createdBy: string;
    authorName: string | null;
    name: string;
    description: string | null;
    snapshot: TemplateSnapshot;
    sourceViewIds: string[];
  },
): Promise<{ id: string; code: string }> {
  assertStorable(input.snapshot);
  return guarded(async () => {
    const id = crypto.randomUUID();
    /**
     * A COLLISION IS RETRIED, NOT PREVENTED. At fifty bits the first attempt
     * wins for the lifetime of the product; the loop exists so that the day it
     * does not, the answer is a second code rather than a unique-violation in
     * somebody's face.
     */
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newTemplateCode();
      const written = await db
        .insert(workspaceTemplates)
        .values({ id, code, ...input })
        .onConflictDoNothing({ target: workspaceTemplates.code })
        .returning({ id: workspaceTemplates.id });
      if (written.length > 0) return { id, code };
    }
    throw new Error("Could not mint a template code.");
  });
}

/**
 * CHANGE A TEMPLATE. A new snapshot bumps the version: people who already used
 * it keep the copy they got, and the next person gets this one.
 */
export async function updateTemplate(
  db: DB,
  orgId: string,
  id: string,
  patch: { name?: string; description?: string | null; snapshot?: TemplateSnapshot; sourceViewIds?: string[]; enabled?: boolean },
): Promise<boolean> {
  return guarded(async () => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.sourceViewIds !== undefined) set.sourceViewIds = patch.sourceViewIds;
    if (patch.snapshot !== undefined) {
      assertStorable(patch.snapshot);
      set.snapshot = patch.snapshot;
      set.version = sql`${workspaceTemplates.version} + 1`;
    }
    const done = await db
      .update(workspaceTemplates)
      .set(set)
      .where(and(eq(workspaceTemplates.orgId, orgId), eq(workspaceTemplates.id, id)))
      .returning({ id: workspaceTemplates.id });
    return done.length > 0;
  });
}

/** Refuse a snapshot its own link could not read back — see `storable`. */
function assertStorable(snapshot: TemplateSnapshot): void {
  const verdict = storable(snapshot);
  if (verdict.ok) return;
  const message =
    verdict.reason === "views"
      ? "A template can hold at most 30 views. Untick a few and try again."
      : verdict.reason === "size"
        ? "These views hold too much text to share as one template. Share fewer views, or shorten the longest text blocks."
        : "Something on these views couldn't be turned into a template.";
  throw new TemplateRefusal(message, verdict.reason);
}

export async function deleteTemplate(db: DB, orgId: string, id: string): Promise<boolean> {
  return guarded(async () => {
    const done = await db
      .delete(workspaceTemplates)
      .where(and(eq(workspaceTemplates.orgId, orgId), eq(workspaceTemplates.id, id)))
      .returning({ id: workspaceTemplates.id });
    return done.length > 0;
  });
}

/**
 * HAS THIS WORKSPACE ALREADY TAKEN THIS TEMPLATE? What tells a double-submit of
 * "create my workspace from it" (yes — the first press did it) from somebody
 * naming a new workspace after one they already have (no). A missing table is
 * "yes": nothing could have been applied, so there is nothing to refuse.
 */
export async function templateTakenBy(db: DB, rawCode: string, orgId: string): Promise<boolean> {
  const code = normaliseTemplateCode(rawCode);
  if (!code) return true;
  try {
    const [row] = await db
      .select({ id: workspaceTemplateUses.id })
      .from(workspaceTemplateUses)
      .innerJoin(workspaceTemplates, eq(workspaceTemplates.id, workspaceTemplateUses.templateId))
      .where(and(eq(workspaceTemplates.code, code), eq(workspaceTemplateUses.orgId, orgId)))
      .limit(1);
    return row != null;
  } catch (e) {
    if (isUndefinedTableError(e)) return true;
    throw e;
  }
}

export async function recordTemplateUse(
  db: DB,
  use: { templateId: string; orgId: string; userId: string; version: number; newWorkspace: boolean },
): Promise<void> {
  await guarded(() => db.insert(workspaceTemplateUses).values(use));
}

// ─── Reading the author's views ──────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE AUTHOR'S VIEWS, READ FOR A SNAPSHOT, in the order their tab strip shows
 * them. `canSee` is the author's own rank: a metric it hides contributes no
 * name to the template (see `buildSnapshot`).
 *
 * Returns the ids actually found, because a view deleted between the form
 * being drawn and it being posted is simply not in the template — "Update"
 * later re-reads whatever still exists.
 */
export async function snapshotViews(
  db: DB,
  orgId: string,
  viewIds: string[],
  canSee: (visibilityKey: string) => boolean,
): Promise<{ snapshot: TemplateSnapshot; viewIds: string[] } | null> {
  const ids = [...new Set(viewIds)].filter((v) => typeof v === "string" && v.length > 0 && v.length <= 64);
  if (ids.length === 0) return null;

  const views = (
    await db
      .select({ id: dashboardViews.id, name: dashboardViews.name, kind: dashboardViews.kind, pos: dashboardViews.pos })
      .from(dashboardViews)
      .where(and(eq(dashboardViews.orgId, orgId), inArray(dashboardViews.id, ids)))
  ).sort((a, b) => compareKeys(a.pos, b.pos));
  if (views.length === 0) return null;

  const idsOf = (kind: string) => views.filter((v) => asViewKind(v.kind) === kind).map((v) => v.id);
  const customIds = idsOf("custom");
  const groupIds = idsOf("groups");
  const calendarIds = idsOf("calendar");
  const placedIds = [...groupIds, ...calendarIds];

  const [tiles, groups, placements, notes] = await Promise.all([
    customIds.length
      ? db
          .select({
            viewId: dashboardTiles.viewId,
            tileKey: dashboardTiles.tileKey,
            chart: dashboardTiles.chart,
            config: dashboardTiles.config,
            x: dashboardTiles.x,
            y: dashboardTiles.y,
            w: dashboardTiles.w,
            h: dashboardTiles.h,
          })
          .from(dashboardTiles)
          .where(and(eq(dashboardTiles.orgId, orgId), inArray(dashboardTiles.viewId, customIds)))
      : [],
    groupIds.length
      ? db
          .select({
            id: dashboardGroups.id,
            viewId: dashboardGroups.viewId,
            name: dashboardGroups.name,
            color: dashboardGroups.color,
            sortKey: dashboardGroups.sortKey,
            pos: dashboardGroups.pos,
          })
          .from(dashboardGroups)
          .where(and(eq(dashboardGroups.orgId, orgId), inArray(dashboardGroups.viewId, groupIds)))
      : [],
    placedIds.length
      ? db
          .select({
            viewId: dashboardTilePlacements.viewId,
            tileKey: dashboardTilePlacements.tileKey,
            groupId: dashboardTilePlacements.groupId,
            pos: dashboardTilePlacements.pos,
          })
          .from(dashboardTilePlacements)
          .where(and(eq(dashboardTilePlacements.orgId, orgId), inArray(dashboardTilePlacements.viewId, placedIds)))
      : [],
    readNotes(db, orgId),
  ]);

  /**
   * A TILE ITS AUTHOR'S ROLE HIDES IS NOT IN THE TEMPLATE AT ALL — not its box,
   * not its chart kind, and above all not its NOTE, which a teammate with
   * wider access may have written about the very metric the role hides ("Client
   * X margin, from Stripe"). The board drops these rows for this author
   * entirely; the template does the same, so it can only ever publish what its
   * author could see on their own screen. Blocks and empty slots name no
   * metric and always pass. Same for a calendar whose metric is hidden: it
   * keeps its shape and loses the metric.
   */
  const visible = (key: string) => {
    const vis = visibilityKeyOf(key);
    return vis == null || canSee(vis);
  };
  const shown = tiles.filter((t) => visible(t.tileKey));

  // Every key a name might be wanted for — the tiles, their composed parts,
  // every placement and every calendar's metric.
  const keys = new Set<string>();
  for (const t of shown) {
    keys.add(t.tileKey);
    const c = parseTileConfig(t.config);
    for (const k of [...(c.parts ?? []), ...(c.exits ?? [])]) keys.add(k);
  }
  for (const p of placements) keys.add(p.tileKey);
  const facts = await metricFacts(db, orgId, [...keys].filter((k) => visibilityKeyOf(k) != null && visible(k)));

  const source: SourceView[] = views.map((v) => {
    const kind = asViewKind(v.kind);
    const ownNotes = new Map<string, { note: string | null; apps: string[] }>();
    const viewGroups = groups.filter((g) => g.viewId === v.id);
    for (const g of viewGroups) {
      const n = notes.get(`group:${g.id}`);
      if (n) ownNotes.set(`group:${g.id}`, n);
    }
    const vn = notes.get(`view:${v.id}`);
    if (vn) ownNotes.set("view", vn);
    const viewPlacements = placements.filter((p) => p.viewId === v.id);
    return {
      name: v.name,
      kind,
      tiles: shown.filter((t) => t.viewId === v.id),
      groups: viewGroups,
      placements: viewPlacements,
      calendarKey:
        kind === "calendar" && viewPlacements[0] && visible(viewPlacements[0].tileKey) ? viewPlacements[0].tileKey : null,
      notes: ownNotes,
    };
  });

  return { snapshot: buildSnapshot(source, (k) => facts.get(k)), viewIds: views.map((v) => v.id) };
}

/**
 * A NAME AND THE APPS BEHIND IT, for each tile key the author may see.
 *
 * A flow tile is named by its OUTPUT (what the board prints on the card), with
 * the flow's own name as the fallback for one not yet materialized; its apps
 * are the connectors its Get-data steps read. A classic metric is named by
 * itself and reads its definition's sources.
 */
async function metricFacts(db: DB, orgId: string, keys: string[]): Promise<Map<string, MetricFacts>> {
  const out = new Map<string, MetricFacts>();
  const flowKeys = keys
    .map((k) => /^flow:([^:]+):(.+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m != null && UUID.test(m[1]));
  const metricIds = keys
    .map((k) => /^metric:(.+)$/.exec(k)?.[1])
    .filter((id): id is string => id != null && UUID.test(id));

  const flowIds = [...new Set(flowKeys.map((m) => m[1]))];
  const [results, flowRows, metricRows] = await Promise.all([
    flowIds.length
      ? db
          .select({
            flowId: flowResults.flowId,
            outputNodeId: flowResults.outputNodeId,
            name: sql<string | null>`${flowResults.tile}->>'name'`,
          })
          .from(flowResults)
          .where(and(eq(flowResults.orgId, orgId), inArray(flowResults.flowId, flowIds)))
      : [],
    flowIds.length
      ? db
          .select({ id: flows.id, name: flows.name, draftGraph: flows.draftGraph })
          .from(flows)
          .where(and(eq(flows.orgId, orgId), inArray(flows.id, flowIds)))
      : [],
    metricIds.length
      ? db
          .select({ id: metrics.id, name: metrics.name, definition: metrics.definition })
          .from(metrics)
          .where(and(eq(metrics.orgId, orgId), inArray(metrics.id, [...new Set(metricIds)])))
      : [],
  ]);

  const flowById = new Map(flowRows.map((f) => [f.id, { name: f.name, apps: graphApps(f.draftGraph) }]));
  const outputName = new Map(results.map((r) => [`${r.flowId}:${r.outputNodeId}`, r.name]));
  for (const m of flowKeys) {
    const flow = flowById.get(m[1]);
    if (!flow) continue; // deleted: nothing to name
    const name = outputName.get(`${m[1]}:${m[2]}`) || flow.name;
    out.set(m[0], { name, apps: flow.apps });
  }
  for (const r of metricRows) {
    const def = MetricDefinitionSchema.safeParse(r.definition);
    const apps = !def.success
      ? []
      : def.data.kind === "aggregate"
        ? [def.data.source]
        : def.data.stages.map((s) => s.source);
    out.set(`metric:${r.id}`, { name: r.name, apps: apps.filter((a): a is string => !!a) });
  }
  return out;
}

function graphApps(graph: unknown): string[] {
  try {
    return [
      ...new Set(
        parseGraph(graph)
          .nodes.filter((n) => n.type === "app")
          .map((n) => String((n.data.config as { source?: unknown } | undefined)?.source ?? ""))
          .filter(Boolean),
      ),
    ];
  } catch {
    // A graph that will not parse still names its flow; it just names no app.
    return [];
  }
}

// ─── Notes on columns and calendars ──────────────────────────────────────

/**
 * EVERY NOTE THIS WORKSPACE HAS WRITTEN on a column or a calendar, keyed
 * `group:<id>` / `view:<id>`. A handful of rows per workspace, so one read
 * serves any number of views.
 *
 * A MISSING TABLE IS "NO NOTES", not an error, and this is the one read in the
 * module that says so rather than throwing `TemplatesUnavailable`: the board
 * calls it on every render of a groups or calendar view, and a dashboard must
 * never fail over a paste that has not happened yet.
 */
export async function readNotes(
  db: DB,
  orgId: string,
  /**
   * ONE VIEW'S NOTES, for the board: its own (a calendar's) and its columns',
   * the columns joined in so a note left behind by a deleted column is never
   * read again — the board runs this on every twelve-second poll, and the
   * table must not be able to grow what that poll reads. Omitted, it reads the
   * whole workspace's, which is what building a template wants.
   */
  viewId?: string,
): Promise<Map<string, { note: string | null; apps: string[] }>> {
  try {
    const columns = { kind: dashboardNotes.targetKind, id: dashboardNotes.targetId, note: dashboardNotes.note, apps: dashboardNotes.apps };
    const rows = viewId
      ? await db
          .select(columns)
          .from(dashboardNotes)
          .leftJoin(
            dashboardGroups,
            and(eq(dashboardGroups.id, dashboardNotes.targetId), eq(dashboardGroups.orgId, dashboardNotes.orgId)),
          )
          .where(
            and(
              eq(dashboardNotes.orgId, orgId),
              or(
                and(eq(dashboardNotes.targetKind, "view"), eq(dashboardNotes.targetId, viewId)),
                and(eq(dashboardNotes.targetKind, "group"), eq(dashboardGroups.viewId, viewId)),
              ),
            ),
          )
      : await db.select(columns).from(dashboardNotes).where(eq(dashboardNotes.orgId, orgId));
    return new Map(
      rows.map((r) => [
        `${r.kind}:${r.id}`,
        { note: r.note, apps: Array.isArray(r.apps) ? r.apps.filter((a): a is string => typeof a === "string") : [] },
      ]),
    );
  } catch (e) {
    if (isUndefinedTableError(e)) return new Map();
    throw e;
  }
}

/**
 * WRITE (OR CLEAR) ONE NOTE. Clearing keeps the row only while it still names
 * apps — those came from a template and are what draws "Connect Stripe" on an
 * empty column, which is not the note's to take away.
 */
export async function writeNote(
  db: DB,
  orgId: string,
  target: { kind: "group" | "view"; id: string },
  note: string | null,
): Promise<void> {
  await guarded(async () => {
    await db
      .insert(dashboardNotes)
      .values({ orgId, targetKind: target.kind, targetId: target.id, note })
      .onConflictDoUpdate({
        target: [dashboardNotes.orgId, dashboardNotes.targetKind, dashboardNotes.targetId],
        set: { note, updatedAt: new Date() },
      });
    if (note == null) {
      await db
        .delete(dashboardNotes)
        .where(
          and(
            eq(dashboardNotes.orgId, orgId),
            eq(dashboardNotes.targetKind, target.kind),
            eq(dashboardNotes.targetId, target.id),
            sql`jsonb_array_length(${dashboardNotes.apps}) = 0`,
          ),
        );
    }
  });
}

/**
 * FORGET THE NOTES OF SOMETHING BEING DELETED — a column, or a view and every
 * column on it. Called by the delete actions so a note does not outlive what
 * it described. BEST-EFFORT AND NEVER FATAL: a delete the person asked for
 * must not fail over its note, and before migration 0034 there is no table to
 * clean (the one case that is silently fine rather than logged).
 */
export async function deleteNotes(db: DB, orgId: string, target: { groupId: string } | { viewId: string }): Promise<void> {
  try {
    if ("groupId" in target) {
      await db
        .delete(dashboardNotes)
        .where(
          and(eq(dashboardNotes.orgId, orgId), eq(dashboardNotes.targetKind, "group"), eq(dashboardNotes.targetId, target.groupId)),
        );
      return;
    }
    const groups = await db
      .select({ id: dashboardGroups.id })
      .from(dashboardGroups)
      .where(and(eq(dashboardGroups.orgId, orgId), eq(dashboardGroups.viewId, target.viewId)));
    await db
      .delete(dashboardNotes)
      .where(
        and(
          eq(dashboardNotes.orgId, orgId),
          or(
            and(eq(dashboardNotes.targetKind, "view"), eq(dashboardNotes.targetId, target.viewId)),
            groups.length
              ? and(eq(dashboardNotes.targetKind, "group"), inArray(dashboardNotes.targetId, groups.map((g) => g.id)))
              : sql`false`,
          ),
        ),
      );
  } catch (e) {
    if (!isUndefinedTableError(e)) console.error("[notes] cleanup failed", e);
  }
}

// ─── Applying a snapshot ─────────────────────────────────────────────────

/**
 * A TEMPLATE, WRITTEN INTO A WORKSPACE — every view, tile, column and note in
 * ONE statement.
 *
 * One statement because the deployed driver has no transactions (see
 * `newViewCte` in board-actions.ts), and a template that lands three of its
 * five views is a board the recipient cannot tell is half. Data-modifying CTEs
 * run as one atomic statement on every driver. Tiles and columns join to the
 * views CTE by id, so they reference rows the same statement is creating.
 *
 * THE CAPS ARE CHECKED FIRST, against what the workspace already holds: a
 * template can add views to a workspace that has some, and must not be the way
 * a workspace ends up past `MAX_BOARD_VIEWS_PER_ORG`.
 */
export async function applySnapshot(db: DB, orgId: string, snapshot: TemplateSnapshot): Promise<{ viewIds: string[] }> {
  const [views, [groupCount]] = await Promise.all([
    db.select({ pos: dashboardViews.pos }).from(dashboardViews).where(eq(dashboardViews.orgId, orgId)),
    db.select({ n: count() }).from(dashboardGroups).where(eq(dashboardGroups.orgId, orgId)),
  ]);
  const viewCap = boardViewCap();
  if (views.length + snapshot.views.length > viewCap) {
    const room = Math.max(0, viewCap - views.length);
    throw new TemplateRefusal(
      `This template has ${snapshot.views.length} views and this workspace has room for ${room} more (the limit is ${viewCap}). Delete a view or two, or start a new workspace from it.`,
    );
  }
  const newGroups = snapshot.views.reduce((n, v) => n + (v.kind === "groups" ? v.groups.length : 0), 0);
  const groupCap = boardGroupCap();
  if (Number(groupCount?.n ?? 0) + newGroups > groupCap) {
    throw new TemplateRefusal(`This template's columns would take this workspace past its limit of ${groupCap} groups.`, "groups");
  }

  const last = views.map((v) => v.pos).sort(compareKeys).at(-1) ?? null;
  const rows = planApply(snapshot, {
    viewPos: keysBetween(last, null, snapshot.views.length),
    groupPos: (n) => keysBetween(null, null, n),
    id: () => crypto.randomUUID(),
  });

  const parts = [
    sql`with v as (
      insert into ${dashboardViews} (id, org_id, name, pos, kind)
      values ${sql.join(
        rows.views.map((r) => sql`(${r.id}::text, ${orgId}::text, ${r.name}::text, ${r.pos}::text, ${r.kind}::text)`),
        sql`, `,
      )}
      returning id
    )`,
  ];
  if (rows.tiles.length) {
    parts.push(sql`, t as (
      insert into ${dashboardTiles} (id, org_id, view_id, tile_key, chart, config, x, y, w, h)
      select r.id, ${orgId}, v.id, r.tile_key, r.chart, r.config, r.x, r.y, r.w, r.h
        from (values ${sql.join(
          rows.tiles.map(
            (r) =>
              sql`(${r.id}::text, ${r.viewId}::text, ${r.tileKey}::text, ${r.chart}::text, ${JSON.stringify(r.config)}::jsonb, ${r.x}::int, ${r.y}::int, ${r.w}::int, ${r.h}::int)`,
          ),
          sql`, `,
        )}) as r(id, view_id, tile_key, chart, config, x, y, w, h)
        join v on v.id = r.view_id
      returning 1
    )`);
  }
  if (rows.groups.length) {
    parts.push(sql`, g as (
      insert into ${dashboardGroups} (id, org_id, name, color, pos, sort_key, view_id)
      select r.id, ${orgId}, r.name, r.color, r.pos, r.sort_key, v.id
        from (values ${sql.join(
          rows.groups.map(
            (r) => sql`(${r.id}::text, ${r.viewId}::text, ${r.name}::text, ${r.color}::text, ${r.pos}::text, ${r.sortKey}::text)`,
          ),
          sql`, `,
        )}) as r(id, view_id, name, color, pos, sort_key)
        join v on v.id = r.view_id
      returning 1
    )`);
  }
  if (rows.notes.length) {
    parts.push(sql`, n as (
      insert into ${dashboardNotes} (org_id, target_kind, target_id, note, apps)
      values ${sql.join(
        rows.notes.map(
          (r) => sql`(${orgId}::text, ${r.targetKind}::text, ${r.targetId}::text, ${r.note}::text, ${JSON.stringify(r.apps)}::jsonb)`,
        ),
        sql`, `,
      )}
      returning 1
    )`);
  }
  parts.push(sql` select count(*)::int as n from v`);

  await guarded(() => db.execute(sql.join(parts, sql``)));
  return { viewIds: rows.views.map((v) => v.id) };
}
