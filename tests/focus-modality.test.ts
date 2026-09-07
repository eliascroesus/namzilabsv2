import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE POINTER DOES NOT RING — 7 Sep 2026.
 *
 * The owner's report was "remove the blue outline on any hover". The outline is
 * the product's ONE focus ring (globals.css), and it was firing under a pointer
 * for two reasons that have nothing to do with the ring being wrong:
 *
 *   - Radix moves real DOM focus onto a menu row on `pointermove` and back onto
 *     the trigger when the menu closes. Chromium counts a script-driven focus
 *     as not-from-the-mouse, so `:focus-visible` matched every hovered row.
 *   - A clicked control keeps focus until something else takes it, and Chromium
 *     re-tests `:focus-visible` on the next keydown — which lit the rail's
 *     Search field, a control with no handler for focus to leave.
 *
 * The fix is one bit of state (`input-modality.tsx`) and one twin rule. What
 * this file guards is that the two halves stay in step and that the keyboard
 * half is never silenced with them — the ring is the only thing telling a
 * keyboard user where they are, so a regression here is a WCAG 2.4.7 failure
 * that nothing else in the suite would catch.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = read("src/app/globals.css");
const modality = read("src/components/input-modality.tsx");
const layout = read("src/app/layout.tsx");
/** Comments explain the rules and must not be able to satisfy them. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the ring is stamped by the last input device", () => {
  it("mounts the listener once, in the root layout", () => {
    // The one tree every route shares. In the rail it would miss the landing,
    // the legal pages and the builder.
    expect(code(layout)).toContain("<InputModality />");
    expect(code(layout)).toMatch(/import \{ InputModality \} from "@\/components\/input-modality"/);
  });

  it("records both devices, in the capture phase", () => {
    const c = code(modality);
    expect(c, "pointer down means the pointer is driving").toMatch(/dataset\.modality = mode/);
    expect(c).toMatch(/addEventListener\("pointerdown"[\s\S]{0,60}capture: true/);
    // Capture, because several components in this app stop propagation (the
    // canvas, the drag layers, a modal's key trap) and a bubbled listener
    // would leave the attribute stale behind them.
    expect(c).toMatch(/addEventListener\("keydown"[\s\S]{0,60}capture: true/);
    expect(c, "and unbinds them").toMatch(/removeEventListener\("pointerdown"/);
    expect(c).toMatch(/removeEventListener\("keydown"/);
  });

  it("does not call a held modifier 'keyboard'", () => {
    /**
     * Holding ⌘ to open a link in a new tab, or Shift to extend a selection, is
     * part of a POINTER gesture. Flipping on those would light a ring under the
     * cursor — the exact thing the mechanism exists to stop.
     */
    for (const key of ["Meta", "Control", "Alt", "Shift", "CapsLock"]) {
      expect(code(modality), `${key} alone must not count as keyboard navigation`).toContain(`"${key}"`);
    }
  });

  it("silences the outline for the pointer, and only for the pointer", () => {
    const c = code(css);
    expect(c).toMatch(/html\[data-modality="pointer"\]/);
    // No `[data-modality="keyboard"]` rule: the keyboard case is the DEFAULT,
    // which is what makes an unrecorded first interaction behave as it always
    // did rather than as a silenced one.
    expect(c, "the keyboard case is the default, not a second rule").not.toContain('data-modality="keyboard"');
  });

  it("keys the twin on the SAME controls as the ring, character for character", () => {
    /**
     * THE PIN THAT MATTERS MOST. A control that rings must be a control that can
     * stop ringing. Two hand-maintained selector lists would drift on the first
     * edit, and the failure is silent in exactly one direction: a control added
     * to the ring but not to the twin keeps a blue box under the cursor forever,
     * which is the bug this whole mechanism was written to remove.
     */
    const lists = [...code(css).matchAll(/:where\((a, button, summary,[^)]*\[tabindex\]:not\(\[tabindex="-1"\]\))\):focus-visible/g)].map(
      (m) => m[1],
    );
    expect(lists.length, "the ring rule and its pointer twin were both found").toBe(2);
    expect(lists[0]).toBe(lists[1]);
  });

  it("leaves a text field's own halo alone", () => {
    // A field is a place you are IN, not a thing you pressed — it should say so
    // however you got there. `input`/`textarea` are in neither selector, and the
    // halo is a utility-layer ring rather than an outline, so an `outline: none`
    // could not reach it even if they were.
    const lists = [...code(css).matchAll(/:where\((a, button, summary,[^)]*)\):focus-visible/g)].map((m) => m[1]);
    for (const list of lists) {
      expect(list, "a bare input must not be in the ring's selector").not.toMatch(/\binput\b/);
      expect(list).not.toMatch(/\btextarea\b/);
    }
    expect(read("src/components/ui/input.tsx")).toContain("focus-visible:ring-2");
  });

  it("fixes it globally rather than in the menus, which cannot hold the fix", () => {
    /**
     * Two independent blockers, both worth stating: a Tailwind `outline-none` on
     * a menu item loses the cascade outright (the ring rule is UNLAYERED and
     * utilities live in `@layer utilities`), and tests/vendored-primitives.test.ts
     * fails the build on that class inside src/components/ui. This re-asserts the
     * second from the other side, scoped to the three primitives that actually
     * move focus on `pointermove`, so a future "just add outline-none here" is
     * caught by the file that explains why it cannot work.
     *
     * `input.tsx` is deliberately NOT in this list: it is the one control the
     * shared outline exempts on purpose, and its `focus-visible:outline-none`
     * is what lets a field draw border-plus-halo instead. It is in
     * vendored-primitives' own OURS set for the same reason.
     */
    for (const f of ["dropdown-menu.tsx", "select.tsx", "command.tsx"]) {
      expect(read(`src/components/ui/${f}`), `${f} tries to reset the shared outline`).not.toMatch(
        /\boutline-(none|hidden)\b/,
      );
    }
  });
});
