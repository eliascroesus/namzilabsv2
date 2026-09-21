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
  /**
   * THE HERO SHOT IS OPTIONAL, AND ITS ABSENCE IS NOT A BUG.
   *
   * `public/dashboard.png` is a file the owner drops in; until it exists the
   * page requests it, gets a 404 and falls back to the drawn card, which is
   * the designed behaviour. The browser still logs "Failed to load resource"
   * for it, so that ONE line is set aside — but narrowly: every other console
   * error still fails, and the missing URLs are asserted separately below, so
   * a genuinely broken asset cannot hide behind this.
   */
  const missingAssets = [];
  page.on("response", (r) => r.status() >= 400 && missingAssets.push(`${r.status()} ${decodeURIComponent(r.url())}`));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/Failed to load resource/.test(m.text())) return; // asserted by URL instead
    errors.push(m.text());
  });
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
      // Two overhangs are the design: S04's track line runs 40px past the
      // container at both ends so the process reads as continuing, and S07's
      // preview card hangs 56px past its panel — that overhang is the
      // section's whole structural idea. Everything else is a blow-out.
      blown: blown.filter((b) => !/^(track|s07Panel|s07Grid|darkPanel s07Panel|aiCardCell) /.test(b)),
      h1Lines: document.querySelectorAll("h1 > span").length,
    };
  });

  check(m.scrollWidth <= m.inner + 1, `${vp.name}: the page does not scroll sideways`, `${m.scrollWidth} > ${m.inner}`);
  check(m.blown.length === 0, `${vp.name}: no grid or row blows past its container`, m.blown.slice(0, 3).join(" · "));
  check(errors.length === 0, `${vp.name}: no console errors`, errors.slice(0, 2).join(" | "));

  // The shot is served through `next/image`, so its URL is the optimizer's
  // with the real path as a query param — matched on the decoded URL so both
  // spellings are covered.
  const unexpected = missingAssets.filter((a) => !a.includes("/dashboard.png"));
  check(unexpected.length === 0, `${vp.name}: no unexpected missing assets`, unexpected.slice(0, 3).join(", "));
  if (missingAssets.length > unexpected.length) {
    console.log("        (public/dashboard.png is absent — the hero is showing its drawn fallback, by design)");
  }
  // v4 §5.2: THREE fixed lines — `Your best metrics / live between / your
  // tools.` — in a left column beside the deck, rather than v3's two centred
  // ones above a full-width object.
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
  /**
   * A "dark" SECTION is one built around a deep panel — not merely one that
   * contains a blue object. Two near-misses to avoid: since the brand kit's
   * blue arrived the panels paint a GRADIENT, so `backgroundColor` is
   * transparent and colour-matching counts none of them; and the hero's
   * resolved card wears the same `.sky-panel`, so matching that class alone
   * counts three. The section-level wrapper is what actually says "this
   * section is the dark beat in the rhythm".
   */
  const isDark = (n) => Boolean(n.querySelector('[class*="darkPanel"]'));
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
// v4 §5: the fold is a two-column layout with the headline in the left one,
// which spends the last centred heading on the page. Zero is therefore the
// assertion — a heading that drifts back to centre is a regression, not a
// tidy-up, because it would put the deck below the copy instead of beside it.
check(rhythm.centred === 0, "no centred heading among the light sections", `${rhythm.centred}`);
// Uniform padding is most of what makes a page feel mechanical; the spec
// varies it per section on purpose.
check(rhythm.distinctPaddings >= 4, "section padding varies rather than repeating", `${rhythm.distinctPaddings} distinct values`);

const anchors = await page.evaluate(() => {
  // EVERY ID THAT SOMETHING ACTUALLY LINKS TO, not every id on the page. The
  // rail carries one so the nav can watch for it scrolling past; nothing
  // navigates there, so it needs no margin and is not a finding.
  const wanted = new Set(
    [...document.querySelectorAll('a[href^="#"]')]
      .map((a) => a.getAttribute("href")?.slice(1))
      .filter((id) => id && id !== "main"),
  );
  const missing = [...wanted].filter((id) => !document.getElementById(id));
  const targets = [...wanted].map((id) => document.getElementById(id)).filter(Boolean);
  const short = targets.filter((n) => parseFloat(getComputedStyle(n).scrollMarginTop) < 100);
  return {
    total: targets.length,
    missing,
    short: short.map((n) => `${n.id} ${getComputedStyle(n).scrollMarginTop}`),
  };
});

/**
 * §0: A NAV LINK USED TO LAND ITS HEADING UNDER THE FLOATING PILL, and the
 * fix for it shipped INSIDE a `prefers-reduced-motion` block — so it worked
 * for readers who ask for less motion and for nobody else. Nothing could see
 * that: the declaration is present in the file, the selector list is right,
 * and the only tell is one level of indentation. Measured, it is obvious.
 */
// THE COUNT IS PART OF THE ASSERTION. "No section fell short" is also what a
// page with no anchors at all reports, and this check reads the anchors off
// the links rather than off a hard-coded list — so a nav that lost its hrefs
// would otherwise make it pass by having nothing left to test. A link that
// points at no element is a broken link, and belongs here too.
check(
  anchors.total >= 3 && anchors.missing.length === 0 && anchors.short.length === 0,
  "every in-page link lands below the floating nav",
  `${anchors.total} targets${anchors.missing.length ? ` · missing: ${anchors.missing.join(", ")}` : ""}${
    anchors.short.length ? ` · short: ${anchors.short.join(" · ")}` : ""
  }`,
);

/**
 * INK MEANS "AN ANSWER" and the page makes that claim three times: the hero's
 * front card, S04's output, S05's left panel. All three paint a GRADIENT, so
 * nothing that reads `backgroundColor` can tell whether they are dark — which
 * is exactly how S05's panel spent a build as light grey while the rule it
 * was supposed to follow sat in the file above it.
 */
const ink = await page.evaluate(() => {
  const lum = (el) => {
    const img = getComputedStyle(el).backgroundImage;
    const stop = (img.match(/rgba?\([^)]*\)/) ?? [])[0];
    if (!stop) return null;
    const [r, g, b] = stop.match(/[\d.]+/g).map(Number);
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const at = (sel) => { const el = document.querySelector(sel); return el ? lum(el) : null; };
  return {
    deck: at('[class*="deckFront"]'),
    output: at('[class*="cvOut"]'),
    panel: at('[class*="receiptInk"]'),
  };
});

const isInk = (v) => typeof v === "number" && v < 0.03;
check(
  isInk(ink.deck) && isInk(ink.output) && isInk(ink.panel),
  "all three ink surfaces are actually ink",
  `deck ${ink.deck} · S04 output ${ink.output} · S05 panel ${ink.panel}`,
);

// §7.2: five labelled nodes and one output, reading left to right. A node
// that loses its label is the failure this drawing was rebuilt to fix.
const canvas = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[class*="cvNodeStd"]')];
  return {
    nodes: nodes.length,
    labelled: nodes.every((n) => (n.textContent ?? "").trim().length > 0),
    output: Boolean(document.querySelector('[class*="cvOut"]')),
    // `path`, because `[class*="cvEdge"]` also matches the `cvEdges` layer
    // they are drawn in and counts the container as a sixth edge.
    edges: document.querySelectorAll('path[class*="cvEdge"]').length,
  };
});

check(canvas.nodes === 5 && canvas.output, "S04 draws five nodes into one output", `${canvas.nodes} nodes`);
check(canvas.labelled, "and every node says what it does");
check(canvas.edges === 5, "and five edges join them", `${canvas.edges}`);

/* ── 3. Type ─────────────────────────────────────────────────────────────── */

console.log("\nTypography");

const type = await page.evaluate(() => {
  const h1 = getComputedStyle(document.querySelector("h1"));
  const figure = document.querySelector('[class*="f2"]');
  const monos = [...document.querySelectorAll("main *")].filter((n) =>
    /mono|courier/i.test(getComputedStyle(n).fontFamily),
  );
  /**
   * `document.fonts.check()` WAS A VACUOUS TEST AND PASSED FOR A WHOLE
   * RELEASE. It answers "would using this font block on a pending download",
   * so it returns TRUE for a family that is not in the document at all —
   * which is why `check("800 104px Figtree")` still said yes long after
   * Figtree was deleted from the page. What follows asks the two questions
   * that can fail: is the face really in `document.fonts`, and is it the face
   * the element actually computes to.
   */
  const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
  const accent = document.querySelector('h1 [class*="accent"]');
  const accentStyle = accent ? getComputedStyle(accent) : null;
  return {
    loadedFaces: loaded,
    sansLoaded: loaded.some((f) => /switzer/i.test(f)),
    serifLoaded: loaded.some((f) => /instrument.?serif/i.test(f)),
    h1IsSans: /switzer/i.test(h1.fontFamily),
    accentIsSerif: Boolean(accentStyle && /instrument.?serif/i.test(accentStyle.fontFamily)),
    accentIsItalic: accentStyle?.fontStyle === "italic",
    family: h1.fontFamily,
    size: h1.fontSize,
    weight: h1.fontWeight,
    tabular: figure ? getComputedStyle(figure).fontVariantNumeric : "",
    monoCount: monos.length,
  };
});

check(type.sansLoaded && type.h1IsSans, "Switzer is loaded and is what the headline computes to", type.family);
check(type.serifLoaded, "Instrument Serif is loaded", type.loadedFaces.join(", "));
// §2.2: the accent word is the one italic on the page. Both halves matter —
// the serif without the italic is a different typeface decision.
check(type.accentIsSerif && type.accentIsItalic, "the hero's accent word is Instrument Serif Italic");
check(type.size === "88px" && type.weight === "800", "the hero headline is D0", `${type.size}/${type.weight}`);
check(type.tabular.includes("tabular-nums"), "figures are tabular", type.tabular);
// §6.2: one family, and no monospace anywhere. A wide mono on a figure is
// what made an earlier build read as a form rather than as a product.
check(type.monoCount === 0, "no monospace anywhere on the page", `${type.monoCount} elements`);

/**
 * §9 NAMES SEVEN ACCENT WORDS AND FIXES THEM, so the count is an assertion
 * rather than a sample. Seven headings carry exactly one italic word each;
 * S09 has no heading, and nothing in the nav, the footer, the buttons or the
 * cards gets one. An eighth is drift and a sixth is a heading that lost its
 * accent in an edit — both are silent failures by eye.
 */
const accents = await page.evaluate(() => {
  const all = [...document.querySelectorAll('h1 [class*="accent"], h2 [class*="accent"]')];
  return {
    count: all.length,
    words: all.map((n) => n.textContent?.trim()),
    allSerifItalic: all.every((n) => {
      const cs = getComputedStyle(n);
      return /instrument.?serif/i.test(cs.fontFamily) && cs.fontStyle === "italic";
    }),
    strays: [...document.querySelectorAll('[class*="accent"]')].filter((n) => !n.closest("h1, h2")).length,
  };
});

check(accents.count === 7, "seven headings carry an accent word", `${accents.count}: ${accents.words.join(", ")}`);
check(accents.allSerifItalic, "and every one of them is serif italic");
check(accents.strays === 0, "and nothing outside a heading is accented", `${accents.strays} stray`);

/* ── 4. Contrast ─────────────────────────────────────────────────────────── */

console.log("\nContrast");

const runs = await page.evaluate(() => {
  /**
   * THE GROUND A RUN OF TEXT ACTUALLY LANDS ON.
   *
   * Two things defeat the naive version, and both arrived with the brand kit's
   * blue panels:
   *
   * 1. `.sky-card` and `.sky-panel` paint a GRADIENT. Their computed
   *    `backgroundColor` is transparent, so walking up for the first painted
   *    ancestor sails straight past them and reports the page's pale canvas —
   *    which would score white-on-blue as white-on-white and fail everything
   *    for the wrong reason. Each one's LIGHTEST stop is used instead, which is
   *    the worst case for white ink and the value the kit itself reasons about:
   *    #3F73E6 for the card, #2B53AE for the panel.
   * 2. Those panels set their ink in rgba. Translucent ink has no colour of its
   *    own — `rgba(255,255,255,0.7)` is whatever it lands on — so it is
   *    composited over the ground before anything is measured. Reading the
   *    first three numbers and calling it white is how a 2.9:1 label passes.
   */
  const SKY_CARD = [63, 115, 230];
  const SKY_PANEL = [43, 83, 174];

  /**
   * ONE PARSER, BECAUSE THE UNITS ARE NOT ALL THE SAME.
   *
   * `color-mix()` computes to `color(srgb 0.99 0.96 0.95)` — channels in 0..1,
   * not 0..255 — and reading those as bytes turns a near-white tint into near
   * black. That is how three perfectly legible rows in S07's card were
   * reported at 1.14:1. `rgb()` and `rgba()` stay in bytes; the alpha is the
   * last value either way.
   */
  const parse = (value) => {
    const n = (value.match(/[\d.]+/g) ?? []).map(Number);
    const scale = /^color\(\s*srgb/.test(value) ? 255 : 1;
    const rgb = n.slice(0, 3).map((c) => c * scale);
    const a = /^(rgba|color)/.test(value) && n.length >= 4 ? n[3] : 1;
    return { rgb, a };
  };
  const painted = (node) => {
    // Walk OUTWARDS and stop at the first thing that actually paints — which
    // may be a white button sitting on top of a sky panel. Testing for the
    // panel first reported the panel's blue under the button's own fill and
    // failed a control that is perfectly legible.
    /**
     * Layers are composited DOWN, not believed at face value. A tab on the ink
     * card fills `rgba(255,255,255,0.1)`; reading its first three numbers calls
     * that ground pure white and then scores white-on-white at 1:1 — a failure
     * that does not exist. Every translucent layer is stacked until an opaque
     * one is reached.
     */
    const stack = [];
    let grounds = [[255, 255, 255]];
    for (let n = node; n; n = n.parentElement) {
      if (n.classList?.contains("sky-panel")) { grounds = [SKY_PANEL]; break; }
      if (n.classList?.contains("sky-card")) { grounds = [SKY_CARD]; break; }
      const cs = getComputedStyle(n);
      /**
       * A GRADIENT IS AN OPAQUE BACKGROUND AND THIS WALKER COULD NOT SEE ONE.
       *
       * `background: linear-gradient(...)` leaves `backgroundColor`
       * transparent, so every card painted with the v4 recipes — the hero's
       * front card, S04's output, S05's left panel, all three of them ink —
       * was skipped, and the walk carried on up to the page's near-white
       * canvas. White text on ink was therefore scored as white on white and
       * reported at 1.02:1. Four runs "failed" that are in fact 6–17:1, and
       * the same blindness would have PASSED genuinely illegible ink on ink.
       *
       * Both classes of error come from guessing. So no stop is chosen: every
       * colour stop becomes a candidate ground and the caller scores against
       * all of them, keeping the worst. That is exact for a flat two-stop
       * fill and conservative for anything else, which is the right direction
       * for a contrast floor.
       */
      const stops = cs.backgroundImage && cs.backgroundImage !== "none"
        ? cs.backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) ?? []
        : [];
      const opaqueStops = stops.map(parse).filter((c) => c.a >= 1);
      if (opaqueStops.length > 0) { grounds = opaqueStops.map((c) => c.rgb); break; }
      const bg = cs.backgroundColor;
      if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
      const { rgb, a } = parse(bg);
      if (a === 0) continue;
      if (a >= 1) { grounds = [rgb]; break; }
      stack.push({ rgb, a });
    }
    // Innermost last, so compositing runs outermost-first onto the ground.
    const layers = stack.reverse();
    return grounds.map((base) => {
      let ground = base;
      for (const layer of layers) {
        ground = [0, 1, 2].map((i) => layer.rgb[i] * layer.a + ground[i] * (1 - layer.a));
      }
      return ground;
    });
  };
  /** Composite a possibly-translucent ink over the ground behind it. */
  const over = (colour, ground) => {
    const { rgb, a } = parse(colour);
    return [0, 1, 2].map((i) => rgb[i] * a + ground[i] * (1 - a));
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
    if (node.tagName === "INPUT") continue;
    for (const ground of painted(node)) {
      out.push({
        text: text.slice(0, 32),
        colour: over(cs.color, ground),
        raw: cs.color,
        bg: ground,
        size,
        weight: Number(cs.fontWeight),
      });
    }
  }
  return out;
});

const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const show = (c) => `rgb(${c.map((n) => Math.round(n)).join(", ")})`;

let worst = { r: 99, what: "" };
const bad = [];
for (const s of runs) {
  const [hi, lo] = [lum(s.colour), lum(s.bg)].sort((a, b) => b - a);
  const r = (hi + 0.05) / (lo + 0.05);
  const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
  const need = large ? 3 : 4.5;
  const where = `${s.raw} over ${show(s.bg)}, ${s.size}px`;
  if (r < worst.r) worst = { r, what: `${s.text} (${where})` };
  if (r < need) bad.push(`${s.text} — ${r.toFixed(2)}:1 needs ${need} (${where})`);
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

/* ── 4b. Fonts and stability (§11.9) ─────────────────────────────────────── */

console.log("\nFonts and stability");

/**
 * NOT A SPEED TEST. This runs against whatever server it is pointed at, and in
 * development that is an unoptimised build — an LCP threshold measured there
 * would be noise with a number attached. What IS meaningful at any build is
 * whether the page moves under the reader while it loads, and whether the two
 * faces are fetched with the document rather than after it.
 *
 * Two faces means two chances to reflow the headline, and the headline is the
 * largest element on the page: 88px Switzer with an italic serif word inside
 * it. A late swap on either would shove three lines sideways.
 */
const stability = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await stability.addInitScript(() => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
});
await stability.goto(BASE, { waitUntil: "networkidle" });
await stability.waitForTimeout(1200);

const fonts = await stability.evaluate(() => ({
  preloaded: [...document.querySelectorAll('link[rel="preload"][as="font"]')].length,
  cls: Number(window.__cls ?? 0),
  ready: document.fonts.status,
}));

// One per face. next/font only emits these for faces the ROUTE uses, so a
// face that stopped being referenced silently loses its preload.
check(fonts.preloaded >= 2, "both faces are preloaded with the document", `${fonts.preloaded} preloads`);
check(fonts.ready === "loaded", "and the font set has settled", fonts.ready);
// 0.1 is the "good" threshold; a headline reflow on this page scores far above
// it, so anything passing here is not a font swap.
check(fonts.cls < 0.1, "the page does not shift while it loads", `CLS ${fonts.cls.toFixed(4)}`);

await stability.close();

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

// The nav's arrival is a user-visible behaviour with no other guard: it is
// hidden on first paint so the hero owns the top of the screen, and it has to
// be there by the time the reader is past the rail — including for somebody
// who lands at a restored scroll position rather than scrolling to it.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
check(
  (await page.locator("header").evaluate((n) => getComputedStyle(n).opacity)) === "0",
  "the nav is absent while the hero owns the screen",
);
await page.evaluate(() => {
  const rail = document.querySelector("#rail");
  window.scrollTo(0, (rail?.getBoundingClientRect().bottom ?? 0) + window.scrollY + 200);
});
await page.waitForTimeout(600);
check(
  (await page.locator("header").evaluate((n) => getComputedStyle(n).opacity)) === "1",
  "and arrives once the reader is past the source rail",
);

const cells = page.locator('ul[class*="index"] > li');
const total = await cells.count();
await page.locator('input[type="search"]').fill("cal");
await page.waitForTimeout(600);
const after = await cells.count();
const dimmed = await page.locator('li[class*="indexDim"]').count();
check(after === total, "searching dims sources rather than removing them", `${total} → ${after}`);
check(dimmed > 0 && dimmed < total, "and some, not all, are dimmed", `${dimmed} of ${total}`);

// v3.1: the empty state is the request cell, which is always present and
// always at full opacity — so a search that matches nothing leaves exactly one
// cell lit rather than printing a message.
await page.locator('input[type="search"]').fill("zzzz");
await page.waitForTimeout(600);
const lit = await page.evaluate(
  () => [...document.querySelectorAll('ul[class*="index"] > li')].filter((n) => Number(getComputedStyle(n).opacity) > 0.9).length,
);
check(lit === 1, "a search matching nothing leaves exactly the request cell lit", `${lit} cells lit`);
check(await page.getByText(/Don.t see yours\?/).isVisible(), "and that cell is the invitation");
await page.close();

/* ── 7. Reduced motion gets the conclusion, not a faster performance ─────── */

console.log("\nReduced motion");

const still = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await settle(still, BASE);
await still.waitForTimeout(400); // deliberately BEFORE the sequence would end

const final = await still.evaluate(() => {
  /**
   * THE CENTREPIECE IS THE DECK NOW, not the board screenshot v3 hung in the
   * middle of the hero. The old assertion kept passing by accident once the
   * screenshot was gone — `querySelector` returned null, `Boolean(null)` was
   * false and the check failed loudly, which at least was honest; the drift
   * check beside it was the quiet one, looking for a `chipRest` element that
   * no longer exists and reporting "none" for it.
   *
   * Reduced motion has a specific meaning here and it is NOT "hold still". A
   * deck whose four cards are all at transform: none is a stack of identical
   * rectangles — a different picture, not the same picture unanimated. So the
   * three tinted cards are asserted to hold the transform their entrance ENDS
   * on, and the ink card in front to be fully opaque.
   */
  const front = document.querySelector('[class*="deckFront"]');
  const fan = [...document.querySelectorAll('[class*="deckCard"]')];
  const settled = (n) => {
    const cs = getComputedStyle(n);
    return Number(cs.opacity) === 1 && cs.animationName === "none";
  };
  return {
    // Three tinted source cards behind one ink answer — the whole argument of
    // the fold, stated in objects.
    dealt: fan.length === 3 && Boolean(front),
    allSettled: Boolean(front) && settled(front) && fan.every(settled),
    // …and fanned, not stacked. `none` for any of them means the reduced-motion
    // block reset the transform instead of pinning it.
    fanned: fan.every((n) => getComputedStyle(n).transform !== "none"),
    frontOpacity: front ? getComputedStyle(front).opacity : "0",
    railAnimation: getComputedStyle(document.querySelector('[class*="railTrack"]')).animationName,
  };
});

check(final.dealt, "the hero centrepiece is three source cards behind one answer");
check(final.allSettled, "and is fully there at once, with nothing still animating", final.frontOpacity);
check(final.fanned, "and still fanned rather than collapsed into a stack");
check(final.railAnimation === "none", "the source rail does not scroll", final.railAnimation);

await still.close();
await browser.close();

console.log(
  fails.length === 0
    ? "\nPASS — the front door measures up.\n"
    : `\nFAIL — ${fails.length}:\n${fails.map((f) => `  · ${f}`).join("\n")}\n`,
);
process.exit(fails.length === 0 ? 0 : 1);
