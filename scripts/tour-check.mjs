/**
 * THE FIRST-RUN TOUR, MEASURED IN A BROWSER.
 *
 * WHY THIS EXISTS, and it is the bug it was written the same hour as. The tour
 * shipped with `ring-2 ring-marker` as a utility and its dim in a `.tour-scrim`
 * class. Both write `box-shadow`, the utility layer wins, and the ring silently
 * erased the scrim: a spotlight that highlighted its target correctly and
 * dimmed nothing at all. Every source check passed. The component rendered. It
 * looked deliberate.
 *
 * It took a screenshot and a `getComputedStyle` to find Tailwind's ring stack
 * sitting where the dim should have been — which is the lesson this repo keeps
 * relearning: a check that greps source cannot see a rule losing a fight with
 * another rule.
 *
 * So this measures PAINTED PIXELS and computed style, never source:
 *
 *   1. the scrim carries BOTH layers — the ring and the 9999px spread;
 *   2. a pixel far from the spotlight is genuinely DARKER than the same pixel
 *      with the tour closed. Not "a shadow is declared" — actually darker;
 *   3. the bubble sits beside its anchor and inside the viewport;
 *   4. the last step, which places its bubble BELOW a top-right anchor, does
 *      not fall off the right edge.
 *
 * Run: `pnpm tour` with the dev server up.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const PAGE = `${BASE}/design/tour`;

let failures = 0;
const check = (name, ok, observed) => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}\n         observed: ${observed}`);
  if (!ok) failures++;
};

/** Mean luminance of a small patch, straight off the painted page. */
async function patch(page, x, y) {
  const buf = await page.screenshot({ clip: { x, y, width: 8, height: 8 } });
  // PNG decode via the browser, so there is no image dependency here.
  return page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4);
  }, [...buf]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

console.log(`\n${"─".repeat(72)}\nFirst-run tour — ${PAGE}\n${"─".repeat(72)}`);

await page.goto(PAGE, { waitUntil: "networkidle" });
await page.waitForSelector(".tour-scrim", { timeout: 10_000 });
await page.waitForTimeout(400);

// ── 1. Both layers are in the one declaration ──────────────────────────────
const shadow = await page.evaluate(() => getComputedStyle(document.querySelector(".tour-scrim")).boxShadow);
check("the scrim's box-shadow carries the 9999px dim", /9999px/.test(shadow), shadow.slice(0, 120));
check(
  "and the ring, in the same declaration",
  (shadow.match(/px/g) ?? []).length > 2 && /2px/.test(shadow),
  `${(shadow.match(/rgb|color\(/g) ?? []).length} colour stop(s)`,
);

// ── 2. The page is ACTUALLY dimmer, measured ───────────────────────────────
const far = { x: 1000, y: 620 }; // well away from the rail and the bubble
const dimmed = await patch(page, far.x, far.y);
await page.evaluate(() => {
  // Close it the way a person does, so the comparison is against the real
  // undimmed page rather than a hidden element.
  document.querySelector(".tour-scrim")?.closest('[role="dialog"]')?.remove();
});
await page.waitForTimeout(150);
const bright = await patch(page, far.x, far.y);
check(
  "a pixel far from the spotlight is genuinely darker with the tour open",
  bright - dimmed > 20,
  `open=${dimmed.toFixed(1)} closed=${bright.toFixed(1)} (difference ${(bright - dimmed).toFixed(1)})`,
);

// ── 3. The bubble is beside its anchor, on screen ──────────────────────────
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".tour-scrim", { timeout: 10_000 });
await page.waitForTimeout(400);

const geometry = await page.evaluate(() => {
  const scrim = document.querySelector(".tour-scrim").getBoundingClientRect();
  const bubble = document.querySelector('[role="dialog"] > div:nth-child(2)').getBoundingClientRect();
  return { scrim: scrim.toJSON(), bubble: bubble.toJSON(), vw: innerWidth, vh: innerHeight };
});
const { scrim, bubble, vw, vh } = geometry;
check(
  "the bubble does not cover the thing it is pointing at",
  bubble.left >= scrim.right || bubble.right <= scrim.left || bubble.top >= scrim.bottom || bubble.bottom <= scrim.top,
  `spotlight right=${scrim.right.toFixed(0)}, bubble left=${bubble.left.toFixed(0)}`,
);
check(
  "the bubble is fully inside the viewport",
  bubble.left >= 0 && bubble.top >= 0 && bubble.right <= vw && bubble.bottom <= vh,
  `bubble ${bubble.left.toFixed(0)},${bubble.top.toFixed(0)} → ${bubble.right.toFixed(0)},${bubble.bottom.toFixed(0)} in ${vw}×${vh}`,
);

// ── 4. The last step places below a TOP-RIGHT anchor without escaping ──────
const total = await page.evaluate(() => {
  const label = document.querySelector('[role="dialog"]')?.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
  return label ? Number(label[2]) : 0;
});
for (let i = 1; i < total; i++) {
  await page.locator('[role="dialog"]').getByRole("button", { name: /^Next$/ }).click();
  await page.waitForTimeout(150);
}
const lastGeom = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const bubble = d.querySelector("div:nth-child(2)")?.getBoundingClientRect();
  return bubble ? { ...bubble.toJSON(), vw: innerWidth, vh: innerHeight } : null;
});
if (!lastGeom) {
  check("the last step still renders a bubble", false, "the dialog was gone before the last step");
} else {
  check(
    "the last step's bubble stays on screen under a top-right anchor",
    lastGeom.right <= lastGeom.vw && lastGeom.left >= 0 && lastGeom.bottom <= lastGeom.vh,
    `right=${lastGeom.right.toFixed(0)} of ${lastGeom.vw}, bottom=${lastGeom.bottom.toFixed(0)} of ${lastGeom.vh}`,
  );
}

// ── 5. The last step ASKS FOR SOMETHING, and doing it goes there ───────────
/**
 * A tour that ends on "Done" leaves somebody exactly where it found them.
 * The last step's button carries the destination, so what is checked is that
 * the label is the call to action and that pressing it both closes the tour
 * AND navigates — a close without the navigation would be the regression that
 * looks fine in a screenshot.
 */
const finalLabel = await page
  .locator('[role="dialog"]')
  .locator("button")
  .last()
  .textContent();
check(
  "the final button asks for the next step rather than saying Done",
  Boolean(finalLabel) && !/^done$/i.test(finalLabel.trim()),
  `"${finalLabel?.trim()}"`,
);

/**
 * IT MUST ATTEMPT THE NAVIGATION, and that is what is checkable from here.
 *
 * The destination is auth-gated, so off this public design route the outcome
 * is a bounce to sign-in rather than a landing on /integrations — and whether
 * that bounce completes depends on the auth proxy, not on the tour. Asserting
 * the final URL made this check a test of the redirect chain; it failed for a
 * reason that had nothing to do with the button.
 *
 * So the observable fact is the REQUEST. If the app asks for /integrations,
 * the button did its job. That the step aims there at all is asserted against
 * the step itself in `tests/tour.test.ts`.
 */
const asked = page
  .waitForRequest((r) => new globalThis.URL(r.url()).pathname.startsWith("/integrations"), { timeout: 5000 })
  .then(() => true)
  .catch(() => false);

await page.locator('[role="dialog"]').getByRole("button", { name: finalLabel.trim(), exact: true }).click();
const navigated = await asked;
check("pressing it asks for the app-connecting page", navigated, navigated ? "requested /integrations" : "no request for /integrations in 5s");

await page.waitForLoadState("domcontentloaded").catch(() => {});
const stillOpen = await page.evaluate(() => Boolean(document.querySelector(".tour-scrim"))).catch(() => false);
check("and closes the tour", !stillOpen, stillOpen ? "the spotlight is still in the document" : "gone");

// ── 6. IT STILL OPENS WHEN THE ANCHORS ARRIVE LATE ────────────────────────
/**
 * THE CHECK FOR THE BUG THAT SHIPPED TWICE.
 *
 * The tour measured for its anchors once, on a single `requestAnimationFrame`,
 * and gave up forever if they were not there. The rail is a `"use client"`
 * component, so on the real dashboard that bet lost and no new account ever
 * saw the tour — while this very script passed, because the design page's
 * anchors are static markup that is always ready on the first frame.
 *
 * `?late=1` holds them back 900ms. A check that only ever measures the easy
 * case is how a timing bug ships green twice.
 */
const latePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await latePage.goto(PAGE + "?late=1", { waitUntil: "domcontentloaded" });
const appeared = await latePage
  .waitForSelector(".tour-scrim", { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
check(
  "the tour still opens when the rail renders late",
  appeared,
  appeared ? "opened after the anchors arrived" : "gave up before the anchors existed — the one-frame bet is back",
);
await latePage.close();

await browser.close();
console.log(`\n${"═".repeat(72)}`);
if (failures > 0) {
  console.log(`FAILED — ${failures} check(s)\n`);
  process.exit(1);
}
console.log("PASS — the spotlight dims, the bubble lands beside its anchor, and the last step hands over to Apps.\n");
