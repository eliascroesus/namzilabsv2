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

/**
 * Everything that sits on a coloured ground, hidden so the ground can be seen.
 *
 * `.marquee span > span` AND NOT `.marquee-track`, which is what this said
 * first and what made it lie for two rounds. Hiding the whole ticker takes the
 * CHIPS with it, so the "ground" behind a connector name sampled as raw sky and
 * the chip's own dark wash — the thing put there specifically to make the name
 * legible — was never measured. It reported 4.47:1 for text that is actually
 * at 6.9:1, and no amount of darkening the chip moved the number, which is the
 * tell: a measurement that does not respond to the fix is measuring something
 * else. Hiding the label and the mark leaves the pill itself painting.
 */
/**
 * EVERYTHING THAT SITS ON A COLOURED GROUND, hidden so the ground can be seen.
 *
 * `.sky-panel` JOINED THE LIST when the rebuild put three more blue surfaces on
 * the page — the facts band, the how-it-works section and the assistant card.
 * Leaving it out would not have failed anything: the sampler simply would not
 * have looked there, and forty-odd words of white-on-blue would have shipped
 * unmeasured. That is the failure mode this whole script exists for, so the
 * selector list and the list of things sampled are now maintained together.
 *
 * `.glass-card` is NOT hidden and must not be: it is a translucent white pane
 * and it is part of the GROUND under the tool-name chips sitting on it. Hiding
 * it would sample those names against raw sky and report a contrast the reader
 * never experiences — the same mistake `.marquee-track` made here twice.
 */
const HIDE =
  ".cloud-sky h1,.cloud-sky p,.marquee span > span,.sky-card h2,.sky-card p," +
  ".sky-panel h2,.sky-panel p,.sky-panel li" +
  "{visibility:hidden!important}";

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
/**
 * THE "DARK" ROW WAS NEVER DARK, and finding that out is why this loop now
 * writes to localStorage instead of setting `colorScheme`.
 *
 * The theme here is a CLASS on the root element — `@custom-variant dark
 * (&:where(.dark, .dark *))` — driven by next-themes out of localStorage, and
 * its default is `mix` rather than `system`. A Playwright context that sets
 * `colorScheme: "dark"` changes what `prefers-color-scheme` reports and
 * nothing else, so next-themes went on applying `mix` and this row re-tested
 * the same pixels as the row above it under a different name. It printed four
 * extra `ok`s per run and could not have failed.
 *
 * `addInitScript` puts the key in before any script on the page runs, which is
 * also early enough to beat the inline anti-flash script next-themes injects.
 *
 * THREE THEMES, NOT TWO: `mix` is what a browser with nothing stored actually
 * gets — the owner's call — so it is the one most visitors see and the one
 * worth measuring widest. The sky does not follow the theme, but the page
 * under it does, and the two meet right where the product window straddles the
 * seam.
 */
for (const [w, h, name, theme] of [
  [1440, 950, "desktop", "mix"],
  [1440, 950, "desktop dark", "dark"],
  [1440, 950, "desktop light", "light"],
  [834, 1100, "tablet", "mix"],
  [390, 844, "phone", "mix"],
]) {
  console.log(`\n${name} ${w}x${h}`);
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* A context that refuses storage still renders the default, which is a
         legitimate thing to photograph — it must not abort the run. */
    }
  }, theme);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  /* The class is applied by next-themes after hydration, so the assertion has
     to wait for it rather than for the network. Without this the first
     screenshot of a "dark" pass catches the page mid-swap. */
  await page
    .waitForFunction((t) => document.documentElement.classList.contains(t), theme, { timeout: 5_000 })
    .catch(() => {});
  check(
    await page.evaluate((t) => document.documentElement.classList.contains(t), theme),
    `the ${theme} theme is actually applied`,
    "the root element never got the class — this pass would re-test the default",
  );
  await page.evaluate(() => document.fonts.ready);
  /* The ticker is mid-flight between the two frames, so a chip would be
     compared against where it used to be and the "glyph" pixel would be an
     anti-aliased edge. Stopping it is the difference between 2.6:1 and 6.2:1
     for the same unchanged markup. */
  await page.addStyleTag({ content: ".marquee{animation:none!important}" });
  await page.waitForTimeout(700);

  // ── composition ──────────────────────────────────────────────────────────
  const geo = await page.evaluate(() => {
    const sky = document.querySelector(".cloud-sky");
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
    /* THE WINDOW BY NAME, not by position. This read `fig.firstElementChild`,
       which was the product window right up until the pipe field was moved
       inside the figure and became the first child — at which point the ratio
       assertion was measuring a 7rem strip of pipe. It failed, which is the
       system working, but the fix is to stop describing the element by where
       it happens to sit among its siblings. */
    const win = fig.querySelector("[data-product-window]");
    if (!win) return null;
    const frame = win.getBoundingClientRect();
    return {
      sky: box(sky),
      fig: box(fig),
      next: box(next),
      docWidth: document.documentElement.scrollWidth,
      frameRatio: frame.width / frame.height,
      sections: [...document.querySelectorAll("main section[id]")].map((n) => n.id),
    };
  });
  check(geo !== null, "the hero, its product window and the section under it all rendered");
  if (geo) {
    /* THE ORDER IS THE ARGUMENT. Problem, then proof, then how, then the AI,
       then what it reads: each section only lands on somebody who has read the
       one before it, and the anchors in the nav promise exactly this list. */
    check(
      JSON.stringify(geo.sections) ===
        JSON.stringify(["problem", "proof", "how", "compare", "ai", "integrations", "pricing", "faq"]),
      "the page tells its story in order",
      geo.sections.join(" → "),
    );
  }
  if (geo) {
    check(geo.sky.top === 0, "the sky starts at the very top of the page", `top=${geo.sky.top}px`);
    const overlap = geo.fig.bottom - geo.sky.bottom;
    check(overlap > 40, "the product window hangs below the sky's foot", `${overlap}px of overlap`);
    check(geo.next.top - geo.fig.bottom > 24, "and still clears the heading under it", `${geo.next.top - geo.fig.bottom}px`);
    // A page that scrolls sideways on a phone is the classic full-bleed bug.
    check(geo.docWidth <= w + 1, "nothing pushes the page wider than the viewport", `${geo.docWidth} > ${w}`);
    /* 16:9 FROM `sm` UP, 4:3 BELOW IT. The window used to be as tall as its
       own content — 309px of board inside a 1152px card, a letterbox rather
       than a screen — and the frame that fixes that is one class nothing else
       would notice losing. 4:3 on a phone because a 390px-wide 16:9 box is
       219px tall and the cards inside it stop being readable. */
    const want = w >= 640 ? 16 / 9 : 4 / 3;
    check(
      Math.abs(geo.frameRatio - want) < 0.02,
      `the product window is ${w >= 640 ? "16:9" : "4:3"}`,
      `measured ${geo.frameRatio.toFixed(3)}, wanted ${want.toFixed(3)}`,
    );
    /* THE SEAM. The gradient's last stop is `var(--background)`, so the hero's
       foot and the page under it should be the same colour to within rounding.
       A literal there instead — the #C0D5FF this shipped with first — is a
       hairline of the wrong blue across the full width in one theme or both. */
    const seam = await page.evaluate(() => {
      const sky = document.querySelector(".cloud-sky");
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
  /**
   * ONE CONTRAST PASS, RUN ONCE PER COLOURED SURFACE.
   *
   * WHY THIS IS NOW A FUNCTION. It used to run inline, exactly once, against
   * the hero — which was the only blue on the page when it was written. The
   * rebuild added three more coloured grounds below the fold (the facts band,
   * the how-it-works section, the assistant card), and every one of them
   * carries white type. Left as it was, this script would have gone on
   * reporting PASS while measuring a quarter of the white-on-blue text on the
   * page.
   *
   * The method is unchanged and the method is the point: photograph the strip
   * twice, once with the ink and once with it hidden, and take the pixel that
   * differs MOST inside each text box. Translucent ink has no colour of its
   * own — `text-white/85` is whatever it lands on — so `getComputedStyle`
   * cannot answer this and only the rendered pixel can.
   */
  const measure = async (label, scrollTo, collect) => {
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
    await page.waitForTimeout(250);

    const found = await page.evaluate(collect);
    if (found.missing.length) {
      check(false, `${label}: every text the sampler looks for is on the page`, found.missing.join(", "));
    }
    if (!found.out.length) {
      check(false, `${label}: found text to measure`, "no elements in the viewport");
      return;
    }

    const withInk = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString("base64");
    /* The hide rule goes on and comes back OFF, because this function runs
       several times against the same page. Left on, every pass after the first
       would photograph an already-blank page and report Δ0 for everything. */
    const tag = await page.addStyleTag({ content: HIDE });
    await page.waitForTimeout(250);
    const noInk = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString("base64");
    await tag.evaluate((n) => n.remove());

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
          const box = [
            Math.round(s.box.x * k),
            Math.round(s.box.y * k),
            Math.max(1, Math.round(s.box.w * k)),
            Math.max(1, Math.round(s.box.h * k)),
          ];
          const a = ga.getImageData(...box).data;
          const b = gb.getImageData(...box).data;
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
      { withInk, noInk, spots: found.out },
    );

    found.out.forEach((s, i) => {
      const { ink, ground, delta } = measured[i];
      /* Nothing changed inside the box: the selector found an element the hide
         rule does not cover, so there is no glyph to measure and a pass here
         would mean nothing. */
      if (delta < 30) {
        check(false, `${label}: ${s.label} was measurable`, `only Δ${delta} between the two frames`);
        return;
      }
      const r = ratio(ink, ground);
      // WCAG 1.4.3: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1.
      const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
      const need = large ? 3 : 4.5;
      check(
        r >= need,
        `${label}: ${s.label} is legible`,
        `${r.toFixed(2)}:1, needs ${need} at ${s.size}px/${s.weight}`,
      );
    });
  };

  // ── the hero ─────────────────────────────────────────────────────────────
  await measure("hero", 0, () => {
    const out = [];
    const missing = [];
    const add = (el, label) => {
      if (!el) {
        missing.push(label);
        return;
      }
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
    const sky = document.querySelector(".cloud-sky");
    add(sky.querySelector("h1 span"), "headline");
    add(sky.querySelector("p"), "paragraph");
    /* THE "READS FROM" LABEL AND THE LINE UNDER THE CTA WERE BOTH SAMPLED HERE
       AND BOTH ARE GONE, removed from the hero at the owner's ask. The probes
       come out with them rather than being re-pointed at whatever is nearest:
       the marquee's wrapper carries no text of its own, so a probe aimed at it
       would report "not measurable", and a check that keeps a hook alive by
       moving it somewhere convenient is a check that passes by measuring
       nothing. What remains in this half of the sky — the headline, the
       paragraph and the connector chips — is still measured. */
    /**
     * A CHIP FROM THE MIDDLE OF THE TRACK, not the first one in the DOM.
     *
     * `.marquee-track` fades its ends out with a mask — that is what makes a
     * ticker read as continuous rather than as a clipped div — so the chip at
     * x=0 is half transparent BY DESIGN, and measuring it reports the fade as
     * a contrast bug.
     */
    const chip = [...document.querySelectorAll(".marquee span span:last-child")].find((n) => {
      const c = n.getBoundingClientRect();
      const mid = c.left + c.width / 2;
      return mid > innerWidth * 0.25 && mid < innerWidth * 0.75;
    });
    add(chip, "a connector name");
    return { out, missing };
  });

  /**
   * ── every other blue surface ───────────────────────────────────────────
   *
   * EACH SURFACE DECLARES WHAT IT EXPECTS TO BE MEASURED, and that list is the
   * whole point of this block. The first version probed the same four generic
   * selectors everywhere and let a miss slide, which failed in both directions
   * at once: the facts band has no heading inside it — its h2 sits in the white
   * column beside it — so it reported a missing hook that was never there,
   * while `#how` matched its step card on `li` and "measured" an opaque white
   * card against the blue behind it. That one passed at 11:1 and tested
   * nothing.
   *
   * So: only white-on-blue TEXT is listed, never a container, and a selector
   * that matches nothing turns the run red. Dark ink on the glass cards is not
   * here on purpose — it is ordinary `--foreground` on `--card`, governed by
   * the token layer and by `check:ui`, and pulling it into a script that hides
   * its own ground would measure it against the sky two layers down.
   */
  for (const [sel, label, probes] of [
    /* TWO BLUE SURFACES LEFT, DOWN FROM FOUR. The page went to daylight at the
       owner's ask, so the facts band and the how-it-works section are ordinary
       ink on the page's own ground and the token layer governs them. These two
       are the only places white type still sits on a fill — the assistant card
       (the invite board's sky, kept because he named it) and the closing
       card — and they are the only places a contrast bug can hide from
       `check:ui`. */
    ["#ai .sky-panel", "the assistant card", [["h2", "heading"], ["p", "body copy"], ["li", "a tool-name chip"]]],
    [".sky-card", "the closing card", [["h2", "heading"], ["p", "body copy"]]],
  ]) {
    const y = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      /* Centre the surface in the viewport so its type is not clipped at an
         edge, but never scroll past the document's own end.
         
         AND NEVER PUT ITS TOP UNDER THE NAV. The capsule is sticky, 
         translucent white and about 80px tall, so a surface taller than the
         viewport — which is every one of these on a phone — got scrolled until
         its first line sat behind the glass, and the sampler dutifully
         measured white-on-blue through a 55%-white bar at 2.09:1. The text is
         not broken; that is simply not where anybody reads it. 96px clears the
         capsule and its inset. */
      const want = r.top + scrollY - Math.max(96, (innerHeight - r.height) / 2);
      return Math.max(0, Math.min(want, document.documentElement.scrollHeight - innerHeight));
    }, sel);

    if (y === null) {
      check(false, `${label} is on the page`, `no element matches ${sel}`);
      continue;
    }

    await measure(label, y, `(() => {
      const out = [];
      const missing = [];
      const root = document.querySelector(${JSON.stringify(sel)});
      if (!root) return { out, missing: ["the surface itself"] };
      for (const [css, name] of ${JSON.stringify(probes)}) {
        const el = root.querySelector(css);
        if (!el) { missing.push(name + " (" + css + ")"); continue; }
        const r = el.getBoundingClientRect();
        /* Off-screen is not the same as absent: the surface is centred in the
           viewport above, so anything that still falls outside it is taller
           than the screen and its first line was measured anyway. */
        if (r.width < 4 || r.bottom < 2 || r.top > innerHeight - 2) continue;
        const cs = getComputedStyle(el);
        out.push({
          label: name,
          box: {
            x: Math.round(r.left),
            y: Math.round(Math.max(0, r.top)),
            w: Math.round(r.width),
            h: Math.round(Math.min(r.height, innerHeight - r.top)),
          },
          size: parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
        });
      }
      return { out, missing };
    })()`);
  }

  check(errors.length === 0, "no uncaught page errors", errors.join(" · "));
  await page.close();
}

await browser.close();
if (fails.length) {
  console.log(`\nFAIL — ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — the front door holds its shape and every word on it can be read.");
