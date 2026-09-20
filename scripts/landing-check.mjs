/**
 * THE FRONT DOOR, MEASURED.
 *
 * Nothing else in this repository can see this page. `check-ui` reads class
 * names and this page's are hashed CSS-module names; the vitest suite has no
 * DOM; `pnpm geometry`, `frame` and `shadows` all point at `/design/*` routes
 * that `/` is not one of. So a grid that blows out, ink below 4.5:1, or a page
 * that inverts in dark mode all ship green. This script is the only thing
 * standing between those and production.
 *
 * ═══ IT CHECKS THE RHYTHM, NOT JUST THE PIXELS ═══
 *
 * The design's own specification calls the scroll rhythm the most important
 * thing about it: density, alignment and weight change section by section, and
 * three rules enforce that — only two sections centre a heading, only two are
 * dark, only two break to full bleed. Those are exactly the rules a future
 * edit breaks by accident, one plausible section at a time, and no other check
 * in this repo could notice. So they are asserted here as counts.
 *
 * Usage: `pnpm dev` in one terminal, `pnpm landing` in another.
 * SHOT_BASE overrides http://localhost:3000. Exits non-zero on any failure.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";

/**
 * `networkidle` never settles against a real deployment — analytics and the
 * Vercel toolbar keep a socket warm — so waiting on it would pin this check
 * to localhost, the environment whose result matters least. The document plus
 * the webfont is both faster and the thing actually being asserted: the page
 * cannot be measured until the face it is designed in has arrived.
 */
const settle = async (page, url) => {
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
};

const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch();

/* ── 1. Geometry: nothing runs off the side, at three widths ─────────────── */

console.log("\nGeometry");

for (const vp of [
  { name: "XL 1440", width: 1440, height: 1000 },
  { name: "MD 834", width: 834, height: 1100 },
  { name: "XS 375", width: 375, height: 800 },
]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await settle(page, BASE);
  await page.waitForTimeout(3600); // the hero sequence ends at ~3.4s

  const m = await page.evaluate(() => {
    // A grid column declared `1fr` floors at its content's min-content width,
    // so one `white-space: nowrap` descendant can blow a whole grid past the
    // viewport while the page itself still refuses to scroll, because `main`
    // clips. That shipped once. This looks for the blow-out, not the scroll.
    const blown = [];
    for (const n of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "visible") continue;
      if (n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0) {
        blown.push(`${n.className.toString().replace(/snap-module__\w+__/g, "").slice(0, 30)} ${n.scrollWidth}>${n.clientWidth}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      // The track line deliberately runs 40px past the container at both ends
      // so the process reads as continuing; it is the one allowed overhang.
      blown: blown.filter((b) => !b.startsWith("track ")),
      h1Lines: document.querySelectorAll("h1 > span").length,
    };
  });

  check(m.scrollWidth <= m.inner + 1, `${vp.name}: the page does not scroll sideways`, `${m.scrollWidth} > ${m.inner}`);
  check(m.blown.length === 0, `${vp.name}: no grid or row blows past its container`, m.blown.slice(0, 3).join(" · "));
  check(errors.length === 0, `${vp.name}: no console errors`, errors.slice(0, 2).join(" | "));
  if (vp.width === 1440) check(m.h1Lines === 3, "the headline breaks on three fixed lines", `${m.h1Lines}`);

  if (vp.width === 375) {
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("a, button, input")]
        .filter((n) => {
          const b = n.getBoundingClientRect();
          // Off-screen until focused (the app's shared skip link) is not a
          // tap target, and is not this page's to change.
          return b.width > 0 && b.right > 0 && b.bottom > 0 && b.left < window.innerWidth + 200;
        })
        .filter((n) => {
          const b = n.getBoundingClientRect();
          return b.height < 44 || b.width < 44;
        })
        .map((n) => `${n.tagName}:${(n.textContent || "").trim().slice(0, 18)}`),
    );
    check(small.length === 0, "XS: every tap target clears 44×44", small.slice(0, 4).join(", "));
  }
  await page.close();
}

/* ── 2. The scroll rhythm (§4) — the design's core, and invisible to code ── */

console.log("\nScroll rhythm");

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await settle(page, BASE);
await page.waitForTimeout(3600);

const rhythm = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("main > section, main > div > section")];
  const isDark = (n) => {
    // A dark section is one whose own panel is painted ink.
    const panel = n.querySelector('[class*="darkPanel"]');
    if (!panel) return false;
    return getComputedStyle(panel).backgroundColor === "rgb(20, 20, 28)";
  };
  const fullBleed = sections.filter((n) => Math.round(n.getBoundingClientRect().width) >= window.innerWidth);
  const dark = sections.filter(isDark);
  // Only headings in LIGHT sections count: the dark closing panel centres
  // everything by design, which is a different kind of object.
  const centred = sections
    .filter((n) => !isDark(n))
    .filter((n) => {
      const h = n.querySelector("h1, h2");
      return h && getComputedStyle(h).textAlign === "center";
    });
  const paddings = sections.map((n) => getComputedStyle(n).paddingTop);
  return {
    total: sections.length,
    dark: dark.length,
    fullBleed: fullBleed.length,
    centred: centred.length,
    distinctPaddings: new Set(paddings).size,
  };
});

check(rhythm.dark === 2, "exactly two dark sections", `${rhythm.dark}`);
check(rhythm.fullBleed === 2, "exactly two full-bleed sections", `${rhythm.fullBleed}`);
check(rhythm.centred === 2, "exactly two centred headings among the light sections", `${rhythm.centred}`);
// Uniform padding is most of what makes a page feel mechanical; the spec
// varies it per section on purpose.
check(rhythm.distinctPaddings >= 4, "section padding varies rather than repeating", `${rhythm.distinctPaddings} distinct values`);

/* ── 3. Type ─────────────────────────────────────────────────────────────── */

console.log("\nTypography");

const type = await page.evaluate(() => {
  const h1 = getComputedStyle(document.querySelector("h1"));
  const figure = document.querySelector('[class*="f2"]');
  const monos = [...document.querySelectorAll("main *")].filter((n) =>
    /mono|courier/i.test(getComputedStyle(n).fontFamily),
  );
  return {
    figtree: document.fonts.check("800 104px Figtree"),
    family: h1.fontFamily,
    size: h1.fontSize,
    weight: h1.fontWeight,
    tabular: figure ? getComputedStyle(figure).fontVariantNumeric : "",
    monoCount: monos.length,
  };
});

check(type.figtree, "Figtree loaded", type.family);
check(type.size === "104px" && type.weight === "800", "the hero headline is D0", `${type.size}/${type.weight}`);
check(type.tabular.includes("tabular-nums"), "figures are tabular", type.tabular);
// §6.2: one family, and no monospace anywhere. A wide mono on a figure is
// what made an earlier build read as a form rather than as a product.
check(type.monoCount === 0, "no monospace anywhere on the page", `${type.monoCount} elements`);

/* ── 4. Contrast ─────────────────────────────────────────────────────────── */

console.log("\nContrast");

const runs = await page.evaluate(() => {
  const painted = (node) => {
    for (let n = node; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    }
    return "rgb(255, 255, 255)";
  };
  const out = [];
  for (const node of document.querySelectorAll("p, h1, h2, h3, span, a, li, dt, dd, button, input")) {
    const text = node.tagName === "INPUT" ? node.placeholder : node.textContent?.trim() ?? "";
    if (!text || (node.tagName !== "INPUT" && node.children.length > 0)) continue;
    // The two-letter source initials are white on coral, sky and lilac, which
    // is 2.6–3.2:1 and would fail outright as text. They are not text: the
    // squircle is aria-hidden, and every one of them sits beside its source
    // NAME set in ink. WCAG exempts incidental and logotype text on exactly
    // that basis — and the precondition is not taken on trust, it is asserted
    // by the "every source mark is paired with its name" check below. Remove
    // that check and this exemption stops being honest.
    if (node.closest("[aria-hidden='true']")) continue;
    const cs = getComputedStyle(node);
    if (Number(cs.opacity) < 0.9) continue;
    const size = parseFloat(cs.fontSize);
    const box = node.getBoundingClientRect();
    if (size < 10 || box.width < 4 || box.height < 4) continue;
    const colour = node.tagName === "INPUT" ? "" : cs.color;
    out.push({ text: text.slice(0, 32), colour, bg: painted(node), size, weight: Number(cs.fontWeight) });
  }
  return out;
});

const lum = (s) => {
  const [r, g, b] = (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

let worst = { r: 99, what: "" };
const bad = [];
for (const s of runs) {
  if (!s.colour) continue;
  const [hi, lo] = [lum(s.colour), lum(s.bg)].sort((a, b) => b - a);
  const r = (hi + 0.05) / (lo + 0.05);
  const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
  const need = large ? 3 : 4.5;
  if (r < worst.r) worst = { r, what: `${s.text} (${s.colour} on ${s.bg}, ${s.size}px)` };
  if (r < need) bad.push(`${s.text} — ${r.toFixed(2)}:1 needs ${need} (${s.colour} on ${s.bg}, ${s.size}px)`);
}

check(bad.length === 0, `${runs.length} text runs clear WCAG AA`, bad.slice(0, 4).join("  ·  "));
console.log(`        lowest passing: ${worst.r.toFixed(2)}:1 — ${worst.what}`);

// The precondition for exempting the source initials above: a mark that is
// NOT accompanied by its source name in real text is carrying information by
// colour and abbreviation alone, which §6.1 forbids without exception.
const unpaired = await page.evaluate(() => {
  const out = [];
  for (const mark of document.querySelectorAll('[class*="squircle"]')) {
    const holder = mark.parentElement?.closest("li, div, span, a");
    const initials = (mark.textContent || "").trim();
    const text = (holder?.textContent || "").replace(initials, "").trim();
    if (text.length < 3) out.push(initials);
  }
  return out;
});
check(unpaired.length === 0, "every source mark is paired with its name in text", unpaired.join(", "));

/* ── 5. The page stays light when the app is dark ────────────────────────── */

console.log("\nTheme isolation");

// `colorScheme` does NOT switch this app's theme — next-themes reads a stored
// preference and stamps a class on <html> — so a headless dark check that does
// not write localStorage is just re-testing light. That mistake shipped once.
const dark = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await dark.addInitScript(() => window.localStorage.setItem("theme", "dark"));
await settle(dark, BASE);
await dark.waitForTimeout(1200);

const themed = await dark.evaluate(() => ({
  htmlClass: document.documentElement.className,
  pageBg: getComputedStyle(document.querySelector("main").parentElement).backgroundColor,
  headingColour: getComputedStyle(document.querySelector("h1")).color,
}));

check(/dark/.test(themed.htmlClass), "the app really is in dark mode for this check", themed.htmlClass || "(none)");
check(themed.pageBg === "rgb(251, 250, 252)", "the landing ground stays canvas", themed.pageBg);
check(themed.headingColour === "rgb(20, 20, 28)", "the headline stays ink", themed.headingColour);
await dark.close();

/* ── 6. The two interactions the page's argument depends on ──────────────── */

console.log("\nInteraction");

const tabs = page.locator('[role="tab"]');
await tabs.first().scrollIntoViewIfNeeded();
const firstFigure = await page.locator('[class*="figureValue"]').innerText();
await tabs.nth(1).click();
await page.waitForTimeout(700);
const secondFigure = await page.locator('[class*="figureValue"]').innerText();
check(firstFigure !== secondFigure, "a metric tab swaps the figure", `${firstFigure} → ${secondFigure}`);
check(
  (await tabs.nth(1).getAttribute("aria-selected")) === "true",
  "and reports itself selected",
);

await tabs.nth(1).focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
check((await tabs.nth(2).getAttribute("aria-selected")) === "true", "arrow keys move between tabs");

const cells = page.locator('ul[class*="index"] > li');
const total = await cells.count();
await page.locator('input[type="search"]').fill("cal");
await page.waitForTimeout(600);
const after = await cells.count();
const dimmed = await page.locator('li[class*="indexDim"]').count();
check(after === total, "searching dims sources rather than removing them", `${total} → ${after}`);
check(dimmed > 0 && dimmed < total, "and some, not all, are dimmed", `${dimmed} of ${total}`);

await page.locator('input[type="search"]').fill("zzzz");
await page.waitForTimeout(500);
check(
  await page.getByText("Not here yet.").isVisible(),
  "an empty result is an invitation, not an apology",
);
await page.close();

/* ── 7. Reduced motion gets the conclusion, not a faster performance ─────── */

console.log("\nReduced motion");

const still = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await settle(still, BASE);
await still.waitForTimeout(400); // deliberately BEFORE the sequence would end

const final = await still.evaluate(() => {
  const resolved = document.querySelector('[class*="resolved"]');
  const chip = document.querySelector('[class*="chipRest"]');
  return {
    figure: (resolved?.textContent ?? "").includes("41"),
    resolvedOpacity: resolved ? getComputedStyle(resolved).opacity : "0",
    // The idle drift is the one thing on this page that would otherwise never
    // stop moving, which §10 names as a real accessibility problem.
    chipAnimation: chip ? getComputedStyle(chip).animationName : "none",
    railAnimation: getComputedStyle(document.querySelector('[class*="railTrack"]')).animationName,
  };
});

check(final.figure, "the hero figure reads its final value at once");
check(Number(final.resolvedOpacity) === 1, "the resolved card is already in place", final.resolvedOpacity);
check(final.chipAnimation === "none", "the idle drift loop is stopped", final.chipAnimation);
check(final.railAnimation === "none", "the source rail does not scroll", final.railAnimation);

await still.close();
await browser.close();

console.log(
  fails.length === 0
    ? "\nPASS — the front door measures up.\n"
    : `\nFAIL — ${fails.length}:\n${fails.map((f) => `  · ${f}`).join("\n")}\n`,
);
process.exit(fails.length === 0 ? 0 : 1);
