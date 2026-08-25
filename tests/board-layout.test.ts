import { describe, it, expect } from "vitest";
import { arrangeBoard } from "@/lib/board/arrange";
import { compareKeys, ORDER_DIGITS } from "@/lib/board/order";
import { tileKeyOfFlow, tileKeyOfMetric, type BoardGroup, type BoardTile, type TilePlacement } from "@/lib/board/types";

/**
 * WHERE EVERY TILE ENDS UP, AND WHY.
 *
 * `arrangeBoard` is where this feature's product rules actually live, and it is
 * deliberately pure so they can be stated here rather than inferred from a
 * rendered board. Two of these tests exist for hazards that have no visible
 * symptom until a customer hits them — a placement pointing at a tile that no
 * longer exists (the republish case), and an auto-sort that quietly destroys the
 * manual order it was supposed to be a view over.
 */

/** A tile with only the fields the arrangement reads. `node` is never inspected. */
function tile(key: string, over: Partial<BoardTile> = {}): BoardTile {
  return {
    key,
    title: key,
    unitKey: "number::",
    value: null,
    attention: 0,
    node: null,
    ...over,
  };
}

const group = (id: string, pos: string, over: Partial<BoardGroup> = {}): BoardGroup => ({
  id,
  name: id,
  color: "grey",
  pos,
  sortKey: "manual",
  ...over,
});

const at = (tileKey: string, groupId: string | null, pos: string): TilePlacement => ({ tileKey, groupId, pos });

/** The tile keys in one lane, which is what every assertion below is about. */
const keysOf = (lane: { tiles: BoardTile[] }) => lane.tiles.map((t) => t.key);

describe("with no groups, the board is the grid it always was", () => {
  it("reports grid mode and keeps the server's order", () => {
    const tiles = [tile("a"), tile("b"), tile("c")];
    const out = arrangeBoard(tiles, [], []);
    expect(out.mode).toBe("grid");
    // Sabotage: return a board with one lane instead. The dashboard would then
    // render a scroller for a workspace that has never asked for one.
    expect(out.mode === "grid" && out.tiles.map((t) => t.key)).toEqual(["a", "b", "c"]);
  });

  it("ignores placements left behind by a group that was deleted", () => {
    // Deleting the last group leaves its placements with a null group_id. They
    // must not resurrect a board.
    const out = arrangeBoard([tile("a")], [], [at("a", null, "i")]);
    expect(out.mode).toBe("grid");
  });
});

describe("lanes", () => {
  it("puts placed tiles in key order, and unplaced ones after them", () => {
    /**
     * The rule that decides where a NEWLY PUBLISHED metric appears. Anything
     * without a placement sorts after everything with one, in the server's
     * default order — so a new tile lands at the end of the ungrouped row and
     * never in the middle of an arrangement somebody built.
     */
    const tiles = [tile("new"), tile("first"), tile("second")];
    const out = arrangeBoard(tiles, [group("g", "i")], [at("second", null, "a"), at("first", null, "b")]);
    expect(out.mode).toBe("board");
    if (out.mode !== "board") return;
    expect(keysOf(out.ungrouped)).toEqual(["second", "first", "new"]);
  });

  it("orders columns by the group key, not by insertion", () => {
    const out = arrangeBoard([], [group("late", "z"), group("early", "b"), group("mid", "m")], []);
    if (out.mode !== "board") throw new Error("expected a board");
    expect(out.columns.map((c) => c.id)).toEqual(["early", "mid", "late"]);
  });

  it("breaks a tie on the tile key, so two users see the same order", () => {
    /**
     * Two people dropping two tiles into the same gap compute the IDENTICAL
     * key — there is deliberately no unique constraint on `pos`, because the
     * alternative is one of them getting an error they cannot act on. This is
     * what makes the collision deterministic rather than arbitrary.
     */
    const out = arrangeBoard([tile("zebra"), tile("apple")], [group("g", "i")], [at("zebra", null, "i"), at("apple", null, "i")]);
    if (out.mode !== "board") throw new Error("expected a board");
    expect(keysOf(out.ungrouped)).toEqual(["apple", "zebra"]);
  });
});

describe("placements are allowed to dangle", () => {
  it("drops a placement whose tile no longer exists, leaving no empty slot", () => {
    /**
     * THE REPUBLISH CASE, and the reason `tile_key` carries no foreign key.
     * `materializeFlow` deletes the flow_results row of an Output that left the
     * published set. The placement survives on purpose — re-add the Output and
     * the tile returns to its column — so the read has to skip it silently.
     *
     * Sabotage: render a slot for it and the customer gets a phantom gap in a
     * column, with nothing on screen explaining what belongs there.
     */
    const g = group("g", "i");
    const out = arrangeBoard([tile("alive")], [g], [at("alive", "g", "b"), at("deleted", "g", "a")]);
    if (out.mode !== "board") throw new Error("expected a board");
    expect(keysOf(out.columns[0])).toEqual(["alive"]);
    expect(out.columns[0].tiles).toHaveLength(1);
  });

  it("returns a tile to Ungrouped when its group is gone, as UNPLACED", () => {
    /**
     * The FK's ON DELETE SET NULL normally gets there first; this covers the row
     * that slipped past it. It lands unplaced rather than keeping its key,
     * because a key written for one lane orders it against numbers in another
     * lane that it never had anything to do with — which is how a tile ends up
     * mysteriously first.
     */
    const out = arrangeBoard(
      [tile("orphan"), tile("settled")],
      [group("g", "i")],
      [at("orphan", "vanished", "a"), at("settled", null, "m")],
    );
    if (out.mode !== "board") throw new Error("expected a board");
    expect(keysOf(out.ungrouped)).toEqual(["settled", "orphan"]);
  });
});

describe("sorting a group", () => {
  const g = (sortKey: BoardGroup["sortKey"]) => group("g", "i", { sortKey });
  const placed = (keys: string[]) => keys.map((k, i) => at(k, "g", ORDER_DIGITS[i + 1]));

  it("name A–Z and Z–A, with numbers read as numbers", () => {
    const tiles = [tile("w10", { title: "Week 10" }), tile("w2", { title: "Week 2" }), tile("a", { title: "Acme" })];
    const asc = arrangeBoard(tiles, [g("name_asc")], placed(["w10", "w2", "a"]));
    if (asc.mode !== "board") throw new Error("expected a board");
    // "Week 2" before "Week 10" is `numeric: true`. Without it this is the
    // string comparison that puts 10 before 2 and looks like a bug in the sort.
    expect(keysOf(asc.columns[0])).toEqual(["a", "w2", "w10"]);

    const desc = arrangeBoard(tiles, [g("name_desc")], placed(["w10", "w2", "a"]));
    if (desc.mode !== "board") throw new Error("expected a board");
    expect(keysOf(desc.columns[0])).toEqual(["w10", "w2", "a"]);
  });

  it("value high→low never ranks a percentage against a currency", () => {
    /**
     * $12,400, 3.2% and 47 leads have no shared order. A sort that produces one
     * confident list out of them is a dashboard telling a lie with a straight
     * face, so the lane is partitioned by unit and ranked only within a
     * partition — currency, then counts, then rates.
     */
    const tiles = [
      tile("rate", { unitKey: "percent::", value: 3.2 }),
      tile("count", { unitKey: "number::", value: 47 }),
      tile("money", { unitKey: "currency:USD:", value: 12400 }),
      tile("money2", { unitKey: "currency:USD:", value: 900 }),
    ];
    const out = arrangeBoard(tiles, [g("value_desc")], placed(["rate", "count", "money", "money2"]));
    if (out.mode !== "board") throw new Error("expected a board");
    expect(keysOf(out.columns[0])).toEqual(["money", "money2", "count", "rate"]);
  });

  it("sinks a tile with no number to the bottom, never treats it as zero", () => {
    // An em-dash is not a small number: a metric that could not be computed for
    // this range is outside the ordering, not at the wrong end of it.
    const tiles = [
      tile("none", { unitKey: "number::", value: null }),
      tile("small", { unitKey: "number::", value: 1 }),
      tile("big", { unitKey: "number::", value: 99 }),
    ];
    const out = arrangeBoard(tiles, [g("value_desc")], placed(["none", "small", "big"]));
    if (out.mode !== "board") throw new Error("expected a board");
    expect(keysOf(out.columns[0])).toEqual(["big", "small", "none"]);
  });

  it("ranks attention error > unpublished > stale > fine, stably", () => {
    const tiles = [
      tile("ok1", { attention: 0 }),
      tile("stale", { attention: 1 }),
      tile("err", { attention: 3 }),
      tile("ok2", { attention: 0 }),
      tile("unpub", { attention: 2 }),
    ];
    const out = arrangeBoard(tiles, [g("attention")], placed(["ok1", "stale", "err", "ok2", "unpub"]));
    if (out.mode !== "board") throw new Error("expected a board");
    // ok1 before ok2 is the stability: within one rank the manual order stands,
    // so turning this view on moves as few tiles as it possibly can.
    expect(keysOf(out.columns[0])).toEqual(["err", "unpub", "stale", "ok1", "ok2"]);
  });

  it("RESTORES the manual order exactly when switched back to Manual", () => {
    /**
     * The proof that `pos` is never written by a sort. An auto-sort is a VIEW
     * over the manual order — if it were applied by rewriting keys, turning it
     * off would leave the customer with whatever the sort last decided and no
     * way back to the arrangement they built by hand.
     */
    const tiles = [tile("c", { title: "Cherry", value: 1 }), tile("a", { title: "Apple", value: 9 }), tile("b", { title: "Banana", value: 5 })];
    const placements = placed(["c", "a", "b"]);
    const manualBefore = arrangeBoard(tiles, [g("manual")], placements);
    const sorted = arrangeBoard(tiles, [g("name_asc")], placements);
    const manualAfter = arrangeBoard(tiles, [g("manual")], placements);
    if (manualBefore.mode !== "board" || sorted.mode !== "board" || manualAfter.mode !== "board") throw new Error("board");

    expect(keysOf(manualBefore.columns[0])).toEqual(["c", "a", "b"]);
    expect(keysOf(sorted.columns[0])).toEqual(["a", "b", "c"]);
    expect(keysOf(manualAfter.columns[0])).toEqual(keysOf(manualBefore.columns[0]));
  });
});

describe("the order key comparator", () => {
  it("is byte order, and the alphabet cannot disagree with a locale", () => {
    /**
     * The collation trap, pinned. Under `en_US.UTF-8` 'a' sorts before 'B';
     * under byte order 'B' comes first. The alphabet is digits-then-lowercase
     * precisely so the two can never diverge — widen it to include uppercase
     * and a board's order starts depending on which code path last touched it.
     */
    expect(ORDER_DIGITS).toBe("0123456789abcdefghijklmnopqrstuvwxyz");
    expect(ORDER_DIGITS).not.toMatch(/[A-Z]/);
    expect(compareKeys("a", "b")).toBeLessThan(0);
    expect(compareKeys("b", "a")).toBeGreaterThan(0);
    expect(compareKeys("m", "m")).toBe(0);
    // Every digit of the alphabet is strictly ordered against the next one.
    for (let i = 1; i < ORDER_DIGITS.length; i++) {
      expect(compareKeys(ORDER_DIGITS[i - 1], ORDER_DIGITS[i])).toBeLessThan(0);
    }
  });
});

describe("a tile's key carries the pair that identifies it", () => {
  it("keeps the flow's output node, because one flow can publish several tiles", () => {
    // flow_results is unique on (flow_id, output_node_id), so a flow with two
    // Outputs is two tiles. A key of just the flow id would collapse them into
    // one placement and drag both at once.
    expect(tileKeyOfFlow("f1", "filter_ab12cd")).toBe("flow:f1:filter_ab12cd");
    expect(tileKeyOfFlow("f1", "a")).not.toBe(tileKeyOfFlow("f1", "b"));
    expect(tileKeyOfMetric("m1")).toBe("metric:m1");
  });

  it("is prefixed by the visibility key permissions already speak", () => {
    // src/lib/permissions.ts gates on "flow:<flowId>" / "metric:<metricId>".
    // Placement is per TILE and permission is per FLOW, and this shared prefix
    // is the whole bridge between the two vocabularies.
    expect(tileKeyOfFlow("f1", "n1").startsWith("flow:f1")).toBe(true);
    expect(tileKeyOfMetric("m1").startsWith("metric:m1")).toBe(true);
  });
});
