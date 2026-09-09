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
    // `--rail-control` since 8 Sep: the rail is a permanently dark band in
    // both themes (49:5268 and 58:5824 draw it identically), so it raises to
    // the CHROME's control step rather than the content's — `--control` is
    // #F4F4F4 on light and would flash white under the pointer.
    expect(code(sidebar)).toMatch(/const SLOT = "[^"]*hover:bg-rail-control/);
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

  it("keeps the present out of the rail's foot, where the bell also never went", () => {
    /**
     * THE GIFT MOVED UP, 8 SEP 2026. "Get Free Access" was a filled secondary
     * button at the foot, carrying a present rather than a bell — a bell being
     * the top bar's glyph for real unread notifications, and spending it here
     * put one picture on two unrelated things in one chrome.
     *
     * Node 51:5756 puts the gift in the TOP BAR beside the account, as an
     * offer among the account's own controls rather than as a third act under
     * two others. The reasoning that kept the bell out of the rail is
     * unchanged and now covers both glyphs: neither belongs in this column.
     */
    const c = code(sidebar);
    expect(c, "the present went to the top bar").not.toMatch(/<Gift\b/);
    expect(c, "the bell was never the rail's to spend").not.toMatch(/<Bell\b/);
    expect(c, "and the row it sat on is gone with it").not.toMatch(/Get Free Access/);
    // It has to be SOMEWHERE, or the offer was deleted rather than moved.
    expect(code(topBar)).toMatch(/<Gift\b/);
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

  it("keeps the peer machinery, which has a sibling reading it again", () => {
    /**
     * IT WAS DELETED FOR A GOOD REASON AND IS BACK FOR THE SAME ONE.
     *
     * `peer` + `empty:hidden` + `peer-[:not(:empty)]:hidden` let an occupied
     * slot push the centre's other occupant aside without any page having to
     * say which was which. When the greeting was deleted there was only one
     * occupant, so the `peer` had no sibling reading it — a rule that looks
     * load-bearing to whoever finds it next, and it went.
     *
     * The 8 September Figma puts a promo line in the centre (node 51:5788),
     * so there are two occupants again: the builder's toolbar and a sentence.
     * The arbitration is exactly the problem it was built for.
     */
    expect(code(topBar)).toContain("peer-[:not(:empty)]:hidden");
    // …and the thing it arbitrates against must actually be a `peer`.
    expect(code(topBar)).toMatch(/id="topbar-slot"[^>]*className="[^"]*\bpeer\b/);
  });
});

describe("a chart card's delta sits BESIDE its number, at the far end", () => {
  it("puts the figure and the chip on one justify-between row, and lets it wrap", () => {
    /**
     * It was stacked underneath on `mt-1.5`. The export draws the same row the
     * metric card does — figure hard left, chip hard right, the whole width
     * between them — and that gap is what stops the two competing.
     *
     * `flex-wrap` since 8 Sep 2026, and it is the other half of the numeral's
     * `whitespace-nowrap`. The figure must never break: "0h 8m 39s" split
     * across three lines pushed its tile past its own grid row and left the
     * card below overlapping the card above. But a figure that cannot break
     * beside a chip that cannot shrink is a row that overflows, and the card
     * clips it — the chip rendered as "−50% vs yes…" against the card's edge.
     * The Figma's tile is ~400px and fits both; a three-column tile at 1440px
     * is ~265px and cannot. Wrapping degrades instead of truncating.
     */
    const c = code(frame);
    expect(c).toMatch(
      /<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">[\s\S]{0,400}\{delta\}/,
    );
    expect(c, "the stacked wrapper is gone").not.toMatch(/\{delta && <div className="mt-1\.5">/);
    expect(c, "and the figure itself still never breaks").toMatch(/stat-numeral whitespace-nowrap/);
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

  it("stands the head's switcher at 40 and the foot's filled button at 36", () => {
    /**
     * THE FOOT'S BUTTON GREW FROM 32 TO 36, AND THE FIGMA IS THE ONLY REASON.
     *
     * The kit's filled-control rung is 32, and the header's three buttons
     * (Add, Today, Refresh All) are all measured there in node 49:5423. The
     * rail's own "New" is not: node 49:5744 draws it at 36, matching the
     * search field and the nav rows it sits in a column with rather than the
     * buttons it shares a vocabulary with.
     *
     * Followed rather than corrected toward the rung, because a full-width
     * control in a 260px column is answering to the column's rhythm — every
     * other row in that stack is 36 — and a 32px button between 36px
     * neighbours reads as a mistake in a way it does not in a header row.
     */
    const c = code(sidebar);
    expect(c, "the switcher is the one 40px row").toMatch(/cn\(SLOT, "h-10 /);
    expect(c, "the filled foot button stands at 36, with the column").toMatch(/size="sm" className="h-9 w-full"/);
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
