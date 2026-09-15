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

  it("marks the active row in WHITE, and leaves the glyph an OUTLINE", () => {
    /**
     * TWO OWNER CALLS, IN ORDER, AND THE SECOND ONE REVERSES HALF THE FIRST.
     *
     * 6 Sep: "when a like nav thing is active it shouldnt be blue it should be
     * white and completely filled in color". The chip had been drawing
     * `text-marker`, the brand stroke, which the file's long note defended as
     * WCAG 1.4.1's second signal — it is not, because the row's `--control`
     * fill is a SURFACE change rather than a hue anyone has to distinguish.
     *
     * 15 Sep: "dont make the like icons filled when selected". Solid at 18px is
     * a blob — six of them in a column stop telling each other apart — and the
     * row was already saying "selected" twice without it.
     *
     * WHAT SURVIVES BOTH is the half that is not a preference: the active glyph
     * must never go back to the brand hue. That is the regression this test was
     * written for, and it is asserted below either way.
     */
    const chip = code(sidebar).slice(code(sidebar).indexOf("function RailChip"));
    expect(chip.slice(0, 900), "the active glyph is not the brand").not.toContain("text-marker");
    expect(chip.slice(0, 900), "the glyph is an outline, not a fill").not.toContain("[&_svg]:fill-current");
    // …and the row keeps the surface change that carries the state.
    expect(sidebar).toContain('className={cn(SLOT, active && "bg-rail-control")}');
  });

  it("keeps the deleted upsell out, and the bell where the bell lives", () => {
    /**
     * WHAT THIS TEST WAS FOR, AND WHAT IT OVER-REACHED ON.
     *
     * "Get Free Access" was a filled secondary button at the rail's foot
     * carrying a PRESENT rather than a bell — a bell being the top bar's glyph
     * for notifications, and spending it here put one picture on two unrelated
     * things in one chrome. Node 51:5756 moved it to the bar; no 10 September
     * frame draws it at all, so it went from the product entirely.
     *
     * The test then banned `<Gift>` outright, which was the deleted feature's
     * icon standing in for the deleted feature. Those are different things, and
     * on 15 Sep 2026 the difference bit: the owner asked for a referral card in
     * this column, a present is the conventional glyph for one, and nothing
     * else in the chrome uses it — so the original objection ("one picture on
     * two unrelated things") does not apply.
     *
     * SO THE RULE IS NARROWED TO WHAT IT ALWAYS MEANT: the withdrawn upsell
     * stays withdrawn, and the bell stays a top-bar glyph. That second half is
     * now load-bearing rather than decorative — the bell opens a real panel of
     * real failures, so a second bell in the rail would be a second thing
     * claiming to be notifications.
     */
    const c = code(sidebar);
    expect(c).not.toMatch(/Get Free Access/i);
    expect(c, "the bell belongs to the bar").not.toMatch(/<Bell\b/);
    /**
     * The referral card that replaced the ban: a link out of the column, not a
     * filled button in it. The rail has ONE solid object — the "+" in the foot,
     * its one verb — and the card is asked to be loud without becoming a
     * second one, so it takes the brand WASH inside a brand EDGE.
     *
     * A WINDOW AFTER THE HREF, not a slice between two of them. `bg-primary` is
     * legitimately the workspace chip's fill two hundred lines above, so a
     * file-wide `not.toMatch` failed on markup with nothing to do with this
     * rule — and bounding the slice with the NEXT card's `/dashboard/settings`
     * produced an empty string, because that path also appears in the `NAV`
     * array near the top of the file and `indexOf` found that one first.
     */
    const at = c.indexOf('href="/dashboard/refer"');
    expect(at, "the referral card is in the rail").toBeGreaterThan(-1);
    const card = c.slice(at, at + 700);
    expect(card, "it takes the brand WASH").toMatch(/bg-brand-soft/);
    expect(card, "never the brand FILL — the + is the column's only solid object").not.toMatch(/bg-primary/);
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

  it("keeps the builder's slot, and no longer arbitrates over it", () => {
    /**
     * THE `peer` PAIR IS GONE FOR THE SECOND TIME, BY ITS OWN ARGUMENT.
     *
     * `peer` + `empty:hidden` + `peer-[:not(:empty)]:hidden` let an occupied
     * slot push the centre's OTHER occupant aside without any page having to
     * say which was which. It was deleted once when the greeting died and
     * there was only one occupant left; it came back when node 51:5788 put a
     * promo line beside the builder's toolbar.
     *
     * The 10 September frames draw neither a promo nor a wordmark, so the slot
     * has one occupant again and the arbitration has nothing to arbitrate. A
     * rule that looks load-bearing to whoever finds it next is worse than no
     * rule, which is exactly why it went the first time.
     *
     * WHAT MUST SURVIVE IS THE ID. Losing `#topbar-slot` does not degrade the
     * flow builder, it breaks it: `getElementById` returns null and the
     * toolbar renders nowhere.
     */
    const bar = read("src/components/top-bar.tsx");
    expect(bar).toMatch(/id="topbar-slot"/);
    expect(bar).toMatch(/empty:hidden/);
    expect(bar, "nothing left to yield to").not.toMatch(/peer-\[:not\(:empty\)\]:hidden/);
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
  it("defines --text-button at 13px, which is what every frame draws", () => {
    /**
     * IT WAS 15 (`text-sm`), THEN 14, AND IS 13.
     *
     * The 14 came from `ui/button.tsx`'s own argument — "14 on 32 leaves 6px
     * above and below the cap height" — which was reasoning about a box rather
     * than reading a frame. The 10 September frames set EIGHT labelled
     * controls across two bars at 13/16/400 with no exceptions: Add, Today,
     * Compare To, Refresh All, Share, and the three view tabs. One value that
     * many times is a rung, not a coincidence.
     *
     * The owner's ask was for consistency — "the text of the share button …
     * the same as the add button" — and they were the same SIZE already; what
     * differed was WEIGHT, because the button base spelled `font-medium` and
     * Share overrode to `font-normal`. Both halves are settled here: the rung
     * is 13/16 and the base is 400.
     */
    expect(globals).toMatch(/--text-button:\s*0\.8125rem/);
    expect(globals).toMatch(/--text-button--line-height:\s*1rem/);
    const button = read("src/components/ui/button.tsx");
    const base = button.match(/"inline-flex shrink-0[^"]+"/)?.[0] ?? "";
    expect(base, "the base carries the frames' 400").toMatch(/\bfont-normal\b/);
    expect(base, "not 500").not.toMatch(/\bfont-medium\b/);
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
    // The binding is the announced fact and must survive the chip — and the
    // two round trips it has now made. The field went to the bar with node 0:5
    // and came back to the rail with node 35:5931; the announcement travelled
    // both ways with it, and a claim in `aria-keyshortcuts` that no listener
    // honours is the state this assertion exists to prevent.
    expect(code(sidebar), "the shortcut is still announced").toMatch(/aria-keyshortcuts="Meta\+K"/);
    expect(code(sidebar), "and still bound").toMatch(/e\.key !== "k" \|\| !\(e\.metaKey \|\| e\.ctrlKey\)/);
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
     * control in a 260px column is answering to the column's rhythm rather
     * than a header row's.
     *
     * THE RHYTHM MOVED DOWN A STEP ON 9 SEP 2026. Node 0:5 draws the nav rows
     * at 32 rather than 36, and the two full-width controls that bracket them —
     * the switcher at the head and the filled "New" at the foot — at 36 rather
     * than 40 and 36. So the shape of the rule is unchanged (the brackets stand
     * one step above the rows they enclose) and both numbers came down with the
     * frame.
     */
    const c = code(sidebar);
    expect(c, "the switcher stands one step above the rows").toMatch(/cn\(SLOT, "h-9 /);
    expect(c, "the filled foot button stands at 36, with the switcher").toMatch(/size="sm" className="h-9 w-full"/);
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
