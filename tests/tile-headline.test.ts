import { describe, it, expect } from "vitest";
import { buildTile } from "@/lib/flow/engine";
import type { FlowRecord } from "@/lib/flow/records";
import type { TileSpec } from "@/lib/flow/types";

/**
 * A TILE'S HEADLINE MUST BE THE METRIC, NOT THE SUM OF ITS BARS.
 *
 * `buildTile` set `tile.value` to `sum(series)` / `sum(groups)` whatever
 * aggregation produced those values. That is right for a sum or a count and
 * wrong for everything else: an "average deal size by month" over twelve months
 * of ~$4,500 rendered **$54,000** as its primary figure — a number that exists
 * nowhere in the source, is 12x the answer, and sits above bars that are each
 * correct, so it reads as validated rather than suspect.
 *
 * It cannot be repaired inside `buildTile`, which receives only the bucketed
 * values. The aggregate over the WHOLE record set is computed where the records
 * are — in `aggregate()` — and carried on the shape as `total`. For sum and
 * count that equals the old sum-of-buckets, so those tiles do not move.
 *
 * Averaging the bucket averages would also be wrong, and differently: it weights
 * a month with three deals the same as one with three hundred.
 */

const spec = {
  name: "t",
  viz: "bar" as const,
  format: "number" as const,
  precision: 2,
  target: null,
};

const tile = (shape: Parameters<typeof buildTile>[1]): TileSpec => buildTile(spec, shape, [] as FlowRecord[]);

describe("the headline of a split metric", () => {
  it("uses the aggregate over the whole set, not the sum of the buckets", () => {
    const t = tile({
      kind: "series",
      series: [
        { bucket: "2026-01", value: 4500 },
        { bucket: "2026-02", value: 4500 },
        { bucket: "2026-03", value: 4500 },
      ],
      total: 4500,
    });
    expect(t.value).toBe(4500);
    expect(t.series).toHaveLength(3);
  });

  it("does the same for a grouped breakdown", () => {
    const t = tile({
      kind: "grouped",
      groups: [
        { label: "google", value: 10 },
        { label: "direct", value: 20 },
      ],
      total: 15,
    });
    expect(t.value).toBe(15);
  });

  /**
   * The counterweight. A sum or a count still sums, because for those the
   * whole-set aggregate IS the sum of the buckets — so no existing tile changes.
   */
  it("still sums when summing is what the aggregation means", () => {
    const t = tile({
      kind: "series",
      series: [
        { bucket: "2026-01", value: 10 },
        { bucket: "2026-02", value: 20 },
      ],
      total: 30,
    });
    expect(t.value).toBe(30);
  });

  /**
   * A shape built before `total` existed, or by any path that does not compute
   * one, keeps the old behaviour rather than rendering undefined.
   */
  it("falls back to the sum when no total was carried", () => {
    const t = tile({
      kind: "series",
      series: [
        { bucket: "2026-01", value: 10 },
        { bucket: "2026-02", value: 20 },
      ],
    });
    expect(t.value).toBe(30);
  });
});
