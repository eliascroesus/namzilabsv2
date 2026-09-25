import { z } from "zod";
import { GROUP_ACCENT } from "@/components/flow/node-accent";
import { BLOCK_IDS, CHART_IDS, asChartId, blockKindOf, blockTileKey, type BlockId, type ChartId } from "@/lib/board/charts";
import { composes, parseTileConfig, type TileConfig } from "@/lib/board/tile-config";
import { GROUP_SORT_KEYS, UNSET_TILE_KEY, type BoardViewKind, type GroupSortKey } from "@/lib/board/types";

/**
 * A TEMPLATE'S CONTENTS — the shape of some views, and not one fact about the
 * workspace they were drawn from.
 *
 * ═══ WHAT CROSSES, AND WHY THE LIST IS SHORT ═══
 *
 * A snapshot is published at a public URL and copied into strangers'
 * workspaces, so it is BUILT BY A WHITELIST rather than by removing the
 * dangerous parts of a copy. Removing is how leaks happen: the next key added
 * to a tile's config would ride out on every template until somebody thought
 * to strip it. Here a key crosses only if `PRESENTATION_KEYS` names it.
 *
 * What crosses: each view's name and kind; a custom view's tiles as chart kind,
 * grid box and presentation (colour, decimals, sort, legend…); text blocks with
 * their words; a groups view's columns as name, colour and sort; and for every
 * place a metric goes, a NOTE saying which one and the APPS it comes from.
 *
 * What never crosses: a tile key (it names a flow or metric id in the author's
 * workspace), a goal (`target` is the author's own number — "$50k this month"
 * is business data, not layout), a custom title (it becomes the note instead,
 * see `slotNote`), composed parts (sibling tile keys), placements, groups'
 * member lists, and every id of every row.
 *
 * ═══ THE NOTE IS DERIVED, SO A WORKING BOARD NEEDS NO EXTRA TYPING ═══
 *
 * A coach sharing a dashboard that already works should not have to annotate
 * it: each filled tile becomes an empty slot whose note is the metric's name
 * (or the tile's own title, which is the name the author chose to show), and
 * whose apps are the connectors that metric reads. A note the author wrote
 * themselves wins over both. A composed funnel's note is its stages in order —
 * "Leads → Booked → Showed → Won" — which is the one sentence that tells a
 * student what to build.
 *
 * Pure and synchronous: `store.ts` does the reading, this decides what may
 * leave, and `tests/templates-snapshot.test.ts` is the specification.
 */

export const SNAPSHOT_VERSION = 1;

/** The presentation keys a template may carry. Everything else stays home. */
const PRESENTATION_KEYS = [
  "precision",
  "color",
  "showSpark",
  "showLabels",
  "sort",
  "limit",
  "donut",
  "legend",
  "rangeKey",
  "flow",
  // A text block's content and setting — words the author put on the board
  // FOR its readers, which is exactly what a template is for.
  "text",
  "textSize",
  "textWeight",
  "align",
  "valign",
] as const satisfies ReadonlyArray<keyof TileConfig>;

/** How many metric names a derived column note lists before it says "and N more". */
const NOTE_NAMES = 6;
const NOTE_MAX = 280;
/** Grid bounds, the same numbers `setCustomTileLayoutAction` enforces. */
const GRID = { x: 11, y: 400, w: 12, h: 60 } as const;

// ─── The stored shape ────────────────────────────────────────────────────

const appsSchema = z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)).max(8);
const noteSchema = z.string().trim().min(1).max(NOTE_MAX).nullable();

const tileSchema = z.object({
  chart: z.string().refine((c) => (CHART_IDS as string[]).includes(c)),
  x: z.number().int().min(0).max(GRID.x),
  y: z.number().int().min(0).max(GRID.y),
  w: z.number().int().min(1).max(GRID.w),
  h: z.number().int().min(1).max(GRID.h),
  /** Whitelisted presentation, re-parsed on the way in — see `parseSnapshot`. */
  config: z.record(z.string(), z.unknown()),
  note: noteSchema,
  apps: appsSchema,
});

const groupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().refine((c) => Object.hasOwn(GROUP_ACCENT, c)),
  sortKey: z.enum(GROUP_SORT_KEYS as [GroupSortKey, ...GroupSortKey[]]),
  note: noteSchema,
  apps: appsSchema,
});

const viewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("custom"), name: z.string().trim().min(1).max(60), tiles: z.array(tileSchema).max(60) }),
  z.object({ kind: z.literal("groups"), name: z.string().trim().min(1).max(60), groups: z.array(groupSchema).max(100) }),
  z.object({ kind: z.literal("calendar"), name: z.string().trim().min(1).max(60), note: noteSchema, apps: appsSchema }),
]);

const snapshotSchema = z.object({
  v: z.literal(SNAPSHOT_VERSION),
  views: z.array(viewSchema).min(1).max(30),
});

export type SnapshotTile = z.infer<typeof tileSchema>;
export type SnapshotGroup = z.infer<typeof groupSchema>;
export type SnapshotView = z.infer<typeof viewSchema>;
export type TemplateSnapshot = z.infer<typeof snapshotSchema>;

/**
 * A STORED SNAPSHOT, READ BACK — or null.
 *
 * It was written by this module, so failing to parse means a bug or a hand in
 * the SQL editor; either way the answer is "this template is unavailable"
 * rather than a half-rendered page or a half-applied board. The tile configs
 * are re-filtered through the whitelist as well, so a bag edited in place can
 * never widen what a copy receives.
 */
export function parseSnapshot(raw: unknown): TemplateSnapshot | null {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  for (const view of parsed.data.views) {
    if (view.kind !== "custom") continue;
    for (const tile of view.tiles) tile.config = presentationOf(tile.config);
  }
  return parsed.data;
}

/**
 * THE LARGEST SNAPSHOT A TEMPLATE MAY STORE, serialized.
 *
 * The public page is read by strangers, and every read of a stored snapshot
 * is billed egress on an account-wide allowance (see the Neon notes in the
 * project memory). Thirty views of sixty 2000-character text blocks is ~3.8MB,
 * and a link passed round a course would read that on every visit. 256KB is
 * roughly a hundred times what a real board measures, so no genuine template
 * meets it; the ones that do are the ones that would have hurt.
 */
export const SNAPSHOT_MAX_BYTES = 256 * 1024;

/**
 * MAY THIS SNAPSHOT BE STORED? The same schema `parseSnapshot` reads with, so a
 * template can never be written that its own link would then call
 * unavailable — the fate of a thirty-one-view workspace before this existed:
 * "Link ready" in Settings, "isn't available" at the link. Plus the size cap.
 */
export function storable(snapshot: TemplateSnapshot): { ok: true } | { ok: false; reason: "views" | "size" | "shape" } {
  if (snapshot.views.length > 30) return { ok: false, reason: "views" };
  if (!snapshotSchema.safeParse(snapshot).success) return { ok: false, reason: "shape" };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > SNAPSHOT_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

// ─── Building one ────────────────────────────────────────────────────────

/** What the builder needs to know about a metric the author can see. */
export type MetricFacts = { name: string; apps: string[] };

/** One of the author's views, as `store.ts` read it. Ids never leave. */
export type SourceView = {
  name: string;
  kind: BoardViewKind;
  tiles: Array<{ tileKey: string; chart: string; config: unknown; x: number; y: number; w: number; h: number }>;
  groups: Array<{ id: string; name: string; color: string; sortKey: string; pos: string }>;
  placements: Array<{ tileKey: string; groupId: string | null; pos: string }>;
  /** A calendar's one metric, if it has one. */
  calendarKey: string | null;
  /** Notes the author wrote on a column (`group:<id>`) or on the view itself (`view`). */
  notes: Map<string, { note: string | null; apps: string[] }>;
};

/**
 * THE AUTHOR'S VIEWS, AS A TEMPLATE.
 *
 * `facts` answers for a tile key the AUTHOR may see, and nothing else — a key
 * hidden from them by their role, or naming a metric that no longer exists,
 * answers undefined and contributes no name. So a template can never publish
 * the name of a metric its own author could not open.
 */
export function buildSnapshot(views: SourceView[], facts: (tileKey: string) => MetricFacts | undefined): TemplateSnapshot {
  return { v: SNAPSHOT_VERSION, views: views.map((view) => snapshotView(view, facts)) };
}

function snapshotView(view: SourceView, facts: (tileKey: string) => MetricFacts | undefined): SnapshotView {
  const name = clip(view.name, 60) || "View";
  if (view.kind === "custom") {
    return {
      kind: "custom",
      name,
      tiles: view.tiles
        .map((t) => snapshotTile(t, facts))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .slice(0, 60),
    };
  }
  if (view.kind === "calendar") {
    const own = view.notes.get("view");
    const metric = view.calendarKey ? facts(view.calendarKey) : undefined;
    return {
      kind: "calendar",
      name,
      note: clipNote(own?.note ?? metric?.name ?? null),
      apps: cleanApps([...(own?.apps ?? []), ...(metric?.apps ?? [])]),
    };
  }
  const groups = [...view.groups].sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0)).slice(0, 100);
  return {
    kind: "groups",
    name,
    groups: groups.map((g) => {
      /**
       * A COLUMN'S NOTE IS ITS MEMBERS, NAMED — unless the author wrote one.
       *
       * The metrics themselves cannot travel, but which ones belonged in
       * "Sales" is exactly the fact a student needs, and it is already on the
       * author's board in the order they arranged it. The apps are ALWAYS the
       * members', whatever the note says, because they are facts about what the
       * column holds rather than words about it.
       */
      const members = view.placements
        .filter((p) => p.groupId === g.id)
        .sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0))
        .map((p) => facts(p.tileKey))
        .filter((m): m is MetricFacts => m != null);
      const own = view.notes.get(`group:${g.id}`);
      return {
        name: clip(g.name, 60) || "Group",
        color: Object.hasOwn(GROUP_ACCENT, g.color) ? g.color : "grey",
        sortKey: (GROUP_SORT_KEYS as string[]).includes(g.sortKey) ? (g.sortKey as GroupSortKey) : "manual",
        note: clipNote(own?.note ?? listNames(members.map((m) => m.name))),
        apps: cleanApps([...(own?.apps ?? []), ...members.flatMap((m) => m.apps)]),
      };
    }),
  };
}

function snapshotTile(
  t: SourceView["tiles"][number],
  facts: (tileKey: string) => MetricFacts | undefined,
): SnapshotTile {
  const block = blockKindOf(t.tileKey);
  const chart: ChartId = block ?? asChartId(t.chart);
  const config = parseTileConfig(t.config);
  const box = clampBox(t);
  if (block) {
    // Furniture travels whole: its words ARE the content, and there is no
    // metric behind it to leave behind.
    return { chart, ...box, config: presentationOf(config), note: null, apps: [] };
  }
  const { note, apps } = slotNote(chart, t.tileKey, config, facts);
  return { chart, ...box, config: presentationOf(config), note, apps };
}

/**
 * WHAT AN EMPTY SLOT WILL SAY, in order of who knows best.
 *
 * 1. The author's own note — they wrote it for exactly this.
 * 2. For a composed chart, its members in order: the anchor, then its parts.
 * 3. The tile's title, if the author renamed it — that is the name they chose
 *    to show, and it is on their board already.
 * 4. The metric's own name.
 *
 * Titles and names come only from `facts`, so a metric hidden from the author
 * contributes nothing — not even a custom title typed over it, which could
 * name the very thing the role hides.
 */
function slotNote(
  chart: ChartId,
  tileKey: string,
  config: TileConfig,
  facts: (tileKey: string) => MetricFacts | undefined,
): { note: string | null; apps: string[] } {
  const own = config.note ?? null;
  const ownApps = config.noteApps ?? [];
  if (tileKey === UNSET_TILE_KEY) return { note: clipNote(own), apps: cleanApps(ownApps) };

  const anchor = facts(tileKey);
  const parts = composes(chart) ? (config.parts ?? []).map((k) => facts(k)).filter((m): m is MetricFacts => m != null) : [];
  const members = anchor ? [anchor, ...parts] : parts;
  const apps = cleanApps([...ownApps, ...members.flatMap((m) => m.apps)]);
  if (own) return { note: clipNote(own), apps };
  if (!anchor) return { note: null, apps };
  if (parts.length > 0) {
    const sep = chart === "pipeline" ? " → " : ", ";
    return { note: clipNote(members.map((m) => m.name).join(sep)), apps };
  }
  return { note: clipNote(config.title ?? anchor.name), apps };
}

/** The whitelisted part of a config bag — see `PRESENTATION_KEYS`. */
function presentationOf(config: unknown): Record<string, unknown> {
  const parsed = parseTileConfig(config) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PRESENTATION_KEYS) if (key in parsed) out[key] = parsed[key];
  return out;
}

// ─── Applying one ────────────────────────────────────────────────────────

/**
 * THE ROWS A SNAPSHOT BECOMES in the workspace receiving it — computed here,
 * written in one statement by `store.ts`.
 *
 * Every id is fresh; every slot is `UNSET_TILE_KEY` carrying its note and apps
 * in its own config, which is exactly the tile the board's add menu already
 * draws as "Pick a metric" — so the receiving board needs no idea that a
 * template was ever involved. Views go after the workspace's last tab (`after`)
 * in the snapshot's order, never displacing anything already there.
 */
export type AppliedRows = {
  views: Array<{ id: string; name: string; kind: BoardViewKind; pos: string }>;
  tiles: Array<{ id: string; viewId: string; tileKey: string; chart: string; config: Record<string, unknown>; x: number; y: number; w: number; h: number }>;
  groups: Array<{ id: string; viewId: string; name: string; color: string; pos: string; sortKey: GroupSortKey }>;
  notes: Array<{ targetKind: "group" | "view"; targetId: string; note: string | null; apps: string[] }>;
};

export function planApply(
  snapshot: TemplateSnapshot,
  keys: { viewPos: string[]; groupPos: (n: number) => string[]; id: () => string },
): AppliedRows {
  const rows: AppliedRows = { views: [], tiles: [], groups: [], notes: [] };
  snapshot.views.forEach((view, i) => {
    const viewId = keys.id();
    rows.views.push({ id: viewId, name: view.name, kind: view.kind, pos: keys.viewPos[i] });
    if (view.kind === "custom") {
      for (const t of view.tiles) {
        const block = (BLOCK_IDS as readonly string[]).includes(t.chart) ? (t.chart as BlockId) : null;
        const config: Record<string, unknown> = { ...presentationOf(t.config) };
        if (!block && t.note) config.note = t.note;
        if (!block && t.apps.length) config.noteApps = t.apps;
        rows.tiles.push({
          id: keys.id(),
          viewId,
          tileKey: block ? blockTileKey(block) : UNSET_TILE_KEY,
          chart: t.chart,
          config,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
        });
      }
    } else if (view.kind === "groups") {
      const pos = keys.groupPos(view.groups.length);
      view.groups.forEach((g, j) => {
        const id = keys.id();
        rows.groups.push({ id, viewId, name: g.name, color: g.color, pos: pos[j], sortKey: g.sortKey });
        if (g.note || g.apps.length) rows.notes.push({ targetKind: "group", targetId: id, note: g.note, apps: g.apps });
      });
    } else if (view.note || view.apps.length) {
      rows.notes.push({ targetKind: "view", targetId: viewId, note: view.note, apps: view.apps });
    }
  });
  return rows;
}

/** What the public page and the owner's list say a template holds. */
export function summarize(snapshot: TemplateSnapshot): { views: number; slots: number; apps: string[] } {
  let slots = 0;
  const apps: string[] = [];
  for (const view of snapshot.views) {
    if (view.kind === "custom") {
      for (const t of view.tiles) {
        if ((BLOCK_IDS as readonly string[]).includes(t.chart)) continue;
        slots++;
        apps.push(...t.apps);
      }
    } else if (view.kind === "groups") {
      for (const g of view.groups) apps.push(...g.apps);
    } else {
      slots++;
      apps.push(...view.apps);
    }
  }
  return { views: snapshot.views.length, slots, apps: cleanApps(apps, 12) };
}

// ─── Small, total helpers ────────────────────────────────────────────────

/**
 * CUT WITHIN A UTF-16 BUDGET, BUT NEVER INSIDE A CHARACTER — both halves were
 * bugs.
 *
 * `String.slice` counts code units, so a note whose 280th unit was the first
 * half of an emoji kept a lone surrogate, which Postgres' jsonb refuses
 * outright ("invalid input syntax for type json") — one emoji in one metric's
 * name failed the whole template. Cutting by code points instead fixed that and
 * broke the other side: zod's `.max(280)`, which is what reads the snapshot
 * back, counts UNITS, so 280 characters holding an emoji is 281 and the stored
 * template came back unreadable. So: whole code points, while the units fit.
 */
function clipUnits(s: string, maxUnits: number): string {
  if (s.length <= maxUnits) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > maxUnits) break;
    out += ch;
  }
  return out;
}

function clip(s: string, n: number): string {
  return clipUnits(s.trim(), n).trim();
}

function clipNote(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= NOTE_MAX ? t : `${clipUnits(t, NOTE_MAX - 1).trimEnd()}…`;
}

function listNames(names: string[]): string | null {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  const shown = unique.slice(0, NOTE_NAMES).join(" · ");
  const rest = unique.length - NOTE_NAMES;
  return rest > 0 ? `${shown} · and ${rest} more` : shown;
}

function cleanApps(apps: string[], max = 8): string[] {
  return [...new Set(apps.filter((a) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(a)))].slice(0, max);
}

/**
 * A box that fits the grid, whatever the row said. The author's rows passed
 * `setCustomTileLayoutAction`'s bounds when written, so this only ever bites a
 * row edited by hand — and a template must not be the way one reaches thirty
 * other workspaces.
 */
function clampBox(t: { x: number; y: number; w: number; h: number }) {
  const int = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(v) ? v : lo)));
  const w = int(t.w, 1, GRID.w);
  return { x: int(t.x, 0, GRID.w - w), y: int(t.y, 0, GRID.y), w, h: int(t.h, 1, GRID.h) };
}
