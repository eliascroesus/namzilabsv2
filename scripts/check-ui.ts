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
 * components compile.
 *
 * THE LEGACY HALF HAS EMPTIED OUT, and the day it did is this one. The eight
 * old names were allowed in "while the app is migrated surface by surface";
 * what actually happened is that both spellings stayed live for months, so the
 * app ran TWELVE names over NINE sizes with three-way ties at 12px and 16px.
 * Every one of them compiled, so this file passed the whole time — a closed set
 * that had quietly reopened, which is worse than never having had one, because
 * the gate reported health.
 *
 * So they come off the list AND get a rule of their own below. Deleting the
 * tokens alone would make `text-micro` compile to nothing, which is the kit's
 * usual punishment and the wrong one here: 326 call sites were rewritten at
 * once, and a missed one would render at its inherited size on a page nobody
 * reopened. A named failure says which word to use instead.
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
    name: "retired type alias",
    why: "one name per size; these were the second spelling of a step that already had one, and they no longer exist in @theme",
    /**
     * The mapping, for whoever trips this:
     *   text-micro | text-tiny -> text-xs          (12px)
     *   text-small | text-base -> text-sm          (14px)
     *   text-lead              -> text-md          (16px)
     *   text-title             -> text-lg          (18px)
     *   text-display           -> text-display-xs  (24px)
     *   text-stat              -> text-display-md  (36px)
     *   text-hero              -> text-display-lg  (48px)
     *
     * `text-banner` is NOT here: it is the landing's fluid clamp, the one step
     * with no Untitled UI twin, and it keeps its own name.
     *
     * The negative lookahead on `display` is load-bearing — `\b` matches before
     * a hyphen, so a naive `\btext-display\b` flags every `text-display-xs` in
     * the app and the rule that bans the alias would ban its replacement.
     */
    find: (line) =>
      line.match(/\btext-(?:micro|tiny|small|base|lead|title|stat|hero|display\b(?!-(?:xs|sm|md|lg)))\b/)?.[0] ?? null,
  },
  {
    name: "font-bold",
    why: "the kit runs 400 / medium / semibold; 700 is a fourth weight nothing else in the product uses",
    /**
     * Added because the NEWEST surface broke it. `top-bar.tsx` — shipped in the
     * chrome rebuild — set the workspace name, the avatar initial and the
     * greeting in `font-bold`, three of them, while every other heading in the
     * app is `font-semibold`. Nothing failed, because this rule did not exist:
     * §3 of the kit said "Never `font-bold`" and only prose was enforcing it.
     */
    find: (line) => (/\bfont-bold\b/.test(line) ? "font-bold" : null),
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
    allow: {
      // `rounded:` there is a tailwind-merge CLASS GROUP KEY, not a class — the
      // group that teaches the merger our four radius names so `rounded-control`
      // can beat `buttonVariants`' `rounded-full`. The rule's own regex accepts
      // a trailing `:` (it has to, to catch `rounded:` inside a variant), so an
      // object key spelled the same way reads as a bare radius.
      "src/lib/utils.ts": "the tailwind-merge radius class-group key, which is not a class",
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
  /**
   * `black-as-primary` IS RETIRED, AND IT IS THE ONE RULE THE RE-THEME KILLED
   * OUTRIGHT RATHER THAN REPLACED.
   *
   * It banned `bg-neutral-900` at a call site, and the whole argument was about
   * INVERSION: `--foreground` answered `neutral-900` in light and `ink-50` in
   * dark, so a `bg-foreground` button flipped with the theme while a
   * `bg-neutral-900` one was that black frozen at one exposure — invisible on
   * the dark theme's own page colour, and identical to the correct spelling in
   * light, which is precisely why nobody would catch it by eye.
   *
   * There is one theme. Nothing inverts, so nothing can be frozen against an
   * exposure that does not exist, and `neutral-900` is no longer a near-black
   * pretending to be a role — it is #211f20, the CONTROL surface, which the
   * period track and every select in the product legitimately name.
   *
   * Keeping the rule would have meant banning the spelling of a surface the kit
   * had just introduced. It goes, rather than acquiring an allowlist entry for
   * every file that draws a select.
   */
  /**
   * `yellow-as-stroke` IS RETIRED, AND IT IS THE RULE THIS FILE WAS PROUDEST OF.
   *
   * It failed the build on `text-primary`, `border-primary`, `ring-primary`,
   * `stroke-primary`, `fill-primary` and `divide-primary`, because #eecf00
   * measures 1.55:1 as a stroke on white and 11.24:1 as a fill under near-black
   * ink. Those are legal classes pointing at a live token, so they COMPILED —
   * the build passed, and the link rendered at 1.55:1. That is not a dim
   * colour, it is an absent one, and the only person who would ever catch it is
   * someone looking at that exact hover state on that exact screen. A script
   * was the only thing that could.
   *
   * The measurement it was built on is gone. `--primary` is #00c0e8 and
   * `--marker` is #00cdf5, both cyan, and on #1b191a the stroke step is 9.20:1
   * — past what a line owes AND past what body text owes. The split it enforced
   * has nothing left to keep apart, and the exemption it carried (top-bar.tsx's
   * ring arc, "the one surface where the brand strokes at 8.77:1") is now every
   * surface in the product.
   *
   * The two tokens survive as a FILL step and a STROKE step of one ramp, which
   * is an ordinary ramp rather than a rule needing a gate.
   */
  {
    name: "retired accent-yellow",
    why: "--color-accent-yellow was deleted when yellow became the brand; the class still parses and compiles to NOTHING, so the object renders with no fill at all",
    /**
     * The sheet's decorative set held a fifth colour — `#faf63c`, a highlighter
     * neon — for as long as `--primary` was violet and the kit needed a yellow
     * that was not the brand. Now that yellow IS the brand, two yellows four
     * counts apart under two names is a pair nobody could have kept in step and
     * nobody could have told apart on screen, so the token is gone.
     *
     * Deleting it without a rule is the wrong punishment here, for the reason
     * the retired type aliases got one: an unresolved COLOUR utility does not
     * look broken. `bg-accent-yellow` renders as no background at all, so a
     * chip that should be the loudest object in its row reads as a plain label
     * on the card behind it — legible, plausible, and wrong. Anything that
     * wants the brand asks for `bg-primary` with `text-primary-foreground`.
     */
    find: (line) => line.match(/\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|via|to)-accent-yellow\b/)?.[0] ?? null,
  },
  {
    name: "retired token",
    why: "these tokens were deleted with the light theme; the classes still PARSE, compile to nothing, and leave the object with no colour at all",
    /**
     * THE PUNISHMENT THAT FITS THE CRIME, and this rule exists because the
     * re-theme committed exactly this offence twice before anyone looked.
     *
     * Deleting a colour token is not like deleting a size token. An unresolved
     * `text-micro` renders at the inherited SIZE, which is wrong and visible.
     * An unresolved `border-marker-300` renders with NO BORDER — the selected
     * step in the flow builder simply stopped having an edge — and an
     * unresolved `text-marker-ink` renders in whatever colour its parent
     * happened to be. Both look plausible. Neither throws, neither warns, and
     * neither fails a build.
     *
     * That is precisely what happened: 27 `marker-*` ramp classes and three
     * `text-marker-ink` in the builder survived the sweep that retired their
     * tokens, and they were found by grepping rather than by anything failing.
     * A named failure says which word to use instead.
     *
     * The mapping, for whoever trips this:
     *   --ground / --ground-ink / --ground-ink-muted  ->  background / foreground / muted-foreground
     *   --chrome-*  (nine of them)                    ->  border / card / primary / muted-foreground
     *   --period-bg / -line / -ink                    ->  control / border / muted-foreground
     *   --tab-underline                               ->  marker
     *   --marker-ink                                  ->  marker  (9.20:1 — it needs no ink step)
     *   --marker-<n>  (the violet ramp)               ->  brand-<n>
     *   --ink-<n>     (the dark-surface ramp)         ->  neutral-<n>
     *   --rail / --sidebar / --sidebar-accent         ->  background / neutral-700
     *   --accent-yellow                               ->  primary
     */
    find: (line) =>
      line.match(
        /\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|via|to|shadow)-(?:ink-\d+|chrome-[a-z-]+|ground(?:-ink)?(?:-muted)?|period-[a-z]+|marker-ink|marker-\d+|tab-underline|accent-yellow|rail|sidebar(?:-accent)?)\b/,
      )?.[0] ?? null,
  },
  {
    name: "dark: variant",
    why: "a value that differs between the themes is a ROLE; `dark:` is a second answer living at a call site, which is how the two themes drifted last time",
    /**
     * `@custom-variant dark` is deliberately KEPT in globals.css — deleting it
     * hands `dark:` back to Tailwind's default `prefers-color-scheme` binding,
     * where a stray class would fire on half the machines loading the page with
     * nobody here able to see it. So the variant compiles and matches nothing,
     * and this is what stops the dead spelling accumulating behind it.
     */
    find: (line) => line.match(/\bdark:[a-z[]/)?.[0] ?? null,
  },
  {
    name: "re-spelled icon weight",
    why: "the kit's icon weight is 2.25 and globals.css declares it once; a bare strokeWidth={2} or {2.25} is the sixth spelling of a decision that already has one",
    /**
     * THE SAME FAILURE AS THE FOCUS RING, IN A DIFFERENT ATTRIBUTE.
     *
     * `strokeWidth` was spelled SIX ways across 53 call sites — 2, 2.25, 2.5,
     * 2.75, 3, 3.5 — with no default declared anywhere, so the same 16px
     * chevron rendered at one weight in the rail and another in a menu and the
     * only way to notice was to put two screens side by side.
     *
     * `:where(svg.lucide)` in globals.css is the answer now. This rule bans
     * only the two values that RE-SPELL that default; the heavier ones are
     * deliberate and still pass, because an 11px checkmark inside a 14px swatch
     * genuinely needs 3.5 to read at all. What is banned is saying the default
     * out loud, because a call site that says it can drift from it.
     */
    find: (line) => line.match(/strokeWidth=\{2(?:\.25)?\}/)?.[0] ?? null,
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
      // `src/components/sidebar.tsx` WAS here, for "the rail's avatar — a round
      // control on a dark surface with its own alpha ladder". That avatar left
      // with the 264px column, and the 70px rail's two buttons (search, the
      // bell) are `Button variant="ghost" size="iconSm"` with the chip drawn
      // inside them. An allowlist entry that no longer suppresses anything is
      // an invitation to put something back under it.
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
