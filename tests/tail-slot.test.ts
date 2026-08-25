import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE END-OF-LINE DROP SLOT AND THE "Add next step" BUTTON ARE ONE POSITION.
 *
 * A chain's last slot is not an empty gap — there is already a card in it, the
 * terminal "Add next step" button — so the drop placeholder has to land exactly
 * ON that button rather than in the space above it. It did not: the slot sat at
 * `CARD_GAP / 2` below the card, 18px high, so the placeholder overlapped the
 * button and the canvas showed two dashed cards a few pixels apart fighting for
 * one position.
 *
 * The fix is a number in flow-canvas.tsx (`TAIL_SLOT_Y`) that is a MEASUREMENT
 * OF ANOTHER FILE: the button lives in FlowNodeCard.tsx as Tailwind classes,
 * and nothing but this test connects the two. Change the button's margin,
 * padding or glyph and the placeholder silently drifts off it again — with no
 * error anywhere, exactly like the chrome-band measurement this mirrors.
 *
 *     TAIL_SLOT_Y = CARD_H (86) + mt-8 (32) + half the button (28) = 146
 *
 * Text assertions against source, for the reason `chrome-band.test.ts` gives:
 * the failure is two files disagreeing, which rendering either one cannot
 * catch.
 */
const root = join(__dirname, "..");
const canvas = readFileSync(join(root, "src/components/flow/flow-canvas.tsx"), "utf8");
const card = readFileSync(join(root, "src/components/flow/FlowNodeCard.tsx"), "utf8");

/** The terminal button's own class string, isolated from the rest of the file. */
function tailButtonClasses(): string {
  const at = card.indexOf("data-add-btn={id}");
  expect(at, "the terminal Add-next-step button moved or was renamed").toBeGreaterThan(-1);
  const m = card.slice(at).match(/className="([^"]+)"/);
  expect(m, "the terminal button has no className").not.toBeNull();
  return m![1];
}

describe("the tail drop slot", () => {
  it("is built from the button's own measurements, not a round number", () => {
    // Spelled as a sum on purpose: `const TAIL_SLOT_Y = 146` would be a magic
    // number that survives every change to the thing it measures.
    expect(canvas).toMatch(/const TAIL_SLOT_Y = CARD_H \+ 32 \+ 28;/);
    expect(canvas).toMatch(/const CARD_H = 86;/);
  });

  it("matches the margin the button actually renders with", () => {
    // `mt-8` is 2rem — the 32 in the sum above.
    expect(tailButtonClasses()).toMatch(/\bmt-8\b/);
    expect(tailButtonClasses()).toMatch(/\btop-full\b/);
  });

  it("matches the button's own height", () => {
    /**
     * 56px = `p-3` (12) + `h-8` glyph (32) + `p-3` (12), and half of it is the
     * 28 in the sum. The button's text sits on `text-base`, whose line box is
     * shorter than the glyph, so the glyph is what sets the height.
     */
    expect(tailButtonClasses()).toMatch(/\bp-3\b/);
    expect(card.slice(card.indexOf("data-add-btn={id}"))).toMatch(/h-8 w-8/);
  });

  it("takes the button's place rather than sitting beside it", () => {
    // Two dashed cards in one position reads as a rendering fault. The button
    // hides for exactly the slot that covers it.
    expect(canvas).toMatch(/hideTailAdd: dropSlot\?\.after === n\.id && !dropSlot\.handle/);
    expect(card).toMatch(/!data\.hideTailAdd/);
  });

  it("no longer positions that slot from the layout's inter-card gap", () => {
    /**
     * `CARD_GAP / 2` was the old value and the bug — half the layout's gap,
     * which put the slot 18px above the button. Asserted against the
     * DECLARATION rather than the string: the constant is discussed by name in
     * the prose above its replacement, and a test that cannot tell code from a
     * comment fails on its own documentation.
     */
    expect(canvas).not.toMatch(/const CARD_GAP\s*=/);
    expect(canvas).toMatch(/childTop == null \? top \+ TAIL_SLOT_Y/);
  });
});
