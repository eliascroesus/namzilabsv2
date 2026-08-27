/**
 * DRIVE THE CUSTOM-VIEW CANVAS IN A REAL BROWSER.
 *
 * The reason this exists is one production incident: every SUCCESSFUL add
 * crashed the page, and nothing in the suite could see it. The source-text
 * tests asserted rules the code satisfied; the ad-hoc gesture script only
 * exercised writes that FAIL (the specimen has no session); and the crash was
 * two correct lines whose interaction only a browser executes. `/design/canvas`
 * now mounts the board with a harness whose fake actions SUCCEED — so the one
 * path that broke is the first path this file drives.
 *
 * Usage: `pnpm dev` in one terminal, `pnpm canvas:check` in another.
 * SHOT_BASE overrides http://localhost:3000. Exits non-zero on any failure.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
/**
 * EVERY SELECTOR BELOW IS SCOPED TO THE LIVE BOARD. `/design/canvas` now shows
 * three boards — the gallery's specimens, a deliberately frozen one, and this
 * — so a bare `[data-canvas]` matches more than one and Playwright's strict
 * mode refuses it. `data-live-board` names the one with working actions.
 */
const LIVE = "[data-live-board]";
const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const layout = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-live-board] [data-canvas] [data-canvas-cell]")].map((c) => [
        c.getAttribute("data-canvas-cell"),
        c.style.getPropertyValue("--c12") + "|" + c.style.getPropertyValue("--r12"),
      ]),
    ),
  );
const cellCount = () =>
  page.evaluate(() => document.querySelectorAll("[data-live-board] [data-canvas] [data-canvas-cell]").length);

const load = async () => {
  const res = await page.goto(`${BASE}/design/canvas`, { waitUntil: "networkidle" });
  if (!res || res.status() >= 400) {
    console.error(`Could not load ${BASE}/design/canvas — is \`pnpm dev\` running?`);
    process.exit(1);
  }
  await page.waitForTimeout(500);
  // The live board sits below the static gallery; a pointer cannot press an
  // element that is off screen.
  await page.locator(`${LIVE} [data-canvas]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
};

// ── the success-path add: the class that shipped broken ─────────────────────
console.log("\na SUCCESSFUL add must not crash the page");
{
  await load();
  const before = await cellCount();
  check(before > 0, "the live board mounted", `cells=${before}`);

  await page.locator(LIVE).getByRole("button", { name: "Add", exact: true }).click();
  // ONE press: the chart lands immediately, bound to the first metric that can
  // draw it. There is no metric step — that decision moved onto the tile.
  //
  // Addressed by `data-add-chart` rather than by its label: the settings panel
  // lists chart types too, so "Single number" now names two buttons on this
  // page and a label match resolved to both.
  await page.locator(`${LIVE} [data-add-chart='number']`).click();
  await page.waitForTimeout(400);
  check(
    (await page.locator("div[role='dialog']").count()) === 0,
    "no metric step ever appears",
  );

  const after = await cellCount();
  check(after === before + 1, "the new box appears immediately", `${before} -> ${after}`);
  // The window the crash lived in: the box exists, its card has not arrived.
  const pendingCell = page.locator(`${LIVE} [data-canvas-cell^='sim-added-']`);
  check((await pendingCell.count()) === 1, "the added box is the pending one");
  check(
    (await pendingCell.locator("[aria-busy='true']").count()) === 1,
    "it renders a skeleton while its card is on the way",
  );
  check(
    (await pendingCell.locator("button[aria-label^='Options for']").count()) === 0,
    "and carries NO menu — the menu reading a tile that is not there was the crash",
  );
  check(errors.length === 0, "no uncaught page errors after the add", errors.join(" · "));
}

// ── the ghost tile: the crash's permanent form ──────────────────────────────
console.log("\na tile deleted elsewhere leaves no ghost, and the board keeps working");
{
  await load();
  const before = await cellCount();
  await page.locator(`${LIVE} [data-canvas-sim='remove']`).click();
  await page.waitForTimeout(300);
  const after = await cellCount();
  check(after === before - 1, "the box vanishes when the server no longer has it", `${before} -> ${after}`);

  // The brick: with a ghost id in the batch, every layout write failed
  // wholesale. Drag a survivor and confirm the board still moves.
  const cell = page.locator(`${LIVE} [data-canvas] [data-canvas-cell]`).first();
  const box = await cell.boundingBox();
  const pre = await layout();
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 30, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  check(JSON.stringify(await layout()) !== JSON.stringify(pre), "a drag after the removal still lands");
  check(errors.length === 0, "no uncaught page errors after the removal", errors.join(" · "));
}

// ── a tile added elsewhere appears ──────────────────────────────────────────
console.log("\na tile added elsewhere appears without a reload");
{
  await load();
  const before = await cellCount();
  await page.locator(`${LIVE} [data-canvas-sim='add']`).click();
  await page.waitForTimeout(300);
  check((await cellCount()) === before + 1, "membership reconciles from the prop");
}

// ── the tile settings panel ─────────────────────────────────────────────────
console.log("\nclicking a tile opens its settings — and nothing else does");
{
  await load();
  // t3 is the BAR tile, chosen deliberately: its mark reads the accent, so an
  // optimistic colour change is visible in its markup. A scorecard's colour
  // only reaches its trend line, and asserting against one proved nothing.
  const cell = page.locator(`${LIVE} [data-canvas] [data-canvas-cell='t3']`);
  // Scoped to the live board — the gallery above shows panel specimens too.
  const panel = page.locator(`${LIVE} [data-tile-panel]`);

  // A PLAIN CLICK on the card opens it. This is the whole gesture, and it is
  // only possible because `swallowClick` already tells a click from a drag.
  const box = await cell.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  check((await panel.count()) === 1, "a click on the card opens the panel");

  // It opens on Data, because a freshly added chart is bound to whichever
  // metric could draw it and "is this the right one?" is the standing question.
  check((await panel.getByRole("button", { name: "style" }).count()) === 1, "both tabs are there");
  await panel.getByRole("button", { name: "style" }).click();
  await page.waitForTimeout(250);
  check((await panel.getByText("Colour", { exact: true }).count()) === 1, "Style carries the colour swatches");

  // AN OPTIMISTIC WRITE: the harness's editTile answers `{ ok: true }` and
  // echoes nothing, so anything that appears came from the overlay alone.
  const before = await cell.innerHTML();
  await panel.getByRole("button", { name: "olive", exact: true }).click();
  await page.waitForTimeout(500);
  check((await cell.innerHTML()) !== before, "the colour applies without waiting for the server");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check((await panel.count()) === 0, "Escape closes it");

  // THE TWO WAYS IT MUST NOT OPEN. `swallowClick` is read-and-clear and click
  // BUBBLES, so a kebab press that consumed the flag there would leave the
  // cell handler to read `false` and open the panel as the event rose. The
  // control guard is what stops it, and this is the check that would notice.
  const kebab = page.locator(`${LIVE} button[aria-label^='Options for']`).first();
  await kebab.click();
  await page.waitForTimeout(250);
  check((await panel.count()) === 0, "the kebab opens its menu, not the panel");

  // AND NEITHER DOES THE MENU'S PROSE. `Popover` renders its panel inline —
  // `fixed` moves where it paints, not where it sits — so everything in the
  // menu is a DOM descendant of the cell. Pressing the kebab BUTTON was always
  // caught by the cell guard's `button` clause; pressing a heading inside the
  // open menu was not, and opened the settings panel behind it.
  // Any non-button prose inside the open menu. ("Draw as" used to be here; the
  // chart list moved to the settings panel, which owns every tile choice now.)
  const heading = page.locator(`${LIVE} [data-canvas] h2:text-is('Width')`).first();
  if (await heading.count()) {
    await heading.click();
    await page.waitForTimeout(250);
    check((await panel.count()) === 0, "clicking the menu's own text does not open the panel");
  } else {
    check(false, "could not find the menu's heading to click");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // THE POINTERLESS WAY IN. The card is a plain div, so the menu is the only
  // route a keyboard has to any of these settings.
  await kebab.click();
  await page.waitForTimeout(250);
  // Scoped to the live board AND exact: `name` matches a substring by default,
  // so an unscoped "Chart settings" also hit the gallery specimens' "Close
  // chart settings" buttons, which sit higher up the page.
  await page.locator(`${LIVE} [data-canvas]`).getByRole("button", { name: "Chart settings", exact: true }).click();
  await page.waitForTimeout(300);
  check((await panel.count()) === 1, "the menu offers Chart settings, so a keyboard can reach it");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // A DRAG must not open it either — the click that ends a gesture is swallowed.
  // From the card's HEAD: the top half is the handle now, so a press lower down
  // is an ordinary click and would legitimately open the panel.
  const b2 = await cell.boundingBox();
  await page.mouse.move(b2.x + 60, b2.y + 20);
  await page.mouse.down();
  await page.mouse.move(b2.x + 60 + 260, b2.y + 20 + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check((await panel.count()) === 0, "a drag does not open the panel");

  check(errors.length === 0, "no uncaught page errors around the panel", errors.join(" · "));
}

// ── duplicating a chart ─────────────────────────────────────────────────────
console.log("\nduplicating a chart lands a second one beside it");
{
  await load();
  const before = await cellCount();
  const cell = page.locator(`${LIVE} [data-canvas] [data-canvas-cell='t3']`);
  const box = await cell.boundingBox();

  await page.locator(`${LIVE} button[aria-label^='Options for']`).nth(2).click();
  await page.waitForTimeout(250);
  await page.locator(LIVE).getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.waitForTimeout(500);

  check((await cellCount()) === before + 1, "a copy appears", `${before} -> ${await cellCount()}`);
  const copy = page.locator(`${LIVE} [data-canvas-cell^='sim-copy-']`);
  check((await copy.count()) === 1, "and it is the new box, not a re-render of the old one");

  // BESIDE, not on top: the board compacts the copy in the way it compacts a
  // drop, so the two must not share a cell.
  const copyBox = await copy.boundingBox();
  const apart =
    copyBox.x + copyBox.width <= box.x + 1 ||
    box.x + box.width <= copyBox.x + 1 ||
    copyBox.y + copyBox.height <= box.y + 1 ||
    box.y + box.height <= copyBox.y + 1;
  check(apart, "and it does not overlap the original", `${JSON.stringify(box)} vs ${JSON.stringify(copyBox)}`);

  check(errors.length === 0, "no uncaught page errors after duplicating", errors.join(" · "));
}

// ── blocks ──────────────────────────────────────────────────────────────────
console.log("\na block is furniture: it lands with no metric and wears no card");
{
  await load();
  const before = await cellCount();

  // ONE PRESS, AND NO METRIC STEP — there is nothing to bind. The board here
  // has metrics, but a heading would be offerable on an empty one too.
  await page.locator(LIVE).getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(200);
  const heading = page.locator(`${LIVE} [data-add-chart='heading']`);
  check(await heading.isEnabled(), "a heading is always offerable, metric or not");
  await heading.click();
  await page.waitForTimeout(400);

  check((await cellCount()) === before + 1, "it lands", `${before} -> ${await cellCount()}`);
  check((await page.locator("div[role='dialog']").count()) === 0, "no metric step, and no error overlay");

  // The gallery's own specimens are the ones to inspect: they are rendered
  // with real config, and the live board's new tile has no card yet.
  const blocks = page.locator("[data-blocks]");
  await blocks.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const cards = await blocks.locator(".rounded-surface, .shadow-card").count();
  check(cards === 0, "no card chrome on any block", `found ${cards}`);
  check((await blocks.getByText("Acquisition").count()) >= 1, "a heading draws its words");
  check((await blocks.getByRole("presentation").count()) >= 1, "a divider is a rule, not a box");

  check(errors.length === 0, "no uncaught page errors around blocks", errors.join(" · "));
}

// ── a view holding a row this viewer may not see ────────────────────────────
console.log("\na view with a hidden chart is read-only, and says so");
{
  await load();
  const frozen = page.locator("[data-frozen-board]");
  await frozen.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);

  check(
    (await frozen.getByText("arrangement is locked").count()) === 1,
    "it says why, once",
  );

  // THE MENU'S ARRANGEMENT ROWS ARE GONE — checkable only here, because a
  // Popover renders nothing until it is opened.
  await frozen.locator("button[aria-label^='Options for']").first().click();
  await page.waitForTimeout(250);
  const menu = frozen.locator("div.cursor-default");
  const rows = (await menu.allInnerTexts()).join(" ");
  check(!/\bWidth\b/.test(rows) && !/\bMove\b/.test(rows), "no Width, Height or Move in the menu", rows.slice(0, 90));
  // ...but what a chart IS can still be changed: those writes touch one row.
  check(/Chart settings/.test(rows), "the chart can still be restyled");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // AND THE GESTURE ITSELF DOES NOTHING. This is the one that matters: a drag
  // here would let `compact` reflow the survivors into the hidden tile's space
  // and write that, overlapping it for everyone who CAN see it.
  const cell = frozen.locator("[data-canvas-cell]").first();
  const before = await page.evaluate(() =>
    [...document.querySelectorAll("[data-frozen-board] [data-canvas-cell]")].map(
      (c) => c.style.getPropertyValue("--c12") + "|" + c.style.getPropertyValue("--r12"),
    ),
  );
  const box = await cell.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 30, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("[data-frozen-board] [data-canvas-cell]")].map(
      (c) => c.style.getPropertyValue("--c12") + "|" + c.style.getPropertyValue("--r12"),
    ),
  );
  check(JSON.stringify(before) === JSON.stringify(after), "a drag moves nothing at all", `${before} -> ${after}`);
  check((await frozen.locator("[data-canvas-handle]").count()) === 0, "and there is no resize grip");

  check(errors.length === 0, "no uncaught page errors on a frozen board", errors.join(" · "));
}

// ── the handle is the head of the card ──────────────────────────────────────
console.log("\nonly the top half of a card drags it");
{
  await load();
  const cell = page.locator(`${LIVE} [data-canvas] [data-canvas-cell]`).first();
  const box = await cell.boundingBox();
  const before = await layout();

  // BELOW the handle: the chart's own area, where a press is for pointing at a
  // bar, not for shoving the board. It must move nothing.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height - 20, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check(JSON.stringify(await layout()) === JSON.stringify(before), "a press on the chart moves nothing");

  // ABOVE it: the title bar, which is what moves.
  await page.mouse.move(box.x + 60, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 60 + 320, box.y + 16, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  check(JSON.stringify(await layout()) !== JSON.stringify(before), "a press on the head still drags");

  check(errors.length === 0, "no uncaught page errors around the handle", errors.join(" · "));
}

// ── the gestures, unchanged from the ad-hoc script ──────────────────────────
console.log("\nthe gestures still hold");
{
  await load();
  let box = await page.locator(`${LIVE} [data-canvas] [data-canvas-cell]`).first().boundingBox();
  let before = await layout();
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 30, { steps: 14 });
  await page.waitForTimeout(150);
  check(JSON.stringify(await layout()) !== JSON.stringify(before), "the preview follows the pointer");
  await page.mouse.up();
  await page.waitForTimeout(300);

  await load();
  box = await page.locator(`${LIVE} [data-canvas] [data-canvas-cell]`).first().boundingBox();
  before = await layout();
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 30, { steps: 12 });
  await page.waitForTimeout(150);
  const moved = JSON.stringify(await layout()) !== JSON.stringify(before);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(moved && JSON.stringify(await layout()) === JSON.stringify(before), "Escape puts everything back");
  await page.mouse.up();

  await load();
  const grip = await page.locator(`${LIVE} [data-canvas-handle]`).first().boundingBox();
  before = await layout();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 280, grip.y + 130, { steps: 12 });
  await page.waitForTimeout(180);
  check(JSON.stringify(await layout()) !== JSON.stringify(before), "the corner resizes the card");
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.setViewportSize({ width: 900, height: 900 });
  await load();
  const nb = await page.locator(`${LIVE} [data-canvas] [data-canvas-cell]`).first().boundingBox();
  before = await layout();
  await page.mouse.move(nb.x + 30, nb.y + 30);
  await page.mouse.down();
  await page.mouse.move(nb.x + 300, nb.y + 30, { steps: 10 });
  await page.waitForTimeout(180);
  check(JSON.stringify(await layout()) === JSON.stringify(before), "a tablet grid refuses the gesture");
  await page.mouse.up();
}

check(errors.length === 0, "no uncaught page errors anywhere", errors.join(" · "));
await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(" · ")}` : "\nPASS — the canvas does what it claims, success path included.");
process.exit(fails.length ? 1 : 0);
