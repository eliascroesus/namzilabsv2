/**
 * Take a picture of a running page.
 *
 * The reason this exists: every UI judgement in this repo up to now was made
 * by reading class names, which cannot see a clipped menu, a colour that
 * resolves to nothing, or a label that truncates to "2. Match ...". All three
 * shipped. A screenshot catches them in one look.
 *
 *   pnpm dev                                   # in another terminal
 *   pnpm shot /design out.png                  # full page
 *   pnpm shot /design out.png 950              # one viewport
 *   pnpm shot /design out.png 950 1500         # scrolled to y=1500
 *
 * Only unauthenticated routes are reachable this way — /design exists partly
 * for that reason. Anything behind WorkOS needs a real session.
 */
import { chromium } from "playwright";

const [path = "/design", out = "shot.png", height, scrollY] = process.argv.slice(2);
const base = process.env.SHOT_BASE ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env.SHOT_WIDTH ?? 1440), height: Number(height) || 900 },
  deviceScaleFactor: 2,
});
const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
if (!res || res.status() >= 400) {
  console.error(`✗ ${path} returned ${res?.status() ?? "no response"}`);
  await browser.close();
  process.exit(1);
}
if (scrollY) await page.evaluate((y) => (document.querySelector("main") ?? window).scrollTo(0, Number(y)), scrollY);
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: !height });
console.log(`✓ ${path} → ${out}`);
await browser.close();
