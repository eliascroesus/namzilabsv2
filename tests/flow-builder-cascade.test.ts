import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FLOW BUILDER'S RULES ARE UNLAYERED DELIBERATELY, AND THIS SAYS SO.
 *
 * The cascade collapse layered every other component class in `globals.css`, so
 * that a `font-*` or `bg-*` utility written in a component wins against the
 * stylesheet the way its author expects. These seven were left alone.
 *
 * The reason is not that they are different in kind — they are exactly the same
 * kind, and layering them would be the consistent thing to do. It is that
 * layering them hands precedence to utilities on a surface whose design is
 * settled and not under review, and the only honest way to find out what that
 * moves is to move it and look. That was not the job.
 *
 * So this is a decision, and it is indistinguishable from an oversight to the
 * next person who greps for unlayered rules and finds seven of them sitting
 * there. Without this file they would layer them, in good faith, and the
 * builder would shift for reasons nobody could reconstruct six months later.
 * With it, the grep has an answer: it was already finished.
 *
 * If the builder is ever deliberately re-themed, delete this file in the same
 * commit that layers the rules. Do not delete it to make a red test green.
 */
const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8");

const BUILDER_RULES = [
  ".react-flow__node",
  ".react-flow__node.selectable:focus-visible",
  ".react-flow__handle",
  ".react-flow__edge-path",
  ".flow-shadow",
  ".flow-pop-in",
  ".flow-pop-out",
];

/**
 * The stylesheet with every `@layer <name> { … }` block removed, leaving only
 * what is unlayered. Brace-matched rather than regexed, because these blocks
 * nest and a non-greedy `{[^}]*}` stops at the first inner brace.
 */
function unlayered(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; ) {
    const at = source.indexOf("@layer", i);
    if (at === -1) {
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

/** Comments come out first, or a rule named only in prose counts as present. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the flow builder's rules stay out of the layers", () => {
  const outside = stripComments(unlayered(css));

  for (const selector of BUILDER_RULES) {
    it(`keeps ${selector} unlayered`, () => {
      // Matched as a rule head — `<selector> {` or `<selector>,` — so the
      // assertion cannot be satisfied by the name turning up inside some other
      // rule's selector list or a longer class name that contains it.
      expect(outside).toMatch(new RegExp(`\\${selector}\\s*[,{]`));
    });
  }

  it("keeps --spacing-chrome-band, which is builder geometry and not a chrome colour", () => {
    // Task 5 retires the eight `--chrome-*` COLOUR roles. This one is a
    // spacing token that happens to share the prefix, it belongs to the
    // builder's toolbar island, and a prefix-wide rename would take it out.
    expect(css).toMatch(/--spacing-chrome-band\s*:\s*24px/);
  });
});
