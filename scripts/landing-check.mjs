/**
 * THE FRONT DOOR, MEASURED.
 *
 * Nothing else in this repository can see this page. `check-ui` reads class
 * names and the landing page's are hashed CSS-module names; the vitest suite
 * has no DOM; `pnpm geometry`, `frame` and `shadows` all point at `/design/*`
 * routes that `/` is not one of. So a layout that collapses, ink that falls
 * below 4.5:1, or a page that inverts in dark mode all ship green. This script
 * is the only thing standing between those and production.
 *
 * ═══ WHAT CHANGED WHEN THE LEDGER REPLACED THE SKY ═══
 *
 * The previous version of this file measured the sky hero: that the gradient
 * started at y=0, that the product window straddled the seam, and it took
 * contrast from PIXELS because that page was built from translucent ink
 * (`text-white/85` has no colour of its own, so `getComputedStyle().color`
 * returns an oklab triple that means nothing on its own).
 *
 * The ledger has no translucent ink anywhere — every one of its twelve colours
 * is an opaque literal — so contrast is computed from resolved colours and the
 * nearest painted ancestor instead. That is not a weakening: it is exact for
 * opaque fills and it reports WHICH pair failed, where the photograph method
 * could only say that some box was too quiet.
 *
 * The one thing it still checks by photograph is the page's ground, because
 * "does this page stay light when the app is in dark mode" is a question about
 * what actually got painted.
 *
 * Usage: `pnpm dev` in one terminal, `pnpm landing` in another.
 * SHOT_BASE overrides http://localhost:3000. Exits non-zero on any failure.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";

const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

/** WCAG 2.x relative luminance and contrast, from sRGB triples. */
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

const browser = await chromium.launch();

/* ── 1. The page renders, in three shapes, with nothing off the side ─────── */

console.log("\nGeometry and overflow");

const VIEWPORTS = [
  { name: "XL 1440", width: 1440, height: 1000, rules: 5 },
  { name: "MD 834", width: 834, height: 1100, rules: 3 },
  { name: "XS 375", width: 375, height: 800, rules: 0 },
];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(3600); // the hero sequence ends at 3,340ms

  const m = await page.evaluate(() => {
    const visibleRules = [...document.querySelectorAll('[class*="rules"] > div > span')].filter(
      (n) => n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== "none",
    );
    // One zone's worth: the five rules repeat per rule-zone, so the count that
    // matters is how many distinct x positions there are.
    const xs = [...new Set(visibleRules.map((n) => Math.round(n.getBoundingClientRect().left)))].sort((a, b) => a - b);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      ruleXs: xs,
      h1Lines: document.querySelectorAll("h1 > span").length,
    };
  });

  check(m.scrollWidth <= m.inner + 1, `${vp.name}: nothing scrolls off the right`, `${m.scrollWidth} > ${m.inner}`);
  check(
    m.ruleXs.length === vp.rules,
    `${vp.name}: ${vp.rules} column rule positions`,
    `saw ${m.ruleXs.length} at ${m.ruleXs.join(", ")}`,
  );
  check(errors.length === 0, `${vp.name}: no console errors`, errors.slice(0, 2).join(" | "));

  // The rules are the page's spine: at XL they must land on the 12-column
  // grid, not merely exist. c1, c4, c7, c10 and the right edge of c12.
  if (vp.rules === 5) {
    const pad = Math.max(80, (vp.width - 1272) / 2);
    const want = [0, 3, 6, 9].map((i) => pad + i * 108).concat(pad + 1272);
    const off = m.ruleXs.map((x, i) => Math.abs(x - want[i])).filter((d) => d > 2);
    check(off.length === 0, `${vp.name}: rules sit on the 12-column grid`, `want ${want.join(", ")}`);
  }

  if (vp.width === 1440) {
    check(m.h1Lines === 3, "headline breaks at fixed points, not on reflow", `${m.h1Lines} lines`);
  }
  await page.close();
}

/* ── 2. The two faces the design depends on actually arrived ─────────────── */

console.log("\nTypography");

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3600);

const type = await page.evaluate(() => {
  const h1 = getComputedStyle(document.querySelector("h1"));
  const figure = [...document.querySelectorAll("span")].find((n) =>
    getComputedStyle(n).fontFamily.includes("Martian"),
  );
  return {
    archivo: document.fonts.check('600 68px Archivo'),
    martian: document.fonts.check('600 56px "Martian Mono"'),
    h1Family: h1.fontFamily,
    // The width axis is the whole reason this page needs no display face; if
    // `axes: ["wdth"]` ever falls out of the font call this silently reverts
    // to 100% and every heading quietly narrows.
    h1Stretch: h1.fontStretch,
    figureFound: Boolean(figure),
    figureTabular: figure ? getComputedStyle(figure).fontVariantNumeric : "",
  };
});

check(type.archivo, "Archivo loaded", type.h1Family);
check(type.martian, "Martian Mono loaded");
check(type.h1Stretch === "112%", "the headline keeps its width axis", `font-stretch: ${type.h1Stretch}`);
check(type.figureFound, "figures are set in Martian Mono");
check(type.figureTabular.includes("tabular-nums"), "figures are tabular", type.figureTabular);

/* ── 3. Ink clears 4.5:1 on the ground it actually lands on ──────────────── */

console.log("\nContrast");

const contrast = await page.evaluate(() => {
  const painted = (node) => {
    for (let n = node; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    }
    return "rgb(255, 255, 255)";
  };
  const out = [];
  for (const node of document.querySelectorAll("p, h1, h2, h3, span, a, li, dt, dd, text")) {
    const text = node.textContent?.trim() ?? "";
    if (!text || node.children.length > 0) continue;
    const cs = getComputedStyle(node);
    const size = parseFloat(cs.fontSize);
    if (size < 10) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    out.push({
      text: text.slice(0, 34),
      color: cs.color,
      bg: painted(node),
      size,
      weight: Number(cs.fontWeight),
    });
  }
  return out;
});

let worst = { r: 99, what: "" };
const failures = [];
for (const s of contrast) {
  const r = (() => {
    const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const L = ([x, y, z]) => 0.2126 * f(x) + 0.7152 * f(y) + 0.0722 * f(z);
    const a = L((s.color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number));
    const b = L((s.bg.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number));
    const [hi, lo] = [a, b].sort((m, n) => n - m);
    return (hi + 0.05) / (lo + 0.05);
  })();
  // WCAG large-text threshold: 18.66px at 700, or 24px at any weight.
  const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
  const need = large ? 3 : 4.5;
  if (r < worst.r) worst = { r, what: `${s.text} (${s.color} on ${s.bg}, ${s.size}px)` };
  if (r < need) failures.push(`${s.text} — ${r.toFixed(2)}:1, needs ${need} (${s.color} on ${s.bg}, ${s.size}px)`);
}

check(failures.length === 0, `${contrast.length} text runs clear WCAG AA`, failures.slice(0, 4).join("  ·  "));
console.log(`        lowest passing: ${worst.r.toFixed(2)}:1 — ${worst.what}`);

/* ── 4. The page is light even when the app is dark ──────────────────────── */

console.log("\nTheme isolation");

// `colorScheme` does NOT switch this app's theme — next-themes reads a stored
// preference and stamps a class on <html> — so a headless dark check that does
// not write localStorage is just re-testing light. That mistake shipped once.
const dark = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await dark.addInitScript(() => window.localStorage.setItem("theme", "dark"));
await dark.goto(BASE, { waitUntil: "networkidle" });
await dark.waitForTimeout(1200);

const themed = await dark.evaluate(() => ({
  htmlClass: document.documentElement.className,
  pageBg: getComputedStyle(document.querySelector("main").parentElement).backgroundColor,
  headingColor: getComputedStyle(document.querySelector("h1")).color,
}));

check(/dark/.test(themed.htmlClass), "the app really is in dark mode for this check", themed.htmlClass || "(no class)");
check(themed.pageBg === "rgb(238, 241, 234)", "the landing ground stays ledger paper", themed.pageBg);
check(themed.headingColor === "rgb(21, 36, 27)", "the headline stays ledger ink", themed.headingColor);

await dark.close();

/* ── 5. The three interactions the page's argument depends on ────────────── */

console.log("\nInteraction");

const figure = page.locator('button[aria-label*="show receipt"]');
await figure.scrollIntoViewIfNeeded();
await figure.click();
await page.waitForTimeout(500);
check(await page.locator('[role="region"][aria-label*="Receipt"]').isVisible(), "a figure opens its receipt");

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check(
  (await page.locator('[role="region"][aria-label*="Receipt"]').count()) === 0,
  "Escape closes the receipt",
);
check(await figure.evaluate((n) => n === document.activeElement), "and focus returns to the figure");

const rows = page.locator('ul li[class*="sourceRow"]');
const total = await rows.count();
await page.locator('input[type="search"]').fill("cal");
await page.waitForTimeout(300);
const after = await rows.count();
const struck = await page.locator('li[class*="sourceStruck"]').count();
check(after === total, "searching strikes sources off rather than hiding them", `${total} → ${after}`);
check(struck > 0 && struck < total, "and some, not all, are struck", `${struck} of ${total}`);

await page.close();

/* ── 6. Reduced motion gets the conclusion, not a faster performance ─────── */

console.log("\nReduced motion");

const still = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await still.goto(BASE, { waitUntil: "networkidle" });
await still.waitForTimeout(400); // deliberately BEFORE the sequence would end

const final = await still.evaluate(() => {
  const resolved = document.querySelector('[class*="heroResolved"]');
  const strike = document.querySelector('[class*="strike"]');
  return {
    figure: resolved?.textContent?.match(/\b41\b/) ? "41" : resolved?.textContent ?? "",
    resolvedOpacity: resolved ? getComputedStyle(resolved).opacity : "0",
    strikeScale: strike ? getComputedStyle(strike).transform : "none",
    railAnimation: getComputedStyle(document.querySelector('[class*="railTrack"]')).animationName,
  };
});

check(final.figure === "41", "the hero figure reads its final value at once", final.figure);
check(Number(final.resolvedOpacity) === 1, "the resolved row is already in place", final.resolvedOpacity);
const xScale = Math.hypot(...(final.strikeScale.match(/-?\d+(\.\d+)?/g) ?? [0, 0]).slice(0, 2).map(Number));
check(Math.abs(xScale - 1) < 0.02, "the struck rows are already struck", `x-scale ${xScale.toFixed(3)} from ${final.strikeScale}`);
check(final.railAnimation === "none", "the source rail does not scroll", final.railAnimation);

await still.close();
await browser.close();

console.log(
  fails.length === 0
    ? "\nPASS — the front door measures up.\n"
    : `\nFAIL — ${fails.length}:\n${fails.map((f) => `  · ${f}`).join("\n")}\n`,
);
process.exit(fails.length === 0 ? 0 : 1);
