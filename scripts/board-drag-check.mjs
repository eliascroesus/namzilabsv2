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

const p_up = async () => {
  await page.mouse.up();
  await page.waitForTimeout(150);
};

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
  const sorted = now.g3 ?? [];
  check(sorted.length >= 1, "the specimen has a sorted group with a tile in it", JSON.stringify(now.g3));
  const { ghost, after } = await drag(sorted[0], "g2", 30);
  check(ghost === 1, "it can be picked up");
  check(after.g2.includes(sorted[0]), "and carried into another group", JSON.stringify(after.g2));
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

console.log("\na sorted group says so, and does not promise a position it cannot keep");
{
  /**
   * Reported as "on the Confirmation group it just adds it to the bottom, I
   * can't place it between metrics, but it works perfectly on Total". Both
   * columns were behaving correctly; only one of them was sorted, and nothing
   * on screen said so. Worse, the gap opened at the BOTTOM while the sort would
   * have placed the card by value — the placeholder was promising a position
   * that was about to be overruled.
   */
  await page.reload({ waitUntil: "networkidle" });
  const header = await page.evaluate(() => {
    const s = [...document.querySelectorAll("section")].find((x) => x.getAttribute("aria-label") === "User");
    return s ? s.textContent.slice(0, 60) : null;
  });
  check(/Value/.test(header ?? ""), "the sorted column wears its sort in the header", JSON.stringify(header));

  const now = await layout();
  const from = await page.locator(`[data-board-tile="${(now.g1 ?? [])[0]}"]`).boundingBox();
  const lane = await page.locator('[data-board-lane="g3"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 40);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 50, { steps: 3 });
  // Aim BETWEEN two metrics in the sorted column — the old build drew a gap at
  // the bottom regardless, which is the position it could not honour.
  await page.mouse.move(lane.x + lane.width / 2, lane.y + 200, { steps: 14 });
  await page.waitForTimeout(160);
  const state = await page.evaluate(() => {
    const l = document.querySelector('[data-board-lane="g3"]');
    return {
      gaps: [...(l?.children ?? [])].filter((c) => String(c.className).includes("border-dashed")).length,
      banner: l?.textContent?.includes("Placed by") ?? false,
      lit: (l?.getAttribute("style") ?? "").includes("inset"),
    };
  });
  await p_up();
  check(state.gaps === 0, "no placeholder promises a position the sort will overrule", `gaps=${state.gaps}`);
  check(state.banner, "it says the card will be placed by the sort");
  check(state.lit, "and the whole column lights up instead");
}

console.log("\nthe menu moves a metric ONE place, and gets out of the way");
{
  /**
   * "Move down sends it all the way to the bottom; move up works perfectly."
   * Both went through the same clamp — up passed `index - 1` and down passed
   * `index + 2`, which in a lane of four is the difference between one place
   * and the end of the lane.
   */
  await page.reload({ waitUntil: "networkidle" });
  const start = (await layout()).g1 ?? [];
  check(start.length >= 3, "the lane is long enough to tell one step from the end", JSON.stringify(start));

  const menu = async (tileKey, item) => {
    await page.locator(`[data-board-tile="${tileKey}"] button[aria-haspopup="menu"]`).click();
    await page.waitForTimeout(120);
    await page.getByRole("button", { name: item, exact: true }).click();
    await page.waitForTimeout(200);
  };

  await menu(start[0], "Move down");
  const down = (await layout()).g1 ?? [];
  check(down[1] === start[0], "move down steps past exactly one neighbour", JSON.stringify(down));
  check(down[down.length - 1] !== start[0], "and does NOT fall to the bottom");

  const open = await page.evaluate(() => !!document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]'));
  check(!open, "the menu closes behind the move");
}

console.log("\nmoving a column closes its menu too");
{
  await page.reload({ waitUntil: "networkidle" });
  const kebab = page.locator('section[aria-label="Confirmation"] button[aria-label^="Options"]');
  await kebab.click();
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: "Move left", exact: true }).click();
  await page.waitForTimeout(250);
  const stillOpen = await page.evaluate(() => !!document.querySelector('[aria-label^="Options"][aria-expanded="true"]'));
  check(!stillOpen, "the column's menu does not hang over a board that moved");
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("section[aria-label]")].map((s) => s.getAttribute("aria-label")),
  );
  check(order[0] === "Confirmation", "and the column really moved one place left", JSON.stringify(order));
}

console.log("\na press on an open menu is not a press on the board");
{
  /**
   * The panel renders INSIDE the card (and the column header), and both of
   * those are drag handles — so a press on the menu's own background, the
   * padding between its items, bubbled out and started dragging the thing
   * underneath it.
   */
  await page.reload({ waitUntil: "networkidle" });
  const start = (await layout()).g1 ?? [];
  await page.locator(`[data-board-tile="${start[0]}"] button[aria-haspopup="menu"]`).click();
  await page.waitForTimeout(150);
  const panel = await page.locator("[data-board-menu]").first().boundingBox();
  // The very top strip of the panel is its padding, above the first item.
  await page.mouse.move(panel.x + panel.width / 2, panel.y + 3);
  await page.mouse.down();
  await page.mouse.move(panel.x + panel.width / 2 + 60, panel.y + 90, { steps: 10 });
  await page.waitForTimeout(120);
  const dragging = await page.evaluate(() => document.querySelectorAll(".fixed.z-50").length);
  await p_up();
  check(dragging === 0, "dragging from the menu's background moves nothing", `ghosts=${dragging}`);
}

console.log("\nthe menu does not reappear at the metric's new home");
{
  /**
   * The exit animation holds the panel for a beat, which is right when it is
   * dismissed in place and wrong when the act that dismissed it MOVES the card
   * it is pinned to: the fixed panel re-measured against its new anchor
   * mid-fade, so the menu blinked open again a few rows down. One frame, and it
   * read as a glitch.
   */
  await page.reload({ waitUntil: "networkidle" });
  const start = (await layout()).g1 ?? [];
  await page.locator(`[data-board-tile="${start[0]}"] button[aria-haspopup="menu"]`).click();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Move down", exact: true }).click();
  // One frame later the panel must already be gone, not fading somewhere else.
  await page.waitForTimeout(30);
  const lingering = await page.evaluate(() => document.querySelectorAll("[data-board-menu]").length);
  check(lingering === 0, "the panel is gone the frame after the move", `panels=${lingering}`);
}

console.log("\nthe group's colour reads at the top of the column");
{
  await page.reload({ waitUntil: "networkidle" });
  const bar = await page.evaluate(() => {
    const s = [...document.querySelectorAll("section")].find((x) => x.getAttribute("aria-label") === "Total");
    const tinted = s?.querySelector(".rounded-card");
    const accent = tinted?.firstElementChild;
    return {
      tintedWrapsHeader: !!tinted?.querySelector('[aria-haspopup="menu"]'),
      barHeight: accent ? Math.round(accent.getBoundingClientRect().height) : 0,
      barColoured: (accent?.getAttribute("style") ?? "").includes("background"),
    };
  });
  check(bar.tintedWrapsHeader, "the tint reaches the header, not just the cards");
  check(bar.barHeight >= 3 && bar.barColoured, "and an accent bar sits across the top", JSON.stringify(bar));
}

check(errors.length === 0, "no uncaught page errors", JSON.stringify(errors));

await browser.close();
console.log(fails.length === 0 ? "\nPASS — the board's drag does what it claims." : `\nFAILED: ${fails.join(" · ")}`);
process.exit(fails.length === 0 ? 0 : 1);
