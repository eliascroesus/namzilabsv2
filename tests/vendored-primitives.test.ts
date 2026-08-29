import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WHAT A VENDORED COMPONENT MUST GIVE UP AT THE DOOR.
 *
 * shadcn components are copied into this repo rather than installed, which is
 * the whole appeal — they are ours to edit. It is also the whole hazard: they
 * arrive carrying another design system's opinions, and `shadcn add --overwrite`
 * will cheerfully put every one of them back. That has already happened once in
 * this migration: a batch re-add silently reverted a fixed Button variant.
 *
 * So the rules that a re-add would undo are asserted here rather than trusted
 * to survive. `scripts/check-ui.ts` catches off-kit radii, shadows and type
 * sizes across the whole tree; these are the three things it cannot see.
 */
const UI = join(__dirname, "..", "src/components/ui");
const read = (f: string) => readFileSync(join(UI, f), "utf8");
const files = readdirSync(UI).filter((f) => f.endsWith(".tsx"));

/** The kit's own primitives, which were never vendored and keep their own rules. */
const OURS = new Set([
  "badge.tsx",
  "button.tsx",
  "card.tsx",
  "chip.tsx",
  "empty-state.tsx",
  "field.tsx",
  "input.tsx",
  "legal.tsx",
  "modal.tsx",
  "page.tsx",
  "skeleton.tsx",
  "submit-button.tsx",
  "switch.tsx",
  "table.tsx",
  "toast.tsx",
]);
const vendored = files.filter((f) => !OURS.has(f));

describe("the vendored primitives speak this kit's vocabulary", () => {
  it("finds them (a filter matching nothing would pass everything)", () => {
    expect(vendored.length).toBeGreaterThanOrEqual(15);
  });

  for (const f of vendored) {
    /**
     * FOCUS IS DECLARED ONCE, IN globals.css — a zero-specificity
     * `:where(a, button, summary, …):focus-visible` outline that covers every
     * control in the product. shadcn ships each component with a ring of its
     * own, and `outline-none` on top of it, which switches the shared rule OFF
     * for that element. This app has been here before: 122 hand-written copies
     * of one idea at four different alphas, and four controls with no focus
     * state at all.
     */
    it(`${f} does not re-spell the focus ring`, () => {
      const src = read(f);
      expect(src, "carries its own ring").not.toMatch(/focus(-visible)?:ring-/);
      expect(src, "resets the outline the shared rule needs").not.toMatch(/\boutline-(none|hidden)\b/);
    });

    /**
     * ONE SCRIM. The kit's is warm ink at 40% with a blur; shadcn's is pure
     * black at 50%. Two scrims in one product is how a dialog opened from the
     * builder comes to look like a different dialog from one opened on the
     * board.
     */
    it(`${f} uses the kit's scrim, not a black one`, () => {
      expect(read(f)).not.toMatch(/bg-black\//);
    });
  }
});

/**
 * THE BUTTON STAYS SERVER-RENDERABLE.
 *
 * It holds no state and calls no hooks on purpose, because half the app's
 * buttons live in server components posting to server actions. Adding
 * `asChild` meant importing Radix's Slot — and `import { Slot } from
 * "radix-ui"` would have pulled the barrel, which re-exports Dialog,
 * DropdownMenu and every other `"use client"` primitive through one entry
 * point, dragging all of Radix into the server graph behind the most-imported
 * component in the app. The leaf package carries no directive.
 */
describe("the Button is still safe to render on the server", () => {
  /**
   * Comments stripped, and not as a nicety: the import above is explained by a
   * note that quotes the very barrel import it warns against, so an unstripped
   * scan reads the warning as the offence. Every source pin in this repo that
   * looks for a string has to do this — prose about a rule is not the rule.
   */
  const src = read("button.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("declares no client directive", () => {
    const first = src
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    expect(first).not.toMatch(/^["']use client["']/);
  });

  it("imports Slot from the leaf package, never the radix-ui barrel", () => {
    expect(src).toMatch(/from "@radix-ui\/react-slot"/);
    expect(src).not.toMatch(/from "radix-ui"/);
  });
});

/**
 * WHITE INK NEEDS A FILL UNDERNEATH IT.
 *
 * `WorkspaceChip` drew its initials in `text-white` because it sat on a
 * saturated hue derived from the workspace name. When those six coloured rail
 * chips were removed, the fill went and the ink stayed — white-on-white at all
 * five call sites, in the light theme only. The letters were still in the DOM
 * and still announced, so nothing failed; dark mode rendered them perfectly,
 * which is precisely why it survived a review.
 *
 * That is the shape of the bug worth pinning: an ink chosen FOR a background
 * outliving the background. Checked on the one component it actually bit,
 * rather than as a repo-wide rule — a parent can legitimately supply the fill,
 * so a general scan would be mostly false positives and would be muted within
 * a week.
 */
describe("the workspace chip carries its own fill", () => {
  const src = readFileSync(join(__dirname, "..", "src/components/sidebar.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const chip = src.match(/export function WorkspaceChip[\s\S]*?\n\}/)?.[0] ?? "";

  it("finds the component (a parse matching nothing would pass everything)", () => {
    expect(chip).toMatch(/rounded-control/);
  });

  it("names a background, so its ink has something to sit on", () => {
    expect(chip, "WorkspaceChip sets an ink with no fill — invisible on a light sidebar").toMatch(/\bbg-[a-z]/);
  });

  it("takes its ink from a role, not from a literal white", () => {
    // `text-white` is only correct on a fill that is guaranteed dark in BOTH
    // themes. `text-background` inverts with the theme; the literal does not.
    expect(chip).not.toMatch(/\btext-white\b/);
  });

  /**
   * THE SAME BUG, A SECOND TIME, TWENTY LINES AWAY.
   *
   * The active destination's icon chip was `bg-background/15 text-background` —
   * a VEIL of the row's own ink, which is a sound idea while the active row is
   * a solid violet fill. That fill became `bg-muted`, and a 15% wash of the
   * page colour over the page colour is the page colour: the glyph measured
   * 1.41:1 in light and 1.14:1 in dark, against the 3:1 non-text needs.
   *
   * Both bugs are one shape — an ink specified FOR a fill, outliving it — and
   * both were invisible to every existing gate because the markup never
   * changed. So the rule is spelled as the thing that actually went wrong: the
   * ACTIVE branch may not paint its fill from a translucent role.
   */
  it("gives the active row's icon chip an opaque fill", () => {
    const nav = src.match(/active \?[^,]+,/)?.[0] ?? "";
    expect(nav, "the active/inactive chip ternary moved").toMatch(/active \?/);
    expect(
      nav,
      "a translucent wash of a role over a row painted in a near-identical role is invisible",
    ).not.toMatch(/bg-(background|foreground|muted|card)\/\d+/);
  });
});
