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

  it("offers no slot between a Split and a Path card", () => {
    /**
     * "Nodes are able to be placed in between the split and path nodes, which
     * should absolutely not be possible — there is no + there."
     *
     * That is the whole argument. A branch edge gets no insert affordance, so a
     * hub advertising a drop target in that gap was offering a position nothing
     * on the canvas said existed — and taking it pushed the auto-created "Path
     * A" card into second place, which is the one thing a card named Path A
     * promises not to be. Steps join a branch by landing UNDER its Path card.
     *
     * The hub branch of the loop must therefore push nothing at all.
     */
    const hubBranch = canvas.match(/if \(n\.type === "paths"\) \{([\s\S]*?)\n {6}\} else \{/);
    expect(hubBranch, "the hub's arm of the dropSlots loop has moved").not.toBeNull();
    expect(hubBranch![1], "a hub is contributing a drop slot again").not.toMatch(/out\.push/);
    // And the affordance it would have shadowed is still withheld.
    expect(canvas).toMatch(/onInsert: e\.sourceHandle \? undefined : insertOnEdge/);
  });

  it("keeps the wall behind the lock rather than only the lock", () => {
    // A hub cannot be picked up, so `moveWiring` can no longer be handed one by
    // a drag — but it is still given `nodes`, which is what makes it refuse.
    expect(canvas).toMatch(/moveWiring\(node\.id, \{ after: target\.after, handle: target\.handle, root: target\.root \}, edges, nodes\)/);
  });
});

describe("the end-of-line drop slot", () => {
  it("is measured off THIS card's bottom, not off a constant card height", () => {
    /**
     * The bug behind "the spacing on placeholder end node should be bigger".
     * Cards are not one size — the publish footer ("On your dashboard") adds a
     * whole strip — so a slot placed at a fixed offset from the card's TOP
     * leaves a plain card 30px of air and a footered one about 9px. Same drop,
     * two spacings.
     *
     * React Flow measures what it renders, so the card can simply be asked.
     */
    expect(canvas).toMatch(/const h = n\.measured\?\.height \?\? CARD_H;/);
    expect(canvas).toMatch(/childTop == null \? top \+ height \+ SLOT_CLEARANCE \+ SLOT_H \/ 2 : \(top \+ height \+ childTop\) \/ 2/);
    // `CARD_H` may no longer stand in for a real card anywhere a gap is placed.
    expect(canvas).not.toMatch(/gapY\(p\.y, CARD_H/);
    expect(canvas).not.toMatch(/\(top \+ CARD_H \+ childTop\) \/ 2/);
  });

  it("leaves the same clear space a mid-line slot leaves, by construction", () => {
    /**
     * Spelled as the leftover room in a row rather than as `30`: two cards sit
     * ROW_PITCH apart, the card takes CARD_H of that and the placeholder
     * SLOT_H, and what is left splits above and below. A magic 30 would survive
     * every future change to the pitch it is derived from.
     */
    expect(canvas).toMatch(/const SLOT_CLEARANCE = \(ROW_PITCH - CARD_H - SLOT_H\) \/ 2;/);

    const CARD_H = constant("CARD_H");
    const SLOT_H = constant("SLOT_H");
    expect(SLOT_H, "SLOT_H no longer matches DropSlotNode's own height").toBe(slotHeight());

    // The property the eye actually checks: a placeholder centred between two
    // plain cards clears each of them by exactly SLOT_CLEARANCE.
    const clearance = (ROW_PITCH - CARD_H - SLOT_H) / 2;
    const midCentre = (CARD_H + ROW_PITCH) / 2;
    expect(midCentre - SLOT_H / 2 - CARD_H).toBe(clearance);
    expect(clearance, "the placeholder opens INSIDE the card it follows").toBeGreaterThan(0);

    // Both earlier end-of-line values, kept as the things this must not become.
    // Half a card gap (128) opened the gap 1px inside the card; the mid-line
    // centre (159) was right for a plain card and ~9px for a footered one.
    const FOOTERED = 119;
    expect(CARD_H + 84 / 2 - SLOT_H / 2 - CARD_H).toBeLessThan(0);
    expect(midCentre - SLOT_H / 2 - FOOTERED).toBeLessThan(clearance);
  });

  it("takes the terminal button's place rather than sitting beside it", () => {
    // Two dashed cards in one position reads as a rendering fault. The button
    // hides for exactly the slot that covers it — a tail slot is the only one
    // that can name a terminal step, and a branch slot carries a `handle`.
    expect(canvas).toMatch(/hideTailAdd: dropSlot != null && dropSlot\.after === n\.id && !dropSlot\.handle/);
    expect(card).toMatch(/!data\.hideTailAdd/);
  });
});
