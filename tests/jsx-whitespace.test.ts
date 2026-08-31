import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE SPACE AFTER A JSX EXPRESSION, WHICH TWO TRANSFORMS DISAGREE ABOUT.
 *
 * This is a source scan rather than a render assertion, and that is the whole
 * point — a render assertion CANNOT catch this bug, because it runs under the
 * transform that agrees with it.
 *
 * The shape is:
 *
 *     <p>
 *       {count} records carry no date in this metric’s time
 *       reference — counted in All time.
 *     </p>
 *
 * The text node begins with a space, on the same line as the expression before
 * it, and then WRAPS. esbuild (which vitest uses) keeps that leading space.
 * Next's SWC transform drops it. So this shipped to production reading
 * "3 records carryno date", passed a test asserting the rendered string, and
 * was found only by looking at the page — twice, because the first repair kept
 * the same shape and the test kept agreeing with it.
 *
 * Two spellings are safe and both are explicit: put the whole sentence in one
 * expression, or end the line with `{" "}`. Neither leaves a transform an
 * opinion to have.
 *
 * THIS IS A LINT, and lints go stale silently, so it asserts a known-good
 * baseline of zero rather than merely reporting. A new offender fails here
 * with its own file and line.
 */

const SRC = join(process.cwd(), "src");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Comments explain the rule; they must not be able to trip it. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * THE SAME BUG AFTER A CLOSING TAG, WHICH THE RULE ABOVE CANNOT SEE.
 *
 * `offenders()` looks for a `}` — an EXPRESSION closing — and it skips any line
 * carrying a `className`. Both were reasonable and together they leave a hole
 * the width of every inline element in the product, because the transform does
 * not care what produced the node:
 *
 *     The band is <code className="font-mono">ink-950</code> #2E2E2E in both
 *     themes — flat, not a gradient.
 *
 * That text node also begins with a space, on the same line as the thing before
 * it, and also wraps. SWC drops it and the page reads "ink-950#2E2E2E". Five of
 * these were live when this was written — an invite page reading
 * "invite?Open the invite link", a connection row reading "</span>records
 * synced", a config panel, and two more — every one of them shipped, and every
 * one passed the lint above because the line said `className`.
 *
 * `nodeCloseOffenders()` is that rule with the element-close spelling. The two
 * stay separate rather than merging into one regex: the skips they need are
 * different (this one MUST read `className` lines, which is exactly what the
 * other one must not do), and one pattern trying to serve both is how a lint
 * quietly stops matching either.
 *
 * THE TRAILING RUN IS TESTED IN CODE, NOT IN THE PATTERN, and that is a
 * deliberate retreat from a cleverer regex. The first version anchored the
 * prose with `[A-Za-z]` and therefore could not see the very line that prompted
 * it — `</code> #2E2E2E` starts with a hash. Widening the anchor one character
 * class at a time is how a lint ends up matching everything or nothing, so the
 * close is matched, the rest of the line is captured, and `isProse` says
 * whether it is a sentence or syntax.
 *
 * THE JSX-ATTRIBUTE FALSE POSITIVE is what `isProse` is really for.
 * `qualifications={cond ? <p …>{x}</p> : null}` closes an element and then runs
 * to the end of the line — but it is an attribute value, not a text node, and
 * there is no space for a transform to have an opinion about. Prose does not
 * contain `{`, `}`, `<` or `=`, and does not open with the punctuation that
 * continues an expression.
 */
/** Is this trailing run a sentence, or the rest of an expression? */
function isProse(rest: string): boolean {
  if (/[<{}=]/.test(rest)) return false; // syntax, not a text node
  if (/^[:?,)\/|&*+]/.test(rest)) return false; // an expression continuing
  return /[A-Za-z]{2}/.test(rest); // and it has actual words in it
}
function nodeCloseOffenders(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const lines = strip(readFileSync(file, "utf8")).split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (/^\s*(import|export|const|let|return|function|type)\b/.test(line)) continue;
      // Already spelled explicitly — the whole point of the fix.
      if (/\{" "\}/.test(line)) continue;
      // An ELEMENT closes, a space follows, and what remains is prose.
      const m = line.match(/<\/[A-Za-z][\w.]*>[ \t]+(\S.*)$/);
      if (!m || !isProse(m[1])) continue;
      // And the SAME text node continues on the next line.
      const next = lines[i + 1].trim();
      if (!next || !/^[A-Za-z&]/.test(next)) continue;
      if (/^(import|export|const|return)\b/.test(next)) continue;
      found.push(`${file.slice(process.cwd().length + 1)}:${i + 1}  ${line.trim().slice(0, 80)}`);
    }
  }
  return found;
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const lines = strip(readFileSync(file, "utf8")).split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      // Statements, not markup.
      if (/^\s*(import|export|const|let|return|function|type)\b/.test(line)) continue;
      if (line.includes('from "') || line.includes("=>") || line.includes("className")) continue;
      // An expression closes, a space follows, and prose runs to end of line.
      if (!/\}\s+[A-Za-z][A-Za-z ,’'&;-]*$/.test(line)) continue;
      if (/\{" "\}/.test(line)) continue;
      // And the SAME text node continues on the next line — that is the wrap
      // that makes the leading space a transform's decision.
      const next = lines[i + 1].trim();
      if (!next || !/^[A-Za-z&]/.test(next)) continue;
      if (/^(import|export|const|return)\b/.test(next)) continue;
      found.push(`${file.slice(process.cwd().length + 1)}:${i + 1}  ${line.trim().slice(0, 80)}`);
    }
  }
  return found;
}

describe("prose spliced with expressions", () => {
  it("never leaves the space after an expression for a transform to decide", () => {
    /**
     * Sabotage: rewrite the undated sentence in `custom-tile.tsx` as
     * `carr{n === 1 ? "ies" : "y"} no date in this metric’s time` + a wrap,
     * and this fails naming that line.
     */
    expect(offenders()).toEqual([]);
  });

  it("never leaves it after a closing tag either", () => {
    /**
     * Sabotage: delete the `{" "}` from the rail note in `design/page.tsx`
     * (`</code>{" "}#2E2E2E`) and this fails naming that line.
     */
    expect(nodeCloseOffenders()).toEqual([]);
  });

  it("detects the closing-tag shape, and not a JSX attribute", () => {
    // The lint is only worth having if it fires on what actually shipped.
    const rest = (l: string) => l.match(/<\/[A-Za-z][\w.]*>[ \t]+(\S.*)$/)?.[1];

    // Live on /design. It opens with `#`, which is why the prose test is not
    // anchored to a letter — the first version of this rule missed it.
    expect(isProse(rest('The band is <code className="font-mono">ink-950</code> #2E2E2E in both')!)).toBe(true);
    // Live on the auth-error page: "invite?Open the invite link".
    expect(isProse(rest('<b className="font-semibold">Joining from an invite?</b> Open the invite link again')!)).toBe(true);
    // Live on the connection row: "</span>records synced".
    expect(isProse(rest('<span className="tnum">{n}</span> records synced from')!)).toBe(true);

    // And the attribute shape that must NOT fire: an element closes and a
    // ternary continues, which is syntax rather than a text node.
    expect(isProse(rest('qualifications={tile.kind === "error" ? <p className="mt-2">{tile.error}</p> : null}')!)).toBe(false);
  });

  it("actually detects the shape it claims to", () => {
    // The lint is only worth having if it fires. This is the exact source that
    // shipped broken, run through the same matcher.
    const broken = ["      <p>", "        {n} records carry no date in this metric’s time", "        reference — counted.", "      </p>"];
    const line = broken[1];
    expect(/\}\s+[A-Za-z][A-Za-z ,’'&;-]*$/.test(line)).toBe(true);
    expect(/^[A-Za-z&]/.test(broken[2].trim())).toBe(true);
  });
});
