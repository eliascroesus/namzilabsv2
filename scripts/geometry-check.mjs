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
  return {
    sidebar: box(document.querySelector("aside")),
    topbar: box(document.querySelector("header")),
    cells: grid ? [...grid.children].map(box) : [],
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

await browser.close();
console.log(failed ? `\n✗ ${failed} box(es) off by more than ${TOL}px` : "\n✓ every measured box matches the Figma");
process.exit(failed ? 1 : 0);
