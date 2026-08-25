import { compareKeys } from "./order";
import type { BoardGroup, BoardTile, GroupSortKey, TilePlacement } from "./types";

/**
 * THE ARRANGEMENT, COMPUTED FROM THREE LISTS AND NOTHING ELSE.
 *
 * Pure, synchronous and DOM-free on purpose: this is where every product rule
 * about the board lives, so it has to be testable without rendering anything.
 * `tests/board-layout.test.ts` is the specification.
 *
 * The input `tiles` array arrives IN THE SERVER'S DEFAULT ORDER (flow tiles,
 * then classic metrics), which is today's board. That order is the fallback
 * ranking for anything unplaced, so it costs nothing to compute — it is the
 * index.
 */

/** A column, or the ungrouped row when `group` is null. */
export type BoardLane = {
  /** The group's id, or null for the ungrouped row. */
  id: string | null;
  group: BoardGroup | null;
  tiles: BoardTile[];
};

export type BoardArrangement =
  /** No groups exist: the dashboard is exactly what it was before this feature. */
  | { mode: "grid"; tiles: BoardTile[] }
  | { mode: "board"; ungrouped: BoardLane; columns: BoardLane[] };

/** A tile plus where it was placed, if it was. */
type Seated = { tile: BoardTile; pos: string | null; fallback: number };

/**
 * ORDER WITHIN ONE LANE, BEFORE ANY AUTO-SORT.
 *
 * Placed tiles first, by their key; then anything unplaced, in the server's
 * default order. A newly published metric therefore appears at the END of the
 * ungrouped row rather than in the middle of an arrangement somebody built,
 * which is the only placement that does not silently rearrange their work.
 *
 * `tileKey` is the final tiebreak and it is not decoration. Two people dropping
 * two tiles into the same gap compute the SAME key — there is deliberately no
 * unique constraint on `pos`, because the alternative is one of them getting an
 * error they cannot act on. This is what makes both of them nevertheless see
 * the same order.
 */
function byManualOrder(a: Seated, b: Seated): number {
  if (a.pos != null && b.pos != null) {
    const k = compareKeys(a.pos, b.pos);
    return k !== 0 ? k : compareKeys(a.tile.key, b.tile.key);
  }
  if (a.pos != null) return -1;
  if (b.pos != null) return 1;
  return a.fallback - b.fallback;
}

/**
 * HOW A FORMAT RANKS AGAINST ANOTHER FORMAT — money, then counts, then rates,
 * then durations, then whatever we do not recognise.
 *
 * A FIXED precedence, deliberately, rather than "the partition with the biggest
 * number first". The latter smuggles the cross-unit comparison straight back in
 * through the ordering of the partitions, which is the exact thing partitioning
 * exists to refuse.
 */
const FORMAT_RANK: Record<string, number> = { currency: 0, number: 1, percent: 2, duration: 3 };
const formatRankOf = (unitKey: string) => FORMAT_RANK[unitKey.split(":")[0] ?? ""] ?? 4;

/**
 * VALUE HIGH→LOW, WITHOUT LYING ABOUT WHAT IS COMPARABLE.
 *
 * $12,400, 3.2% and 47 leads have no shared order, and a dashboard that sorts
 * them into one confident list is a dashboard that lies. So the lane is
 * partitioned by `unitKey`, the partitions are ordered by the fixed precedence
 * above, and tiles are ranked by value only against their own kind.
 *
 * A TILE WITH NO NUMBER SINKS TO THE BOTTOM, ALWAYS. An em-dash is not a small
 * number — a metric that could not be computed for this range is outside the
 * ordering entirely, not worth zero.
 */
function byValueDesc(a: Seated, b: Seated): number {
  const av = a.tile.value;
  const bv = b.tile.value;
  if (av == null && bv == null) return byManualOrder(a, b);
  if (av == null) return 1;
  if (bv == null) return -1;
  if (a.tile.unitKey !== b.tile.unitKey) {
    const fr = formatRankOf(a.tile.unitKey) - formatRankOf(b.tile.unitKey);
    // Two partitions of the same format (two currencies, two units) are ordered
    // by their key so the grouping is at least stable and nameable.
    return fr !== 0 ? fr : compareKeys(a.tile.unitKey, b.tile.unitKey);
  }
  return bv - av;
}

/**
 * The comparator a lane uses, given its group's setting.
 *
 * EVERY BRANCH FALLS BACK TO `byManualOrder` FOR TIES, and that is what makes
 * an auto-sort a VIEW over the manual order rather than a replacement for it.
 * `pos` is never written by a sort, so switching back to Manual restores the
 * previous arrangement exactly — see the test that asserts precisely that.
 */
function comparatorFor(sortKey: GroupSortKey): (a: Seated, b: Seated) => number {
  switch (sortKey) {
    case "name_asc":
      return (a, b) => cmpName(a, b) || byManualOrder(a, b);
    case "name_desc":
      return (a, b) => -cmpName(a, b) || byManualOrder(a, b);
    case "value_desc":
      return byValueDesc;
    case "attention":
      // Descending: 3 (error) first. Stable within a rank, so switching to this
      // view moves as few tiles as it possibly can.
      return (a, b) => b.tile.attention - a.tile.attention || byManualOrder(a, b);
    default:
      return byManualOrder;
  }
}

/**
 * The locale is NAMED, not left to the runtime.
 *
 * `check:ui`'s unpinned-locale rule only matches `.toLocale*String()`, so this
 * call slips past the gate while carrying the identical failure: a server
 * rendering under one default and a browser under another disagree about order,
 * and the board reshuffles on hydration. `numeric` is what puts "Week 2" before
 * "Week 10" instead of after it.
 */
const cmpName = (a: Seated, b: Seated) =>
  a.tile.title.localeCompare(b.tile.title, "en", { numeric: true, sensitivity: "base" });

export function arrangeBoard(
  tiles: BoardTile[],
  groups: BoardGroup[],
  placements: TilePlacement[],
): BoardArrangement {
  // ZERO GROUPS IS TODAY'S DASHBOARD, and it is a whole branch rather than a
  // board that happens to have one lane — the grid is a different layout, not a
  // degenerate case of this one.
  if (groups.length === 0) return { mode: "grid", tiles };

  const byId = new Map(groups.map((g) => [g.id, g]));
  const placed = new Map(placements.map((p) => [p.tileKey, p]));
  const lanes = new Map<string | null, Seated[]>([[null, []]]);
  for (const g of groups) lanes.set(g.id, []);

  tiles.forEach((tile, fallback) => {
    const p = placed.get(tile.key);
    /**
     * A PLACEMENT INTO A GROUP THAT NO LONGER EXISTS FALLS BACK TO UNGROUPED
     * rather than vanishing. The FK's ON DELETE SET NULL normally gets there
     * first; this is what covers the row that slipped past it.
     */
    const laneId = p && p.groupId != null && byId.has(p.groupId) ? p.groupId : null;
    // Its `pos` only means something in the lane it was written for. A tile
    // whose group was deleted lands in Ungrouped as UNPLACED — at the end —
    // because a key from another lane orders it against numbers it never had
    // anything to do with.
    lanes.get(laneId)!.push({ tile, pos: laneId === (p?.groupId ?? null) ? (p?.pos ?? null) : null, fallback });
  });

  // A PLACEMENT WHOSE TILE NO LONGER EXISTS IS SIMPLY NEVER READ. It is not
  // deleted and it leaves no empty slot: republish the flow with that Output
  // restored and the tile comes back to the column it was in. That memory is
  // the reason `tile_key` carries no foreign key.

  const laneOf = (id: string | null, group: BoardGroup | null): BoardLane => ({
    id,
    group,
    tiles: lanes
      .get(id)!
      .slice()
      .sort(comparatorFor(group?.sortKey ?? "manual"))
      .map((s) => s.tile),
  });

  return {
    mode: "board",
    ungrouped: laneOf(null, null),
    columns: groups
      .slice()
      .sort((a, b) => compareKeys(a.pos, b.pos) || compareKeys(a.id, b.id))
      .map((g) => laneOf(g.id, g)),
  };
}
