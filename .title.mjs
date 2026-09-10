import { chromium } from "playwright";
const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: mode });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/design/overview", { waitUntil: "domcontentloaded" });
  await page.evaluate((m) => localStorage.setItem("theme", m), mode);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const out = await page.evaluate(() => {
    const card = document.querySelector("[data-tile-card]");
    if (!card) return { err: "no card" };
    const header = card.querySelector("[data-slot='card-header']") ?? card.firstElementChild;
    const title = card.querySelector("[data-slot='card-title']");
    const cs = title ? getComputedStyle(title) : null;
    const hcs = header ? getComputedStyle(header) : null;
    const r = title?.getBoundingClientRect();
    return {
      titleText: title?.textContent?.trim(),
      titleColor: cs?.color,
      titleSize: cs?.fontSize,
      titleWeight: cs?.fontWeight,
      titleBox: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
      headerDisplay: hcs?.display,
      headerGridCols: hcs?.gridTemplateColumns,
      headerPad: hcs ? `${hcs.paddingTop} ${hcs.paddingRight} ${hcs.paddingBottom} ${hcs.paddingLeft}` : null,
      headerHTML: header ? header.outerHTML.slice(0, 420) : null,
    };
  });
  console.log(`── ${mode} ──`);
  console.log(JSON.stringify(out, null, 2));
  await ctx.close();
}
await browser.close();
