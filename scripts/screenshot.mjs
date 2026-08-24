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
/**
 * Scroll whatever ACTUALLY scrolls, rather than assuming it is <main>.
 *
 * It used to be `document.querySelector("main")`, which quietly stopped
 * working the day AppFrame's scroll region became a <div> (the frame and the
 * page inside it were both rendering a <main>, which is invalid and broke
 * landmark navigation). The selector still matched *a* main on most pages —
 * just not the one with the overflow — and on /design it matched nothing and
 * fell back to `window`, which does not scroll when the scrollbar belongs to
 * an inner element. The failure mode is the worst kind for a screenshot tool:
 * it exits 0 and hands you a picture of the top of the page.
 *
 * So: find the deepest element that can actually scroll, and fall back to the
 * document only when nothing can.
 */
if (scrollY)
  await page.evaluate((y) => {
    const scroller =
      [...document.querySelectorAll("body *")].find(
        (el) => el.scrollHeight > el.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(el).overflowY),
      ) ?? document.scrollingElement;
    scroller.scrollTo(0, Number(y));
  }, scrollY);
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: !height });
console.log(`✓ ${path} → ${out}`);
await browser.close();
