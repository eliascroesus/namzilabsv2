import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BASE STYLES MUST LOSE TO UTILITIES, AND THE ONLY THING THAT SAYS SO IS THE
 * LAYER THEY ARE IN.
 *
 * This is the test for a bug that was live in every card in the product and
 * invisible in every file that had it. `globals.css` set, at the top level:
 *
 *     :where(h1, h2, h3, h4, legend) { text-wrap: balance; }
 *
 * `:where()` has zero specificity, so this looks like the weakest rule in the
 * stylesheet and was written to be. It was not. UNLAYERED CSS BEATS LAYERED
 * CSS OUTRIGHT — the layer sort runs before specificity is ever consulted, and
 * unlayered declarations sort last — so this beat every Tailwind utility in the
 * app, all of which live in `@layer utilities`.
 *
 * What that broke: `text-wrap` and `white-space` are shorthands over the SAME
 * longhand, `text-wrap-mode`. `balance` set `text-wrap-mode: wrap`, which
 * outranked the `white-space: nowrap` inside `truncate`. So `truncate` on a
 * heading applied its `overflow: hidden` and its `text-overflow: ellipsis` and
 * silently dropped the third of its three declarations. Every card title in
 * this product is an `h3` with `truncate` on it, so a long title wrapped to
 * three lines and was then clipped by the overflow rule — the exact opposite
 * of the one line and an ellipsis the class exists to produce.
 *
 * Nothing about that is legible from the call site. `<h3 className="truncate">`
 * is correct code. Measured in a browser it was `white-space: normal`, on an
 * element whose class list said otherwise.
 *
 * So the assertion is about the LAYER, not about the property: a base style
 * that is not in `@layer base` is a base style that outranks the utilities it
 * is supposed to yield to, whatever it happens to set today.
 *
 * Sabotage-verified: unwrapping the `@layer base` block fails this test alone.
 */
const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8");

/**
 * The stylesheet with every `@layer <name> { … }` block removed, leaving only
 * what is unlayered. Brace-matched rather than regexed: these blocks nest
 * (`@layer base { @media … { … } }`), and a non-greedy `{[^}]*}` stops at the
 * first inner brace and reports the rest of the layer as top-level.
 *
 * `@layer a, b;` statements and `@import … layer(…)` are not blocks and are
 * left alone; they declare order and set no properties.
 */
function unlayered(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; ) {
    // `@keyframes` is stripped alongside `@layer` because its `from`/`to`
    // selectors are keyframe stops, not element selectors — they look exactly
    // like bare elements to the check below and are not subject to the cascade
    // at all.
    const at = [source.indexOf("@layer", i), source.indexOf("@keyframes", i)]
      .filter((n) => n !== -1)
      .sort((a, b) => a - b)[0] ?? -1;
    if (at === -1 || at === undefined) {
      out += source.slice(i);
      break;
    }
    const open = source.indexOf("{", at);
    const semi = source.indexOf(";", at);
    // `@layer a, b;` — a declaration, not a block. Keep scanning past it.
    if (open === -1 || (semi !== -1 && semi < open)) {
      out += source.slice(i, semi + 1);
      i = semi + 1;
      continue;
    }
    out += source.slice(i, at);
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/**
 * COMMENTS COME OUT BEFORE ANYTHING IS SCANNED, AND THAT IS NOT HOUSEKEEPING.
 *
 * The selector scan below keys on `(^|})\s*([^{}@/]+?)\s*\{`. Excluding `/`
 * from a selector is right — no selector contains one — but it also means the
 * pattern cannot step OVER a comment, and in this stylesheet nearly every rule
 * is preceded by a long one. The effect was silent and total: the check saw 13
 * of the 35 unlayered rules, could not see bare `html` at all, and matched
 * prose from inside a comment as a selector (it reported "` or `" as CSS).
 *
 * So the guard reported success for a file whose `html`, `textarea` and
 * `summary` rules were all outside every layer — the exact class of rule the
 * second test exists to forbid. A guard that cannot see the thing it guards is
 * worse than no guard, because its green is mistaken for evidence.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Declarations of `prop` that are not inside any `@layer`. */
function unlayeredDeclarations(prop: string): string[] {
  return [...stripComments(unlayered(css)).matchAll(new RegExp(`^\\s*${prop}\\s*:\\s*([^;]+);`, "gm"))].map((m) =>
    m[1].trim(),
  );
}

/**
 * Unlayered rules whose selector reaches BARE ELEMENTS — `h3`, `:where(h1, h2)`,
 * `a:hover` — as opposed to a class or an id.
 *
 * The distinction is the whole point of the second test, and `.board-canvas`
 * is why it has to be drawn. A component class sitting outside a layer wins
 * against utilities too, but only on the elements that opt into it by carrying
 * the class, and nothing puts a conflicting `display` utility on a canvas that
 * exists to be a grid. A rule keyed on an ELEMENT applies to every one of them
 * in the product, including the several hundred that carry utilities the author
 * of the rule never saw. That is the case that silently disarms a utility.
 *
 * Custom properties are excluded: a `:root { --token: … }` block sets values
 * that utilities READ, so it cannot outrank them.
 */
function unlayeredElementRules(): { selector: string; props: string[] }[] {
  const out: { selector: string; props: string[] }[] = [];
  for (const m of stripComments(unlayered(css)).matchAll(/(^|})\s*([^{}@/]+?)\s*\{([^{}]*)\}/g)) {
    const selector = m[2].trim();
    if (!selector || selector.startsWith("--")) continue;
    // A selector reaches bare elements when some comma-separated part, with
    // `:where()`/`:is()` unwrapped, has a key that is not a class, id,
    // attribute or `:root`.
    const parts = selector.replace(/:(?:where|is)\(([^)]*)\)/g, ",$1,").split(",");
    const bare = parts.some((p) => {
      const key = p.trim().split(/[\s>+~]+/).pop() ?? "";
      return /^[a-z][a-z0-9-]*(?::|::|$)/.test(key) && !key.startsWith("root");
    });
    if (!bare) continue;
    const props = [...m[3].matchAll(/^\s*([a-z-]+)\s*:/gm)].map((d) => d[1]).filter((p) => !p.startsWith("--"));
    if (props.length) out.push({ selector, props });
  }
  return out;
}

describe("base styles are layered", () => {
  it("puts the heading text-wrap rule inside @layer base", () => {
    // It still has to exist — deleting it would pass a test about layering
    // while losing the balanced headings the rule is there for.
    expect(css).toMatch(/text-wrap:\s*balance/);
    // `white-space` is checked alongside it because the two are a shorthand
    // pair over `text-wrap-mode`: an unlayered rule setting EITHER one
    // disarms `truncate`, `text-wrap-*` and `whitespace-*` on every element
    // it matches.
    expect(unlayeredDeclarations("text-wrap")).toEqual([]);
    expect(unlayeredDeclarations("white-space")).toEqual([]);
  });

  it("leaves no unlayered rule keyed on a bare element", () => {
    expect(unlayeredElementRules()).toEqual([]);
  });
});

/**
 * TWO THINGS THE FILE USED TO SAY TWICE, AND ONE IT SHOULD NOT SAY AT ALL.
 *
 * `html` was declared in two places — `color-scheme` and `scroll-padding-top`
 * in one, `-webkit-tap-highlight-color` in another eighty lines later. They did
 * not conflict, so nothing was broken; they were simply two answers to "what
 * does this file say about `html`", which is one answer too many for the next
 * person editing it.
 *
 * The tap highlight is the other one. Its comment said "the brand at 12%" and
 * the value was `rgb(0 212 146)` — #00D492, which WAS the brand until the
 * 8 September re-theme and then was not. The literal outlived the sentence
 * describing it, so the highlight drew what is now `--success` — the freshness
 * dot's green — while claiming to draw the product's colour.
 *
 * #00D492 IS NOT DEAD and must not be banned: it is `--success`, live in both
 * themes as `--success-soft` and `--freshness-halo`, with its contrast ratios
 * worked out in the stylesheet. The assertion below is therefore about what the
 * tap highlight IS, not about what the file may no longer contain — a blanket
 * ban on the value would fail on the success colour doing its job.
 *
 * NOT ASSERTED: that `@layer base` appears once. Wrapping rules where they sit
 * left eleven blocks, and merging them would move two hundred lines of rules
 * away from the prose that explains them. Every `@layer base` block contributes
 * to the same layer with identical cascade behaviour, so the merge would buy
 * nothing and cost the thing that makes this file readable.
 */
describe("the stylesheet says each thing once", () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("declares html exactly once", () => {
    expect([...bare.matchAll(/^\s*html\s*\{/gm)]).toHaveLength(1);
  });

  it("sets the tap highlight in the brand, not in the success colour", () => {
    expect(bare).toMatch(/-webkit-tap-highlight-color:\s*rgb\(182 255 86 \/ 0\.12\)/);
    expect(bare).not.toMatch(/-webkit-tap-highlight-color:\s*rgb\(0 212 146/);
  });

  it("keeps #00D492 where it is still the right answer", () => {
    // Guards the fix above from being over-applied: the success colour is not
    // residue, and a later cleanup that greps for the old brand must not take
    // the freshness dot with it.
    expect(bare).toMatch(/--success:\s*#00d492/i);
  });
});
