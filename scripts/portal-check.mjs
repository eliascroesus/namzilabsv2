/**
 * REPRODUCE THE BLANK BAR, THEN PROVE IT IS FIXED.
 *
 * The failure is a portal whose target was resolved once: replace the target
 * div and the old copy renders into a detached node, so the bar goes blank and
 * stays blank until a hard reload. No error, no log.
 */
import { chromium } from "playwright";

/**
 * SHOT_BASE OVERRIDES THE PORT, like every other browser check here. Four of
 * the eleven hardcoded :3000 and the rest read the env var, so running two of
 * them against a dev server on another port half-worked — the ones that read it
 * passed and the ones that did not refused the connection. A check that cannot
 * be pointed at the thing under test is a check that gets skipped.
 */
const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "light" });
await page.goto(`${BASE}/design/overview`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const read = () => page.evaluate(() => document.querySelector("#topbar-title")?.textContent?.trim() ?? "");

console.log("1. on load                    :", JSON.stringify(await read()));

// Replace the target exactly as a remount of the bar would: destroy the div
// and put a fresh, empty one in the same place.
await page.evaluate(() => {
  const old = document.getElementById("topbar-title");
  const fresh = old.cloneNode(false); // same id, same classes, NO children
  old.replaceWith(fresh);
});
await page.waitForTimeout(300);
const after = await read();
console.log("2. after the bar is replaced  :", JSON.stringify(after));

// And a second time, to show it is not a one-shot recovery.
await page.evaluate(() => {
  const old = document.getElementById("topbar-title");
  old.replaceWith(old.cloneNode(false));
});
await page.waitForTimeout(300);
const twice = await read();
console.log("3. and again                  :", JSON.stringify(twice));

/**
 * THE SAME FAILURE, ON THE CONTROL THAT ACTUALLY WENT MISSING.
 *
 * The 11 Sep sweep that introduced `PortalSlot` converted four files and its own
 * note said "four files each carried their own four-line copy". There were five:
 * `custom-board.tsx` kept the once-on-mount version, so "+ Add" — the board's
 * ONLY route to putting a chart on a view — portalled into a detached div
 * whenever the header was replaced by a soft navigation or by `FreshnessPoller`'s
 * `router.refresh()`. `empty:hidden` on the header's target then collapsed the
 * gap, so the button did not go blank, it went ABSENT, and the board looked like
 * it had never offered one. Reported by the owner on 12 Sep 2026.
 *
 * Checking the bar alone could never have caught it, which is the whole reason
 * this second half exists: one portal being fixed says nothing about the next.
 */
const board = await browser.newPage({ viewport: { width: 1600, height: 1200 }, colorScheme: "light" });
await board.goto(`${BASE}/design/canvas`, { waitUntil: "networkidle" });
await board.evaluate(() => document.fonts.ready);

const readAdd = () =>
  board.evaluate(
    () => document.querySelector("#canvas-add-chart")?.querySelector("button")?.textContent?.trim() ?? "",
  );

console.log("\n1. add button on load         :", JSON.stringify(await readAdd()));
await board.evaluate(() => {
  const old = document.getElementById("canvas-add-chart");
  old.replaceWith(old.cloneNode(false));
});
await board.waitForTimeout(300);
const addAfter = await readAdd();
console.log("2. after its slot is replaced :", JSON.stringify(addAfter));

await board.evaluate(() => {
  const old = document.getElementById("canvas-add-chart");
  old.replaceWith(old.cloneNode(false));
});
await board.waitForTimeout(300);
const addTwice = await readAdd();
console.log("3. and again                  :", JSON.stringify(addTwice));

await browser.close();
const barOk = after.includes("Overview") && twice.includes("Overview");
const addOk = addAfter === "Add" && addTwice === "Add";
console.log(barOk ? "\n✓ the heading follows its target across remounts" : "\n✗ the bar went blank — the portal is still resolving once");
console.log(
  addOk
    ? "✓ \"+ Add\" follows its target across remounts"
    : `✗ "+ Add" vanished (${JSON.stringify(addAfter)}, ${JSON.stringify(addTwice)}) — custom-board's portal is resolving once`,
);
process.exit(barOk && addOk ? 0 : 1);
