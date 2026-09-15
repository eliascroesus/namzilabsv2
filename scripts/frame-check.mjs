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

  check(errors.length === 0, "no page errors from the bell", errors.join(" · "));
  await ctx.close();
  if (fails.length) bad++;
}

await browser.close();
console.log(bad === 0 ? "\n✓ the frame holds at every size" : `\n✗ ${bad} size(s) wrong`);
process.exit(bad === 0 ? 0 : 1);
