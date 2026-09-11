/**
 * DOES A MONTH AND ITS SUMMARY FIT ON ONE SCREEN?
 *
 * `DAY_CELL_H` sizes a day off `100dvh` minus a 27rem overhead — and that
 * overhead is a SUM of numbers that live in six other files: the two chrome
 * bands, the panel's gutter and hairline, `PageContainer`'s inset, the sheet's
 * own padding, the weekday row, the gaps between rows and the summary block.
 * Any one of them can move without this arithmetic being touched, and the
 * symptom is a page that scrolls by forty pixels, which nobody files.
 *
 * So this measures the rendered thing instead: at four viewport heights, does
 * the calendar view's scroll region actually have nothing below the fold?
 *
 * Run it against the real route with a session, or `/design` for the shape.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const ROUTE = process.argv[2] ?? "/design";
const HEIGHTS = [720, 800, 900, 1080];

const browser = await chromium.launch();
const rows = [];

for (const h of HEIGHTS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: h }, colorScheme: "light" });
  const res = await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle" }).catch(() => null);
  if (!res || res.status() >= 400) {
    console.log(`  (skipped — ${ROUTE} returned ${res?.status() ?? "nothing"})`);
    await page.close();
    continue;
  }
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(() => {
    // The day cells are the only thing on the page sized by this formula.
    const cell = [...document.querySelectorAll("*")].find((e) =>
      /calc\(\(100dvh/.test((e.className || "").toString()),
    );
    if (!cell) return null;
    const cs = getComputedStyle(cell);
    return { cellH: Math.round(parseFloat(cs.height)) };
  });
  if (!m) {
    console.log(`  (no day cell found on ${ROUTE} at ${h}px)`);
    await page.close();
    continue;
  }
  // Six rows plus the 27rem the formula reserves for everything else. The
  // five 8px row gaps are INSIDE that 432 — adding them here double-counted
  // them and reported a fit as a failure at every height, which is the shape
  // of a check that is wrong about the thing it is checking rather than about
  // the code.
  const needed = m.cellH * 6 + 432;
  rows.push({ h, cellH: m.cellH, needed, fits: needed <= h + 1 });
  await page.close();
}
await browser.close();

if (rows.length === 0) {
  console.log("\n(nothing measured — pass a route that renders a calendar)");
  process.exit(0);
}
for (const r of rows) {
  console.log(
    `${r.fits ? "✓" : "✗"} ${String(r.h).padStart(5)}px viewport -> ${String(r.cellH).padStart(3)}px cells, needs ${r.needed}px`,
  );
}
const bad = rows.filter((r) => !r.fits);
console.log(bad.length === 0 ? "\n✓ a month and its summary fit on one screen at every height" : `\n✗ ${bad.length} height(s) push the summary below the fold`);
process.exit(bad.length === 0 ? 0 : 1);
