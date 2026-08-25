import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROW_PITCH } from "@/components/flow/graph-utils";

/**
 * THE DRAG'S FEEDBACK RULES, PINNED WHERE THEY ARE ARITHMETIC.
 *
 * Three separate complaints about the same interaction, each traceable to one
 * number or one boolean:
 *
 *  - "the hitboxes are too big" — `DROP_REACH` (260) was wider than the gap
 *    between slots (`ROW_PITCH`, 232), so every point on the canvas was inside
 *    some slot's radius and the placeholder never went away.
 *  - "keep showing the + until the placeholder shows up" — every `+` hid for
 *    the whole drag, taking away the map of where a step may go at the moment
 *    it was being read.
 *  - "the end placeholder should have the same spacing as a middle one" — the
 *    tail slot was measured off the terminal button instead of off the gap
 *    every other slot uses.
 *
 * Text assertions against source, for the reason `chrome-band.test.ts` gives:
 * these are two files agreeing about one measurement, which rendering either
 * one cannot catch.
 */
const root = join(__dirname, "..");
const canvas = readFileSync(join(root, "src/components/flow/flow-canvas.tsx"), "utf8");
const card = readFileSync(join(root, "src/components/flow/FlowNodeCard.tsx"), "utf8");
const insertEdge = readFileSync(join(root, "src/components/flow/InsertEdge.tsx"), "utf8");

/** A numeric `const NAME = <number>;` read out of the canvas source. */
function constant(name: string): number {
  const m = canvas.match(new RegExp(`const ${name} = (\\d+);`));
  expect(m, `${name} is not a plain numeric constant in flow-canvas.tsx`).not.toBeNull();
  return Number(m![1]);
}

describe("the end-of-line drop slot", () => {
  it("sits exactly where a mid-line slot sits", () => {
    /**
     * A slot between two cards lands at the midpoint of the gap between them —
     * `(cardTop + CARD_H + childTop) / 2`, where `childTop - cardTop` is
     * ROW_PITCH. A line's end has no child to measure against, so it borrows
     * the same arithmetic instead of inventing a number.
     *
     * Spelled as the sum, not as the answer: `= 159` would be a magic number
     * that survives every change to the pitch it is derived from.
     */
    expect(canvas).toMatch(/const TAIL_SLOT_Y = \(CARD_H \+ ROW_PITCH\) \/ 2;/);
    expect(canvas).toMatch(/childTop == null \? top \+ TAIL_SLOT_Y : \(top \+ CARD_H \+ childTop\) \/ 2/);
  });

  it("is the same distance from its card as a mid-line one, in numbers", () => {
    // The property the eye actually checks, computed rather than asserted by
    // spelling: a card and its child are ROW_PITCH apart, so a gap's midpoint
    // is this far below the upper card's top.
    const CARD_H = constant("CARD_H");
    const midLineOffset = (CARD_H + ROW_PITCH) / 2;
    const tailOffset = (CARD_H + ROW_PITCH) / 2;
    expect(tailOffset).toBe(midLineOffset);
    // And it is NOT the terminal button's own centre, which is where this sat
    // when it was reported as inconsistent — 13px short of a real gap.
    expect(tailOffset).not.toBe(CARD_H + 32 + 28);
  });

  it("takes the terminal button's place rather than sitting beside it", () => {
    // Two dashed cards in one position reads as a rendering fault. The button
    // hides for exactly the slot that covers it.
    expect(canvas).toMatch(/hideTailAdd: dropSlot\?\.after === n\.id && !dropSlot\.handle/);
    expect(card).toMatch(/!data\.hideTailAdd/);
  });
});

describe("the drop hitbox", () => {
  it("leaves a real dead band between vertically adjacent slots", () => {
    /**
     * The complaint was that the placeholder showed when the cursor was
     * nowhere near a position. With rows ROW_PITCH apart, two adjacent slots'
     * radii must not meet — otherwise every point on the canvas belongs to
     * some slot and the feedback stops carrying information.
     */
    const reach = constant("DROP_REACH");
    expect(reach * 2, `DROP_REACH ${reach} still spans the ${ROW_PITCH}px row pitch`).toBeLessThan(ROW_PITCH);
  });

  it("still reaches far enough to land a card without precision", () => {
    // The other half: too small and the drag becomes a game. Comfortably more
    // than a third of the gap.
    expect(constant("DROP_REACH")).toBeGreaterThan(ROW_PITCH / 3);
  });
});

describe("the + markers during a drag", () => {
  it("stay up, and only the covered one stands down", () => {
    /**
     * They are the map of where a step may go. Hiding all of them for the
     * length of the drag — which is what `carrying: dragging != null` did —
     * removed that map at exactly the moment somebody was reading it.
     */
    expect(canvas).toMatch(/const covered =\s*\n?\s*dropSlot != null && dropSlot\.after === e\.source/);
    expect(canvas).not.toMatch(/carrying: dragging != null/);
    expect(insertEdge).toMatch(/\{ covered\?: boolean \}/);
  });
});
