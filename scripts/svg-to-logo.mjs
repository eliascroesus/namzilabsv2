/**
 * TURN A PASTED SVG INTO A CATALOGUE ENTRY.
 *
 *   node scripts/svg-to-logo.mjs whop path/to/whop.svg
 *   pbpaste | node scripts/svg-to-logo.mjs whop -
 *
 * The owner asked whether he could just send SVGs for the brands that have no
 * redistributable mark. He can, and this is what makes that cheap: it reads the
 * file, pulls out the viewBox and every path with the fill that actually
 * applies to it, and prints an entry to paste into `src/connectors/logos.ts`.
 *
 * ═══ WHY THIS IS A SCRIPT AND NOT A PAIR OF EYES ═══
 *
 * Three things go wrong when a person transcribes an SVG by hand, and all three
 * have already happened in this repo or were one step away:
 *
 *   1. THE FILL IS IN A STYLESHEET, NOT ON THE PATH. Illustrator exports
 *      `<style>.st0{fill:#FFFFFF}</style>` and then `class="st0"` on each path.
 *      Read the path alone and you get no fill at all; read it carelessly and
 *      you get "white", which is invisible on a light card. This resolves the
 *      class map.
 *   2. PATH DATA CONTAINS NEWLINES. Exporters wrap long `d` attributes. Pasted
 *      straight into a TS string that is a syntax error, and pasted into a
 *      template literal it is a silently different path.
 *   3. THE viewBox IS NOT 24x24. Whop's is `0 0 383.2 196.4` — twice as wide as
 *      it is tall. The old one-path-per-brand model assumed a square and would
 *      have squashed it.
 *
 * ═══ WHAT IT REFUSES ═══
 *
 * A file whose paint comes from a gradient, mask or clipPath is NOT reducible
 * to a list of solid fills, and flattening one to a single colour is exactly
 * the "close enough" that produced the wrong Google Calendar. Those are
 * reported and left for a human to decide, rather than quietly averaged.
 *
 * WHITE-ON-DARK VARIANTS are flagged too. A brand's press kit usually ships
 * both; the white one is for dark grounds and disappears on this product's
 * light cards. The fix is to take the mark as MONOCHROME — `currentColor`, so
 * the brand's own colour from the catalogue paints it — which is what the
 * output suggests when every fill it found is white.
 */
import { readFileSync } from "node:fs";

const [, , source, file] = process.argv;
if (!source || !file) {
  console.error("usage: node scripts/svg-to-logo.mjs <source-key> <file.svg|->");
  process.exit(2);
}

const svg = readFileSync(file === "-" ? 0 : file, "utf8");

const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
if (!viewBox) {
  console.error("! no viewBox — cannot place the mark without one.");
  process.exit(1);
}

/** `.st0{fill:#FFFFFF}` → { st0: "#FFFFFF" }. Illustrator's default export. */
/**
 * `style="fill:#292929"` — Cal.com's circle paints itself this way, and reading
 * only the `fill` ATTRIBUTE reported it as unpainted, which silently turned a
 * dark disc into `currentColor`. The presentation attribute and the style
 * property are two spellings of one thing and both have to be read.
 */
const styleFill = (attrs) => attrs.match(/style="[^"]*\bfill\s*:\s*([^;"]+)/)?.[1]?.trim();

const classFills = {};
for (const block of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
  for (const rule of block[1].matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const fill = rule[2].match(/fill\s*:\s*([^;]+)/)?.[1]?.trim();
    if (fill) classFills[rule[1]] = fill;
  }
}

const blockers = [];
if (/<(linearGradient|radialGradient)/.test(svg)) blockers.push("a gradient");
if (/<mask[\s>]/.test(svg)) blockers.push("a mask");
/**
 * A clipPath whose shape is the WHOLE canvas clips nothing — exporters emit
 * one routinely — so it is not a blocker. One that is smaller genuinely cuts
 * the art and cannot be expressed as a fill list.
 */
if (/<clipPath[\s>]/.test(svg)) {
  const clipped = [...svg.matchAll(/<clipPath[^>]*>([\s\S]*?)<\/clipPath>/g)].map((m) => m[1]);
  const vb = viewBox.split(/[\s,]+/).map(Number);
  const coversAll = clipped.every((inner) => {
    const w = Number(inner.match(/width="([\d.]+)"/)?.[1] ?? 0);
    const h = Number(inner.match(/height="([\d.]+)"/)?.[1] ?? 0);
    if (w >= vb[2] && h >= vb[3]) return true;
    /**
     * The same full-canvas clip written as a PATH — `M0 0h600v600H0z` — which
     * is what several exporters emit and what a width/height check misses
     * entirely. Close's file is exactly this, and reading it as a real crop
     * flagged a perfectly faithful mark as unusable.
     */
    const nums = (inner.match(/[\d.]+/g) ?? []).map(Number);
    return nums.includes(vb[2]) && nums.includes(vb[3]);
  });
  if (!coversAll) blockers.push("a clipPath that actually crops the art");
}
if (/<(ellipse|polygon|polyline|line)[\s>]/.test(svg)) blockers.push("a non-path shape (ellipse/polygon/polyline)");

/**
 * `<circle>` AND `<rect>` ARE CONVERTED, NOT REFUSED.
 *
 * Both are exactly expressible as a path — a circle is two arcs, a rounded
 * rectangle is four lines and four arcs — so converting loses nothing, which
 * is the bar for touching a vendor's art at all. It matters because real
 * brand files use them constantly: Google Analytics' third bar is a `<circle>`,
 * Pipedrive's tile is a `<rect rx>`, and refusing those would mean hand-writing
 * path data, which is the one thing this script exists to prevent.
 *
 * ORDER IS PRESERVED. A background rect is drawn FIRST in the source and must
 * stay first, or the tile paints over the glyph it sits behind.
 */
const shapeToPath = (tag, a) => {
  const num = (n, d = 0) => Number(a.match(new RegExp(`\\s${n}="([-\\d.]+)"`))?.[1] ?? d);
  if (tag === "circle") {
    const [cx, cy, r] = [num("cx"), num("cy"), num("r")];
    if (!r) return null;
    return `M${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}Z`;
  }
  const [x, y, w, h] = [num("x"), num("y"), num("width"), num("height")];
  if (!w || !h) return null;
  const rx = Math.min(num("rx", num("ry")), w / 2);
  const ry = Math.min(num("ry", rx), h / 2);
  if (!rx && !ry) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
  return (
    `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}` +
    `V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}` +
    `H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
    `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
  );
};

const paths = [];
// Walk paths, circles and rects in DOCUMENT order, so paint order survives.
for (const m of svg.matchAll(/<(path|circle|rect)\b([^>]*)>/g)) {
  const tag = m[1];
  if (tag !== "path") {
    const attrs = m[2];
    // `fill="none"` is a spacer, not art — exporters emit one to pin the box.
    const own = attrs.match(/\sfill="([^"]*)"/)?.[1];
    const cls = attrs.match(/class="([^"]*)"/)?.[1];
    const fill = own ?? styleFill(attrs) ?? (cls ? classFills[cls.trim().split(/\s+/)[0]] : undefined) ?? "currentColor";
    if (fill === "none") continue;
    // A rect inside <defs>/<clipPath> is a clip shape, not a drawn one.
    const before = svg.slice(0, m.index ?? 0);
    const inDefs = (before.match(/<defs[\s>]/g) ?? []).length > (before.match(/<\/defs>/g) ?? []).length;
    const inClip = (before.match(/<clipPath[\s>]/g) ?? []).length > (before.match(/<\/clipPath>/g) ?? []).length;
    if (inDefs || inClip) continue;
    const d = shapeToPath(tag, attrs);
    if (d) paths.push({ d, fill: fill.trim(), converted: tag });
    continue;
  }
  const attrs = m[2];
  const d = attrs.match(/\sd="([^"]*)"/s)?.[1];
  if (!d) continue;
  {
    const before = svg.slice(0, m.index ?? 0);
    const inDefs = (before.match(/<defs[\s>]/g) ?? []).length > (before.match(/<\/defs>/g) ?? []).length;
    const inClip = (before.match(/<clipPath[\s>]/g) ?? []).length > (before.match(/<\/clipPath>/g) ?? []).length;
    // Close's clip is a white full-canvas path; emitted as art it paints over
    // the entire logo. The skip existed only for circle/rect.
    if (inDefs || inClip) continue;
  }
  const cls = attrs.match(/class="([^"]*)"/)?.[1];
  const own = attrs.match(/\sfill="([^"]*)"/)?.[1];
  // Precedence as the browser applies it: a presentation attribute on the
  // element beats the class rule it inherits.
  const fill = own ?? styleFill(attrs) ?? (cls ? classFills[cls.trim().split(/\s+/)[0]] : undefined) ?? "currentColor";
  // Collapse the exporter's line wrapping. `d` is whitespace-insensitive
  // between tokens, so this changes the string and not the shape.
  paths.push({ d: d.replace(/\s+/g, " ").trim(), fill: fill.trim() });
}

if (paths.length === 0) {
  console.error("! nothing drawable found (no path, circle or rect).");
  process.exit(1);
}

const fills = [...new Set(paths.map((p) => p.fill.toLowerCase()))];
const allWhite = fills.every((f) => f === "#ffffff" || f === "#fff" || f === "white");
const mono = fills.length === 1;

console.log(`\n// ${source} — ${paths.length} path(s), viewBox ${viewBox}, fills: ${fills.join(", ")}`);
const converted = paths.filter((p) => p.converted);
if (converted.length) {
  // Said out loud, because a conversion is the one place this script changes
  // the vendor's file rather than just reading it.
  console.log(`// Converted to paths (exactly, no loss): ${converted.map((p) => p.converted).join(", ")}`);
}
if (blockers.length) {
  console.log(`// !! CONTAINS ${blockers.join(" and ")} — this entry is NOT faithful.`);
  console.log(`//    Solid fills cannot express it. Get a flattened symbol-only file,`);
  console.log(`//    or keep the two-letter tile. Do NOT ship the paths below as-is.`);
}
if (allWhite) {
  console.log(`// !! EVERY FILL IS WHITE — this is the on-dark variant, which is`);
  console.log(`//    invisible on a light card. Emitted as \`currentColor\` so the`);
  console.log(`//    brand's own colour from the catalogue paints it. That is the`);
  console.log(`//    right answer for a monochrome mark; check it is monochrome.`);
} else if (mono) {
  console.log(`// Single fill — a monochrome mark. Emitted as \`currentColor\`.`);
}

const emit = (p) => (allWhite || mono ? "currentColor" : p.fill);
console.log(`  ${source}: {`);
console.log(`    viewBox: ${JSON.stringify(viewBox)},`);
console.log(`    paths: [`);
for (const p of paths) console.log(`      { d: ${JSON.stringify(p.d)}, fill: ${JSON.stringify(emit(p))} },`);
console.log(`    ],`);
console.log(`  },`);
console.log(`\n// Paste into src/connectors/logos.ts, then RENDER IT AND LOOK.`);
console.log(`// Path data that parses is not path data that is correct.\n`);
