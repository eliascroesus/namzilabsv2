import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROW_PITCH } from "@/components/flow/graph-utils";

/**
 * TWO RULES ABOUT DRAGGING A STEP, PINNED WHERE EACH ONE LIVES.
 *
 *  - "it doesn't make sense to be able to drag the Split node and paths" — a
 *    fork is the shape of the line rather than a place in it, so the whole
 *    group holds still and every other card behaves exactly as before.
 *  - "the end placeholder should have the same spacing as a middle one" — the
 *    tail slot was measured off the card gap instead of off the row pitch every
 *    other slot uses, so it opened 1px INSIDE the card it followed and left the
 *    terminal "Add next step" lit underneath it.
 *
 * Text assertions against source, for the reason `chrome-band.test.ts` gives:
 * these are separate files agreeing about one measurement or one flag, which
 * rendering either file on its own cannot catch.
 */
const root = join(__dirname, "..");
const canvas = readFileSync(join(root, "src/components/flow/flow-canvas.tsx"), "utf8");
const card = readFileSync(join(root, "src/components/flow/FlowNodeCard.tsx"), "utf8");
const slot = readFileSync(join(root, "src/components/flow/drop-slot.tsx"), "utf8");

/** A numeric `const NAME = <number>;` read out of the canvas source. */
function constant(name: string): number {
  const m = canvas.match(new RegExp(`const ${name} = (\\d+);`));
  expect(m, `${name} is not a plain numeric constant in flow-canvas.tsx`).not.toBeNull();
  return Number(m![1]);
}

/** The placeholder's own height, from the class that actually sets it. */
function slotHeight(): number {
  const m = slot.match(/h-\[(\d+)px\]/);
  expect(m, "DropSlotNode no longer sets an explicit pixel height").not.toBeNull();
  return Number(m![1]);
}

describe("what a user may pick up", () => {
  it("locks a Split and every Path card it owns, and only by that rule", () => {
    /**
     * The set is the hub PLUS the direct target of each of its branch handles,
     * which is the auto-created "Path A" / "Path B" conditions step. Built from
     * the handles rather than from a node type, because "is a branch head" is a
     * fact about wiring — a Filter dropped as a branch's first step would be
     * one, and a conditions step sitting anywhere else would not.
     */
    expect(canvas).toMatch(/const splitGroupIds = useMemo\(/);
    expect(canvas).toMatch(/const hubs = new Set\(nodes\.filter\(\(n\) => n\.type === "paths"\)\.map\(\(n\) => n\.id\)\);/);
    expect(canvas).toMatch(/if \(e\.sourceHandle && hubs\.has\(e\.source\)\) locked\.add\(e\.target\);/);
  });

  it("leaves every other card draggable — one rule, stated once", () => {
    /**
     * "But all the other nodes let them work exactly as per usual." A second
     * `draggable:` anywhere in this file would be a second answer to the same
     * question, and the two would drift.
     */
    const all = canvas.match(/^\s*draggable:.*$/gm) ?? [];
    expect(all, "more than one thing decides whether a card drags").toHaveLength(1);
    expect(all[0]).toMatch(/draggable: !splitGroupIds\.has\(n\.id\),/);
  });

  it("keeps the wall behind the lock rather than only the lock", () => {
    // A hub cannot be picked up, so `moveWiring` can no longer be handed one by
    // a drag — but it is still given `nodes`, which is what makes it refuse.
    expect(canvas).toMatch(/moveWiring\(node\.id, \{ after: target\.after, handle: target\.handle, root: target\.root \}, edges, nodes\)/);
  });
});

describe("the end-of-line drop slot", () => {
  it("borrows the mid-line gap's arithmetic instead of inventing a number", () => {
    /**
     * A slot between two cards lands at the midpoint of the gap between them —
     * `(cardTop + CARD_H + childTop) / 2`, where `childTop - cardTop` is
     * ROW_PITCH. A line's end has no child to measure against, so it reuses the
     * same expression.
     *
     * Spelled as the sum, not as the answer: `= 159` would be a magic number
     * that survives every future change to the pitch it is derived from.
     */
    expect(canvas).toMatch(/const TAIL_SLOT_Y = \(CARD_H \+ ROW_PITCH\) \/ 2;/);
    expect(canvas).toMatch(/childTop == null \? top \+ TAIL_SLOT_Y : \(top \+ CARD_H \+ childTop\) \/ 2/);
  });

  it("clears the last card by the same margin a mid-line slot clears its own", () => {
    const CARD_H = constant("CARD_H");
    const SLOT_H = slotHeight();
    // The placeholder is centred on the slot's point (`translateY(-50%)`), so
    // its top edge is half its height above it.
    const clearance = (CARD_H + ROW_PITCH) / 2 - SLOT_H / 2 - CARD_H;
    expect(clearance, "the placeholder opens INSIDE the card it follows").toBeGreaterThan(0);

    // Half a card gap below the card is what was reported: at 128 the
    // placeholder's top edge sat 1px above the card's bottom, so the gap opened
    // inside the card and the terminal button stayed lit across the same band.
    expect(86 + 84 / 2 - SLOT_H / 2 - CARD_H).toBeLessThan(0);

    // Nor is it the terminal button's own centre — 13px short of a real gap,
    // which is close enough to read as a mistake rather than a decision.
    expect((CARD_H + ROW_PITCH) / 2).not.toBe(CARD_H + 32 + 28);
  });

  it("takes the terminal button's place rather than sitting beside it", () => {
    // Two dashed cards in one position reads as a rendering fault. The button
    // hides for exactly the slot that covers it — a tail slot is the only one
    // that can name a terminal step, and a branch slot carries a `handle`.
    expect(canvas).toMatch(/hideTailAdd: dropSlot != null && dropSlot\.after === n\.id && !dropSlot\.handle/);
    expect(card).toMatch(/!data\.hideTailAdd/);
  });
});
