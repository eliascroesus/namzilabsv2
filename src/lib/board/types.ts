import { blockKindOf } from "./charts";
import type { ReactNode } from "react";

/**
 * THE BOARD'S VOCABULARY, IN A MODULE WITH NO `"use client"` DIRECTIVE.
 *
 * That absence is load-bearing rather than incidental. The dashboard page is a
 * server component and `BoardLayout` is a client one, and both import from
 * here — a client module's exports become throwing stubs on the server and
 * stringify silently into whatever used them, which is the trap
 * `tests/page-width.test.ts` documents at length for the calendar's day-cell
 * constant. Types and pure key arithmetic only; nothing here touches a
 * browser or a database.
 */

/**
 * ONE WAY OF LOOKING AT THE BOARD.
 *
 * `id: null` is the DEFAULT view — the board every workspace already had before
 * views existed. It has no row and cannot be renamed or deleted, which is the
 * price of not writing to the database on a page load. See the schema.
 */
export type BoardViewKind = "groups" | "custom" | "calendar";

/**
 * An unknown stored value reads as the board every workspace already had.
 *
 * THE ONE PLACE `kind` IS INTERPRETED, which is why a third kind was cheap. The
 * column is plain `text` with a default and no CHECK constraint (schema.ts), so
 * the database never had an opinion about the vocabulary — this function is the
 * whole of it, and everything downstream is a comparison against its output.
 */
export const asViewKind = (v: unknown): BoardViewKind =>
  v === "custom" ? "custom" : v === "calendar" ? "calendar" : "groups";

/**
 * THE THREE ARRANGEMENTS, AND WHERE EACH ONE'S LAYOUT LIVES.
 *
 * A `kind` is not a rendering preference — it decides which table the view's
 * arrangement is stored in, which is why the three cannot be collapsed:
 *
 *   groups   — `dashboard_tile_placements`, one row per metric, carrying a
 *              column and a position.
 *   custom   — `dashboard_tiles`, one row per CHART, so a metric can appear
 *              several times drawn several ways.
 *   calendar — `dashboard_tile_placements` again, but exactly ONE row and no
 *              group: the single metric this calendar breaks down by day.
 *
 * Calendar reuses the placements table rather than earning a column of its own
 * because the row means the same thing it always did — this metric belongs to
 * this view — and it inherits the unique index and the ON DELETE CASCADE for
 * free. What differs is arity, which the writer enforces, not the shape.
 */
export const VIEW_KINDS: readonly BoardViewKind[] = ["groups", "custom", "calendar"] as const;

/**
 * `id: null` is the SYNTHETIC default tab — the board that exists as the absence
 * of a row, prepended by the page for a workspace that has never renamed it.
 * `isDefault` is the ADOPTED one: a real row carrying the same board after
 * somebody typed a name for it. Exactly one of the two shapes is ever present
 * in a strip, which is what stops "Dashboard" appearing twice.
 */
export type BoardView = { id: string | null; name: string; pos: string; kind: BoardViewKind; isDefault?: boolean };

/**
 * ONE METRIC THE PICKER MAY OFFER, and the charts its shape supports.
 *
 * PLAIN DATA — no functions — so it crosses the RSC boundary beside `BoardTile`
 * for the same reason and under the same rule. `charts` is computed on the
 * SERVER by `chartsFor`, and the picker filters with it rather than deriving it
 * again: two definitions of "can be drawn as" is precisely the gap between what
 * an interface offers and what it draws, which is the gap this whole feature
 * exists to close.
 */
export type CustomTileOption = { key: string; title: string; charts: string[] };

/**
 * ONE CHART ON A CUSTOM VIEW, as the board reads it.
 *
 * `x`/`y`/`w`/`h` are GRID UNITS — twelve columns, forty-pixel rows. See
 * `src/lib/board/grid.ts`, which owns that arithmetic and is the only place it
 * lives.
 *
 * `tileKey` is the same `flow:<flowId>:<outputNodeId>` / `metric:<metricId>`
 * string a placement carries, and deliberately the same name — but unlike a
 * placement it is NOT this row's identity. `id` is, which is what lets one
 * metric appear on a view three times as three different charts.
 */
export type BoardTileRow = {
  id: string;
  tileKey: string;
  chart: string;
  /** Per-chart presentation; the rename override lives here as `title`. */
  config: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** How a group orders the tiles inside it. `manual` means "as dragged". */
export type GroupSortKey = "manual" | "name_asc" | "name_desc" | "value_desc" | "attention";

export const GROUP_SORT_KEYS: GroupSortKey[] = ["manual", "name_asc", "name_desc", "value_desc", "attention"];

/** A `dashboard_groups` row, as every reader on this side of the wire sees it. */
export type BoardGroup = {
  id: string;
  name: string;
  /** A GROUP_ACCENT key. Unknown values render grey — see `groupAccent`. */
  color: string;
  pos: string;
  sortKey: GroupSortKey;
};

/** A `dashboard_tile_placements` row. `groupId: null` is the ungrouped row. */
export type TilePlacement = {
  tileKey: string;
  groupId: string | null;
  pos: string;
};

/**
 * ONE TILE, AS THE BOARD NEEDS IT — the four facts an arrangement is computed
 * from, plus the card itself.
 *
 * `node` is the SERVER-RENDERED card, passed straight through a client
 * component's props and placed without ever being inspected. That is what lets
 * the tiles stay server components while the arrangement is client state.
 *
 * NOTHING IN THIS OBJECT MAY BE A FUNCTION. React elements serialize through
 * the RSC payload anywhere in a prop tree, including inside an array of
 * objects, but a function does not — and one `onClick` slipped in beside `node`
 * fails the build with an error that names nothing useful. Strings, numbers,
 * nulls and `node`.
 */
export type BoardTile = {
  /** `flow:<flowId>:<outputNodeId>` or `metric:<metricId>`. */
  key: string;
  /** The name sorts, the drag ghost and the "Move to" menu read this. */
  title: string;
  /**
   * WHICH NUMBERS THIS ONE MAY BE COMPARED WITH — `format:currency:unit`.
   *
   * $12,400, 3.2% and 47 leads are not orderable against each other, so the
   * value sort partitions on this rather than pretending they are. See
   * `arrangeBoard`.
   */
  unitKey: string;
  /** The headline number under the ACTIVE range, or null when there is none. */
  value: number | null;
  /** 3 error · 2 unpublished · 1 stale or unanswered · 0 fine. */
  attention: 0 | 1 | 2 | 3;
  /** The card. Placed, never read. */
  node: ReactNode;
};

/**
 * A TILE'S IDENTITY, AS ONE STRING.
 *
 * A flow tile is a `(flowId, outputNodeId)` pair — one flow can publish several
 * Outputs and each is its own tile — while a classic metric is a single id. The
 * board needs one column to key placements on, so the pair is spelled into the
 * string.
 *
 * The prefix vocabulary is DELIBERATELY the one `src/lib/permissions.ts`
 * already uses for metric visibility ("flow:<flowId>", "metric:<metricId>"),
 * so the coarser permission key is a literal PREFIX of the finer placement key
 * and `visibilityKeyOf` is the whole bridge between them. Permission is per
 * flow; placement is per tile.
 */
export const tileKeyOfFlow = (flowId: string, outputNodeId: string) => `flow:${flowId}:${outputNodeId}`;
export const tileKeyOfMetric = (metricId: string) => `metric:${metricId}`;

/**
 * WHAT A CANVAS ROW IS, once the permission filters have already run.
 *
 * A row whose metric this viewer may not see and a row whose metric no longer
 * exists arrive at the renderer as the same thing: a `tileKey` that joins to
 * nothing. Telling them apart needs a fact from BEFORE the filter, and getting
 * it wrong is not cosmetic — the canvas told restricted viewers "It isn't
 * published any more. Publish it again", printing the tile's title beside a
 * sentence that was false for them.
 *
 *   "render" — the metric joined; draw the tile.
 *   "hidden" — it exists but this viewer's rank covers it. The row is dropped
 *              on the SERVER and nothing about it crosses to the client, title
 *              included. Not a placeholder, not an empty box: absent.
 *   "dead"   — it is in no unfiltered set, so it is genuinely gone. `DeadTile`,
 *              which keeps its box and says so, because somebody chose that
 *              chart and put it in that spot and republishing brings it back.
 *
 * `existing` must be assembled BEFORE `canSeeMetric` runs, or every hidden row
 * reads as dead and the leak comes straight back.
 */
export type CanvasRowFate = "render" | "hidden" | "dead";

export function canvasRowFate(tileKey: string, joined: boolean, existing: ReadonlySet<string>): CanvasRowFate {
  if (joined) return "render";
  /**
   * A BLOCK JOINS TO NOTHING BY DESIGN, so it has to be answered before the
   * two "joined to nothing" cases below. A heading points at no metric and is
   * in no unfiltered set, which is indistinguishable from a deleted one to
   * every test this function performs — so without this line every block on
   * every board renders "It isn't published any more."
   */
  if (blockKindOf(tileKey)) return "render";
  return existing.has(tileKey) ? "hidden" : "dead";
}

/**
 * THE VIEW STRIP — the views a workspace has made, in order. Nothing else.
 *
 * IT USED TO CONJURE A "Dashboard" TAB, and that is what this deletes.
 *
 * The default board was the ABSENCE of a row: `listBoardViews` could not return
 * it, so every caller put it back by prepending a synthetic
 * `{ id: null, name: "Dashboard" }` whenever no row was flagged `isDefault`.
 * That was right while the board could not be empty. It is wrong now, and it was
 * wrong in the way that undid the whole empty state: rename the first view,
 * delete it, and the tab came straight back — a board nobody created, holding
 * nothing, that could not itself be deleted because it had no row to delete.
 * "There is always at least one tab" was being enforced by inventing one.
 *
 * A view is now a row and only a row. No views means no views, which is what
 * lets the dashboard show its Get-started card instead of a board.
 *
 * VERIFIED SAFE AGAINST THE LIVE DATABASE BEFORE REMOVING IT, because the
 * synthetic tab was the only route to any content stored at `view_id IS NULL`
 * and cutting it blind would have made such a board unreachable: zero groups and
 * zero placements carry a null `view_id`, so it was reaching nothing.
 */
export function viewStrip(views: BoardView[]): BoardView[] {
  return views.slice().sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
}
