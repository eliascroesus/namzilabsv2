/**
 * NOTHING IN THIS PRODUCT DRAWS A DROP SHADOW.
 *
 * The kit's shadow ladder is `none` at every rung (globals.css), which means
 * the ~127 `shadow-*` spellings across the app — and the vendored shadcn
 * components that cannot be edited without forking them — all compile and draw
 * nothing. That is the whole mechanism, and a mechanism is not a guarantee: a
 * hardcoded `box-shadow` in a style attribute, an arbitrary
 * `shadow-[0_2px_8px_rgba(0,0,0,.2)]`, or a re-pointed rung would each bring
 * one back with every class name still looking correct.
 *
 * So this asserts the OUTCOME rather than the spelling: it renders real pages
 * in both themes and fails if any element paints a visible shadow.
 *
 * TRANSPARENT SHADOWS ARE NOT SHADOWS. Tailwind scaffolds every ring with
 * `--tw-ring-shadow`, so a focusable element reports a `box-shadow` of several
 * fully transparent layers at rest. Those are the focus ring's plumbing and
 * must survive — filtering on alpha is what tells them apart from a real one.
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const ROUTES = ["/design/overview", "/design", "/design/board", "/design/canvas"];

const browser = await chromium.launch();
const offenders = [];

for (const route of ROUTES) {
  for (const mode of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: mode });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => null);
    if (!res || res.status() >= 400) {
      console.log(`  (skipped ${route} — ${res?.status() ?? "no response"})`);
      await ctx.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    const found = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        const shadow = getComputedStyle(el).boxShadow;
        if (!shadow || shadow === "none") continue;
        // A DROP shadow is what is banned, and two other things share the
        // property. Split the value into layers and judge each:
        //
        //   FULLY TRANSPARENT -> Tailwind's ring scaffolding, which every
        //   focusable element carries at rest. Not a shadow.
        //
        //   `inset 0 0 0 1px` -> a 1px STROKE drawn as a shadow, which is the
        //   thing the owner asked drop shadows to be REPLACED by. The group
        //   accents draw their hairline this way because it must sit inside a
        //   rounded corner without changing the box's size.
        // A DROP SHADOW HAS OFFSET OR BLUR. Everything else that lands in
        // this property is a stroke or a ring, and both are wanted:
        //
        //   `0 0 0 1px` (inset or not) is a 1px HAIRLINE drawn as a shadow —
        //   the group accents use it so the line sits inside a rounded corner
        //   without changing the box's size, and it is precisely the thing
        //   drop shadows were asked to be replaced BY.
        //
        //   Tailwind scaffolds every ring through `--tw-ring-shadow`, so a
        //   focusable element carries transparent, zero-width layers at rest,
        //   and the kit page deliberately renders lit ones.
        //
        // Judging on offset-or-blur tells a shadow from a line without having
        // to enumerate either.
        const layers = shadow.split(/,(?![^(]*\))/).map((l) => l.trim());
        const dropped = layers.filter((layer) => {
          const n = [...layer.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]));
          const [x = 0, y = 0, blur = 0] = n;
          if (x === 0 && y === 0 && blur === 0) return false;
          const rgba = layer.match(/rgba?\(([^)]+)\)/);
          if (rgba) {
            const parts = rgba[1].split(",").map((v) => parseFloat(v));
            if (parts.length >= 4 && parts[3] <= 0.001) return false;
          }
          return true;
        });
        if (dropped.length === 0) continue;
        out.push(`<${el.tagName.toLowerCase()}> ${(el.className || "").toString().slice(0, 60)} :: ${shadow.slice(0, 60)}`);
      }
      return out;
    });
    for (const f of found) offenders.push(`${route} [${mode}]  ${f}`);
    await ctx.close();
  }
}
await browser.close();

if (offenders.length === 0) {
  console.log("\n✓ no element draws a drop shadow — the edge is the border everywhere");
  process.exit(0);
}
console.log("\n✗ drop shadows found:");
for (const o of [...new Set(offenders)].slice(0, 20)) console.log("  " + o);
process.exit(1);
