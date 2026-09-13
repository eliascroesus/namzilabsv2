import { describe, expect, it } from "vitest";
import { composeFunnel, composePie, composeRanked, isRefusal, type ComposeMember } from "@/lib/board/compose";
import { PARTS_SLOT } from "@/lib/board/tile-config";

/**
 * RANKED BARS — the composition that claims the least, and the rules that stay
 * anyway.
 *
 * A funnel says these are stages of one journey; a pie says these are parts of
 * one whole. Both are claims, and most of `compose.ts` exists to stop a drawing
 * making one it cannot support. This chart claims nothing beyond "here are these
 * numbers, drawn to one scale" — so the interesting assertions are about which
 * refusals it therefore DROPS, and which it must keep regardless.
 */

const member = (over: Partial<ComposeMember> = {}): ComposeMember => ({
  label: "Total Leads",
  value: 100,
  countable: true,
  additive: true,
  hasPeriods: true,
  timeField: "created_at",
  format: { format: "number" },
  ...over,
});

const refusalOf = (out: { refusal: string } | object) => (isRefusal(out) ? out.refusal : null);

const RANKED = PARTS_SLOT.ranked;
const FUNNEL = PARTS_SLOT.pipeline;
const PIE = PARTS_SLOT.pie;

describe("ranked bars", () => {
  it("takes a DURATION, which a funnel and a pie both refuse", () => {
    /**
     * THE RULE THAT MAKES THIS CHART WORTH HAVING, and the one most likely to be
     * "tidied" back into line with its siblings.
     *
     * `refuseShared` rejects a non-tally member because a funnel divides one
     * stage by the next and a pie divides each slice by the sum — arithmetic
     * ACROSS members, which a length of time cannot take part in. Ranked bars do
     * no arithmetic at all: each bar is one metric at its own length. So "Speed
     * to Lead" per rep is exactly the chart somebody wants, and refusing it would
     * be a rule fired past its reason.
     *
     * The two sibling assertions are the half that makes this capable of
     * failing: without them, deleting the tally rule outright would pass.
     */
    const durations = [
      member({
        label: "Speed to Lead (Felix)",
        value: 106,
        countable: false,
        format: { format: "duration", unit: "seconds" },
      }),
      member({
        label: "Speed to Lead (Rasmus)",
        value: 377,
        countable: false,
        format: { format: "duration", unit: "seconds" },
      }),
    ];
    expect(isRefusal(composeRanked(durations, RANKED)), "durations rank fine").toBe(false);
    expect(refusalOf(composeFunnel(durations, FUNNEL))).toMatch(/length of time/);
    expect(refusalOf(composePie(durations, PIE))).toBeTruthy();
  });

  it("still insists on one unit, because bars share an axis", () => {
    /**
     * The half of `refuseShared` that DOES apply, and nothing about "no
     * arithmetic across members" rescues it: the axis IS the arithmetic. Dollars
     * beside a count draws two scales as one and invites exactly the comparison
     * the chart cannot support.
     */
    const mixed = [
      member({ label: "Revenue", format: { format: "currency", currency: "USD" } }),
      member({ label: "Deals", format: { format: "number" } }),
    ];
    expect(refusalOf(composeRanked(mixed, RANKED))).toMatch(/different units/);
  });

  it("refuses a negative rather than drawing it as nothing", () => {
    /**
     * `BarsHorizontal` runs from a zero baseline rightward and clamps a negative
     * width to 0 — so the metric would sit in the list, in the tooltip and in the
     * screen-reader line while being absent from the drawing. That is the silent
     * kind of wrong, which is why this refuses rather than clamps.
     */
    const out = composeRanked([member({ label: "Net" }), member({ label: "Refunds", value: -40 })], RANKED);
    expect(refusalOf(out)).toContain("Refunds");
    expect(refusalOf(out)).toMatch(/below zero/);
  });

  it("draws every member including the anchor, in the author's stored order", () => {
    /**
     * NO ORDER IMPOSED BY THE COMPOSER. `BarsHorizontal` ranks by value and the
     * tile's own `sort` overrides it — sorting here as well would mean two places
     * deciding one thing, and the setting would appear not to work.
     */
    const out = composeRanked(
      [
        member({ label: "Total", value: 52 }),
        member({ label: "Booked", value: 24 }),
        member({ label: "Organic", value: 41 }),
      ],
      RANKED,
    );
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.groups).toEqual([
      { label: "Total", value: 52 },
      { label: "Booked", value: 24 },
      { label: "Organic", value: 41 },
    ]);
  });

  it("asks for a second metric rather than drawing one lonely bar", () => {
    expect(refusalOf(composeRanked([member({ label: "Total" })], RANKED))).toMatch(/another metric/);
  });

  it("makes no claim about overlap, because it sums nothing", () => {
    /**
     * A pie must disclose that its slices are assumed disjoint and a funnel that
     * its stages are not a cohort — both are claims their arithmetic depends on.
     * Two bars counting the same subject are just two true figures, so there is
     * nothing here to caveat and a borrowed sentence would be noise on the card.
     */
    const out = composeRanked([member({ label: "A" }), member({ label: "B", value: 40 })], RANKED);
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.notes.some((n) => /overlap|cohort/.test(n))).toBe(false);
  });

  it("refuses a member with no number for this period", () => {
    const out = composeRanked([member({ label: "A" }), member({ label: "Booked", value: null })], RANKED);
    expect(refusalOf(out)).toContain("Booked");
  });
});
