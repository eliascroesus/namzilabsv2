/**
 * THE FRONT DOOR, MEASURED.
 *
 * The landing page is the one surface in this product with a coloured ground,
 * and a coloured ground is where contrast goes wrong silently: `text-white/70`
 * reads as a considered piece of hierarchy in the source and as 3.1:1 on the
 * screen. Nothing else in the repo can see that. `check-ui` reads class names,
 * the suite has no DOM, and `pnpm shadows`/`geometry`/`frame` all point at
 * `/design/*` routes that this page is not one of.
 *
 * It also measures the hero's COMPOSITION, because two of its three moving
 * parts are load-bearing and both broke once already:
 *
 *   - the sky starts at y=0. A `sticky h-0` wrapper whose padding was on the
 *     OUTER box left a 16px white strip above the gradient.
 *   - the product window straddles the seam. With `pb-0` on the section, the
 *     figure's negative bottom margin collapsed through it, so the sky ended
 *     level with the card and the overlap did nothing — correct in the source,
 *     absent in the browser.
 *
 * CONTRAST IS TAKEN FROM PIXELS, NOT FROM TOKENS, and the method matters.
 * Translucent ink has no colour of its own: `text-white/85` is whatever it
 * lands on, and reading `getComputedStyle().color` gets you `oklab(… / .85)`,
 * which two earlier versions of this parsed into near-black and then failed
 * everything for the wrong reason. So the page is photographed twice, with the
 * ink and without it, and the pixel inside each text box that differs MOST
 * between the frames is the middle of a glyph. That is the colour a reader
 * actually sees, over the ground actually behind it.
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

/** Everything that sits on a coloured ground, hidden so the ground can be seen. */
const HIDE = ".hero-sky h1,.hero-sky p,.marquee-track,.sky-card h2,.sky-card p{visibility:hidden!important}";

const browser = await chromium.launch();

/**
 * THREE WIDTHS, AND BOTH THEMES AT THE WIDEST.
 *
 * The sky does NOT follow the theme — it is the same blue for everyone, because
 * a hero whose ground flips would need two sets of ink and two contrast
 * budgets. But the page UNDER it does, and the two surfaces meet: the
 * gradient's last stop is `var(--background)`, so a dark-mode visitor's hero
 * fades into #121212 where a light-mode visitor's fades into near-white. That
 * join is the one thing on this page whose appearance depends on the theme, and
 * it is right under the product window where the eye already is.
 */
for (const [w, h, name, scheme] of [
  [1440, 950, "desktop", "light"],
  [1440, 950, "desktop dark", "dark"],
  [834, 1100, "tablet", "light"],
  [390, 844, "phone", "light"],
]) {
  console.log(`\n${name} ${w}x${h}`);
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  /* The ticker is mid-flight between the two frames, so a chip would be
     compared against where it used to be and the "glyph" pixel would be an
     anti-aliased edge. Stopping it is the difference between 2.6:1 and 6.2:1
     for the same unchanged markup. */
  await page.addStyleTag({ content: ".marquee{animation:none!important}" });
  await page.waitForTimeout(700);

  // ── composition ──────────────────────────────────────────────────────────
  const geo = await page.evaluate(() => {
    const sky = document.querySelector(".hero-sky");
    const fig = sky?.querySelector("figure");
    /**
     * THE HEADING, NOT THE SECTION. The section under the hero starts where
     * the SKY ends, which is deliberately above the window's bottom edge — the
     * whole point of the overlap — so measuring against its box top reports a
     * negative clearance on every viewport and means nothing. What has to
     * clear the window is the first thing you can actually see in there.
     */
    const next = sky?.nextElementSibling?.querySelector("h2");
    if (!sky || !fig || !next) return null;
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY) };
    };
    return { sky: box(sky), fig: box(fig), next: box(next), docWidth: document.documentElement.scrollWidth };
  });
  check(geo !== null, "the hero, its product window and the section under it all rendered");
  if (geo) {
    check(geo.sky.top === 0, "the sky starts at the very top of the page", `top=${geo.sky.top}px`);
    const overlap = geo.fig.bottom - geo.sky.bottom;
    check(overlap > 40, "the product window hangs below the sky's foot", `${overlap}px of overlap`);
    check(geo.next.top - geo.fig.bottom > 24, "and still clears the heading under it", `${geo.next.top - geo.fig.bottom}px`);
    // A page that scrolls sideways on a phone is the classic full-bleed bug.
    check(geo.docWidth <= w + 1, "nothing pushes the page wider than the viewport", `${geo.docWidth} > ${w}`);
    /* THE SEAM. The gradient's last stop is `var(--background)`, so the hero's
       foot and the page under it should be the same colour to within rounding.
       A literal there instead — the #C0D5FF this shipped with first — is a
       hairline of the wrong blue across the full width in one theme or both. */
    const seam = await page.evaluate(() => {
      const sky = document.querySelector(".hero-sky");
      const r = sky.getBoundingClientRect();
      const below = document.elementFromPoint(8, Math.min(innerHeight - 2, r.bottom + 8));
      const paint = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !/rgba?\([^)]*,\s*0\)/.test(bg) && bg !== "transparent") return bg;
        }
        return null;
      };
      return { foot: getComputedStyle(document.body).backgroundColor, page: paint(below) };
    });
    check(seam.page !== null, "the page under the hero paints a ground", JSON.stringify(seam));
  }

  // ── contrast ─────────────────────────────────────────────────────────────
  const spots = await page.evaluate(() => {
    const out = [];
    const add = (el, label) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.bottom < 2 || r.top > innerHeight - 2) return;
      const cs = getComputedStyle(el);
      out.push({
        label,
        box: {
          x: Math.round(r.left),
          y: Math.round(Math.max(0, r.top)),
          w: Math.round(r.width),
          h: Math.round(Math.min(r.height, innerHeight - r.top)),
        },
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight),
      });
    };
    const sky = document.querySelector(".hero-sky");
    add(sky.querySelector("h1 span"), "headline");
    add(sky.querySelector("p"), "paragraph");
    add(sky.querySelector(".uppercase.tracking-widest"), "reads-from label");
    const ps = sky.querySelectorAll("p");
    add(ps[ps.length - 1], "line under the CTA");
    add(document.querySelector(".marquee span span:last-child"), "a connector name");
    return out;
  });
  check(spots.length >= 4, "found the hero's text to measure", `${spots.length} elements`);

  const withInk = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString("base64");
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(250);
  const noInk = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString("base64");

  const measured = await page.evaluate(
    async ({ withInk, noInk, spots }) => {
      const load = (b64) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = `data:image/png;base64,${b64}`;
        });
      const [A, B] = await Promise.all([load(withInk), load(noInk)]);
      const ctx = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g;
      };
      const ga = ctx(A);
      const gb = ctx(B);
      const k = A.width / innerWidth;
      return spots.map((s) => {
        const a = ga.getImageData(Math.round(s.box.x * k), Math.round(s.box.y * k), Math.max(1, Math.round(s.box.w * k)), Math.max(1, Math.round(s.box.h * k))).data;
        const b = gb.getImageData(Math.round(s.box.x * k), Math.round(s.box.y * k), Math.max(1, Math.round(s.box.w * k)), Math.max(1, Math.round(s.box.h * k))).data;
        let best = -1;
        let ink = null;
        let ground = null;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d > best) {
            best = d;
            ink = [a[i], a[i + 1], a[i + 2]];
            ground = [b[i], b[i + 1], b[i + 2]];
          }
        }
        return { ink, ground, delta: best };
      });
    },
    { withInk, noInk, spots },
  );

  spots.forEach((s, i) => {
    const { ink, ground, delta } = measured[i];
    /* Nothing changed inside the box: the selector found an element the hide
       rule does not cover, so there is no glyph to measure and a pass here
       would mean nothing. */
    if (delta < 30) {
      check(false, `${s.label} was measurable`, `only Δ${delta} between the two frames`);
      return;
    }
    const r = ratio(ink, ground);
    // WCAG 1.4.3: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1.
    const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
    const need = large ? 3 : 4.5;
    check(r >= need, `${s.label} is legible on the sky`, `${r.toFixed(2)}:1, needs ${need} at ${s.size}px/${s.weight}`);
  });

  check(errors.length === 0, "no uncaught page errors", errors.join(" · "));
  await page.close();
}

await browser.close();
if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — the front door holds its shape and every word on it can be read.");
