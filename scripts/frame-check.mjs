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
await browser.close();
console.log(bad === 0 ? "\n✓ the frame holds at every size" : `\n✗ ${bad} size(s) wrong`);
process.exit(bad === 0 ? 0 : 1);
