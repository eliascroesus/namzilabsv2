import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE ICONS SOMEBODY DROPPED INTO `public/app-icons/`, as the build sees them.
 *
 * Run by `next.config.mjs` every time the app builds (and every time the dev
 * server starts), so adding a logo is: put `instantly.png` in the folder, push.
 * No script to remember and no list to edit — which is also why a file added
 * through GitHub's own "Upload files" button works: Vercel's build does the
 * scan.
 *
 * The answer is baked into the bundle (`env.APP_ICONS`) because the public
 * folder is served by the CDN, not shipped inside the server functions, so
 * nothing can reliably list it at request time. `src/connectors/app-icons.ts`
 * matches each file to an app.
 *
 * `?v=` IS THE FILE'S CONTENT HASH, so replacing `instantly.png` with a better
 * one reaches every browser on the next deploy instead of hiding behind a
 * cached copy of the old one — and an untouched file keeps its cache.
 *
 * `mono` IS SET WHEN THE FILE IS A ONE-COLOUR SVG (see `monoColor`), which is
 * what lets the product repaint a navy or black mark white on a dark ground
 * instead of drawing it invisible there.
 *
 * @param {string} dir absolute path of the folder to scan
 * @returns {Array<{ key: string; src: string; mono?: string }>} `key` is the file name without its extension
 */
export function scanAppIcons(dir) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return []; // No folder is no icons, never a failed build.
  }
  const out = [];
  for (const file of files.sort()) {
    const m = /^(.+)\.(svg|png|webp|jpe?g|avif)$/i.exec(file);
    if (!m || file.startsWith(".")) continue;
    const bytes = readFileSync(join(dir, file));
    const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 8);
    const mono = m[2].toLowerCase() === "svg" ? monoColor(bytes.toString("utf8")) : undefined;
    out.push({ key: m[1], src: `/app-icons/${encodeURIComponent(file)}?v=${hash}`, ...(mono ? { mono } : {}) });
  }
  return out;
}

/**
 * THE ONE COLOUR AN SVG IS PAINTED IN — or undefined when it has more than one.
 *
 * A mark drawn in a single colour is a silhouette, and a silhouette can be
 * repainted: Retell's is eight navy dots, which is exactly right on a light
 * card and invisible on the dark theme's near-black, because every logo here
 * is drawn bare with no tile behind it. Knowing the file is one colour is what
 * lets `BrandLogo` paint it white on a dark ground — the way vendors ship their
 * own reversed marks — while leaving a multi-colour logo exactly as uploaded.
 *
 * DELIBERATELY NARROW. Only `fill`/`stroke` spelled as hex, `black`, `white`
 * or `currentColor` count, and anything that paints some other way — a
 * gradient, a pattern, an embedded bitmap, `rgb()` — makes the answer
 * "not one colour", so a file this cannot read is drawn as-is rather than
 * recoloured wrongly. No explicit paint at all is SVG's default: black.
 *
 * @param {string} svg the file's text
 * @returns {string | undefined} `#rrggbb`, lower-case
 */
export function monoColor(svg) {
  if (/<image\b|<pattern\b|gradient\b|stop-color|url\(/i.test(svg)) return undefined;
  const named = { black: "#000000", white: "#ffffff", currentcolor: "#000000" };
  const found = new Set();
  for (const m of svg.matchAll(/(?<![\w-])(?:fill|stroke)\s*(?:=\s*["']|:\s*)([^"';}\s>]+)/gi)) {
    const v = m[1].toLowerCase();
    if (v === "none" || v === "transparent") continue;
    if (/^#[0-9a-f]{6}$/.test(v)) found.add(v);
    else if (/^#[0-9a-f]{3}$/.test(v)) found.add(`#${[...v.slice(1)].map((c) => c + c).join("")}`);
    else if (v in named) found.add(named[v]);
    else return undefined;
  }
  if (found.size > 1) return undefined;
  return found.size === 1 ? [...found][0] : "#000000";
}
