/**
 * THE FRONT DOOR, MEASURED.
 *
 * Rewritten for the rebuild. The page it used to check had a photographic sky,
 * a product window straddling a seam, and a marquee — none of which exist any
 * more, so every geometric assertion in it was measuring furniture that had
 * been removed.
 *
 * WHAT IT CHECKS NOW, and why each one needs a browser:
 *
 *   1. THE ARITHMETIC RECONCILES. Read out of the rendered DOM and actually
 *      subtracted. This is the page's entire claim, it was WRONG on the live
 *      site (123 / 82 / 41, which gives 38), and no source check can catch it
 *      because the numbers are three separate strings in three components.
 *   2. CONTRAST, FROM PIXELS. Translucent and inherited ink has no colour of
 *      its own; `getComputedStyle` returns the declaration, not what a reader
 *      sees. The page is photographed twice — with the ink and without — and
 *      the pixel inside each text box that differs most between the frames is
 *      the middle of a glyph.
 *   3. NO TWO-LETTER TOOL CHIPS. Fourteen connectors have no logo, and the
 *      product's shared mark falls back to initials, which on a marketing page
 *      read as fourteen broken images.
 *   4. NO SIDEWAYS SCROLL at four widths.
 *   5. ONE H1, and the section order the nav promises.
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

/**
 * Everything sampled, hidden so its ground can be photographed. The list and
 * the list of probes below are maintained together: a selector that stops
 * matching must turn the run red rather than shrink it.
 */
const HIDE = `
  .lander h1, .lander h1 span, .t-body-lg, .ledger-clause, .ledger-figure,
  .receipt-n, .receipt-what, .receipt-figure, .stat-body, .faq-answer
  { visibility: hidden !important }
`;

const browser = await chromium.launch();

for (const [w, h, name, theme] of [
  [1600, 1000, "desktop 1600", "mix"],
  [1280, 900, "desktop 1280", "mix"],
  [1280, 900, "desktop dark", "dark"],
  [768, 1024, "tablet 768", "mix"],
  [380, 800, "phone 380", "mix"],
]) {
  console.log(`\n${name} ${w}x${h}`);
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* The theme is a CLASS from next-themes out of localStorage, default `mix`.
     Setting Playwright's colorScheme alone changes `prefers-color-scheme` and
     nothing else — this check spent a release re-testing the light theme under
     the word "dark". */
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* a context that refuses storage still renders the default */
    }
  }, theme);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction((t) => document.documentElement.classList.contains(t), theme, { timeout: 5_000 })
    .catch(() => {});
  check(
    await page.evaluate((t) => document.documentElement.classList.contains(t), theme),
    `the ${theme} theme is actually applied`,
  );
  await page.waitForTimeout(500);

  // ── structure ────────────────────────────────────────────────────────────
  const shape = await page.evaluate(() => ({
    h1: document.querySelectorAll("h1").length,
    sections: [...document.querySelectorAll("main section[id]")].map((n) => n.id),
    docWidth: document.documentElement.scrollWidth,
    /* A chip with no mark and a label of two characters is the initials
       fallback leaking onto the page. */
    stubs: [...document.querySelectorAll(".tool-chip:not([data-marked])")]
      .map((n) => n.textContent.trim())
      .filter((t) => t.length <= 2),
    blueNonLinks: [...document.querySelectorAll("main p span, main li span")].filter((n) => {
      const c = getComputedStyle(n).color;
      return /rgb\(47, 95, 216\)/.test(c) && !n.closest("a");
    }).length,
  }));

  check(shape.h1 === 1, "exactly one H1", `${shape.h1}`);
  check(
    JSON.stringify(shape.sections) ===
      JSON.stringify(["problem", "proof", "how", "compare", "ai", "integrations", "pricing", "faq"]),
    "the page tells its story in order",
    shape.sections.join(" → "),
  );
  check(shape.docWidth <= w + 1, "nothing pushes the page wider than the viewport", `${shape.docWidth} > ${w}`);
  check(shape.stubs.length === 0, "no tool renders as a two-letter stub", shape.stubs.join(", "));
  check(shape.blueNonLinks === 0, "nothing that is not a link is painted like one", `${shape.blueNonLinks} found`);

  // ── THE ARITHMETIC ───────────────────────────────────────────────────────
  const sums = await page.evaluate(() =>
    [...document.querySelectorAll(".receipt")].map((r) => ({
      figure: r.querySelector(".receipt-figure")?.textContent.trim(),
      lines: [...r.querySelectorAll(".receipt-line")].map((l) => ({
        n: Number(l.querySelector(".receipt-n")?.textContent.replace(/[^0-9.-]/g, "")),
        excluded: l.hasAttribute("data-excluded"),
        total: l.hasAttribute("data-total"),
      })),
    })),
  );
  check(sums.length === 3, "the receipt appears three times", `${sums.length}`);
  sums.forEach((r, i) => {
    const [arrived, excluded, considered, matched, unique] = r.lines.map((l) => l.n);
    check(
      arrived - excluded === considered,
      `receipt ${i + 1}: arrived − excluded = considered`,
      `${arrived} − ${excluded} ≠ ${considered}`,
    );
    check(
      considered - matched === unique,
      `receipt ${i + 1}: considered − matched = unique`,
      `${considered} − ${matched} ≠ ${unique}`,
    );
    check(
      String(unique) === r.figure,
      `receipt ${i + 1}: the stated figure is the one the working arrives at`,
      `${r.figure} vs ${unique}`,
    );
    check(r.lines.filter((l) => l.excluded).length === 1, `receipt ${i + 1}: exactly one excluded line is marked`);
  });

  // ── contrast, from pixels ────────────────────────────────────────────────
  const found = await page.evaluate(() => {
    const out = [];
    const missing = [];
    const add = (sel, label) => {
      const el = document.querySelector(sel);
      if (!el) {
        missing.push(label);
        return;
      }
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const cs = getComputedStyle(el);
      out.push({
        label,
        sel,
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight),
      });
    };
    add(".lander h1 span", "the headline");
    add(".t-body-lg", "a standfirst");
    add(".ledger-clause", "a ledger clause");
    add(".ink-block .receipt-line:not([data-excluded]) .receipt-what", "a working line on the dark block");
    add(".ink-block .receipt-line[data-excluded] .receipt-what", "the excluded line's amber");
    add(".stat-body", "a proof-strip fact");
    return { out, missing };
  });
  check(found.missing.length === 0, "every text the sampler looks for is on the page", found.missing.join(", "));

  for (const spot of found.out) {
    /* Each probe is photographed where it lives: one element is scrolled into
       view, the strip around it is captured twice, and the pixel that differs
       most is the middle of a glyph. Scrolling per-probe rather than sampling
       one screenful is what lets this reach the dark block and the ledger in
       the same run. */
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    }, spot.sel);
    if (box.width < 4 || box.height < 4 || box.y < 0 || box.y + box.height > h) continue;

    const withInk = await page.screenshot({ clip: box });
    const tag = await page.addStyleTag({ content: HIDE });
    await page.waitForTimeout(120);
    const noInk = await page.screenshot({ clip: box });
    await tag.evaluate((n) => n.remove());

    const measured = await page.evaluate(
      async ({ a, b }) => {
        const load = (buf) =>
          new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.src = `data:image/png;base64,${buf}`;
          });
        const [A, B] = await Promise.all([load(a), load(b)]);
        const ctx = (img) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, img.width, img.height).data;
        };
        const p = ctx(A);
        const q = ctx(B);
        let best = -1;
        let ink = null;
        let ground = null;
        for (let i = 0; i < p.length; i += 4) {
          const d = Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
          if (d > best) {
            best = d;
            ink = [p[i], p[i + 1], p[i + 2]];
            ground = [q[i], q[i + 1], q[i + 2]];
          }
        }
        return { ink, ground, delta: best };
      },
      { a: withInk.toString("base64"), b: noInk.toString("base64") },
    );

    if (measured.delta < 30) {
      check(false, `${spot.label} was measurable`, `only Δ${measured.delta} between the two frames`);
      continue;
    }
    const r = ratio(measured.ink, measured.ground);
    // WCAG 1.4.3: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1.
    const large = spot.size >= 24 || (spot.size >= 18.66 && spot.weight >= 700);
    const need = large ? 3 : 4.5;
    check(r >= need, `${spot.label} is legible`, `${r.toFixed(2)}:1, needs ${need} at ${spot.size}px/${spot.weight}`);
  }

  check(errors.length === 0, "no uncaught page errors", errors.join(" · "));
  await page.close();
}

await browser.close();
if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${[...new Set(fails)].join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — the front door holds its shape, and the arithmetic reconciles.");
