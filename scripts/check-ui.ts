/**
 * Brand-kit gate.
 *
 * The UI drifted because nothing failed when it did: a `rounded-md` here, a
 * `text-blue-600` there, and eighteen months later the app had thirteen radii,
 * four heading styles and five greens. The kit (docs/BRAND_KIT.md) now names
 * one spelling for each of those jobs; this script is what makes the second
 * spelling a build failure instead of a design-review comment.
 *
 *   pnpm tsx scripts/check-ui.ts
 *
 * Exits 1 on any violation. Per-rule allowlists carry reasons — "it's fine"
 * is how the next drift gets waved through.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments are design prose, not classes in the DOM — and the prose in this
 * codebase is dense enough that reading it naively is the difference between
 * a useful gate and a noisy one. A rail comment explaining "a 40px rounded
 * tile" is not a radius violation.
 *
 * Line-by-line matching cannot see that: the middle lines of a JSX comment
 * block start with ordinary words. So strip comments with a tiny scanner that
 * carries block state across lines, and hand the rules only live code.
 */
function stripComments(lines: string[]): string[] {
  let inBlock = false;
  return lines.map((line) => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) return out;
        inBlock = false;
        i = end + 2;
        continue;
      }
      const lineComment = line.startsWith("//", i);
      if (lineComment) return out;
      if (line.startsWith("/*", i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      out += line[i];
      i++;
    }
    return out;
  });
}

type Rule = {
  name: string;
  why: string;
  /** Returns the offending token, or null. Runs per line. */
  find: (line: string) => string | null;
  /** Files where the pattern is sanctioned, with the reason. */
  allow?: Record<string, string>;
};

/** Radius suffixes the kit owns. Anything else — including bare `rounded`. */
const RADIUS_OK = /(control|card|surface|frame|full|none|var\(--radius)/;
/** Shadow rungs the kit owns (both finishes of the one ladder). */
const SHADOW_OK = /^(card|card-hover|island|panel|surface|raised|lifted|float|pop|none)$/;

const RULES: Rule[] = [
  {
    name: "stock type scale",
    why: "the kit's eight sizes are the only sizes — text-lg beside text-title is two 17px-ish that never match",
    find: (line) => line.match(/\btext-(?:xs|sm|lg|[2-9]?xl)\b/)?.[0] ?? null,
  },
  {
    name: "off-kit radius",
    why: "four radii (control/card/surface/frame) + full; a fifth radius is how cards stop matching",
    find: (line) => {
      for (const m of line.matchAll(/\brounded(?:-[a-z]{1,2})?(?:-\[[^\]]*\]|-[a-z0-9-]+)?(?=[\s"'`}:]|$)/g)) {
        const token = m[0];
        if (token === "rounded" || !RADIUS_OK.test(token)) return token;
      }
      return null;
    },
  },
  {
    name: "stock shadow",
    why: "elevation is the kit's one ladder; shadow-sm is a rung from someone else's",
    find: (line) => {
      for (const m of line.matchAll(/\bshadow-([a-z0-9-]+)\b/g)) {
        if (!SHADOW_OK.test(m[1])) return m[0];
      }
      return null;
    },
  },
  {
    name: "raw chromatic palette",
    why: "state speaks through success/warn/danger trios and the brand ramp; raw palette classes are how five greens happen",
    find: (line) =>
      line.match(
        /\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|via|to)-(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+(?:\/\d+)?\b/,
      )?.[0] ?? null,
    allow: {
      "src/components/ui": "primitives are the sanctioned home of the few raw tints the trios can't express",
      "src/app/privacy/page.tsx": "out of scope this pass — restyled with the landing rebuild",
      "src/app/terms/page.tsx": "out of scope this pass — restyled with the landing rebuild",
    },
  },
  {
    name: "black-as-primary",
    why: "the product has ONE primary and it is indigo; bg-neutral-900 buttons are the old split brand",
    find: (line) => (line.includes("bg-neutral-900") ? "bg-neutral-900" : null),
    allow: {
      "src/app/page.tsx": "landing keeps its current look until the marketing rebuild",
      "src/components/charts.tsx": "if bars ever need a neutral series tone, it is decided there once",
    },
  },
  {
    name: "hex literal",
    why: "colours live in tokens; a hex in a component is invisible to a future theme",
    find: (line) => line.match(/#[0-9a-fA-F]{6}\b/)?.[0] ?? null,
    allow: {
      "src/components/flow/node-accent.ts": "the step-identity palette — the one sanctioned hex map",
      "src/components/flow/controls/source-style.ts": "connector brand colours are the vendors', not ours",
      "src/app/design/page.tsx": "the kit page prints hex VALUES as documentation labels",
    },
  },
  {
    name: "unpinned locale",
    why: "bare toLocale* renders the server's locale on the server and the visitor's in the browser — same timestamp, two spellings",
    find: (line) => line.match(/\.toLocale(?:Date|Time)?String\(\s*[)]/)?.[0] ?? null,
    allow: {
      "src/lib/format.ts": "the pinned formatters themselves",
    },
  },
  {
    name: "glyph-as-icon",
    why: "lucide is the icon set; a ✕ beside a <X> is two close buttons that don't match",
    find: (line) => line.match(/[✕▾⚠⚙★›‹]/)?.[0] ?? null,
  },
  {
    name: "hand-rolled button",
    why: "Button owns the eight variants; a raw <button> re-typing bg-primary is how the app grew two primaries",
    find: (line) => (/<button\b/.test(line) ? "<button" : null),
    // Bespoke controls are not Buttons wearing a disguise — a combobox
    // trigger, a menu row, a node kebab and a card-header disclosure are
    // their own things, and forcing them through a variant would be worse.
    // Everything NOT named here is an ordinary page, where a hand-rolled
    // button is exactly the drift this file exists to stop.
    allow: {
      "src/components/ui": "the primitives themselves — this is where <button> is supposed to live",
      "src/components/flow": "the builder's canvas chrome: islands, kebabs, menu rows, combobox triggers, tab strips",
      "src/components/sidebar.tsx": "the rail's avatar — a round control on a dark surface with its own alpha ladder",
      "src/app/dashboard/settings/RanksPanel.tsx": "a full-width card-header disclosure and the dashed New-rank ghost",
    },
  },
];

const files = walk(SRC);
type Hit = { rule: Rule; file: string; line: number; token: string };
const hits: Hit[] = [];
const allowed: Hit[] = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = stripComments(readFileSync(file, "utf8").split("\n"));
  for (const rule of RULES) {
    const allowKey = Object.keys(rule.allow ?? {}).find((p) => rel.startsWith(p));
    lines.forEach((text, i) => {
      const token = rule.find(text);
      if (!token) return;
      const hit = { rule, file: rel, line: i + 1, token };
      (allowKey ? allowed : hits).push(hit);
    });
  }
}

console.log(`Scanned ${files.length} source files against ${RULES.length} kit rules.\n`);

if (hits.length === 0) {
  console.log("PASS — the UI speaks the kit's vocabulary everywhere it must.");
  process.exit(0);
}

const byRule = new Map<Rule, Hit[]>();
for (const h of hits) byRule.set(h.rule, [...(byRule.get(h.rule) ?? []), h]);

console.log(`FAIL — ${hits.length} violation(s):\n`);
for (const [rule, ruleHits] of byRule) {
  console.log(`  ${rule.name} — ${rule.why}`);
  for (const h of ruleHits.slice(0, 20)) console.log(`    ✗ ${h.file}:${h.line}  ${h.token}`);
  if (ruleHits.length > 20) console.log(`    … and ${ruleHits.length - 20} more`);
  console.log("");
}
console.log(
  "Use the kit spelling (docs/BRAND_KIT.md), or add a per-rule allowlist entry\n" + "in this script WITH a reason.",
);
process.exit(1);

export {};
