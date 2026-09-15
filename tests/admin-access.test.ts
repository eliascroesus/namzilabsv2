import { describe, expect, it, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isAllowedStaff, parseAllowlist } from "@/lib/admin/allowlist";

/**
 * THE ADMIN GATE.
 *
 * `/admin` is the only surface in this product that reads across every tenant
 * on purpose. Everything else is held by one rule — every request-facing query
 * names `org_id`, enforced by `pnpm check:tenancy` — and this route exists to
 * break it. The thing standing in its place is one allowlist, so the allowlist
 * gets the same scrutiny the tenant predicate does.
 *
 * The properties below are the ones that cannot be established by reading the
 * file: that an absent variable locks the door rather than opening it, that a
 * stray comma cannot become a member, and that no admin query anywhere reaches
 * the database without calling the gate first.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** The decision is pure, so the env does not need to be mutated to test it. */
const withEnv = (value: string | undefined) => parseAllowlist(value);

describe("the staff allowlist fails closed", () => {
  it("admits nobody when the variable is unset", () => {
    /**
     * THE FAILURE THIS PREVENTS is a deploy that drops the variable turning
     * the gate into a no-op. An empty allowlist locks the owner out, which is
     * a bad afternoon; the other direction hands every signed-in customer a
     * view of the whole fleet.
     */
    expect(withEnv(undefined).size).toBe(0);
  });

  it("admits nobody when the variable is empty or whitespace", () => {
    expect(withEnv("").size).toBe(0);
    expect(withEnv("   ").size).toBe(0);
    expect(withEnv(",,,").size).toBe(0);
  });

  it("never admits an empty string, which would match a missing email", () => {
    // `"a@b.com,"` must not produce a `""` member. An account whose email
    // failed to load would otherwise normalise to `""` and match it.
    const set = withEnv("a@b.com,");
    expect(set.has("")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("ignores entries that are not addresses", () => {
    // A hostname or a stray word in the list is a configuration mistake, not a
    // member. Requiring an `@` is a cheap way to refuse to guess.
    const set = withEnv("a@b.com, notanemail, c@d.com");
    expect([...set].sort()).toEqual(["a@b.com", "c@d.com"]);
  });

  it("normalises case and surrounding space", () => {
    const set = withEnv("  Owner@Example.COM , teammate@example.com ");
    expect(set.has("owner@example.com")).toBe(true);
    expect(set.has("teammate@example.com")).toBe(true);
  });
});

/**
 * Source with comments and string bodies left intact but comments stripped —
 * these checks are about CODE, and every phrase they look for also appears in
 * the prose explaining it.
 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("the decision itself", () => {
  const list = parseAllowlist("owner@example.com, teammate@example.com");

  it("admits a verified address on the list", () => {
    expect(isAllowedStaff("owner@example.com", true, list)).toBe(true);
    // Normalised on both sides, so the casing somebody typed never matters.
    expect(isAllowedStaff("  Owner@Example.COM  ", true, list)).toBe(true);
  });

  it("refuses an UNVERIFIED address even when it is on the list", () => {
    /**
     * The attack this closes: register as owner@<yourdomain> at an identity
     * provider that does not verify, and walk in. The address being on the
     * list is not evidence that the person holds it.
     */
    expect(isAllowedStaff("owner@example.com", false, list)).toBe(false);
  });

  it("refuses anybody at all when the list is empty", () => {
    // A dropped env var must lock the door, not remove it.
    expect(isAllowedStaff("owner@example.com", true, new Set())).toBe(false);
  });

  it("refuses a missing or blank email", () => {
    expect(isAllowedStaff(null, true, list)).toBe(false);
    expect(isAllowedStaff(undefined, true, list)).toBe(false);
    expect(isAllowedStaff("   ", true, list)).toBe(false);
    // The pairing that matters: a blank email must not match a blank entry.
    expect(isAllowedStaff("", true, parseAllowlist("a@b.com,"))).toBe(false);
  });

  it("refuses someone not on the list", () => {
    expect(isAllowedStaff("stranger@example.com", true, list)).toBe(false);
  });
});

describe("nothing reads the fleet without passing the gate", () => {
  const libFiles = walk(join(process.cwd(), "src/lib/admin"));
  const pageFiles = walk(join(process.cwd(), "src/app/admin"));

  it("gates every exported function in src/lib/admin that touches the database", () => {
    /**
     * THE RULE THAT MATTERS MOST HERE, and the reason it is asserted on the
     * QUERY rather than on the page: a layout is a rendering convenience, not
     * a security boundary. Gating only in the layout means one new page, or
     * one route handler, is all it takes to read every tenant.
     *
     * So every exported async function in `src/lib/admin` whose body reaches
     * the database must call `requireStaff()` itself.
     */
    let checked = 0;
    for (const file of libFiles) {
      const rel = file.slice(process.cwd().length + 1);
      if (rel.endsWith("access.ts")) continue; // the gate itself
      const src = code(readFileSync(file, "utf8"));
      // Split on export boundaries so each function is examined alone.
      const parts = src.split(/\nexport (?:async )?function /).slice(1);
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("(")).trim();
        if (!/getDb\(\)|db\.select|db\.execute/.test(part)) continue;
        checked++;
        expect(part, `${rel}: ${name} queries the database without requireStaff()`).toMatch(/requireStaff\(\)/);
      }
    }
    // Without this the loop would pass on a tree where nothing matched, which
    // is indistinguishable from success.
    expect(checked, "no database-touching admin functions found — this check would pass vacuously").toBeGreaterThan(3);
  });

  it("gates every admin page and the layout", () => {
    expect(pageFiles.length, "no admin pages found").toBeGreaterThan(1);
    for (const file of pageFiles) {
      const rel = file.slice(process.cwd().length + 1);
      const src = code(readFileSync(file, "utf8"));
      // Either the page calls the gate itself, or every data function it calls
      // does — both are present in this tree, and a page that does neither is
      // the bug.
      expect(src, `${rel} neither calls requireStaff() nor a gated loader`).toMatch(
        /requireStaff\(\)|fleetOverview\(\)|findWorkspaces\(|workspaceCard\(/,
      );
    }
  });

  it("refuses with notFound, never a 403", () => {
    /**
     * A 403 confirms the route exists, which tells an attacker exactly where
     * to aim. The refusal has to be indistinguishable from any other missing
     * page — so there is no admin login screen and no "not authorised" copy
     * anywhere in the tree.
     */
    const access = code(readFileSync(join(process.cwd(), "src/lib/admin/access.ts"), "utf8"));
    expect(access).toMatch(/notFound\(\)/);
    expect(access, "no status-code refusal").not.toMatch(/403|forbidden|Forbidden/);
    for (const file of [...libFiles, ...pageFiles]) {
      // Comment-stripped: the paragraph explaining "there is no 'you are not
      // authorised' screen" would otherwise fail the check it describes.
      const src = code(readFileSync(file, "utf8"));
      expect(src, `${file} must not advertise the gate`).not.toMatch(/not authoris|not authoriz|Access denied/i);
    }
  });

  it("requires the email to be verified, not merely present", () => {
    // Without this the gate trusts a string a user may control, and signing up
    // as owner@<yourdomain> becomes the entire attack. Asserted on the pure
    // module, which is where the decision moved so it could also be EXECUTED
    // in the block below rather than only read.
    const decision = code(readFileSync(join(process.cwd(), "src/lib/admin/allowlist.ts"), "utf8"));
    expect(decision).toMatch(/emailVerified !== true/);
  });

  it("keeps the allowlist out of the database", () => {
    /**
     * The dashboard's job is to expose the database, so staff membership must
     * not be something a database compromise can grant itself. This fails if
     * anybody moves the allowlist into a table.
     */
    const access = readFileSync(join(process.cwd(), "src/lib/admin/access.ts"), "utf8");
    expect(code(access)).toMatch(/process\.env\.ADMIN_EMAILS/);
    expect(code(access), "the gate must not query anything").not.toMatch(/getDb\(\)|db\.select/);
  });
});

describe("the admin surface is read-only", () => {
  it("issues no writes anywhere", () => {
    /**
     * v1 is deliberately look-but-do-not-touch: nothing to get wrong, nothing
     * to abuse, and the whole surface can be reasoned about as a set of
     * SELECTs. Adding an action means adding its own gate and its own audit
     * row — and deleting this test on purpose, rather than by accident.
     */
    for (const file of [...walk(join(process.cwd(), "src/lib/admin")), ...walk(join(process.cwd(), "src/app/admin"))]) {
      const src = code(readFileSync(file, "utf8"));
      const rel = file.slice(process.cwd().length + 1);
      expect(src, `${rel} writes to the database`).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(src, `${rel} declares a server action`).not.toMatch(/"use server"/);
    }
  });

  it("shows no customer content, only shape", () => {
    /**
     * The posture the owner chose: counts, health and identity — never what
     * anybody's data says. `last_error` is on this list because a provider
     * error string can quote a customer's own record back, which makes it
     * content wearing a diagnostic's clothes.
     */
    for (const file of walk(join(process.cwd(), "src/lib/admin"))) {
      const src = code(readFileSync(file, "utf8"));
      const rel = file.slice(process.cwd().length + 1);
      for (const forbidden of ["lastError", "credentialsEncrypted", "signingSecretEncrypted", "argsSummary", "payload"]) {
        expect(src, `${rel} selects ${forbidden}, which is customer content`).not.toContain(forbidden);
      }
    }
  });
});

describe("the overview stays cheap", () => {
  const fleet = code(readFileSync(join(process.cwd(), "src/lib/admin/fleet.ts"), "utf8"));

  it("decides count-or-estimate from the table's size on disk", () => {
    /**
     * MEASURED, NOT ASSUMED. The first version estimated all six traffic
     * tables from `reltuples` and produced five wrong or unknown figures
     * against the real database: delivery_log 51 for an actual 104, two
     * tables at -1 because they had never been analysed. `reltuples` is
     * excellent on a large table (events: 26,148 for 26,151) and unreliable
     * on a small one, which is exactly backwards from where the saving is.
     *
     * So the size decides. Under 32 MB gets counted — the scan is free and
     * the estimate is worst there; over it keeps the estimate, which is both
     * accurate and the only affordable answer.
     */
    expect(fleet).toMatch(/reltuples/);
    expect(fleet, "size must be read alongside the estimate").toMatch(/pg_total_relation_size/);
    expect(fleet, "and it must gate the decision").toMatch(/EXACT_BELOW_BYTES/);
    expect(fleet).toMatch(/bytes < EXACT_BELOW_BYTES/);
    for (const table of ["events", "raw_events", "delivery_log"]) {
      expect(fleet, `${table} must be in the traffic list`).toContain(`"${table}"`);
    }
  });

  it("tells the reader which figures are estimates", () => {
    // An estimate rendered as a fact is worse than a slow page. The overview
    // marks estimated rows with a tilde and never marks a counted one.
    const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");
    expect(page).toMatch(/row\.exact \? fmt\.format\(row\.rows\) : `~/);
  });

  it("never fans out concurrently, which would invalidate MIN_POOL_MAX", () => {
    /**
     * `MIN_POOL_MAX` in src/db/client.ts is derived arithmetic — 5 (the widest
     * read fan-out in the app) + 1 (a transaction holding its client) + 1
     * (headroom) — and tests/pool-tuning.test.ts asserts that exact sum. A
     * `Promise.all` of a dozen counts here would not be slow, it would break
     * the floor and risk the deadlock that comment describes.
     *
     * Latency does not matter on this page, so the queries simply queue.
     */
    expect(fleet, "admin reads must stay sequential").not.toMatch(/Promise\.all|Promise\.allSettled/);
    const lookup = code(readFileSync(join(process.cwd(), "src/lib/admin/lookup.ts"), "utf8"));
    expect(lookup, "admin reads must stay sequential").not.toMatch(/Promise\.all|Promise\.allSettled/);
  });

  it("does no work on the search page until something is searched for", () => {
    // The cost model in one line: no `?q=`, no query.
    const page = code(readFileSync(join(process.cwd(), "src/app/admin/search/page.tsx"), "utf8"));
    expect(page).toMatch(/q \? await findWorkspaces\(q\) : null/);
  });
});
