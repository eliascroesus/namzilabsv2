/**
 * MEASURE THE SHELL AND THE BOARD AGAINST THE FIGMA, IN THE BROWSER.
 *
 *   pnpm dev                  # in another terminal
 *   pnpm geometry             # dark
 *   SHOT_SCHEME=light pnpm geometry
 *
 * WHY THIS EXISTS. Every other check in this repo reads SOURCE — `check:ui`
 * greps classes, `page-width.test.ts` compares two files' class strings. None
 * of them can see a laid-out pixel, so a card can be 72px too tall with every
 * class correct and every test green. That is exactly what happened: the board
 * ran a 24px grid gap against the Figma's 16, and the only symptom was that the
 * whole thing "looked off" — which took a person to notice and a person to
 * describe.
 *
 * It found, in one run: the shell inverted (the top bar above the rail rather
 * than beside it), a four-column chart card 5.3px narrow, a ten-row card 72px
 * tall, and the board sitting 8px low under its own header.
 *
 * RE-POINTED 9 SEP 2026 to node 0:5 in DWPyHPYAlD4czvPmppuf6y — the frame the
 * chrome was rebuilt against. The numbers below are that frame's, read from
 * `get_metadata`, and several of them moved: the bar is three bands now (57 +
 * 49 + 43 = 149, where the frame starts its content container), the rail has no
 * search, and the board grid runs a 24px gutter rather than 16.
 *
 * ── 10 SEP 2026: THE FRAME GAINED A GUTTER, AND EVERY NUMBER BELOW MOVED ──
 *
 * Node 35:6024 wraps the content column in `pr-[8px] py-[8px]` and puts a 1px
 * hairline, 8px-cornered panel inside it. That is a pure OFFSET applied to
 * everything the old constants named, and it is written out here rather than
 * folded into the literals so the arithmetic can be checked:
 *
 *     x  += 1     the panel's left border (there is NO left gutter — node
 *                 35:6024 sets `pr` and `py` only, so the panel butts against
 *                 the rail and only its corners cut into it)
 *     y  += 9     8px of top gutter, then the panel's top border
 *     w  -= 10    8px of right gutter, plus a border on each side
 *
 * so the content column's usable width falls from 1660 to 1650 and the board's
 * 12-column grid re-divides.
 *
 * ── 11 SEP 2026: THE GUTTER WENT BACK TO 16, AND THE FRAME AGREES EXACTLY ──
 *
 * The owner asked for a 16px gutter between cards. Node 35:6124 draws the
 * board container `padding: 24px; gap: 16px`, and the arithmetic that falls
 * out of it is the frame's own, to the decimal:
 *
 *     1650 − 48 of page padding      = 1602
 *     less eleven 16px gutters       = 1426, so 118.833 per column
 *     a four-column chart card       = 4×118.833 + 3×16 = 523.33
 *     ten rows at the new pitch      = 10×40 − 16      = 384
 *     a three-column stat tile       = 3×118.833 + 2×16 = 388.5
 *
 * and the Figma's own chart card is `width: 523.33px; height: 384px`. Both
 * numbers land on the frame with nothing rounded, which is the strongest
 * confirmation available that 16 is the gutter this board was drawn on — at a
 * 24 gutter the same card measured 518×456 and the frame's 523.33 had to be
 * explained away as a rounding artifact (see the note below, now retired).
 *
 * ── AND THEN THE CHROME FOLLOWED, so the bar heights moved after all ──
 *
 * The paragraph that stood here said the 10 September relayout was out of
 * scope and the bars would stay node 0:5's 57 and 49. The owner asked for it
 * on 10 Sep, so they did not. The chrome is now what nodes 35:6027 and 35:6044
 * draw: ONE 56px band of title-and-app-controls, then the board's own white
 * row, and no third band. The search went back to the rail, the account went
 * to the rail's foot, and the wordmark is gone.
 *
 * ONE NUMBER HERE IS THE APP'S AND NOT THE FRAME'S, and it is the same
 * departure this file has recorded twice already. Node 35:6044 draws the
 * board's row 51px tall around a 26px control; the kit stands every labelled
 * control at 32, and at 26 the whole chrome "read as small" — the owner's own
 * words, and the reason commit 3973215 put the kit's rung back. So that row is
 * 57 (8 + 32 + 16 + 1) rather than 51, and the six px land in the board's `y`
 * below. Everything else is the frame's.
 *
 * NOTHING HERE IS DERIVED FROM THE APP. The offsets come from the Figma's own
 * gutter and border; the divisions are arithmetic on them. That the app agrees
 * to the pixel is the result, not the method — reading these off the app's CSS
 * would make the check pass by construction, which is the trap the paragraph
 * above this one exists to name.
 *
 * The previous expectations came from `get_metadata` on Figma nodes 49:5268 and
 * 58:5824 — both 1920x1200 frames of the same screen, dark and light. They are
 * written here as data rather than derived, because the point is to compare the
 * app against the DESIGN; deriving them from the app's own constants would make
 * this test pass by construction.
 *
 * Exits 1 on any mismatch outside tolerance, so it can gate a branch.
 *
 * ITS BLIND SPOT, NAMED. The default path is `/design/overview`, which composes
 * the real cards at the real geometry but does NOT render `CustomBoard` — it
 * builds its own grid. So a margin belonging to that component is invisible
 * here, and one was: `board-canvas mt-4` stacked on `PageHeader`'s `pb-4` and
 * put the real dashboard's board 32px under its tab row while this check
 * reported a clean 16. Elias found it by looking.
 *
 * Pass a path to widen the net (`pnpm geometry /design/canvas`), and when a
 * number below is wrong on the real dashboard but right here, suspect a wrapper
 * that only the authenticated route renders.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const PATH = process.argv[2] ?? "/design/overview";
/** Sub-pixel: the grid divides 1612 by 12, so thirds land on .33 and .67. */
const TOL = 1;

/**
 * Figma nodes 49:5268 / 58:5824, 1920x1200.
 *
 * The main is `p-[24px]` inside a 1660-wide content column, so the content box
 * is 1612 and starts at x=284 (260 rail + 24) and y=89 (65 bar + 24). The
 * header row is 32 tall with a 16px gutter under it, putting the grid at 137.
 */
/**
 * THE FRAME'S OFFSET, APPLIED ONCE, so a future gutter change is one edit and
 * cannot be half-applied across nine boxes. See the header for the derivation.
 */
const GUTTER = 8;
const HAIRLINE = 1;
/** Left edge: the panel's own border only — there is no left gutter. */
const DX = HAIRLINE;
/** Top edge: the gutter, then the border. */
const DY = GUTTER + HAIRLINE;

const FIGMA = {
  // The rail is OUTSIDE the frame — it keeps the full height and starts at
  // zero. The gutter is the content column's, not the shell's.
  sidebar: { x: 0, y: 0, w: 260, h: 1200 },
  // Bar ONE. The check measures the first <header>; bars two and three are
  // asserted in tests/topbar-figma.test.ts.
  //
  // THE SUM IS 155 NOW, NOT THE FRAME'S 149. Node 0:5 draws a 26px control and
  // a 43px third bar; the kit's own rule is one 32px control height, and at 26
  // the whole chrome read smaller than the CRM the frame was drawn against.
  // The kit won, so bar three is 49 and the board starts at 179 rather than
  // 173. Everything else here is still the frame's.
  // 64 = 16 above a 32px control row and 16 below it. Node 35:6027 measures
  // 56 (16/32/8), and the 11 Sep 2026 adjustment made this band's own padding
  // SYMMETRIC: the 16px between it and the board's row used to be split 8/8
  // across the two, so each was lopsided inside its own box. The bar carries
  // the whole gap now and the band starts flush.
  //
  // THE SUM IS THE INVARIANT, NOT EITHER NUMBER: 64 + 49 is the same 113 that
  // 56 + 57 was, which is why every box below is unmoved. If one of these ever
  // changes without the other, the board lands at the wrong y with every class
  // still correct — the failure this file exists for.
  topbar: { x: 260 + DX, y: 0 + DY, w: 1660 - GUTTER - 2 * HAIRLINE, h: 64 },
  chartCards: [
    // Node 0:5's own boxes. They are the board's too now: `GRID_GAP_PX` went
    // back to 24 and `ROW_UNIT_PX` to 48, so a ten-row card is 10*48-24 = 456
    // and four of twelve columns at a 24 gutter is 521.33. The third card is
    // THE "ROUNDING ARTIFACT" NOTE RETIRED HERE. It said node 0:5's third card
    // was 4px wider than its own container and that the app was right where
    // the export was not. At a 16px gutter there is no discrepancy to explain:
    // 523.33 is both the arithmetic AND node 35:6126's own `width`, and the
    // 384 height matches too. The disagreement was the gutter all along.
    // y = 8 gutter + 1 border + 64 (bar) + 49 (the board's row) + 24 (its own
    // padding) = 146 — the same 146 it was at 56 + 57, because only the split
    // between the two bands moved. w and h are node 35:6126's own, to the
    // decimal.
    { x: 285, y: 146, w: 523.33, h: 384 },
    { x: 285 + 523.33 + 16, y: 146, w: 523.33, h: 384 },
    { x: 285 + 2 * (523.33 + 16), y: 146, w: 523.33, h: 384 },
  ],
  /**
   * HEIGHT IS DELIBERATELY NOT CHECKED on these. The Figma draws them at
   * 108.22 — a CONTENT height, `self-start` in its grid — and the board sizes
   * every tile to whole rows. At a 24px row and a 16px gutter the options are
   * 104 (3 rows) and 144 (4); 104 is as close as the grid can land, and moving
   * the row unit to hit 108.22 exactly would put every OTHER tile wrong.
   */
  statTiles: [
    // 546 = 146 + 384 + 16: the chart row, plus the gutter it shares with the
    // row below. Three of twelve columns at a 16 gutter is 388.5.
    { x: 285, y: 546, w: 388.5 },
    { x: 285 + 388.5 + 16, y: 546, w: 388.5 },
    { x: 285 + 2 * (388.5 + 16), y: 546, w: 388.5 },
    { x: 285 + 3 * (388.5 + 16), y: 546, w: 388.5 },
  ],
};

/**
 * THE RAIL'S OWN RHYTHM, node 58:5825, measured from the rail's top-left.
 *
 * Every one of these is a CONTENT box — the padded frame the Figma names, not
 * the full-width row we wrap it in. `x` is therefore 16 (the rail's own gutter)
 * on all of them, and a row whose outer div spans the full 260 is still correct
 * as long as its content starts there.
 *
 * The vertical numbers are the ones that matter and the ones that were wrong:
 * the whole column sat 34px high because the nav's top padding was 4 where the
 * Figma's gap is 24, and every row below the search inherited it.
 */
const RAIL = {
  /**
   * BACK ON 16, AND THE 8px ASKED FOR IS INSIDE THE BUTTON.
   *
   * This briefly expected 24, because the first pass at "add 8px padding on
   * both left and right of it" inset the CONTAINER — which narrowed the hover
   * surface and pushed the block off the column's own edge. The ask was padding
   * INSIDE the button: it stays `w-full`, so its fill and its focus ring still
   * run the full 228px, and only the badge, the name and the chevron move in.
   *
   * So the box is on the gutter like every other row, exactly as node 58:5829
   * has it, and there is no departure left to record.
   */
  /**
   * THE SEARCH ROW IS BACK, and every number under it moved with it.
   *
   * Node 0:5 drew the field in the top bar at 480x40 and none in the rail, so
   * this table had no "search" and ran switcher 8 / Main Menu 68 / Dashboard
   * 88. Nodes 35:5920–35:5939 put it back in the column and the whole rhythm
   * is the frame's again: `Nav - Primary` is `padding: 24px 16px 0`, the
   * switcher block is 36 tall with 24 under it, the field is 36, and the
   * "Main Menu" group opens with another 24.
   *
   *   24  switcher      (36)    node 35:5922
   *   84  search        (36)    node 35:5931  — 24 + 36 + 24
   *  144  Main Menu     (12)    node 35:5940  — 84 + 36 + 24
   *  164  Dashboard     (32)    node 35:5941  — 144 + 12 + 8
   *  204  sub-nav 1st   (32)    node 35:5957  — 164 + 32 + 8
   *  308  Activity      (32)    node 35:5966  — 204 + 96 + 8
   */
  "switcher": { x: 16, y: 24, h: 36 },
  "search": { x: 16, y: 84, h: 36 },
  "Main Menu": { x: 16, y: 144, h: 12 },
  "Dashboard": { x: 16, y: 164, h: 32 },
  "sub-nav 1st": { x: 48, y: 204, h: 32 },
  "Activity": { x: 16, y: 308, h: 32 },
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1200 },
  colorScheme: process.env.SHOT_SCHEME === "light" ? "light" : "dark",
});
const res = await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle", timeout: 60_000 });
if (!res || res.status() >= 400) {
  console.error(`✗ ${PATH} returned ${res?.status() ?? "no response"}`);
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);

const got = await page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  };
  /**
   * The grid's own children, in DOM order — not a class selector. The cards
   * are three different components (`ChartFrame`, `FlowTile`, block tiles) and
   * only one of them carries `data-tile-card`; what this measures is the BOX
   * the grid gives each of them, which is the thing that was wrong.
   */
  const first = document.querySelector("[data-tile-card]");
  const grid = first?.parentElement?.parentElement ?? null;
  /**
   * RAIL BOXES, RELATIVE TO THE RAIL, AND MEASURED ON THE INNERMOST THING.
   *
   * A row's outer div is full-width with its own gutter padding, so measuring
   * it reports x=0 and compares a wrapper against a padded frame. What the
   * Figma names is the CONTENT, so each of these reaches for the element that
   * actually carries ink or a border.
   */
  const aside = document.querySelector("aside");
  const rail = {};
  if (aside) {
    const o = aside.getBoundingClientRect();
    const rel = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: +(r.x - o.x).toFixed(2),
        y: +(r.y - o.y).toFixed(2),
        w: +r.width.toFixed(2),
        h: +r.height.toFixed(2),
      };
    };
    const text = (tag, t) => [...aside.querySelectorAll(tag)].find((e) => (e.textContent || "").trim() === t);
    const head = aside.querySelector("div.mt-6");
    rail["switcher"] = rel(head?.firstElementChild ?? head);
    /* THE FIELD, found by its input rather than by a class: the box around it
       is a plain flex row whose classes are free to change, and the one thing
       that cannot change without the feature going away is that it contains a
       text input. `closest` walks back out to the bordered box the Figma
       measures. */
    rail["search"] = rel(aside.querySelector('input[aria-label="Search the navigation"]')?.parentElement ?? null);
    /**
     * THE CONTENT BOX, NOT THE BORDER BOX AND NOT A RANGE.
     *
     * The caption's `<p>` carries the 24px that separates it from the search as
     * its own `padding-top`, so its border box starts at 122 and comparing that
     * against a Figma frame naming the glyphs is off by the padding.
     *
     * A `Range` over the text node is the obvious alternative and is WRONG here
     * in a way worth recording: it returns the GLYPH box, which for a
     * `line-height` tighter than the font's natural leading is taller than the
     * line and starts above it — it reported 136/15 for a line laid out at
     * 138/12. The content box is what CSS actually placed.
     */
    const mm = text("p", "Main Menu");
    if (mm) {
      const r = mm.getBoundingClientRect();
      const cs = getComputedStyle(mm);
      rail["Main Menu"] = {
        x: +(r.x - o.x + parseFloat(cs.paddingLeft)).toFixed(2),
        y: +(r.y - o.y + parseFloat(cs.paddingTop)).toFixed(2),
        w: +(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)).toFixed(2),
        h: +parseFloat(cs.lineHeight).toFixed(2),
      };
    }
    rail["Dashboard"] = rel(text("span", "Dashboard")?.closest("a"));
    // The nested view rows: the first one's LABEL, which is what sits at x=48.
    const sub = aside.querySelector("a > span[aria-hidden].border-r");
    rail["sub-nav 1st"] = rel(sub?.parentElement);
    rail["sub-nav rule"] = rel(sub);
    rail["Activity"] = rel(text("span", "Activity")?.closest("a"));
  }

  return {
    sidebar: box(document.querySelector("aside")),
    topbar: box(document.querySelector("header")),
    cells: grid ? [...grid.children].map(box) : [],
    rail,
  };
});

let failed = 0;
const check = (label, actual, want) => {
  if (!actual) {
    console.log(`  ✗ ${label.padEnd(14)} NOT FOUND`);
    failed++;
    return;
  }
  const keys = Object.keys(want);
  const off = keys.filter((k) => Math.abs(actual[k] - want[k]) > TOL);
  const detail = keys.map((k) => `${k}=${actual[k]}/${want[k]}`).join("  ");
  console.log(`  ${off.length ? "✗" : "✓"} ${label.padEnd(14)} ${detail}${off.length ? `   OFF: ${off.join(",")}` : ""}`);
  if (off.length) failed++;
};

console.log(`${PATH} at 1920x1200 — measured/figma\n`);
console.log("shell");
check("sidebar", got.sidebar, FIGMA.sidebar);
check("top bar", got.topbar, FIGMA.topbar);

console.log("\nchart cards");
FIGMA.chartCards.forEach((want, i) => check(`chart ${i + 1}`, got.cells[i], want));

console.log("\nstat tiles (height is grid-quantised — see the note in this file)");
FIGMA.statTiles.forEach((want, i) => check(`stat ${i + 1}`, got.cells[i + 3], want));

console.log("\nrail (content boxes, relative to the rail's own top-left)");
for (const [k, want] of Object.entries(RAIL)) {
  const a = got.rail[k];
  if (!a) {
    console.log(`  ✗ ${k.padEnd(14)} NOT FOUND`);
    failed++;
    continue;
  }
  // `x` on a row is where its CONTENT starts, which is what the Figma names.
  const actual = k === "sub-nav 1st" ? { ...a, x: got.rail["sub-nav rule"] ? a.x + 32 : a.x } : a;
  check(k, actual, want);
}

await browser.close();
console.log(failed ? `\n✗ ${failed} box(es) off by more than ${TOL}px` : "\n✓ every measured box matches the Figma");
process.exit(failed ? 1 : 0);
