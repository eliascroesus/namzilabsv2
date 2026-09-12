import { describe, it, expect } from "vitest";
import { funnelShape } from "@/lib/board/scale";

/**
 * THE RIBBON PATH — A SKIN OVER ARITHMETIC THAT MUST NOT MOVE.
 *
 * The funnel's body was chamfered polygons and is now a smooth ribbon, because
 * the reference design the owner asked for is a smooth ribbon. That swap is
 * cosmetic BY CONSTRUCTION and this file is what holds it to that: `points`
 * remains the arithmetic of record, and `path` must agree with it at every
 * stage edge.
 *
 * A curve is exactly the kind of thing that gets "improved" by eye — eased
 * flatter here, given a minimum thickness there — and every one of those
 * improvements is a claim about a drop-off that a polygon was unable to make.
 * The reference itself draws an 11412 → 2952 fall as a gentle taper. Matching
 * that silhouette was considered and refused; here the refusal is enforced
 * rather than remembered.
 *
 * ASSERTED NUMERICALLY, NOT AS SUBSTRINGS. `round10` kills float noise at the
 * tenth decimal rather than rounding to one, so real widths are values like
 * 25.8675078854 — and a test spelling those out as strings would be unreadable,
 * brittle, and would pass just as happily against a shape that had drifted a
 * whole percent. Parsing the path and asserting the RELATIONSHIPS is what makes
 * these fail for the right reason.
 */

/** Every coordinate pair in a path command string, in order. */
function coords(path: string): Array<[number, number]> {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

/**
 * The path is built in (measured, along) space and transposed on the way out, so
 * a test that wants "how wide is the body here" has to un-transpose it. Down:
 * width is x. Across: width is y.
 */
const measured = (p: [number, number], flow: "down" | "across") => (flow === "down" ? p[0] : p[1]);
const along = (p: [number, number], flow: "down" | "across") => (flow === "down" ? p[1] : p[0]);

/**
 * Index map for one band's path: M, L, L, then the right-hand cubic (two
 * controls + endpoint), L across the floor, then the left-hand cubic back up.
 */
const TOP_LEFT = 0;
const TOP_RIGHT = 1;
const SHOULDER_RIGHT = 2;
const R_CTRL_1 = 3;
const R_CTRL_2 = 4;
const FLOOR_RIGHT = 5;
const FLOOR_LEFT = 6;

describe("funnelShape — the ribbon path, which is the mark people actually see", () => {
  it("leaves and re-enters each stage flat, so the body has no kink at the shoulder", () => {
    /**
     * A cubic whose control points each share their own endpoint's MEASURED
     * coordinate is a sigmoid: it leaves the shoulder parallel to the stage's
     * edge and meets the next stage parallel to that one. Controls anywhere else
     * put a corner in the body, which is precisely the chamfer this replaced.
     */
    const [first] = funnelShape([100, 50], { align: "left" });
    const c = coords(first.path);
    expect(measured(c[R_CTRL_1], "down"), "first control holds the shoulder's width").toBe(
      measured(c[SHOULDER_RIGHT], "down"),
    );
    expect(measured(c[R_CTRL_2], "down"), "second control holds the landing width").toBe(
      measured(c[FLOOR_RIGHT], "down"),
    );
  });

  it("puts the curve's waist exactly halfway down the gap", () => {
    /**
     * Both controls sit on one line, so the body gives up half its width in each
     * half of the transition. Moving that line is the one tuning available to
     * somebody adjusting the shape by eye, and it would slide the apparent drop
     * toward whichever stage the waist moved away from.
     */
    const [first] = funnelShape([100, 50], { align: "left" });
    const c = coords(first.path);
    const shoulder = along(c[SHOULDER_RIGHT], "down");
    const floor = along(c[FLOOR_RIGHT], "down");
    expect(along(c[R_CTRL_1], "down")).toBeCloseTo((shoulder + floor) / 2, 6);
    expect(along(c[R_CTRL_2], "down")).toBeCloseTo((shoulder + floor) / 2, 6);
  });

  it("publishes that waist, so a label can sit on the drop rather than under it", () => {
    /**
     * The conversion pill is placed at `waist`. The band BOUNDARY is where the
     * taper finishes, so a pill placed there hangs below the narrowing it
     * describes and reads as belonging to the stage after it. The two are
     * genuinely different coordinates, and this pins the gap between them: for a
     * 2-stage funnel the boundary is 50 and the waist is 38.75.
     */
    const [first] = funnelShape([100, 50], { align: "left" });
    const c = coords(first.path);
    expect(first.waist).toBeCloseTo(along(c[R_CTRL_1], "down"), 6);
    expect(first.waist).not.toBe(first.y1);
    expect(first.waist).toBeGreaterThan(first.y0);
    expect(first.waist).toBeLessThan(first.y1);
  });

  it("lands the curve on the next stage's true width, not a flattering one", () => {
    /**
     * THE TEST THAT EARNS ITS KEEP — the owner's own reference numbers, whose
     * whole point is that 11412 → 2952 is a cliff. The floor of stage 1 is stage
     * 2's width and nothing else, however gentle a taper would look beside it.
     */
    const [first, second] = funnelShape([11412, 2952], { align: "center" });
    const c = coords(first.path);
    const floorWidth = measured(c[FLOOR_RIGHT], "down") - measured(c[FLOOR_LEFT], "down");

    expect(second.width, "2952 of 11412 is about a quarter").toBeCloseTo(25.87, 1);
    expect(floorWidth, "the ribbon's floor IS the next stage's width").toBeCloseTo(second.width, 6);
    // And the top is genuinely full width, so the fall is drawn at its real size.
    const topWidth = measured(c[TOP_RIGHT], "down") - measured(c[TOP_LEFT], "down");
    expect(topWidth - floorWidth, "roughly three quarters of the body is gone").toBeCloseTo(74.13, 1);
  });

  it("steps a rising stage instead of bulging the body outward", () => {
    /**
     * `points` already refuses to flare — a rising band's floor is its OWN width,
     * and the stage after it simply starts wider. The path has to inherit that
     * refusal rather than reintroduce the flare as a curve, which is the more
     * tempting spelling because a bulge looks organic.
     */
    const [a, b] = funnelShape([10, 40], { align: "left" });
    const c = coords(a.path);
    expect(b.width, "the second stage is the wider one").toBe(100);
    expect(
      measured(c[FLOOR_RIGHT], "down"),
      "the rising band ends at its own width, not its successor's",
    ).toBe(measured(c[SHOULDER_RIGHT], "down"));
  });

  it("transposes the whole path for a funnel running across", () => {
    // The same body measured on the other axis — the `down` proof, x and y swapped.
    const [down] = funnelShape([100, 50], { align: "left" });
    const [across] = funnelShape([100, 50], { align: "left", flow: "across" });
    const dc = coords(down.path);
    const ac = coords(across.path);
    expect(ac).toHaveLength(dc.length);
    expect(measured(ac[FLOOR_RIGHT], "across")).toBe(measured(dc[FLOOR_RIGHT], "down"));
    expect(along(ac[FLOOR_RIGHT], "across")).toBe(along(dc[FLOOR_RIGHT], "down"));
  });

  it("gives a zero stage no path at all, so the caller draws its own mark", () => {
    /**
     * A degenerate shape is invisible but still FILLS, and a stage with nothing
     * in it that paints a hairline of accent reads as "a few" rather than "none".
     * `FunnelBody` draws a dashed rule on the band's own axis instead, and it can
     * only choose to do that if the band says outright it has no body.
     */
    const bands = funnelShape([10, 0], { align: "center" });
    expect(bands[1].width).toBe(0);
    expect(bands[1].path).toBe("");
    expect(bands[0].path, "the stage above it still tapers to that point").not.toBe("");
  });

  it("still answers the polygon every existing caller reads", () => {
    /**
     * `path` is ADDITIVE. The hit targets, the geometry check and the older
     * assertions all read `points`, `y0`, `y1` and `width`; a refactor that
     * quietly dropped them would take the funnel's hover and its zero-stage mark
     * with it, and no visual check would notice.
     */
    const [first] = funnelShape([100, 50], { align: "left" });
    expect(first.points.startsWith("0,0 100,0")).toBe(true);
    expect(first.path.startsWith("M ")).toBe(true);
  });
});
