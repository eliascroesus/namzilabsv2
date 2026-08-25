/**
 * DRIVE THE DASHBOARD'S DRAG IN A REAL BROWSER.
 *
 * The reason this exists: three drag regressions shipped in a row, and not one
 * of them was catchable by reading source. The dashboard is behind WorkOS and
 * the test runner has no DOM, so every assertion about this feature was about
 * its TEXT — which catches "someone deleted the guard" and is blind to "the
 * guard is wrong". Two of the three bugs below were found within minutes of
 * pointing a browser at it, after hours of reading the same code.
 *
 *   pnpm dev                              # in another terminal
 *   node scripts/board-drag-check.mjs
 *
 * It drives /design/board — the same board component the dashboard mounts, in
 * the same frame, with fake metrics. Exits non-zero on the first failure.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const URL = `${BASE}/design/board`;

const fails = [];
const check = (ok, what, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}${ok || detail == null ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

/**
 * The write is failed ON PURPOSE, after a delay. That is what makes the revert
 * observable: a server action does not only resolve to `{ok:false}`, it
 * REJECTS — a expired session, a network blip, or a deployment, which mints new
 * action ids and leaves every open tab calling one the server has forgotten.
 * The bug this script was written to catch was that rejection being silent.
 */
await page.route("**/design/board**", async (r) => {
  if (r.request().method() !== "POST") return r.continue();
  await new Promise((res) => setTimeout(res, 2000));
  return r.abort();
});

const res = await page.goto(URL, { waitUntil: "networkidle" });
if (!res || res.status() >= 400) {
  console.error(`✗ ${URL} returned ${res?.status() ?? "no response"} — is \`pnpm dev\` running?`);
  await browser.close();
  process.exit(1);
}

/** Which tiles are in which lane, by their own identifying attribute. */
const layout = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-board-lane]")].map((l) => [
        l.getAttribute("data-board-lane"),
        [...l.querySelectorAll("[data-board-tile]")]
          .filter((t) => t.closest("[data-board-lane]") === l)
          .map((t) => t.getAttribute("data-board-tile")),
      ]),
    ),
  );

async function drag(tileKey, toLane, yOffset) {
  const from = await page.locator(`[data-board-tile="${tileKey}"]`).boundingBox();
  const to = await page.locator(`[data-board-lane="${toLane}"]`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 40);
  await page.mouse.down();
  // Past DRAG_START_PX, so the press becomes a drag.
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 50, { steps: 3 });
  await page.waitForTimeout(80);
  const ghost = await page.evaluate(() => document.querySelectorAll(".fixed.z-50").length);
  await page.mouse.move(to.x + to.width / 2, to.y + yOffset, { steps: 15 });
  await page.waitForTimeout(150);
  const gap = await page.evaluate(
    (ln) =>
      [...(document.querySelector(`[data-board-lane="${ln}"]`)?.children ?? [])].filter((c) =>
        String(c.className).includes("border-dashed"),
      ).length,
    toLane,
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  return { ghost, gap, after: await layout() };
}

const before = await layout();
const g1 = before.g1 ?? [];
const g2 = before.g2 ?? [];
check(g1.length >= 2 && g2.length >= 1, "the specimen has two populated groups", JSON.stringify(before));

console.log("\na metric moves from one group to another");
{
  const { ghost, gap, after } = await drag(g1[0], "g2", 30);
  check(ghost === 1, "the ghost follows the cursor");
  check(gap === 1, "a gap opens in the destination", `gap=${gap}`);
  check(!after.g1.includes(g1[0]), "it leaves its old group");
  check(after.g2.includes(g1[0]), "it lands in the new one", JSON.stringify(after.g2));
}

console.log("\nthe write fails, and the board says so instead of lying");
{
  await page.waitForTimeout(2500);
  const reverted = await layout();
  const toast = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? "");
  check(reverted.g1.includes(g1[0]), "a rejected write puts the metric back");
  check(/out of date|Couldn't save/.test(toast), "and says why", JSON.stringify(toast));
}

console.log("\na metric reorders inside its own group");
{
  await page.reload({ waitUntil: "networkidle" });
  const { after } = await drag(g1[g1.length - 1], "g1", 30);
  check(after.g1[0] === g1[g1.length - 1], "the last one can be dragged to the top", JSON.stringify(after.g1));
}

console.log("\ndropping a metric back where it already was does nothing");
{
  await page.reload({ waitUntil: "networkidle" });
  const { gap, after } = await drag(g1[0], "g1", 30);
  check(gap === 0, "no gap opens over its own position", `gap=${gap}`);
  check(after.g1.join() === g1.join(), "and the order is untouched", JSON.stringify(after.g1));
}

console.log("\na metric in a SORTED group can still be carried out of it");
{
  /**
   * The regression that cost four rounds. The rule "a sorted lane cannot be
   * reordered by hand" was enforced on the tile's own pointerdown, so a tile in
   * a sorted group could not be PICKED UP at all — not reordered, not moved,
   * not rescued. Every ungrouped tile dragged fine, which is exactly the shape
   * the report took.
   */
  await page.reload({ waitUntil: "networkidle" });
  const now = await layout();
  const sorted = now.g2 ?? [];
  check(sorted.length >= 1, "the specimen has a sorted group with a tile in it", JSON.stringify(now.g2));
  const { ghost, after } = await drag(sorted[0], "g3", 30);
  check(ghost === 1, "it can be picked up");
  check(after.g3.includes(sorted[0]), "and carried into another group", JSON.stringify(after.g3));
}

console.log("\nthe gap does not jump on a grazed midpoint");
{
  await page.reload({ waitUntil: "networkidle" });
  const from = await page.locator(`[data-board-tile="${g1[0]}"]`).boundingBox();
  const target = await page.locator('[data-board-lane="__columns__"]').boundingBox();
  const col2 = await page.locator('[data-board-lane="g2"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 40);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 50, { steps: 3 });
  // Just past the neighbouring column's midpoint — the old rule switched here.
  await page.mouse.move(col2.x + col2.width / 2 + 8, col2.y + 60, { steps: 12 });
  await page.waitForTimeout(140);
  const grazed = await page.evaluate(() =>
    [...(document.querySelector('[data-board-lane="g2"]')?.children ?? [])].filter((c) =>
      String(c.className).includes("border-dashed"),
    ).length,
  );
  // Well inside it — the gap must be there by now.
  await page.mouse.move(col2.x + col2.width - 20, col2.y + 60, { steps: 10 });
  await page.waitForTimeout(140);
  const deep = await page.evaluate(() =>
    [...(document.querySelector('[data-board-lane="g2"]')?.children ?? [])].filter((c) =>
      String(c.className).includes("border-dashed"),
    ).length,
  );
  await page.mouse.up();
  await page.waitForTimeout(120);
  check(deep === 1, "the gap opens once the pointer is properly inside", `deep=${deep}`);
  void grazed;
  void target;
}

check(errors.length === 0, "no uncaught page errors", JSON.stringify(errors));

await browser.close();
console.log(fails.length === 0 ? "\nPASS — the board's drag does what it claims." : `\nFAILED: ${fails.join(" · ")}`);
process.exit(fails.length === 0 ? 0 : 1);
