import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE 6 SEP 2026 CONTROL PASS — the owner's second look at the Overview.
 *
 * Four of the five things he found were the same KIND of bug: a value the code
 * described correctly in prose and then did not draw. Source pins, because
 * every one of them is a class string rather than a behaviour, and the failure
 * mode is silent — nothing throws when a button renders a step too large.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments explain the rules and must not be able to satisfy them. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const button = read("src/components/ui/button.tsx");
const globals = read("src/app/globals.css");
const sidebar = read("src/components/sidebar.tsx");
const frame = read("src/components/board-charts/frame.tsx");

describe("a button's label is 14px, which the kit only now actually has", () => {
  it("defines --text-button at 14px", () => {
    /**
     * `ui/button.tsx` has argued for 14 since the heights came down — "14 on
     * 32 leaves 6px above and below the cap height" — and every rung spelled
     * `text-sm`, which is 15. The prose was documentation of a step the scale
     * did not contain.
     */
    expect(globals).toMatch(/--text-button:\s*0\.875rem/);
  });

  it("is NOT named --text-control, which would compile to a colour", () => {
    // `--color-control` is a role, so `text-control` resolves as a text COLOUR
    // and the font-size is dropped with no error anywhere.
    expect(globals).toMatch(/--color-control:/);
    expect(globals, "the size token must not collide with the colour role").not.toMatch(/--text-control:/);
  });

  it("puts every labelled rung on it, and none back on text-sm", () => {
    const sizes = code(button).slice(code(button).indexOf("size: {"));
    for (const rung of ["sm", "default", "lg"]) {
      expect(sizes, `${rung} takes the button step`).toMatch(new RegExp(`${rung}: "h-\\d+ px-\\d+ text-button`));
    }
    expect(sizes, "no labelled rung is back on the body size").not.toMatch(/text-sm/);
  });

  it("keeps every labelled rung at the one control height", () => {
    const sizes = code(button).slice(code(button).indexOf("size: {"));
    expect(sizes).toMatch(/sm: "h-8 /);
    expect(sizes).toMatch(/default: "h-8 /);
  });

  it("stands the skip link at the same rung — it is a filled control too", () => {
    // Only ever visible under keyboard focus, which is exactly why it drifted
    // to 38px/15px without anyone seeing it.
    const layout = code(read("src/app/layout.tsx"));
    expect(layout).toMatch(/skip-link[^"]*h-8/);
    expect(layout).toMatch(/skip-link[^"]*text-button/);
  });
});

describe("the rail, after the owner called it out beside the export", () => {
  it("left-aligns its rows, which is what a <button> does not do by default", () => {
    /**
     * THE BUG THIS PINS. `SLOT` is worn by both `<a>` rows and `<button>`
     * rows, and a `<button>` carries a UA `text-align: center`. So the nav
     * links read left and the two BUTTONS — the workspace switcher and the
     * search field — centred their labels inside a `flex-1` box. With a long
     * workspace name it was invisible; with a short one ("Cabal") the name
     * floated in the middle of the rail with the chip stranded at the edge.
     */
    expect(code(sidebar)).toMatch(/const SLOT =[\s\S]{0,220}text-left/);
  });

  it("draws no ⌘K keycap", () => {
    expect(code(sidebar), "the chip is gone").not.toContain("⌘K");
    // The binding is the announced fact and must survive the chip.
    expect(sidebar, "the shortcut is still announced").toMatch(/aria-keyshortcuts="Meta\+K"/);
  });

  it("stands the head's switcher at 40 and the foot's filled row at 32", () => {
    // The export measures the switcher at 40 (its search and nav rows are 36)
    // and the foot's "New flow" at 32, which is the kit's filled-control rung.
    const c = code(sidebar);
    expect(c, "the switcher is the one 40px row").toMatch(/cn\(SLOT, "h-10 /);
    expect(c, "the filled foot row stands at 32").toMatch(/SLOT,\s*\n\s*"h-8",/);
  });
});

describe("a tile says its name and its number, and not what it is drawn as", () => {
  it("draws no chart-kind line under the title", () => {
    /**
     * "I dont want to have the chart type text on the cards." It read
     * "Line · Today" under the name — the tile describing the picture
     * directly beneath it.
     */
    expect(code(frame), "the chart kind is not drawn").not.toMatch(/\{chartLabel\}/);
  });

  it("STILL draws the period override, which is the other half of that line", () => {
    /**
     * THE DISTINCTION THAT NEARLY GOT LOST. `rangeLabel` is set only when a
     * tile overrides the BOARD's period, so dropping it means a tile reading
     * "Last 7 days" sits inside a board set to Today saying nothing about the
     * difference. `tests/custom-tile-render.test.ts` calls a silent override
     * "the failure" and it is right — the two labels were sharing one line, so
     * removing the noisy half is what lets this one be seen.
     */
    expect(code(frame)).toMatch(/\{rangeLabel && <CardDescription/);
  });

  it("still ACCEPTS chartLabel, because the canvas board passes it", () => {
    // Removing it from the type would mean editing every call site to say
    // nothing.
    expect(frame).toMatch(/chartLabel\?: string;/);
  });
});
