import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PostgresDialect } from "@/db/dialect";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * THE PROPERTIES THE 15 SEP 2026 AUDIT CONFIRMED, WRITTEN DOWN SO THEY STAY
 * TRUE.
 *
 * An audit is a photograph. What survives it is the checks it leaves behind —
 * the point of this file is that the next person to add a server action or a
 * raw SQL fragment finds out here rather than from a customer.
 *
 * The full narrative lives in `docs/security-audit.md`; these are the
 * mechanical halves of it.
 */

describe("every server action is gated", () => {
  /**
   * A SERVER ACTION IS A PUBLIC HTTP ENDPOINT. Next gives it an obscure id and
   * that is not a wall — the id is in the client bundle. So every exported
   * action must establish WHO is calling before it does anything, and the two
   * ways to do that here are `requireOrg()` (session + tenant) and `withAuth()`
   * (session only, for the acts that are about a person rather than a
   * workspace).
   */
  const ACTION_FILES = walk(join(root, "src")).filter((f) => /^"use server"/.test(readFileSync(f, "utf8")));

  /**
   * The two exceptions, and why each is safe without a gate of its own.
   *
   * `switchOrgAction` hands an org id straight to WorkOS's
   * `switchToOrganization`, which calls `refreshSession({ organizationId,
   * ensureSignedIn: true })` — the IdP's token endpoint REFUSES an org the
   * refresh token is not entitled to, and `ensureSignedIn` handles the
   * no-session case. The wall is real and it is at WorkOS. Verified by reading
   * the installed SDK, not by trusting the comment above it.
   *
   * `signOutAction` ends a session. Doing that without one is a no-op.
   */
  const UNGATED_BY_DESIGN: Record<string, string> = {
    switchOrgAction: "WorkOS refuses an org the refresh token is not entitled to; ensureSignedIn covers no session",
    signOutAction: "ending a session you do not have is a no-op",
    /**
     * THE THREE THAT CREATE A SESSION. Requiring one first is a contradiction:
     * nobody arriving at `/login` has a session, and that is the point of the
     * page.
     *
     * They are not therefore unguarded. Each forwards a credential to WorkOS
     * and does nothing at all with the answer except seal whatever WorkOS
     * returned — no password is compared here, no token is minted here, and no
     * tenant is read from the form. WorkOS owns the rate limiting (fed the real
     * client IP, see `requestOrigin`), the breach checks and the lockout.
     *
     * The thing that WOULD be ours to get wrong is where they send somebody
     * afterwards, and that is `safeNext` — pinned separately, and hard, in
     * `tests/auth-routes.test.ts`.
     */
    signInAction: "creates the session; a session gate would be circular. Credentials are forwarded to WorkOS, never judged here",
    signUpAction: "same — it creates the account, then delegates to signInAction",
    verifyEmailAction: "finishes a sign-in with a WorkOS pending token held in an httpOnly cookie; there is no session yet by definition",
    /**
     * THE SIGNED-OUT HALF OF A TEMPLATE LINK. Its whole audience is people with
     * no account — a coach's students — so a session gate would refuse exactly
     * who it is for. It reads a template by its public code (what anybody
     * holding the link can already see on the page), sets two first-party
     * cookies — the choice, and the author's derived referral code — and sends
     * the visitor to sign up. It writes no row. Each cookie only ever takes
     * effect through a GATED act: the template through `createOrganizationAction`
     * (requireOrg's sibling, `withAuth`), the referral through `recordReferral`'s
     * new-account and self-referral guards.
     */
    startWithTemplateAction: "reads a public template by its code and sets two cookies before sign-up; writes nothing, and each cookie only acts through a gated action",
  };

  it("has no action that skips both gates", () => {
    const naked: string[] = [];
    for (const file of ACTION_FILES) {
      const rel = file.slice(root.length + 1);
      const src = code(readFileSync(file, "utf8"));
      const re = /export async function (\w+)\s*\(/g;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const name = m[1];
        const rest = src.slice(m.index);
        const next = rest.indexOf("\nexport ", 1);
        const body = next === -1 ? rest : rest.slice(0, next);
        // `requireStaff()` is `withAuth()` plus the ADMIN_EMAILS allowlist — a
        // stricter gate, not a missing one (see src/lib/admin/access.ts).
        if (/requireOrg\(\)|withAuth\(|requireStaff\(\)/.test(body)) continue;
        if (UNGATED_BY_DESIGN[name]) continue;
        naked.push(`${rel} :: ${name}`);
      }
    }
    expect(
      naked,
      `Server action(s) with no session gate: ${naked.join(", ")}. Add requireOrg() or withAuth(), ` +
        `or — if it is genuinely safe without one — add it to UNGATED_BY_DESIGN in this file WITH the reason.`,
    ).toEqual([]);
  });

  it("takes the tenant from the session and never from the form", () => {
    /**
     * THE IDOR CLASS. An `orgId` read out of a form is an endpoint that acts on
     * whichever tenant the caller names — which is the whole of multi-tenancy,
     * undone by one field.
     */
    for (const file of ACTION_FILES) {
      const src = code(readFileSync(file, "utf8"));
      const rel = file.slice(root.length + 1);
      // Staff act on whichever workspace they name — that is the back office's
      // job, and every act there is gated by requireStaff() as its FIRST
      // statement and audited (tests/admin-actions.test.ts). No customer can
      // reach it.
      if (rel === "src/app/admin/actions.ts") continue;
      for (const key of ["orgId", "organizationId", "org_id", "tenantId"]) {
        // `switchOrgAction` is the one place an org id legitimately arrives
        // from a form, because WorkOS validates it — see UNGATED_BY_DESIGN.
        if (rel === "src/app/actions.ts" && key === "organizationId") continue;
        // Any spelling of reading it: `formData.get("orgId")`, `fd.get('orgId')`,
        // or a helper like `str(formData, "orgId")` — a helper must not be
        // what makes this check pass.
        const read = new RegExp(`\\.get\\(\\s*["']${key}["']\\s*\\)|\\(\\s*\\w+\\s*,\\s*["']${key}["']\\s*\\)`);
        expect(src, `${rel} reads ${key} from a form`).not.toMatch(read);
      }
    }
  });
});

describe("raw SQL cannot be broken out of", () => {
  const d = new PostgresDialect();

  it("escapes a JSON path segment that tries to close the literal", () => {
    /**
     * THE FIELD PICKER LETS SOMEBODY TYPE A PATH. "Use 'booking' as a field
     * path" is a real affordance in the flow builder, and that string reaches
     * `sql.raw` through `jsonExtractText` — so this is the one place in the
     * product where user text becomes SQL rather than a bound parameter.
     *
     * The existing test covered `o'key`. These are the shapes somebody trying
     * would actually send, and the assertion is not "it is escaped" but
     * "the result is still ONE quoted literal": every quote in the output is
     * either the pair we opened and closed with, or a doubled one inside it.
     */
    const attacks = [
      "x'; drop table events; --",
      "x' or '1'='1",
      "x'||(select current_setting('is_superuser'))||'",
      "a'--",
      "';\n--",
    ];
    for (const a of attacks) {
      const out = d.jsonExtractText('"events"."properties"', [a]);
      // The payload's own quotes are all doubled…
      expect(out, a).toContain(a.replaceAll("'", "''"));
      // …and nothing outside the literal survived: no statement terminator and
      // no comment marker can be sitting in SQL position, because the only
      // single quotes are the delimiters and doubled pairs.
      const quotes = (out.match(/'/g) ?? []).length;
      expect(quotes % 2, `${a} left an unbalanced quote: ${out}`).toBe(0);
    }
  });

  it("escapes an identifier that tries to close the quotes", () => {
    expect(d.quoteIdent('a" or 1=1 --')).toBe('"a"" or 1=1 --"');
    expect(() => d.quoteIdent("")).toThrow();
  });

  it("depends on standard_conforming_strings, and says so", () => {
    /**
     * DOUBLING `'` IS COMPLETE ONLY WHILE BACKSLASHES ARE LITERAL. With
     * `standard_conforming_strings = off` — off by default before Postgres 9.1,
     * settable per session — `\'` would escape the delimiter and the doubling
     * could be walked out of. Every supported Postgres has it on and Neon does
     * not change it, so this is a documented assumption rather than a hole; the
     * assertion is that the assumption is WRITTEN DOWN where the escaping is,
     * so nobody later reads the doubling as unconditional.
     */
    expect(read("src/db/dialect.ts")).toMatch(/standard_conforming_strings/);
  });
});

describe("secrets and what is said about them", () => {
  it("encrypts with AES-256-GCM and a fresh nonce per message", () => {
    /**
     * GCM's failure mode is nonce REUSE: two messages under one key and one
     * nonce leaks the keystream and forges the tag. `randomBytes(12)` per call
     * is the standard answer, safe to ~2^32 messages per key.
     */
    const src = code(read("src/lib/crypto.ts"));
    expect(src).toMatch(/createCipheriv\("aes-256-gcm"/);
    expect(src).toMatch(/const iv = randomBytes\(IV_LEN\)/);
    expect(src, "the tag travels with the ciphertext or nothing is authenticated").toMatch(/getAuthTag\(\)/);
    expect(src).toMatch(/setAuthTag\(tag\)/);
    expect(src, "a short key must be refused rather than padded").toMatch(/key\.length !== 32/);
  });

  it("logs no secret, anywhere", () => {
    /**
     * A credential in a log line outlives every delete that was supposed to
     * remove it, and it lands in a system with different access rules from the
     * database. `p.key` is allowed through: it is the provider's NAME
     * ("google"), which is the only "key" in the product that is not one.
     */
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = file.slice(root.length + 1);
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!/console\.(log|info|warn|error)/.test(line)) continue;
        if (!/\$\{[^}]*(secret|token|credential|password|apiKey)/i.test(line)) continue;
        if (/\bp\.key\b|provider\.key/.test(line)) continue;
        offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, `Log line(s) interpolating a secret: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("keeps the referral cookie server-only and cross-site safe", () => {
    // It is an attribution, not a credential — but it is still ours, and a
    // script that can read or forge it can reassign somebody's earnings.
    const src = read("src/app/r/[code]/route.ts");
    expect(src).toMatch(/httpOnly: true/);
    expect(src).toMatch(/sameSite: "lax"/);
    expect(src, "and Secure wherever there is TLS to be secure over").toMatch(/secure: process\.env\.NODE_ENV === "production"/);
  });
});

describe("the outer walls", () => {
  it("protects every authenticated route prefix that exists", () => {
    /**
     * The proxy is the outer wall and routes gate themselves as well. What is
     * asserted here is that no PAGE directory under `src/app` that renders
     * customer data sits outside the protected list — the failure this catches
     * is a new top-level route shipping unprotected because the list looked
     * long enough already.
     */
    const proxy = read("src/proxy.ts");
    for (const prefix of ["/dashboard", "/onboarding", "/integrations", "/connections"]) {
      expect(proxy, `${prefix} must be behind the wall`).toContain(`"${prefix}"`);
    }
    // `/design` is deliberately public — it renders fixtures, and the
    // screenshot tooling can only reach routes that need no session.
    expect(proxy).toMatch(/`\/design` is deliberately NOT here/);
  });

  it("sends the security headers from the config, not from middleware", () => {
    /**
     * The proxy's matcher deliberately EXCLUDES the machine endpoints —
     * webhooks, inngest, health, mcp — which are exactly the routes a header set
     * in middleware would miss. `headers()` in the config matches every path.
     * `pnpm headers` proves they are on the wire, including on those routes.
     */
    const cfg = read("next.config.mjs");
    expect(cfg).toMatch(/async headers\(\)/);
    expect(cfg).toMatch(/source: "\/:path\*"/);
    for (const h of [
      "Strict-Transport-Security",
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ]) {
      expect(cfg, `${h} is missing`).toContain(h);
    }
    expect(cfg, "frame-ancestors is the clickjacking wall over two irreversible controls").toContain("frame-ancestors 'none'");
  });
});
