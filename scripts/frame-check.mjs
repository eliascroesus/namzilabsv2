/**
 * THE FRAME AT EVERY SIZE IT HAS TO SURVIVE.
 *
 * `geometry-check.mjs` measures ONE viewport (1920x1200) against the Figma.
 * The gutter and the corner are `md:`-gated and the panel scrolls internally,
 * so the things that can break are: the gutter appearing on a phone, the page
 * itself gaining a scrollbar (the panel is supposed to scroll, not the
 * document), and the panel failing to fill the height it is given.
 */
import { chromium } from "playwright";

/**
 * SHOT_BASE OVERRIDES THE PORT, like every other browser check here. Four of
 * the eleven hardcoded :3000 and the rest read the env var, so running two of
 * them against a dev server on another port half-worked — the ones that read it
 * passed and the ones that did not refused the connection. A check that cannot
 * be pointed at the thing under test is a check that gets skipped.
 */
const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";

const SIZES = [
  { w: 390, h: 844, label: "phone", gutter: false },
  { w: 744, h: 1000, label: "just below md", gutter: false },
  { w: 768, h: 1000, label: "exactly md", gutter: true },
  { w: 1024, h: 640, label: "small laptop, short", gutter: true },
  { w: 1440, h: 720, label: "laptop, short", gutter: true },
  { w: 1920, h: 1200, label: "the Figma's frame", gutter: true },
  { w: 2560, h: 1440, label: "large desktop", gutter: true },
];

const browser = await chromium.launch();
let bad = 0;
for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/design/overview`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const m = await page.evaluate(() => {
    const shell = document.querySelector("div.flex.h-dvh");
    // The panel is the cornered box: the only element with a frame radius.
    const panel = [...document.querySelectorAll("div")].find(
      (d) => getComputedStyle(d).borderTopLeftRadius === "8px" && d.querySelector("header"),
    );
    const r = panel?.getBoundingClientRect();
    const cs = panel ? getComputedStyle(panel) : null;
    const col = panel?.parentElement;
    const colCs = col ? getComputedStyle(col) : null;
    return {
      docScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      docScrollsY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      shellH: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      panel: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      radius: cs?.borderTopLeftRadius ?? null,
      padTop: colCs ? colCs.paddingTop : null,
      padRight: colCs ? colCs.paddingRight : null,
      padLeft: colCs ? colCs.paddingLeft : null,
    };
  });

  const want = s.gutter ? "8px" : "0px";
  const problems = [];
  // Below md there is no cornered panel at all (the radius is md-gated), so the
  // finder returns nothing — which is itself the correct answer there.
  if (s.gutter) {
    if (!m.panel) problems.push("no cornered panel found");
    if (m.padTop !== want || m.padRight !== want) problems.push(`gutter ${m.padTop}/${m.padRight}, want ${want}`);
    if (m.padLeft !== "0px") problems.push(`left gutter ${m.padLeft}, must be 0px`);
    if (m.panel && m.panel.h !== s.h - 16) problems.push(`panel h=${m.panel.h}, want ${s.h - 16}`);
  } else if (m.panel) {
    problems.push("a corner/gutter is drawn below md");
  }
  if (m.docScrollsX) problems.push("the DOCUMENT scrolls sideways");
  if (m.docScrollsY) problems.push("the DOCUMENT scrolls vertically (the panel should)");
  if (m.shellH !== s.h) problems.push(`shell h=${m.shellH}, want ${s.h}`);

  const ok = problems.length === 0;
  if (!ok) bad++;
  console.log(
    `${ok ? "✓" : "✗"} ${String(s.w).padStart(4)}x${String(s.h).padEnd(4)} ${s.label.padEnd(18)}` +
      (ok ? `panel ${m.panel ? `${m.panel.w}x${m.panel.h} @${m.panel.x},${m.panel.y} r=${m.radius}` : "edge-to-edge (no corner)"}` : problems.join("; ")),
  );
  await ctx.close();
}

/**
 * THE BELL OPENS SOMETHING — and the rail's selected glyph stays an outline.
 *
 * Both are facts `notices.test.ts` can only grep at. That a file contains
 * `<SheetContent>` is not the same fact as "pressing the bell puts a panel on
 * the screen with two rows in it", and the gap between those two is exactly why
 * this script exists: the bell shipped as a button with NO handler and a badge
 * stuck on "1", and every source check in the repo was green the whole time.
 */
{
  console.log("\nthe notification bell");
  const fails = [];
  const check = (ok, what, detail = "") => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
    if (!ok) fails.push(what);
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/design/overview`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const bell = page.getByRole("button", { name: /^Notifications/ });
  check((await bell.count()) === 1, "the bar carries exactly one bell", `${await bell.count()} found`);
  const label = (await bell.getAttribute("aria-label")) ?? "";
  check(/2 needing attention/.test(label), "its label counts the real notices", label || "(none)");

  check((await page.locator("[data-slot='sheet-content']").count()) === 0, "no panel before it is pressed");

  await bell.click();
  await page.waitForTimeout(500);
  const panel = page.locator("[data-slot='sheet-content']");
  check((await panel.count()) === 1, "pressing it opens a panel");
  if (await panel.count()) {
    const box = await panel.boundingBox();
    // On the RIGHT and full height — the half of "same style as the left
    // navbar" that no class-name check can see.
    check(box.x + box.width > 1438, "flush to the right edge", `right edge at ${Math.round(box.x + box.width)}`);
    check(box.height > 700, "and runs the full height", `${Math.round(box.height)}px`);
    const text = (await panel.innerText()).replace(/\s+/g, " ");
    check(/Needs attention/.test(text), "headed Needs attention");
    check(/Calendly/.test(text) && /Close CRM/.test(text), "and lists both notices", text.slice(0, 120));
    const grounds = await page.evaluate(() => ({
      rail: getComputedStyle(document.querySelector("aside")).backgroundColor,
      panel: getComputedStyle(document.querySelector("[data-slot='sheet-content']")).backgroundColor,
    }));
    check(grounds.panel === grounds.rail, "wearing the rail's own ground", `${grounds.panel} vs rail ${grounds.rail}`);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(450);
  check((await page.locator("[data-slot='sheet-content']").count()) === 0, "Escape closes it again");

  /**
   * THE SELECTED RAIL GLYPH IS AN OUTLINE — read as a COMPUTED fill rather than
   * as a class, because `fill-current` could come back through any ancestor
   * rule and a source grep would not see it.
   *
   * EVERY RAIL GLYPH, not the selected one — and the route is why. No public
   * page has a rail row active: `/design/overview` is not `/dashboard`, so the
   * rail draws six inactive rows and nothing carries `aria-current`. An
   * earlier version asked for `[aria-current="page"] svg` anyway, matched the
   * BOARD'S VIEW TAB instead (earlier in the document, always an outline), and
   * passed with the fill deliberately put back — the exact shape of a check
   * that cannot fail. Caught by mutating the source and watching it stay green.
   *
   * Asking about all six is not a weaker question, it is the same one: the
   * active and inactive chips share a single class list now (`RailChip` stopped
   * taking a `tone` at all), so a fill reintroduced for the selected row would
   * land on every row here.
   */
  const glyphs = await page.evaluate(() =>
    [...document.querySelectorAll("aside nav svg")].map((n) => getComputedStyle(n).fill),
  );
  check(glyphs.length >= 4, "the rail's glyphs are on the page to measure", `${glyphs.length} found`);
  const solid = glyphs.filter((f) => f !== "none");
  check(solid.length === 0, "every rail icon is an outline, not a solid", solid.join(", "));

  /**
   * THE RAIL'S INVITE CARD WEARS THE REFER BOARD'S SKY, AND ITS EDGE MOVES.
   *
   * Both halves are invisible to a source check. `className="rail-invite"` is
   * true whether or not globals.css still defines the class — and a rule that
   * quietly stops matching leaves a transparent card with white text on the
   * rail's near-black, which looks deliberate and is not. The sweep is worse:
   * an animation name in a stylesheet proves nothing about whether anything
   * moves.
   */
  const invite = await page.evaluate(() => {
    const link = document.querySelector('aside a[href="/dashboard/refer"]');
    const face = link?.querySelector(".rail-invite-face");
    if (!link || !face) return null;
    const anim = link.getAnimations ? [] : [];
    return {
      // A gradient, not a flat colour — `backgroundImage` is `none` if the rule
      // did not match, whatever the class attribute says.
      faceImage: getComputedStyle(face).backgroundImage.slice(0, 24),
      rim: getComputedStyle(link, "::before").animationName,
      duration: getComputedStyle(link, "::before").animationDuration,
      w: Math.round(link.getBoundingClientRect().width),
      anim: anim.length,
    };
  });
  check(invite !== null, "the rail carries an invite card");
  if (invite) {
    check(invite.faceImage.startsWith("radial-gradient") || invite.faceImage.startsWith("linear-gradient"),
      "it paints the board's sky rather than a flat fill", invite.faceImage || "(none)");
    check(invite.rim === "rail-invite-spin", "and a light runs round its edge", invite.rim);
    check(invite.duration !== "0s" && invite.duration !== "0.01ms", "which is actually moving", invite.duration);
    check(invite.w > 180, "at the rail's full width", `${invite.w}px`);
  }

  /**
   * NOTHING IN THE RAIL APPEARS TWICE.
   *
   * A slice that took its END anchor from a string appearing EARLIER in the
   * file than its start emitted the whole tail a second time — two invite
   * cards, two account gears, two Invite Members cards — and typecheck, the
   * kit check and 3,635 tests all passed on it, because duplicated valid JSX is
   * still valid JSX. Counting rendered elements is the only thing that would
   * have caught it, so it is counted here now.
   */
  const rail = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const n = (sel) => aside?.querySelectorAll(sel).length ?? 0;
    const aside2 = document.querySelector("aside");
    return {
      invite: n('a[href="/dashboard/refer"]'),
      settings: [...(aside2?.querySelectorAll('a[href="/dashboard/settings"]') ?? [])].map(
        (a) => (a.getAttribute("aria-label") || a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
      ),
    };
  });
  check(rail.invite === 1, "exactly one invite card in the rail", `${rail.invite}`);
  /**
   * THREE settings links is CORRECT, and they are listed rather than counted so
   * that this is not "fixed" to a smaller number later: the nav row, the
   * account row's gear, and the Invite Members card. The first count written
   * here said two, from reading the source — and missed that `NAV` renders one
   * of them, which is the whole reason to ask the page instead.
   */
  check(
    rail.settings.length === 3,
    "the nav row, the account gear and Invite Members — no more",
    rail.settings.join(" | "),
  );

  /**
   * SHARE OPENS THE INVITE PICKER. It put `window.location.href` on the
   * clipboard for months — a URL an unauthenticated stranger cannot open — and
   * now asks the one question the bar cannot answer for somebody: which KIND of
   * invite, since the two have opposite consequences.
   */
  const share = page.locator("header").getByRole("button", { name: "Share" });
  check((await share.count()) === 1, "the bar carries a Share control", `${await share.count()}`);
  await share.click();
  await page.waitForTimeout(400);
  const picker = page.locator("[role='dialog']");
  check((await picker.count()) === 1, "and it opens the invite picker");
  if (await picker.count()) {
    const text = (await picker.innerText()).replace(/\s+/g, " ");
    check(/Who are you inviting\?/.test(text), "asking which kind of invite");
    check(/r\/ABC12345/.test(text), "with the person's own link in it", text.slice(0, 120));
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  check((await page.locator("[role='dialog']").count()) === 0, "and Escape closes it");

  check(errors.length === 0, "no page errors from the bell", errors.join(" · "));
  await ctx.close();
  if (fails.length) bad++;
}

/**
 * …AND IT STOPS DEAD FOR SOMEBODY WHO ASKED FOR LESS MOTION. The global reduce
 * block clamps every animation to 0.01ms with one iteration, which for a
 * spinning sweep means "jump to the end and stay there" — a bright arc parked
 * on one corner forever, which is not less motion, it is a permanent artefact.
 */
{
  console.log("\nreduced motion");
  const fails2 = [];
  const check2 = (ok, what, detail = "") => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
    if (!ok) fails2.push(what);
  };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/design/overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const rim = await page.evaluate(() => {
    const link = document.querySelector('aside a[href="/dashboard/refer"]');
    if (!link) return null;
    const cs = getComputedStyle(link, "::before");
    return { name: cs.animationName, image: cs.backgroundImage };
  });
  check2(rim !== null, "the card is still there");
  if (rim) {
    check2(rim.name === "none", "the sweep is off, not frozen mid-turn", rim.name);
    check2(rim.image === "none", "and the conic gradient is replaced by a plain edge", rim.image.slice(0, 30));
  }
  await ctx.close();
  if (fails2.length) bad++;
}

/**
 * THE RIM AND THE TOAST, IN BOTH THEMES — two bugs that were each visible in
 * exactly one of them, which is why they both shipped.
 *
 * THE RIM had no ground of its own: the sweep is transparent for most of its
 * turn, so whatever is behind the card shows through. On the dark rail that is
 * #121212 and the beam reads as a light on a dark edge; on the light rail it is
 * #F3F3F3, and the measured rim came back 243,243,243 with the beam peaking at
 * 218,228,248 — a slightly blue smudge on the page. Two attempts to fix it by
 * changing the beam's COLOUR could not have worked, because the problem was the
 * absence of anything behind it.
 *
 * THE TOAST's Undo was `text-white/90`, left from when that surface was dark in
 * both themes. It is `bg-accent` now, which follows the theme, so on light the
 * one control on the product's only toast measured about 1.1:1. The first fix
 * — `text-muted-foreground` — cleared light at 4.51 and broke dark at 2.96,
 * which is why both are measured here rather than the one that was reported.
 */
{
  console.log("\nboth themes: the invite rim and the toast");
  const fails3 = [];
  const check3 = (ok, what, detail = "") => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok || !detail ? "" : ` — ${detail}`}`);
    if (!ok) fails3.push(what);
  };
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const rgb = (css) => css.match(/\d+/g).slice(0, 3).map(Number);

  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/design/overview`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    /**
     * THE BEAM MUST STAND OUT AGAINST THE RIM IT TRAVELS — which is the
     * invariant, and not the one this first asserted.
     *
     * The first version compared the rim to the PAGE and demanded they differ.
     * That is true on light and false on dark by design: #16305E against
     * #121212 is 1.4:1, and it does not matter, because on a dark page a dark
     * rim is invisible in exactly the way an unlit edge should be. What has to
     * be true in BOTH themes is that the light is brighter than the edge it is
     * running along — which is what the rim's own ground was added to
     * guarantee, after the light rail showed through and left the beam at
     * 218,228,248 on a 243,243,243 page.
     */
    const beam = await page.evaluate(() => {
      const link = document.querySelector('aside a[href="/dashboard/refer"]');
      const probe = document.createElement("span");
      probe.style.color = "var(--rail-beam)";
      link.appendChild(probe);
      const lit = getComputedStyle(probe).color;
      probe.remove();
      return { lit, rim: getComputedStyle(link).backgroundColor };
    });
    const r = ratio(rgb(beam.lit), rgb(beam.rim));
    check3(r >= 3, `${scheme}: the beam stands out against the rim it runs along`, `${r.toFixed(2)}:1 — ${beam.lit} on ${beam.rim}`);

    await ctx.close();
  }

  /* THE TOAST, on the gallery where it is rendered behind a switch. */
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/design`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const toggle = page.getByRole("button", { name: /toast/i }).first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(400);
    }
    /**
     * MEASURED FROM PIXELS, and this is the THIRD check in this repo to learn
     * it the hard way. `getComputedStyle(el).color` for a `text-white/90`
     * comes back as `oklab(0.999994 … / 0.9)` — whose numbers are not colour
     * channels — so a naive rgb parse produced garbage that happened to pass.
     * Reinstating the original `text-white/90` bug left this GREEN until the
     * label was read off the screen instead.
     *
     * So: photograph the toast, hide the label, photograph it again, and take
     * the pixel inside the label's box that differs most between the two. That
     * pixel is the middle of a glyph, and the one under it is the surface.
     */
    const box = await page.evaluate(() => {
      const el = document.querySelector("[role='status']");
      const act = el?.querySelector("button");
      if (!act) return null;
      const r = act.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
    check3(box != null, `${scheme}: the toast and its action are on the page`);
    if (box) {
      const withInk = (await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 900 } })).toString("base64");
      await page.addStyleTag({ content: "[role='status'] button{color:transparent!important}" });
      await page.waitForTimeout(200);
      const noInk = (await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 900 } })).toString("base64");
      const m = await page.evaluate(
        async ({ a, c, box }) => {
          const load = (s) =>
            new Promise((res) => {
              const i = new Image();
              i.onload = () => res(i);
              i.src = `data:image/png;base64,${s}`;
            });
          const [A, B] = await Promise.all([load(a), load(c)]);
          const g2 = (img) => {
            const cv = document.createElement("canvas");
            cv.width = img.width;
            cv.height = img.height;
            const g = cv.getContext("2d", { willReadFrequently: true });
            g.drawImage(img, 0, 0);
            return g;
          };
          const ga = g2(A);
          const gb = g2(B);
          const k = A.width / innerWidth;
          const da = ga.getImageData(Math.round(box.x * k), Math.round(box.y * k), Math.round(box.w * k), Math.round(box.h * k)).data;
          const db = gb.getImageData(Math.round(box.x * k), Math.round(box.y * k), Math.round(box.w * k), Math.round(box.h * k)).data;
          let best = -1;
          let ink = null;
          let ground = null;
          for (let i = 0; i < da.length; i += 4) {
            const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
            if (d > best) {
              best = d;
              ink = [da[i], da[i + 1], da[i + 2]];
              ground = [db[i], db[i + 1], db[i + 2]];
            }
          }
          return { ink, ground, delta: best };
        },
        { a: withInk, c: noInk, box },
      );
      check3(m.delta > 25, `${scheme}: the Undo label was measurable`, `only Δ${m.delta} between frames`);
      if (m.delta > 25) {
        const r = ratio(m.ink, m.ground);
        check3(r >= 4.5, `${scheme}: the toast's Undo is legible`, `${r.toFixed(2)}:1 — rgb(${m.ink}) on rgb(${m.ground})`);
      }
    }
    await ctx.close();
  }
  if (fails3.length) bad++;
}

await browser.close();
console.log(bad === 0 ? "\n✓ the frame holds at every size" : `\n✗ ${bad} size(s) wrong`);
process.exit(bad === 0 ? 0 : 1);
