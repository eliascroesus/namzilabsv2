import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE ACCESS RESOLUTION PER REQUEST.
 *
 * `effectiveAccess` costs up to three queries for a ranked member: the rank
 * assignment, every rank in the workspace, and the owner row. Every
 * authenticated page renders `AppShell`, which resolves access to decide
 * whether the sidebar shows Apps — so a page that ALSO resolves it for its own
 * gates pays for the whole thing twice on the most-rendered screens in the
 * product.
 *
 * `requestAccess` in `src/lib/auth.ts` is the fix, and the interesting part is
 * its signature: it is `cache()`d on three STRINGS rather than on a context
 * object, because React's `cache` compares arguments by IDENTITY. Two call
 * sites each building their own `{ orgId, userId, role }` literal would miss
 * every single time and the wrapper would be decoration.
 *
 * It existed and was wired into exactly one page. Four others still resolved
 * access a second time beside their own AppShell; this is what stops that
 * coming back.
 */
const root = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments stripped: prose naming the rule is not a breach of it. */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const files = walk(join(root, "src/app"));
const pages = files.filter((f) => /[/\\]page\.tsx$/.test(f));

describe("pages resolve the request's access exactly once", () => {
  it("finds the pages (a filter matching nothing would pass everything)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
  });

  for (const p of pages) {
    const rel = p.slice(root.length + 1);
    const src = code(p);
    if (!/\bAccess\b|effectiveAccess|requestAccess/.test(src)) continue;

    it(`${rel} goes through requestAccess, not effectiveAccess`, () => {
      /**
       * A page calling `effectiveAccess` directly is not wrong — it is
       * DUPLICATED. It resolves the same three queries the shell beside it has
       * already run, keyed on an object literal nothing else can match.
       */
      expect(src, "calls effectiveAccess directly").not.toMatch(/effectiveAccess\s*\(/);
    });
  }
});

/**
 * SERVER ACTIONS AND ROUTE HANDLERS ARE THE DELIBERATE EXCEPTION, and this
 * records why rather than leaving it to be re-derived.
 *
 * They call `effectiveAccess` against the WRITE pool (`getDb()`), not the read
 * driver, because an action's whole job is to change something: resolving
 * permissions through a request-scoped cache that a mutation may already have
 * invalidated is how a revoked grant gets honoured one call too late. The reads
 * are cached; the writes re-check.
 */
describe("actions and route handlers still resolve against the write path", () => {
  const writers = files.filter((f) => /actions\.ts$/.test(f) || /route\.ts$/.test(f));

  it("finds them", () => {
    expect(writers.length).toBeGreaterThanOrEqual(4);
  });

  it("none of them reach for the cached read helper", () => {
    for (const w of writers) {
      expect(code(w), `${w.slice(root.length + 1)} caches a permissions read on a write path`).not.toMatch(
        /requestAccess\s*\(/,
      );
    }
  });
});

describe("the helper itself is keyed on values, not on an object", () => {
  const auth = code(join(root, "src/lib/auth.ts"));

  it("wraps in cache()", () => {
    expect(auth).toMatch(/export const requestAccess = cache\(/);
  });

  it("takes three primitives, so two call sites can actually collide", () => {
    /**
     * THE WHOLE POINT, AS AN ASSERTION. Change this to take a context object
     * and every call site builds its own literal, `cache` compares them by
     * reference, nothing ever hits, and the only symptom is a page that is
     * quietly slower than it was.
     */
    expect(auth).toMatch(/requestAccess = cache\(\(orgId: string, userId: string, role\?: string\)/);
  });
});
