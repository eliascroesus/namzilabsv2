import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FOUR NUMBERS THE DESIGN SUPPLIED, PINNED WHERE THEY LIVE.
 *
 * Everything else in this kit is argued: a ratio is measured, a radius is
 * justified against the reference, a spacing follows from a rhythm. These four
 * are not. They arrived as values — "the light blue is 00C0E8", "the background
 * is 1B191A", "all buttons and timeline buttons have 999 radius", "the spacing
 * between the icons in the left navbar is 8px" — and a supplied value has no
 * internal reason a later refactor can rediscover.
 *
 * That is exactly the class of constant that drifts silently. `#00c0e8` looks
 * like a colour somebody chose and could re-choose; `gap-2` looks like a
 * spacing that could round to `gap-1.5` in a tidy-up and nobody would blink.
 * The ratios in globals.css defend themselves — change the ground and the
 * numbers beside it become provably wrong. These do not, so they are defended
 * here.
 *
 * This test says nothing about whether the values are GOOD. It says they are
 * the ones that were asked for, which is the only claim available about a
 * supplied constant.
 *
 * Sabotage-verified: each of the four assertions fails alone when its value is
 * changed at its source.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const css = read("src/app/globals.css");
const button = read("src/components/ui/button.tsx");
const page = read("src/components/ui/page.tsx");
const sidebar = read("src/components/sidebar.tsx");

/** globals.css with every comment removed, so prose cannot answer for a value. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A declaration's value. Comments stripped; first match wins. */
function token(name: string): string | null {
  return bare.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

/**
 * The same, but read from inside `.dark`. Necessary rather than fussy: the two
 * themes declare the SAME role names, `:root` comes first, and several roles
 * legitimately differ between them — `--canvas-bg` is #f5f5f5 on the light page
 * and near-black on the console. An unscoped lookup silently answers with the
 * light value and the assertion then tests the wrong theme.
 */
function darkToken(name: string): string | null {
  const start = bare.indexOf(".dark {");
  const block = bare.slice(start, bare.indexOf("\n}", start));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

describe("the console's supplied constants", () => {
  it("fills with #0070e8", () => {
    // The blue is the FILL step, because it was supplied as the shape of a
    // button — `--primary` reads `brand-600` and nothing else may be the
    // primary. #0070E8, not the Figma's own #007BFF: that value measures
    // 3.98:1 white-on-fill, under the 4.5 a 15px label owes; one step deeper
    // is indistinguishable beside it and clears the bar.
    expect(token("color-brand-600")).toBe("#0070e8");
    expect(token("primary")).toBe("var(--color-brand-600)");
  });

  it("grounds on #0f1011", () => {
    // The page ground under the blue re-theme's three-surface model.
    expect(token("color-neutral-950")).toBe("#0f1011");
  });

  it("keeps the canvas frozen even though the ground moved on without it", () => {
    // The blue re-theme moves the ground to #0F1011. `--canvas-bg` stays
    // #1b191a — the value the builder's canvas was frozen at during the
    // PREVIOUS re-theme — because the canvas is out of scope here (flow
    // builder: tidy and fix, never redesign). The two are allowed to diverge
    // again; this protects the canvas from being "fixed" to match whatever
    // the ground becomes next.
    expect(darkToken("canvas-bg")).toBe("#1b191a");
    expect(token("color-neutral-950")).not.toBe(darkToken("canvas-bg"));
  });

  it("draws every button and the period pill at the control radius — the shape rule's final word", () => {
    // THE 4 SEP 2026 FIGMA IS THE LAST WORD: 8px on every button, chip, input,
    // select, tab and the period switch, no pills anywhere in the kit. The
    // TOKEN itself must still stay a rectangle regardless of what the BASE
    // class spells, so a stray `--radius-control: 9999px` experiment (it
    // happened once) can't silently pill-ify every field, menu row and small
    // panel again.
    expect(button).toMatch(/"inline-flex shrink-0[^"]*\brounded-control\b/);
    expect(button, "the pill must not come back on the base class").not.toMatch(
      /"inline-flex shrink-0[^"]*\brounded-full\b/,
    );
    expect(page).toMatch(/PERIOD_PILL =\s*\n?\s*"[^"]*\brounded-control\b/);
    expect(page, "the period pill must not come back either").not.toMatch(
      /PERIOD_PILL =\s*\n?\s*"[^"]*\brounded-full\b/,
    );
    expect(token("radius-control")).toBe("var(--radius-md)");
    expect(token("radius-md")).toBe("0.5rem");
  });

  it("keeps the period control's groove — only its corners were asked to move, again", () => {
    /**
     * A REGRESSION TEST FOR OVER-REACH, not for a value.
     *
     * The brief was "all buttons and timeline buttons have 999 radius", the
     * FIRST time this control's shape changed. The pass that implemented it
     * also deleted the track's border, its fill and its enclosure, leaving six
     * bare labels on the page — a redesign nobody asked for, delivered under a
     * radius change. This asserts the three properties that were silently
     * dropped, so the next tidy-up of this control — including THIS one, which
     * flips the corners back from a pill to 8px — has to be deliberate about
     * losing them.
     */
    const track = page.match(/PERIOD_TRACK =\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(track, "the groove lost its border").toMatch(/\bborder-border\b/);
    expect(track, "the groove lost its fill").toMatch(/\bbg-control\b/);
    expect(track, "the groove lost its enclosure").toMatch(/\boverflow-hidden\b/);
    // And the part THIS pass changed: the groove is an 8px rectangle now, per
    // the 4 Sep 2026 Figma — not the capsule the previous pass drew.
    expect(track).toMatch(/\brounded-control\b/);
    expect(track, "the pill must not come back").not.toMatch(/\brounded-full\b/);
  });

  it("leaves the month stepper's arrows the same 8px as every other button", () => {
    // A SOURCE PIN, because the offence is an OVERRIDE rather than a default.
    // `calendar-board.tsx`'s two month arrows spelled `rounded-full` on top of
    // `buttonVariants`' base, so flipping the base alone would have left two
    // circles sitting inside an 8px groove — the one place in the product
    // where the old shape could survive this pass unnoticed.
    const calendar = read("src/components/calendar/calendar-board.tsx");
    expect(calendar, "the month arrows must not re-spell a pill").not.toMatch(
      /className="rounded-full text-muted-foreground/,
    );
  });

  it("confirms Select already draws at the control radius — verified, not changed", () => {
    // The spec's Shape bullet names SELECTS alongside buttons, inputs, tabs
    // and nav rows. `select.tsx` was already `rounded-control` on both its
    // trigger and its items and needs no edit; this asserts that rather than
    // leaving "presumably fine" as the plan's answer.
    const select = read("src/components/ui/select.tsx");
    expect(select).toMatch(/rounded-control border border-input bg-control/);
    expect(select, "the trigger must not go back to a pill").not.toMatch(/rounded-full/);
  });

  it("spaces the rail's icons 8px apart, in both of its groups", () => {
    // The rail has TWO stacks — the scrolling nav and the pinned foot — and
    // they have to agree, or the gap changes halfway down a single column of
    // icons. Both were `gap-0.5` (2px).
    const gaps = [...sidebar.matchAll(/flex[^"]*\bflex-col\b[^"]*\bgap-(\S+)/g)].map((m) => m[1]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(g, "a rail column that is not 8px apart").toBe("2");
  });

  it("fills the Add button with literal white", () => {
    // Specified as a colour rather than a role, and #FFFFFF is not any token:
    // `--foreground` — the nearest role, and how `default` gets a light button
    // on the console — is #E8E6E7, four counts off.
    expect(button).toMatch(/white:\s*"[^"]*\bbg-white\b/);
    expect(read("src/app/dashboard/custom-board.tsx")).toMatch(/variant="white"[\s\S]{0,200}?>\s*<Plus \/>\s*Add\b/);
  });

  it("gives a workspace chip its fill and its ink from the same key", () => {
    /**
     * THE BUG THIS EXISTS FOR ALREADY SHIPPED ONCE. The chip used to sit on a
     * hue derived from the workspace name and drew its initials in a
     * hard-coded `text-white`. When the colours were removed the FILL left and
     * the INK stayed, so every chip was white-on-white in the light theme —
     * present in the DOM, announced to a screen reader, invisible.
     *
     * So the assertion is structural rather than chromatic: both halves are
     * set together, from one `key`, in the style attribute — and neither is a
     * class that a call site could drop half of.
     */
    const chip = sidebar.match(/export function WorkspaceChip[\s\S]*?\n}/)?.[0] ?? "";
    expect(chip).toMatch(/const key = workspaceHue\(/);
    expect(chip).toMatch(/style=\{\{\s*background: groupBadge\(key\),\s*color: groupInk\(key\)\s*\}\}/);
    expect(chip, "an ink class can outlive the fill it was solved against").not.toMatch(/text-white|text-background/);
  });
});
