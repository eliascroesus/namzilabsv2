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
 * @param {string} dir absolute path of the folder to scan
 * @returns {Array<{ key: string; src: string }>} `key` is the file name without its extension
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
    const hash = createHash("sha1").update(readFileSync(join(dir, file))).digest("hex").slice(0, 8);
    out.push({ key: m[1], src: `/app-icons/${encodeURIComponent(file)}?v=${hash}` });
  }
  return out;
}
