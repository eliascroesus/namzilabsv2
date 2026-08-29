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

/**
 * THE CLOSED SETS.
 *
 * These three rules never banned "stock Tailwind" for its own sake — they
 * banned a SECOND scale, because `text-lg` beside `text-title` is two 17px-ish
 * sizes that never quite match, and that is what an interface assembled from
 * two systems looks like. The set is now spelled Untitled UI's way so vendored
 * components compile, and the eight legacy names are in it while the app is
 * migrated surface by surface. What matters is that it is still CLOSED:
 * `text-2xl`, `rounded-3xl`-that-is-not-ours and `shadow-inner` are as
 * uncompilable as they ever were, and the day the legacy half empties out it
 * comes off this list rather than being left as a courtesy.
 */
/** Radius suffixes the kit owns. Anything else — including bare `rounded`. */
const RADIUS_OK = /^(xs|sm|md|lg|xl|2xl|3xl|4xl|control|card|surface|frame|full|none)$/;
/** Shadow rungs the kit owns (Untitled UI's ladder, plus the ringed twins). */
const SHADOW_OK = /^(xs|sm|md|lg|xl|2xl|3xl|card|card-hover|island|panel|surface|raised|lifted|float|pop|none)$/;

const RULES: Rule[] = [
  {
    name: "off-scale type",
    why: "text-2xl and up are not in the theme, so they compile to NOTHING — the text silently renders at its inherited size",
    /**
     * `xs`/`sm`/`md`/`lg`/`xl` and the four `display-*` steps ARE the scale
     * now, so the only sizes left to ban are the ones `@theme` does not
     * define — and those are worth banning precisely because Tailwind emits no
     * rule for them: the class looks right in the source, has no effect in the
     * browser, and nothing anywhere reports it. Everything else under `text-`
     * is a colour, policed by the raw-palette rule below.
     */
    find: (line) => line.match(/\btext-[2-9]xl\b/)?.[0] ?? null,
  },
  {
    name: "off-kit radius",
    why: "one radius ladder; a fifth radius from somewhere else is how cards stop matching",
    find: (line) => {
      for (const m of line.matchAll(/\brounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(\[[^\]]*\]|[a-z0-9-]+))?(?=[\s"'`}:]|$)/g)) {
        const suffix = m[1];
        if (suffix === undefined) return m[0]; // bare `rounded`
        if (suffix.startsWith("[")) {
          // Arbitrary values are allowed when derived from a kit token, e.g.
          // rounded-[calc(var(--radius-control)-2px)] — and when they are
          // `inherit`, which introduces no radius at all: it is how a scroller
          // or a mask takes the corner of whatever it is clipping, and banning
          // it would force a literal that could then drift from its parent.
          if (!suffix.includes("var(--radius") && suffix !== "[inherit]") return m[0];
          continue;
        }
        if (!RADIUS_OK.test(suffix)) return m[0];
      }
      return null;
    },
  },
  {
    name: "stock shadow",
    why: "elevation is one ladder; a rung from someone else's is a surface floating at a height nothing else uses",
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
    // The privacy/terms exemptions are GONE, and deliberately so: those two
    // pages were the last raw-palette holdouts ("out of scope this pass"), and
    // they now render through src/components/ui/legal.tsx like everything else.
    // An allowlist entry that no longer suppresses anything is an invitation to
    // put something back under it.
    allow: {
      "src/components/ui": "primitives are the sanctioned home of the few raw tints the trios can't express",
    },
  },
  {
    name: "black-as-primary",
    why: "the product has ONE primary and it is ultramarine; bg-neutral-900 buttons are the old split brand",
    find: (line) => (line.includes("bg-neutral-900") ? "bg-neutral-900" : null),
    // The landing's exemption is gone too — its buttons were the last
    // black-as-primary in the product and are now `buttonVariants()` like
    // every other button.
    allow: {
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
      "src/app/design/brand-sheet.tsx": "the same kit page, split out — it prints the brand sheet's own hex values as labels",
      // Same reason, one system along: the DESIGN.md proposal's swatch board
      // has to print the value it is documenting. The tiles themselves render
      // from the scoped custom properties in design-next.css; only the caption
      // beside each one is a literal.
      "src/app/design/next": "the proposed language's swatch board prints its own hex values as captions",
      // Next emits <meta name="theme-color"> from a build-time literal, so it
      // cannot read a CSS custom property — the browser chrome's colour has to
      // be written out. Pinned to --background by tests/design-swatches.test.ts
      // rather than trusted, because a theme change that misses it leaves a
      // grey band above the app on mobile and nothing fails.
      "src/app/layout.tsx": "themeColor must be a literal for the meta tag; pinned to --background by test",
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
      // The DESIGN.md proposal, rendered. It is a SECOND design system shown
      // beside the shipping one for comparison, so it deliberately does not
      // compose this kit's Button — using it would mean rendering the current
      // brand inside a mock-up of the replacement, which is the one thing the
      // page exists to let you tell apart. Quarantined under one route and one
      // scoped stylesheet; nothing here reaches production surfaces.
      "src/app/design/next": "the proposed design language, deliberately built from its own scoped CSS rather than this kit",
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
