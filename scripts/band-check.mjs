/**
 * IS THE BOARD'S BAND ACTUALLY CHROME?
 *
 * Two symptoms, one cause, and both are only visible in a browser:
 *
 *   IT BOUNCED. A `sticky` element is repainted by the scroller it lives in,
 *   so on a fast scroll it lags the bar above it — two halves of one object
 *   moving independently.
 *
 *   THE SCROLLBAR SHIFTED IT. A vertical scrollbar appears INSIDE the scroll
 *   container and narrows everything in it. The band was in there; the top bar
 *   was not. So the band slid left by the scrollbar's width and the bar did
 *   not, every time a board grew past a screen.
 *
 * Both are consequences of being inside the scroller, so this asserts the one
 * fact that rules them out: the band is a SIBLING of the top bar, it is not a
 * descendant of anything that scrolls, and it spans exactly the same width.
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 620 }, colorScheme: "light" });
await page.goto("http://localhost:3000/design/overview", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const read = () =>
  page.evaluate(() => {
    const bar = document.querySelector("header");
    // `PageHeader` renders a <header>, so the band is the SECOND one on the
    // page — the first is the top bar itself. Selecting on `div` found nothing
    // and reported "no band", which is the silent-pass shape this repo keeps
    // being bitten by; hence the explicit error above.
    const band = [...document.querySelectorAll("header")].find((d) =>
      /border-b border-topbar-border bg-topbar/.test((d.className || "").toString()),
    );
    if (!bar || !band) return { err: !bar ? "no top bar" : "no band" };
    // Is the band inside anything that scrolls vertically?
    let insideScroller = null;
    for (let n = band.parentElement; n && n !== document.body; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) {
        insideScroller = (n.className || "").toString().slice(0, 50);
        break;
      }
    }
    const b = bar.getBoundingClientRect();
    const d = band.getBoundingClientRect();
    const scroller = [...document.querySelectorAll("div")].find(
      (x) => x.scrollHeight > x.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(x).overflowY),
    );
    if (scroller) scroller.scrollTop = 500;
    return {
      position: getComputedStyle(band).position,
      insideScroller,
      barLeft: Math.round(b.left),
      barRight: Math.round(b.right),
      bandLeft: Math.round(d.left),
      bandRight: Math.round(d.right),
      bandTop: Math.round(d.top),
      barBottom: Math.round(b.bottom),
    };
  });

const before = await read();
await page.waitForTimeout(300);
const after = await read();
console.log("before scroll:", JSON.stringify(before));
console.log("after  scroll:", JSON.stringify(after));

await browser.close();

const problems = [];
if (after.err) problems.push(after.err);
else {
  if (after.position === "sticky") problems.push("still sticky — it belongs in the chrome, not pinned inside a scroller");
  if (after.insideScroller) problems.push(`still inside a scroller (${after.insideScroller})`);
  if (after.bandLeft !== after.barLeft || after.bandRight !== after.barRight)
    problems.push(`band ${after.bandLeft}..${after.bandRight} does not span the bar ${after.barLeft}..${after.barRight}`);
  if (after.bandTop !== after.barBottom) problems.push(`band top ${after.bandTop} is not the bar's bottom ${after.barBottom}`);
  if (before.bandLeft !== after.bandLeft) problems.push("the band moved sideways when the panel scrolled");
}
console.log(problems.length === 0 ? "\n✓ the band is chrome: same width as the bar, outside every scroller" : "\n✗ " + problems.join("\n✗ "));
process.exit(problems.length === 0 ? 0 : 1);
