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
   * THE HERO SHOT IS NOT OPTIONAL ANY MORE, AND ITS ABSENCE IS THE FAILURE
   * THIS BLOCK EXISTS TO CATCH.
   *
   * It used to be a file the owner might drop in, with a drawn card standing
   * in until they did — so a 404 on it was excused here by name. The fold is
   * now built ON the screenshot: without it the first screen is an ink
   * rectangle with four logos stuck to the side of it. So the exemption is
   * gone and `/dashboard.png` is asserted like every other asset.
   */
  const missingAssets = [];
  const requested = [];
  page.on("response", (r) => {
    requested.push(decodeURIComponent(r.url()));
    if (r.status() >= 400) missingAssets.push(`${r.status()} ${decodeURIComponent(r.url())}`);
  });
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
    const scrollers = [];
    for (const n of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "auto" && cs.overflowX !== "scroll") continue;
      if (n.scrollWidth <= n.clientWidth + 1) continue;
      const name = n.className.toString().replace(/snap-module__\w+__/g, "");
      /**
       * TWO STRIPS OF CONTROLS MAY SCROLL AND NOTHING ELSE MAY. S05's metric
       * tabs and S08's category filters are rows of BUTTONS that run off a
       * narrow screen, and swiping a row of buttons is an affordance a reader
       * already understands. A drawing that scrolls is the opposite: there is
       * nothing to operate, so the bar along the bottom is just a picture that
       * did not fit. Naming the two is what keeps a third from arriving
       * unnoticed.
       */
      if (/^(receiptBar|filters)\b/.test(name)) continue;
      scrollers.push(`${name.slice(0, 30)} ${n.scrollWidth}>${n.clientWidth}`);
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      // The source rail is a marquee: its track is deliberately wider than
      // its viewport and `overflow: hidden` means no scrollbar is drawn.
      // Anything with `auto` or `scroll` is a real one.
      scrollers,
      /**
       * Four overhangs are the design: S04's track line runs 40px past the
       * container at both ends so the process reads as continuing, S07's
       * preview card hangs 56px past its panel, and the fold's board runs
       * from the copy column to the right edge of the SCREEN — three nested
       * boxes wide by exactly `--bleed`. Everything else is a blow-out.
       *
       * MATCHED PER CLASS NAME, NOT AGAINST THE WHOLE STRING. The list used
       * to carry `darkPanel s07Panel` as one entry, so adding a third class
       * to that element unallowed it and the check failed on an overhang it
       * had been told about. A class list is a set; it is read as one here.
       */
      blown: blown.filter((entry) => {
        const allowed = new Set([
          "track",
          "s07Panel",
          "s07Grid",
          "aiCardCell",
          "foldShot",
          "foldShotInner",
          "shotStage",
        ]);
        return !entry.split(" ").slice(0, -1).some((name) => allowed.has(name));
      }),
      h1Lines: document.querySelectorAll("h1 > span").length,
    };
  });

  check(m.scrollWidth <= m.inner + 1, `${vp.name}: the page does not scroll sideways`, `${m.scrollWidth} > ${m.inner}`);
  /**
   * AND NEITHER DOES ANYTHING ON IT. `main` clips, so a child that scrolls
   * sideways inside its own box never moves the document's scrollWidth and
   * the check above cannot see it — which is how S04's canvas shipped with a
   * scrollbar along the bottom of the card at every width, caused by a 1px
   * border taking two pixels out of a container sized to the drawing exactly.
   * A sideways scrollbar inside a picture of a product is never the design
   * here, so this looks for the scroller rather than for the overflow.
   */
  check(m.scrollers.length === 0, `${vp.name}: nothing on the page scrolls sideways`, m.scrollers.slice(0, 3).join(" · "));
  check(m.blown.length === 0, `${vp.name}: no grid or row blows past its container`, m.blown.slice(0, 3).join(" · "));
  check(errors.length === 0, `${vp.name}: no console errors`, errors.slice(0, 2).join(" | "));

  check(missingAssets.length === 0, `${vp.name}: every asset the page asks for loads`, missingAssets.slice(0, 3).join(", "));

  // The shot is served through `next/image`, so its URL is the optimizer's
  // with the real path as a query param. Asserting that the REQUEST happened
  // is what catches a hero that silently stopped rendering its picture — a
  // `<div>` with no `<img>` in it produces no 404 and no console error, and
  // every other check on this page would still pass.
  const shotRequested = requested.some((u) => u.includes("/dashboard.png"));
  check(shotRequested, `${vp.name}: the hero asks for the board screenshot`);
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

/* ── 1b. The fold's two columns do not touch ────────────────────────────── */

/**
 * THE ONE MEASUREMENT NOTHING ELSE ON THIS PAGE COULD MAKE.
 *
 * Above 1280 the fold is a headline on the left and a board on the right, and
 * the board's first mark IS its left edge — there is no empty margin inside
 * the object to absorb a headline that runs long. When that column was a deck
 * of cards it had 140px of slack and this could not happen; with the board it
 * happened immediately, at 1280, where the copy's widest element overlapped
 * the first mark by 8px and the board covered `See a live metric` outright.
 *
 * Nothing already in this file sees it. The blow-out check measures boxes
 * against their containers and both elements are inside theirs; the overlap
 * is between two SIBLINGS that are supposed to sit side by side. And the
 * widest thing in the copy is not the headline — it is the button row — so a
 * check that measured the headline alone would have passed through the whole
 * failure.
 *
 * `.heroLine > span` fills its column, so its bounding box says nothing about
 * where the letters stop. A Range over the text node is what gives the ink.
 */
for (const vp of [
  { name: "1280", width: 1280, height: 1000 },
  { name: "1360", width: 1360, height: 1000 },
  { name: "1440", width: 1440, height: 1000 },
  { name: "1920", width: 1920, height: 1000 },
]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await settle(page, BASE);
  await page.waitForTimeout(3600);

  const fold = await page.evaluate(() => {
    const inkRight = (n) => {
      const range = document.createRange();
      range.selectNodeContents(n);
      return range.getBoundingClientRect().right;
    };
    const copy = [
      ...[...document.querySelectorAll("h1 > span > span")].map(inkRight),
      ...[...document.querySelectorAll('[class*="heroActions"] a')].map((a) => a.getBoundingClientRect().right),
    ];
    const chip = document.querySelector('[class*="boardChip"]:not([class*="Dot"])');
    const frame = document.querySelector('[class*="boardFrame"]');
    return {
      copyRight: Math.max(...copy),
      chipLeft: chip ? chip.getBoundingClientRect().left : 0,
      // The bleed, restated as an assertion: the board reaches the screen.
      frameRight: frame ? Math.round(frame.getBoundingClientRect().right) : 0,
      inner: window.innerWidth,
    };
  });

  const clearance = Math.round(fold.chipLeft - fold.copyRight);
  check(clearance >= 40, `${vp.name}: the copy column clears the board's first mark`, `${clearance}px`);
  check(
    Math.abs(fold.frameRight - fold.inner) <= 1,
    `${vp.name}: and the board reaches the right edge of the screen`,
    `${fold.frameRight} vs ${fold.inner}`,
  );
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
/**
 * THREE, AND THE THIRD ONE ARRIVED ON PURPOSE. S02 reads the tools, S04b
 * reads the metrics those tools produce, S08 is the index. The rule the
 * design states is not "two" — it is that a band is a band and a section is a
 * section, and that the page never grows a fourth one by accident. Two bands
 * a scroll apart also have to run in OPPOSITE directions or they read as one
 * belt the whole page is sitting on, which is asserted below.
 */
check(rhythm.fullBleed === 3, "exactly three full-bleed bands", `${rhythm.fullBleed}`);
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
 * THE DARK SURFACES ARE THE PRODUCT'S SKY, AND NOT THE OTHER ONE.
 *
 * They were ink, and the check asked whether they were dark. That question is
 * no longer the interesting one: globals.css ships TWO skies and the
 * difference between them is a contrast floor. `.sky-card` opens up to
 * #3F73E6, where white is 4.37:1 and fails as body copy; `.sky-panel` stops
 * at #2B53AE, where it is 7.1:1. Every dark surface here has text running all
 * the way down it, so every one of them has to stay in the panel's range —
 * and "it looks blue" is exactly the kind of judgement that lets the lighter
 * one in one surface at a time.
 *
 * So the stops are read the same way the contrast walker reads them: every
 * OPAQUE stop is a candidate, the translucent bloom on top is ignored, and
 * the LIGHTEST is the one that has to hold. Reading the first stop instead is
 * how the old version of this check reported a luminance of 1.0 for all three
 * the moment a white bloom was painted over them.
 */
const sky = await page.evaluate(() => {
  const lum = ([r, g, b]) => {
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const read = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const stops = (getComputedStyle(el).backgroundImage.match(/rgba?\([^)]*\)/g) ?? [])
      .map((v) => (v.match(/[\d.]+/g) ?? []).map(Number))
      .filter((n) => n.length < 4 || n[3] >= 1)
      .map((n) => n.slice(0, 3));
    if (stops.length === 0) return null;
    const lightest = stops.reduce((a, b) => (lum(b) > lum(a) ? b : a));
    return { count: stops.length, lightest, lum: lum(lightest), blue: lightest[2] > lightest[0] && lightest[2] > lightest[1] };
  };
  return {
    board: read('[class*="boardFrame"]'),
    output: read('[class*="cvOut"]'),
    receipt: read('[class*="receiptInk"]'),
    panel: read('[class*="darkPanel"]'),
  };
});

/* #2B53AE is 0.0979. The margin is for a future stop nudged a shade, not for
   a different sky. */
const isSky = (v) => v !== null && v.blue && v.lum <= 0.11;
for (const [name, surface] of Object.entries(sky)) {
  check(
    isSky(surface),
    `the ${name} surface is the panel sky`,
    surface === null ? "no opaque stops found" : `lightest rgb(${surface.lightest}) · luminance ${surface.lum.toFixed(3)}`,
  );
}

/**
 * THE TWO THINGS THAT MAKE IT THE PRODUCT'S CARD RATHER THAN A BLUE BOX, and
 * neither of them was asserted by anything until both had already gone wrong
 * once. The gradient is measured above; this is the rim and the ruled paper.
 *
 * THE RIM HAS TO BE CONIC. A linear ramp bright at both ends has no dark side,
 * so the eye joins it into a continuous white outline — which is what shipped,
 * and what the owner asked about. A conic spends most of its sweep at nothing,
 * which is the whole reason the bright part reads as a highlight. Asserting
 * the SHAPE rather than a colour is what makes this survive a retint: the
 * failure mode is a stroke, and a stroke is not conic.
 *
 * A solid border colour is the same failure by another route, so it is closed
 * here too — the rim only works while the border itself is transparent.
 */
const skin = await page.evaluate(() => {
  const rimmed = {
    output: '[class*="cvOut"]',
    panel: '[class*="darkPanel"]',
    board: '[class*="boardFrame"]',
  };
  const rims = {};
  for (const [name, sel] of Object.entries(rimmed)) {
    const el = document.querySelector(sel);
    if (!el) { rims[name] = null; continue; }
    const cs = getComputedStyle(el);
    rims[name] = {
      conic: /conic-gradient/.test(cs.backgroundImage),
      // `transparent` computes to rgba(0, 0, 0, 0); anything else is a stroke.
      stroke: cs.borderTopStyle !== "none" && cs.borderTopColor !== "rgba(0, 0, 0, 0)",
    };
  }

  const ruled = [...document.querySelectorAll('[class*="skyRuled"]')].map((el) => {
    const b = getComputedStyle(el, "::before");
    return {
      lines: (b.backgroundImage.match(/linear-gradient/g) ?? []).length,
      // One value per layer, so it computes to `88px 88px, 88px 88px`.
      size: b.backgroundSize.split(",").map((v) => v.trim()),
      // Without the mask the grid runs into the foot of the panel, where a
      // white rule on a lighter blue reads as dirt rather than as structure.
      masked: (b.maskImage ?? b.webkitMaskImage) !== "none",
    };
  });

  const receipt = document.querySelector('[class*="receiptInk"]');
  return {
    rims,
    ruled,
    receiptRuled: receipt ? getComputedStyle(receipt, "::before").backgroundImage.includes("linear-gradient") : false,
  };
});

for (const [name, rim] of Object.entries(skin.rims)) {
  check(rim !== null && rim.conic && !rim.stroke, `the ${name} surface's rim is an arc, not a stroke`,
    rim === null ? "surface not found" : `conic ${rim.conic} · solid border ${rim.stroke}`);
}

check(skin.ruled.length === 2, "the two panels carry the ruled paper", `${skin.ruled.length}`);
check(
  skin.ruled.length === 2 &&
    skin.ruled.every((r) => r.lines >= 2 && r.size.length >= 2 && r.size.every((v) => v === "88px 88px") && r.masked),
  "and each draws an 88px grid that fades before the foot",
  JSON.stringify(skin.ruled[0] ?? null),
);
/**
 * AND THE RECEIPT'S FIGURE PANEL DOES NOT, which is the half of the rule that
 * a count alone would not hold. It had one for a build: at 530 x 374 with
 * type over all of it, a vertical line ran straight down through the `41` and
 * through every source name, and a horizontal one sat immediately above
 * `What each source said`. Two rhythms, neither aligned to the other. The
 * test is density rather than size, so the next dense surface to take the
 * grid trips this rather than shipping.
 */
check(
  !skin.receiptRuled,
  "and the receipt's figure panel does not — its type runs over all of it",
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

/* ── 2b. The call to action ──────────────────────────────────────────────── */

console.log("\nThe call");

const call = await page.evaluate(() => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/[\d.]+/g).map(Number);
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const rows = [...document.querySelectorAll('[class*="ctaRow"]')];
  const fills = [...document.querySelectorAll('a[class*="btn"]:not([class*="btnPaper"]):not([class*="btnOnDark"])')];
  const google = [...document.querySelectorAll('a[href="/auth/google"]')];
  const brand = document.querySelector("header a[aria-label]");
  const tracks = [...document.querySelectorAll('[class*="railScrolling"]')];
  return {
    rows: rows.length,
    email: document.querySelectorAll('a[href="/signup"]').length,
    google: google.length,
    // Google's mark is four colours and is never recoloured, so every one of
    // these buttons has to be carrying a real <svg>, not a letter.
    googleMarked: google.every((a) => a.querySelector("svg path[fill='#4285F4']")),
    // NOT INK. The whole point of the change: a filled action that measures as
    // black is one of four black rectangles on this page and reads as none of
    // them in particular.
    fillLum: fills.length ? lum(getComputedStyle(fills[0]).backgroundColor) : null,
    // A wordmark, and only a wordmark.
    brandText: brand ? (brand.textContent || "").trim() : "",
    brandHasMark: brand ? Boolean(brand.querySelector("svg")) : true,
    // Two bands, running opposite ways.
    directions: [...new Set(tracks.map((t) => getComputedStyle(t).animationName))].length,
    trackCount: tracks.length,
  };
});

check(call.rows >= 4, "the page asks for the sign-up more than once", `${call.rows} calls`);
check(call.email >= 4 && call.google >= 4, "and every one of them offers both doors", `${call.email} email / ${call.google} Google`);
check(call.googleMarked, "Google's mark is drawn on every Google button");
check(
  typeof call.fillLum === "number" && call.fillLum > 0.03,
  "the filled action is not ink",
  call.fillLum === null ? "no filled action found" : `luminance ${call.fillLum?.toFixed(3)}`,
);
check(call.brandText === "Namzilabs" && !call.brandHasMark, "the nav's brand is the word alone", `${call.brandText}${call.brandHasMark ? " + a mark" : ""}`);
check(call.trackCount === 2 && call.directions === 2, "the two bands run in opposite directions", `${call.trackCount} bands, ${call.directions} directions`);

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
await settle(stability, BASE);
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
check(themed.pageBg === "rgb(250, 251, 253)", "the landing ground stays canvas", themed.pageBg);
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
   * THE CENTREPIECE IS THE BOARD, and reduced motion has a specific meaning
   * for it: not "hold still" but "arrive built". Four marks at full opacity
   * on a board at full opacity, with the wires already drawn — a wire left at
   * its `stroke-dashoffset` is an invisible wire, so a reduced-motion reader
   * would get four logos connected to nothing, which is a different picture
   * and not the same picture unanimated.
   *
   * The wire is the one that can fail quietly, because opacity is not what
   * hides it. That is why the dash offset is read rather than inferred.
   */
  const frame = document.querySelector('[class*="boardFrame"]');
  const img = document.querySelector('[class*="boardImg"]');
  const chips = [...document.querySelectorAll('[class*="boardChip"]:not([class*="boardChipDot"])')];
  const wires = [...document.querySelectorAll('path[class*="boardWire"]')];
  const settled = (n) => {
    const cs = getComputedStyle(n);
    return Number(cs.opacity) === 1 && cs.animationName === "none";
  };
  return {
    // Four tools plugged into one board — the whole argument of the fold,
    // stated in objects.
    wired: chips.length === 4 && wires.length === 4 && Boolean(frame),
    // A real <img> with a real source, not an empty frame: the picture IS the
    // claim, and an ink rectangle would pass every other check on this page.
    picture: Boolean(img) && /dashboard/.test(img?.currentSrc || img?.src || ""),
    allSettled: Boolean(frame) && settled(frame) && chips.every(settled),
    drawn: wires.every((w) => parseFloat(getComputedStyle(w).strokeDashoffset) === 0),
    frameOpacity: frame ? getComputedStyle(frame).opacity : "0",
    railAnimation: getComputedStyle(document.querySelector('[class*="railTrack"]')).animationName,
  };
});

check(final.wired, "the hero centrepiece is four tools plugged into one board");
check(final.picture, "and the board is the real screenshot, not an empty frame");
check(final.allSettled, "and is fully there at once, with nothing still animating", final.frameOpacity);
check(final.drawn, "and its wires are drawn rather than left at their dash offset");
check(final.railAnimation === "none", "the source rail does not scroll", final.railAnimation);

await still.close();
await browser.close();

console.log(
  fails.length === 0
    ? "\nPASS — the front door measures up.\n"
    : `\nFAIL — ${fails.length}:\n${fails.map((f) => `  · ${f}`).join("\n")}\n`,
);
process.exit(fails.length === 0 ? 0 : 1);
