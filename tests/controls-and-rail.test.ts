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
const topBar = read("src/components/top-bar.tsx");

/**
 * THE THIRD ROUND, 6 SEP 2026 — read off `node-id=14:44`, the rail's own frame,
 * plus four things the owner named directly.
 */
describe("the rail wears one fill for both selected and hovered", () => {
  it("raises the whole row to --control under the pointer", () => {
    // The rail had TWO raises: `--control` (#202020) for the active row and
    // `--accent` (#3A3A3A) for hover — so a hovered row looked more selected
    // than the selected one.
    expect(code(sidebar)).toMatch(/const SLOT = "[^"]*hover:bg-control/);
  });

  it("leaves no --accent hover anywhere in the column", () => {
    // The nested view rows and the "Show all" fold each carried their own.
    const rail = code(sidebar).replace(/absolute -top-3[\s\S]{0,400}?"/g, ""); // the collapse toggle floats OUTSIDE the rail
    expect(rail).not.toMatch(/hover:bg-accent/);
  });

  it("marks the active row in WHITE and filled, never in the brand", () => {
    /**
     * "when a like nav thing is active it shouldnt be blue it should be white
     * and completely filled in color". The chip drew `text-marker` — the brand
     * stroke — which the file's own long note defended as WCAG 1.4.1's second
     * signal. The row's `--control` fill IS that second signal, and it is a
     * surface change rather than a hue anyone has to distinguish.
     */
    const chip = code(sidebar).slice(code(sidebar).indexOf("function RailChip"));
    expect(chip.slice(0, 600), "the active glyph is not the brand").not.toContain("text-marker");
    expect(chip.slice(0, 600), "it is filled, not outlined").toContain("[&_svg]:fill-current");
  });

  it("gives the foot a present, not a bell, on a filled secondary button", () => {
    // A bell is the top bar's glyph for real unread notifications; spending it
    // on an upsell put one picture on two unrelated things in one chrome.
    const c = code(sidebar);
    expect(c).toMatch(/<Gift \/>/);
    expect(c, "Get Free Access is a filled button, not a nav row").toMatch(
      /variant="secondary"[\s\S]{0,300}Get Free Access/,
    );
    expect(c, "the bell is gone from the rail").not.toMatch(/<Bell\b/);
  });
});

describe("the top bar's centre belongs to the builder, not to a greeting", () => {
  it("says no Welcome back", () => {
    expect(topBar).not.toContain("Welcome back");
  });

  it("keeps the portal slot, which is the whole reason that zone exists", () => {
    // Losing `#topbar-slot` does not degrade the flow builder, it breaks it:
    // `getElementById` returns null and its toolbar renders nowhere.
    expect(code(topBar)).toContain('id="topbar-slot"');
    expect(code(topBar), "an empty slot still claims no width").toContain("empty:hidden");
  });

  it("drops the peer machinery that only existed to arbitrate the two", () => {
    // A `peer` with no sibling reading it looks load-bearing to whoever finds
    // it next.
    expect(code(topBar)).not.toContain("peer-[:not(:empty)]:hidden");
  });
});

describe("a chart card's delta sits BESIDE its number, at the far end", () => {
  it("puts the figure and the chip on one justify-between row", () => {
    /**
     * It was stacked underneath on `mt-1.5`. The export draws the same row the
     * metric card does — figure hard left, chip hard right, the whole width
     * between them — and that gap is what stops the two competing.
     */
    const c = code(frame);
    expect(c).toMatch(/<div className="flex items-center justify-between gap-3">[\s\S]{0,400}\{delta\}/);
    expect(c, "the stacked wrapper is gone").not.toMatch(/\{delta && <div className="mt-1\.5">/);
  });
});

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
