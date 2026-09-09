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
 * The expected numbers come from `get_metadata` on Figma nodes 49:5268 and
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
const FIGMA = {
  sidebar: { x: 0, y: 0, w: 260, h: 1200 },
  topbar: { x: 260, y: 0, w: 1660, h: 65 },
  chartCards: [
    { x: 284, y: 137, w: 526.67, h: 384 },
    { x: 826.67, y: 137, w: 526.67, h: 384 },
    { x: 1369.33, y: 137, w: 526.67, h: 384 },
  ],
  /**
   * HEIGHT IS DELIBERATELY NOT CHECKED on these. The Figma draws them at
   * 108.22 — a CONTENT height, `self-start` in its grid — and the board sizes
   * every tile to whole rows. At a 24px row and a 16px gutter the options are
   * 104 (3 rows) and 144 (4); 104 is as close as the grid can land, and moving
   * the row unit to hit 108.22 exactly would put every OTHER tile wrong.
   */
  statTiles: [
    { x: 284, y: 537, w: 391 },
    { x: 691, y: 537, w: 391 },
    { x: 1098, y: 537, w: 391 },
    { x: 1505, y: 537, w: 391 },
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
  "switcher": { x: 16, y: 14, h: 40 },
  "search": { x: 16, y: 78, h: 36 },
  "Main Menu": { x: 16, y: 138, h: 12 },
  "Dashboard": { x: 16, y: 158, h: 36 },
  "sub-nav 1st": { x: 48, y: 202, h: 32 },
  "Activity": { x: 16, y: 306, h: 36 },
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
    const head = aside.querySelector("div.mt-3\\.5");
    rail["switcher"] = rel(head?.firstElementChild ?? head);
    rail["search"] = rel(aside.querySelector("input")?.parentElement);
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
