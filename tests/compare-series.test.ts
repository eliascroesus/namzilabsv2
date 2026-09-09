import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE COMPARISON SERIES — the second line node 0:5 draws under a chart card,
 * and the thing "vs compared" on a metric card is comparing against.
 *
 * It was the last piece of that frame the product could not draw. The legend
 * slot already took an ARRAY and the card already rendered two entries; what
 * was missing was a second series, and `DESIGN.md` recorded it as unbuilt on
 * the grounds that it "needs a comparison series the product does not have".
 *
 * It turned out to have one. Not stored, but computable for nothing:
 * `calendarDayRanges` measures a bucket per day across whole calendar months so
 * the Calendar view can draw them, `trendKeys` starts from exactly those, and
 * `withTrends` builds the CURRENT series by reading them out of that map. The
 * previous window's buckets are in the same map, already measured by the same
 * run. The comparison is a second read of it.
 *
 * WHY IT IS STORED RATHER THAN DERIVED ON READ, since that is the decision a
 * reader will question: the board's query drops `byDay` in SQL because sixty
 * day entries per tile on a read that runs every twelve seconds is real money
 * on a database that bills by the byte. `byRange` is already selected. A
 * comparison riding in the slot is free to read; one derived from `byDay` would
 * put those sixty entries back on every board render.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the previous window rides in the slot", () => {
  const materialize = read("src/lib/flow/materialize.ts");
  const types = read("src/lib/flow/types.ts");
  const derive = read("src/lib/metrics/derive-range.ts");

  it("is declared where the slot is declared, in both shapes", () => {
    // `RangeSlot` is TileSpec's own; `RangeSlotLike` is the structural twin the
    // derivation rules read. A field on one and not the other compiles and then
    // vanishes on the path that uses the other.
    expect(types).toMatch(/compare\?: Array<\{ bucket: string; value: number \}>;/);
    expect(derive).toMatch(/compare\?: Array<\{ bucket: string; value: number \}>;/);
  });

  it("reads the window shifted back by its own length", () => {
    expect(materialize).toMatch(/const span = r\.end - r\.start;/);
    expect(materialize).toMatch(/bucketWindowsFor\(r\.start - span - 1, r\.start - 1\)/);
  });

  it("measures nothing new — it reads the map the current series is built from", () => {
    // If this ever calls the engine, the cost argument above stops being true.
    const block = materialize.slice(materialize.indexOf("const span = r.end - r.start;"));
    const upToStore = block.slice(0, block.indexOf("slot.compare"));
    expect(upToStore).toMatch(/all\[b\.key\]\?\.value/);
    expect(upToStore).not.toMatch(/await |tileByRange\(|runFlow\(/);
  });

  it("refuses a partial window rather than drawing a fall that is not there", () => {
    // A window missing its far buckets is a SHORT line beside a full one, which
    // reads as a decline. 90d buckets by week and its weeks fall outside the
    // calendar's months, so this is the branch that keeps 90d honest.
    expect(materialize).toMatch(/prev\.length >= 2 && prev\.length === prevWindows\.length/);
  });
});
