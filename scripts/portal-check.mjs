/**
 * REPRODUCE THE BLANK BAR, THEN PROVE IT IS FIXED.
 *
 * The failure is a portal whose target was resolved once: replace the target
 * div and the old copy renders into a detached node, so the bar goes blank and
 * stays blank until a hard reload. No error, no log.
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "light" });
await page.goto("http://localhost:3000/design/overview", { waitUntil: "networkidle" });
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

await browser.close();
const ok = after.includes("Overview") && twice.includes("Overview");
console.log(ok ? "\n✓ the heading follows its target across remounts" : "\n✗ the bar went blank — the portal is still resolving once");
process.exit(ok ? 0 : 1);
