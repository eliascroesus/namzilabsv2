/**
 * ONE PICTURE PER MODE, TAKEN THE WAY A PERSON ACTUALLY GETS THERE.
 *
 * `scripts/screenshot.mjs` can only reach light and dark, because it drives
 * `prefers-color-scheme` and the OS has no opinion about `mix`. This writes the
 * choice into localStorage the way the theme control does, reloads, and waits
 * for the class to land before shooting — otherwise the picture is of whatever
 * `system` resolved to and the file name is a lie.
 *
 *   pnpm dev                          # in another terminal
 *   pnpm shot:modes                   # three PNGs into the cwd
 *   pnpm shot:modes /tmp /dashboard   # somewhere else, some other route
 *
 * The `waitForFunction` on the html class is the load-bearing line: without it
 * this exits 0 having photographed the wrong mode three times, which is the
 * failure `screenshot.mjs`'s own header describes.
 */
import { chromium } from "playwright";

const OUT = process.argv[2] ?? ".";
const PATH = process.argv[3] ?? "/design/overview";
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1600);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 1000);
const base = "http://localhost:3000";

const browser = await chromium.launch();
for (const mode of ["light", "mix", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    colorScheme: mode === "dark" ? "dark" : "light",
  });
  const page = await ctx.newPage();
  await page.goto(`${base}${PATH}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((m) => localStorage.setItem("theme", m), mode);
  await page.reload({ waitUntil: "networkidle" });
  // The class is stamped by next-themes' blocking script; assert it rather
  // than trusting it, so a mode that silently fails to apply fails HERE.
  await page.waitForFunction(
    (m) => document.documentElement.classList.contains(m),
    mode,
    { timeout: 10_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/mode-${mode}.png` });
  const rail = await page.evaluate(() =>
    getComputedStyle(document.querySelector("aside")).backgroundColor,
  );
  console.log(`✓ ${mode.padEnd(5)} rail=${rail}  → ${OUT}/mode-${mode}.png`);
  await ctx.close();
}
await browser.close();
