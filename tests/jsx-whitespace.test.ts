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

  it("actually detects the shape it claims to", () => {
    // The lint is only worth having if it fires. This is the exact source that
    // shipped broken, run through the same matcher.
    const broken = ["      <p>", "        {n} records carry no date in this metric’s time", "        reference — counted.", "      </p>"];
    const line = broken[1];
    expect(/\}\s+[A-Za-z][A-Za-z ,’'&;-]*$/.test(line)).toBe(true);
    expect(/^[A-Za-z&]/.test(broken[2].trim())).toBe(true);
  });
});
