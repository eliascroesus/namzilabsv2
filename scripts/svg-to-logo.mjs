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
if (/<clipPath[\s>]/.test(svg)) blockers.push("a clipPath");
if (/<(circle|rect|ellipse|polygon|polyline|line)[\s>]/.test(svg)) blockers.push("a non-path shape (circle/rect/polygon)");

const paths = [];
for (const m of svg.matchAll(/<path\b([^>]*)>/g)) {
  const attrs = m[1];
  const d = attrs.match(/\sd="([^"]*)"/s)?.[1];
  if (!d) continue;
  const cls = attrs.match(/class="([^"]*)"/)?.[1];
  const own = attrs.match(/\sfill="([^"]*)"/)?.[1];
  // Precedence as the browser applies it: a presentation attribute on the
  // element beats the class rule it inherits.
  const fill = own ?? (cls ? classFills[cls.trim().split(/\s+/)[0]] : undefined) ?? "currentColor";
  // Collapse the exporter's line wrapping. `d` is whitespace-insensitive
  // between tokens, so this changes the string and not the shape.
  paths.push({ d: d.replace(/\s+/g, " ").trim(), fill: fill.trim() });
}

if (paths.length === 0) {
  console.error("! no <path> elements found.");
  process.exit(1);
}

const fills = [...new Set(paths.map((p) => p.fill.toLowerCase()))];
const allWhite = fills.every((f) => f === "#ffffff" || f === "#fff" || f === "white");
const mono = fills.length === 1;

console.log(`\n// ${source} — ${paths.length} path(s), viewBox ${viewBox}, fills: ${fills.join(", ")}`);
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
