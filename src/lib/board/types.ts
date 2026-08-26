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
export type BoardViewKind = "groups" | "custom";

/** An unknown stored value reads as the board every workspace already had. */
export const asViewKind = (v: unknown): BoardViewKind => (v === "custom" ? "custom" : "groups");

export type BoardView = { id: string | null; name: string; pos: string; kind: BoardViewKind };

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
