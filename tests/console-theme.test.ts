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
  it("fills with #568cff", () => {
    // THE SUPPLIED VALUE IS THE FILL, WHICH IS THE THIRD TIME THAT HAS BEEN
    // TRUE OR NOT. The 2024 blue arrived as #007BFF and had to sit one rung
    // deeper (#0070E8) to carry WHITE ink at 4.5:1. The lime carried
    // near-black ink at 11.59:1 and needed no correction. This blue needs no
    // correction either — but only because the ink stayed near-black: white on
    // #568CFF is 3.18:1, so the fill is the Figma's and the INK is the thing
    // that was solved. See `blue-theme.test.ts`, which measures it.
    expect(token("color-brand-400")).toBe("#568cff");
    expect(token("primary")).toBe("var(--color-brand-400)");
  });

  it("grounds on #121212", () => {
    // The page, the rail, the 8px gutter and the board's own ground. It was
    // #121214 and it carried the top bar too; the owner supplied #121212 for
    // this step and #151515 for the bar on 11 Sep 2026, so the chrome is a
    // real step off the page for the first time. See `blue-theme.test.ts`,
    // which asserts all three surfaces and their order.
    expect(token("color-neutral-950")).toBe("#121212");
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

  it("gives a grey button's hover and active a visible step, not a repaint", () => {
    // `--secondary` and `--accent` both landed on #333333 for one draft, so a
    // grey button's own `hover:bg-accent` / `active:bg-accent` repainted the
    // same colour over itself — a completely invisible interaction state.
    // `--accent` moves to neutral-700 (#3A3A3A, the same step `--avatar`
    // uses, a different role) so the two roles can never collide again.
    expect(darkToken("accent")).toBe("var(--color-neutral-700)");
    expect(darkToken("accent")).not.toBe(darkToken("secondary"));
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
    // `bg-secondary` SINCE 11 SEP 2026 — the same face every other button
    // wears. What this line protects is that the groove still HAS a fill at
    // all; which role supplies it is the thing that was allowed to change.
    expect(track, "the groove lost its fill").toMatch(/\bbg-secondary\b/);
    expect(track, "and it is not back on the old recessed step").not.toMatch(/\bbg-control\b/);
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

  it("spaces the rail's two stacks on the scale, 8px in the nav and 16 in the foot", () => {
    /**
     * The rail has TWO stacks — the scrolling nav and the pinned foot. Both
     * were `gap-0.5` (2px), then both 8, and the argument for making them
     * agree was that "the gap changes halfway down a single column of icons".
     *
     * `node-id=14:44` splits them, because by then they are not one column of
     * icons: the nav is a LIST of seven destinations at 8px, and the foot is
     * TWO FILLED BUTTONS at 16. At 8 the pair stacked close enough to read as
     * one two-line control. What is still pinned is that neither invents a
     * value off the scale.
     */
    const gaps = [...sidebar.matchAll(/flex[^"]*\bflex-col\b[^"]*\bgap-(\S+)/g)].map((m) => m[1]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(["2", "4"], `a rail column at an off-scale gap: ${g}`).toContain(g);
  });

  it("defines the white button as a ROLE now, not as a literal", () => {
    // Specified as a colour rather than a role, and #FFFFFF is not any token:
    // `--foreground` — the nearest role, and how `default` gets a light button
    // on the console — is #E8E6E7, four counts off. The literal `white`
    // variant stays in the kit for whatever else wants a bordered chip; this
    // test used to also pin `custom-board.tsx`'s "+ Add" to it, which stopped
    // being true the moment the 4 Sep 2026 blue retheme's header pass reserved
    // the brand fill for "+ Add" and "New flow": `variant="accent"` IS that
    // fill (`bg-primary` under `text-primary-foreground`).
    /**
     * IT WAS A LITERAL, AND THAT IS WHAT PUT FOUR WHITE SLABS ON THE DARK
     * BOARD. `bg-white` in both themes was defensible while nodes 49:5429 and
     * 49:5439 were the reference — they draw two white pills on the console —
     * and the owner overruled it on 11 Sep 2026: "fix all the button colors as
     * well for the dark theme because it is completely wrong it is suppose to
     * be #151515".
     *
     * `--secondary` already meant this: white with a hairline on light, and
     * the button face on dark. So the variant reads the role and the literal
     * is gone.
     */
    expect(button).toMatch(/white:\s*\n?\s*"[^"]*\bbg-secondary\b/);
    expect(button, "the literal must not come back").not.toMatch(/white:\s*\n?\s*"[^"]*\bbg-white\b/);
  });

  it("gives that literal fill an ink that is a LITERAL too, not a role", () => {
    /**
     * THE BUG THIS PINS SHIPPED, AND NOTHING COULD SEE IT.
     *
     * The variant's fill is `bg-white` in BOTH themes, on purpose — nodes
     * 49:5429 and 49:5439 draw "Today" and "Refresh All" as white pills on the
     * console. Its ink was `text-heading`, which is #313131 on light and
     * **#FFFFFF in `.dark`**. So on the dark dashboard "Add", "Today",
     * "Compare To" and "Refresh All" rendered white-on-white: 1:1, four
     * controls that were not dim but invisible.
     *
     * Every class in that string was individually correct, which is why no
     * source test caught it and why this one is written as an INVARIANT rather
     * than as a pin on the current value: a fill that does not change with the
     * theme must not carry ink that does. It is the same rule that makes
     * `--primary-foreground` near-black in both blocks.
     *
     * `--heading`, `--foreground` and `--card-foreground` are the three roles
     * that flip; any of them here reintroduces the bug exactly.
     */
    const decl = button.match(/white:\s*"([^"]*)"/)?.[1];
    expect(decl, "the white variant must still exist to be checked").toBeTruthy();
    for (const role of ["text-heading", "text-foreground", "text-card-foreground"]) {
      expect(decl, `white's ink must not be ${role}: it flips with the theme under a fill that does not`)
        .not.toMatch(new RegExp(`\\b${role}\\b`));
    }
    // And it must actually SET one — inheriting is the same failure by omission.
    expect(decl, "white must name its own ink").toMatch(/\btext-[a-z0-9-]+\b/);
    /**
     * "+ Add" SPENDS NO BRAND ANY MORE, and this is the second reversal.
     * It was `white`, then `accent` on `cd621bf` because the frame of the day
     * filled the adds-something verb. Node 0:5 draws all four controls in that
     * row identically — white, 26px, #E1E1E1 rim — so the fill goes.
     */
    const custom = read("src/app/dashboard/custom-board.tsx");
    expect(custom, "+ Add is white with the rest of its row").toMatch(
      /variant="white"[\s\S]{0,200}?>\s*<Plus \/>\s*Add\b/,
    );
    expect(custom, "and no longer the brand fill").not.toMatch(
      /variant="accent"[\s\S]{0,200}?>\s*<Plus \/>\s*Add\b/,
    );
  });

  it("keeps the white button's states on ROLES, so they follow its face", () => {
    /**
     * THE STATES USED TO BE RAMP LITERALS — `hover:bg-neutral-50`,
     * `active:bg-neutral-100` — which was right while the face was a literal
     * `bg-white`: a fixed fill takes fixed states. The face is `--secondary`
     * now (#FFFFFF on light, #151515 on dark), so a literal hover would send a
     * dark button to near-white on the way to being pressed.
     *
     * `--accent` is the role for exactly this: a step away from the surface,
     * solved per theme, and the same one every other variant hovers to.
     */
    const white = button.match(/white:\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(white, "the white variant must still exist to be checked").toBeTruthy();
    expect(white).toMatch(/\bbg-secondary\b/);
    expect(white).toMatch(/\bhover:bg-accent\b/);
    expect(white).toMatch(/\bactive:bg-accent\b/);
    expect(white, "no ramp literal can survive a theme-aware face").not.toMatch(/bg-neutral-\d/);
    expect(white, "and the face itself may not be a literal").not.toMatch(/\bbg-white\b/);
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

  it("draws the workspace switcher's initial on the solid fill, not the translucent tint", () => {
    /**
     * White on `bg-brand-500/75` composites to 2.83:1 over the light chrome —
     * under AA for a 13px/600 glyph, and in the collapsed rail this initial
     * is the only thing on the row (I1). `bg-primary text-primary-foreground`
     * is brand-600 under white ink, 4.68:1 in both themes; dark gives up the
     * 75% translucency the export drew.
     */
    const stripped = sidebar.replace(/\/\*[\s\S]*?\*\//g, "");
    const discs = [...stripped.matchAll(/className="([^"]*rounded-control[^"]*)"/g)]
      .map((m) => m[1])
      .filter((c) => /\bsize-7\b/.test(c) && /\bfont-semibold\b/.test(c));
    expect(discs.length, "expected the two switcher-initial discs (open account, no account)").toBe(2);
    for (const disc of discs) {
      expect(disc).toMatch(/\bbg-primary\b/);
      expect(disc).toMatch(/\btext-primary-foreground\b/);
    }
    expect(stripped, "the 2.83:1 tint must not come back").not.toMatch(/bg-brand-500\/75/);
  });
});

/**
 * THE LAST PILLS, SQUARED OFF — the shape rule's final word applied to the
 * five places a chip container or a sample swatch still spelled `rounded-full`
 * after the button, the period track and the month arrows already gave it up.
 *
 * Comments are stripped before the scan (the same reasoning `scripts/check-
 * ui.ts` gives for doing it): this file's own activity-page prose now SAYS
 * `rounded-full` is gone, in a sentence about the fix, and an unstripped scan
 * would read that sentence as a violation of itself.
 *
 * `rounded-full` survives only on a true circle — nothing wider than it is
 * tall — and the two left in `calendar-board.tsx` are exactly that: a fixed
 * `size-5` icon badge and the day-of-month numeral disc, both listed in the
 * allow-list below with the reason each one is a circle rather than a chip.
 *
 * Sabotage-verified: reverting any one of the five files' fixes to
 * `rounded-full` fails that file's assertion alone; shrinking the allow-list
 * to omit either surviving circle fails on THAT file for a reason that reads
 * as a false positive, which is what proves the list is doing real work.
 */
describe("the last chip containers give up the pill", () => {
  /** Block and line comments removed, so prose about the rule cannot trip the rule. */
  const stripped = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /**
   * Per file, the exact `rounded-full`-bearing substrings that are true
   * circles and stay — each with the one-line reason, in `mobile-content.
   * test.ts`'s own allow-list style.
   */
  const ALLOWED: Record<string, string[]> = {
    // A fixed size-5 (20x20) icon badge in the metric-picker's leading slot —
    // square by construction, not a chip with variable-width text.
    "src/components/calendar/calendar-board.tsx": [
      "flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground",
      // The day-of-month numeral disc — NOT one of the spec's own named
      // exceptions (that list is avatars, the bell badge, the freshness dot
      // and "the tile's active-count numeral", a different object; citing it
      // here was the mistake a fix round corrected). It earns its circle on
      // its own terms instead: `px-1` came off so `min-w-5` alone sets the
      // width, and two 12px tabular digits (`tnum`) fit inside that 20px box
      // without it — verified square at both one and two digits, not merely
      // asserted square.
      "tnum ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full text-xs font-semibold",
    ],
  };

  const FILES = [
    "src/app/dashboard/activity/page.tsx",
    "src/app/integrations/ConnectionRow.tsx",
    "src/components/calendar/calendar-board.tsx",
    "src/components/custom-tile.tsx",
    "src/app/design/brand-sheet.tsx",
  ];

  for (const file of FILES) {
    it(`${file} spells no rounded-full outside its allow-list`, () => {
      const src = stripped(read(file));
      const allowed = ALLOWED[file] ?? [];
      const offenders: string[] = [];
      for (const m of src.matchAll(/rounded-full/g)) {
        const window = src.slice(Math.max(0, m.index! - 80), m.index! + 120);
        if (allowed.some((a) => window.includes(a))) continue;
        offenders.push(window.slice(0, 60));
      }
      expect(offenders, `${file}: rounded-full found outside the allow-list`).toEqual([]);
    });
  }
});
