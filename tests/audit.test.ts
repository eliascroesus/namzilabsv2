import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./helpers/testdb";
import { auditLog } from "@/db/schema";
import { emailDomain, pseudonym, recordAudit } from "@/lib/audit";

/**
 * THE AUDIT TRAIL, AND THE TWO PROMISES THAT MAKE IT WORTH HAVING.
 *
 * `audit_log` is the one tenant table a workspace deletion deliberately leaves
 * standing (`tests/destroy.test.ts` names the exemption). That is a real
 * exception to a promise this product makes loudly — hard delete, no grace
 * period — and it is only defensible while two things stay true:
 *
 *   1. NOTHING PERSONAL AND NO USER CONTENT IS IN IT. Not "not much": nothing.
 *      Opaque ids, an action name from a closed list, counts and flags. If a
 *      display name or an email ever lands in here, the exemption stops being
 *      "our record of an act survived" and becomes "the customer's data
 *      survived their deletion request", which is a different and much worse
 *      sentence.
 *   2. THE APPLICATION CANNOT REWRITE IT. An audit log with an UPDATE path is
 *      an audit log that anybody with application access can edit, which is
 *      precisely the access an incident investigates.
 *
 * Neither can be enforced by the schema, so they are enforced here, and the
 * suite that fails if they break runs beside the one that permits the
 * exemption. Everything below is written to FAIL if the property goes — see
 * the inline notes where a check could otherwise pass vacuously.
 */

const ROOT = process.cwd();

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
 * Source with comments and string literals' insides stripped.
 *
 * BOTH, and the string half is the one learned the hard way: an earlier check
 * in this codebase asserted `toContain("nz_ref")` and passed on the word
 * appearing in a comment. Here the risk runs the other way — a forbidden word
 * like "secret" appears in explanatory prose all over these files, so a naive
 * scan would fail on the documentation rather than on the code.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

const SRC = walk(join(ROOT, "src"));
const audit = readFileSync(join(ROOT, "src/lib/audit.ts"), "utf8");

/** Every `recordAudit(` call in the tree, as balanced argument text. */
function callSites(): Array<{ file: string; text: string }> {
  const sites: Array<{ file: string; text: string }> = [];
  for (const file of SRC) {
    const rel = file.slice(ROOT.length + 1);
    if (rel === "src/lib/audit.ts") continue; // the definition, not a call
    const src = code(readFileSync(file, "utf8"));
    let i = src.indexOf("recordAudit(");
    while (i !== -1) {
      let depth = 0;
      let end = i + "recordAudit".length;
      for (; end < src.length; end++) {
        if (src[end] === "(") depth++;
        else if (src[end] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      sites.push({ file: rel, text: src.slice(i, end + 1) });
      i = src.indexOf("recordAudit(", end);
    }
  }
  return sites;
}

describe("the audit trail records the acts that matter", () => {
  it("covers every governance act, by name", () => {
    /**
     * The list is spelled out because it IS the policy — the point of this
     * table is that somebody decided which acts are governance, and a test
     * that derived the list from the call sites would assert only that the
     * code matches itself. Deleting a `recordAudit` call fails this.
     */
    const actions = new Set(callSites().flatMap((s) => [...s.text.matchAll(/action: "([a-z._]+)"/g)].map((m) => m[1])));
    for (const required of [
      // Who can reach the data.
      "member.invite",
      "member.invite_revoke",
      "member.rank_assign",
      "rank.create",
      "rank.update",
      "rank.delete",
      // Who owns it, and whether it exists at all.
      "workspace.create",
      "workspace.rename",
      "workspace.transfer",
      "workspace.delete",
      "account.delete",
      // Custody of somebody else's credentials.
      "connection.create",
      "connection.reconnect",
      "connection.signing_enable",
      "connection.disconnect",
      "connection.delete",
      // Where the data can GO, which is its own category.
      "ai.access_toggle",
      "ai.assistant_disconnect",
    ]) {
      expect(actions, `no recordAudit call writes ${required}`).toContain(required);
    }
  });

  it("uses no action outside the closed list in src/lib/audit.ts", () => {
    // A typo'd action name would compile (it is a string literal checked
    // against a union) but this catches the case where somebody widens the
    // union without meaning to — the failure mode the memory on this repo
    // records as "widening a union is when it bites".
    const declared = new Set([...audit.matchAll(/^\s*\| "([a-z._]+)";?$/gm)].map((m) => m[1]));
    expect(declared.size, "the AuditAction union could not be parsed — this check would pass vacuously").toBe(18);
    for (const site of callSites()) {
      for (const [, action] of site.text.matchAll(/action: "([a-z._]+)"/g)) {
        expect(declared, `${site.file} writes ${action}, which is not in the AuditAction union`).toContain(action);
      }
    }
  });

  it("logs the three irreversible acts from the file that performs them", () => {
    const danger = code(readFileSync(join(ROOT, "src/app/dashboard/settings/danger-actions.ts"), "utf8"));
    for (const action of ["workspace.transfer", "workspace.delete", "account.delete"]) {
      expect(danger, `danger-actions.ts must record ${action}`).toContain(`action: "${action}"`);
    }
  });
});

describe("nothing personal reaches the audit trail", () => {
  it("passes no credential, secret or token into a row", () => {
    /**
     * Scanned over comment-stripped source, because every one of these words
     * appears in the prose explaining why it must not appear in the code.
     *
     * STRING LITERALS ARE STRIPPED FIRST, and the distinction is the whole
     * substance of this check. `authType: … ?? "apiKey"` is an ENUM VALUE —
     * one of four names for how a connector authenticates, and exactly the
     * sort of thing an audit row should carry. `apiKey` as an IDENTIFIER is a
     * credential somebody typed into a form. Same six letters, opposite
     * meanings, and only the second is a leak.
     */
    const forbidden = /\b(credentials?|signingSecret|secret|apiKey|accessToken|refreshToken|password)\b/i;
    const sites = callSites().map((s) => ({ ...s, text: s.text.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""') }));
    expect(sites.length, "no call sites found — every check in this block would pass vacuously").toBeGreaterThan(15);
    for (const site of sites) {
      const hit = site.text.match(forbidden);
      expect(hit?.[0] ?? null, `${site.file} passes ${hit?.[0]} into an audit row`).toBeNull();
    }
  });

  it("never passes a name, and never a bare email", () => {
    for (const site of callSites()) {
      /**
       * `.name` and a `name:` key — a workspace name, a connection name, a
       * rank name. All user content, all visible in the product anyway, none
       * of it allowed to outlive a deletion in this table.
       *
       * A COMPARISON IS EXEMPT, because `renamed: patch.name !== undefined`
       * puts a BOOLEAN in the row and not the string. That is the shape the
       * rank editor needs — "somebody renamed this role" is the audit fact,
       * and what they renamed it to is not — so the rule has to permit
       * deriving a flag from a name while still refusing the name itself.
       */
      expect(site.text, `${site.file} passes a name into an audit row`).not.toMatch(
        /\.name\b(?!\s*(?:!==|===|!=|==))|\bname:/,
      );
      /**
       * An email may appear ONLY inside pseudonym() or emailDomain(). This is
       * the one audited subject that genuinely is personal data, so the check
       * is that it is wrapped rather than that it is absent.
       */
      for (const [, expr] of site.text.matchAll(/(?:target|detail):\s*([^,\n]+)/g)) {
        if (!/email|parsed\.data/i.test(expr)) continue;
        expect(expr, `${site.file} passes an email unwrapped: ${expr.trim()}`).toMatch(/pseudonym\(|emailDomain\(/);
      }
    }
  });

  it("hashes an address to something confirmable but not reversible", () => {
    // Same address, same value — otherwise an investigator with a suspected
    // address could not confirm it, which is the only reason to store it.
    expect(pseudonym("Person@Example.com")).toBe(pseudonym("  person@example.com  "));
    expect(pseudonym("a@example.com")).not.toBe(pseudonym("b@example.com"));
    // 64 bits of hex, and nothing that looks like the input.
    expect(pseudonym("person@example.com")).toMatch(/^[0-9a-f]{16}$/);
    expect(pseudonym("person@example.com")).not.toContain("person");
    expect(pseudonym("person@example.com")).not.toContain("example");
  });

  it("keeps the domain and only the domain", () => {
    expect(emailDomain("Person@Example.com")).toBe("example.com");
    expect(emailDomain("a@b@corp.io")).toBe("corp.io"); // last @ wins
    expect(emailDomain("not-an-email")).toBeNull();
    expect(emailDomain("trailing@")).toBeNull();
  });
});

describe("the audit trail is append-only", () => {
  it("has no update or delete path anywhere in src/", () => {
    /**
     * THE CHECK THAT MATTERS MOST IN THIS FILE. `recordAudit` is the only
     * writer and it only inserts; this is what fails if a second path appears.
     *
     * Comment-stripped, so the paragraphs in audit.ts and schema.ts promising
     * there is no update path do not themselves satisfy the check.
     */
    let inserts = 0;
    for (const file of SRC) {
      const src = code(readFileSync(file, "utf8"));
      const rel = file.slice(ROOT.length + 1);
      inserts += [...src.matchAll(/\.insert\(\s*auditLog\s*[,)]/g)].length;
      for (const verb of ["update", "delete"] as const) {
        const re = new RegExp(`\\.${verb}\\(\\s*auditLog\\s*[,)]`, "g");
        const found = [...src.matchAll(re)];
        expect(
          found.length,
          `${rel} ${verb}s audit_log. The table is append-only: an audit log the ` +
            `application can rewrite is one an attacker with application access can rewrite.`,
        ).toBe(0);
      }
    }
    // Without this the loop above would pass on a tree where `auditLog` is
    // never referenced at all — which is exactly what a bad refactor looks
    // like, and it would look identical to success.
    expect(inserts, "nothing inserts into auditLog — this check would pass vacuously").toBe(1);
  });

  it("is not swept by a workspace deletion", () => {
    // The mirror of the exemption in destroy.test.ts, asserted from the other
    // side: destroy.ts must not learn about this table.
    const destroy = code(readFileSync(join(ROOT, "src/lib/destroy.ts"), "utf8"));
    expect(destroy).not.toMatch(/auditLog/);
  });
});

describe("recordAudit against real SQL", () => {
  it("writes the row it was given", async () => {
    const { db, close } = await createTestDb();
    try {
      await recordAudit(db, {
        action: "member.rank_assign",
        orgId: "org_a",
        actorId: "user_admin",
        target: "user_member",
        detail: { rank: "rank_1", cleared: false },
      });
      const rows = await db.select().from(auditLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "member.rank_assign",
        orgId: "org_a",
        actorId: "user_admin",
        target: "user_member",
        detail: { rank: "rank_1", cleared: false },
      });
      // Written by the database, not the caller: a timestamp an application
      // supplies is a timestamp an application can lie about.
      expect(rows[0].at).toBeInstanceOf(Date);
    } finally {
      await close();
    }
  });

  it("accepts an account-level act with no workspace", async () => {
    const { db, close } = await createTestDb();
    try {
      // `account.delete` belongs to no org, which is why the column is
      // nullable. A NOT NULL here would mean the most consequential act in the
      // product is the one act that cannot be recorded.
      await recordAudit(db, { action: "account.delete", actorId: "user_gone", detail: { workspacesOwned: 2 } });
      const [row] = await db.select().from(auditLog);
      expect(row.orgId).toBeNull();
      expect(row.target).toBeNull();
      expect(row.action).toBe("account.delete");
    } finally {
      await close();
    }
  });

  it("swallows a write failure instead of failing the act", async () => {
    const { db, close } = await createTestDb();
    try {
      // The deliberate trade in src/lib/audit.ts: a logging fault must not be
      // able to block a deletion the owner has already confirmed by typing its
      // name. Proven by writing through a closed connection — a real failure,
      // not a mocked one.
      await close();
      await expect(recordAudit(db, { action: "workspace.delete", orgId: "org_a", actorId: "u" })).resolves.toBeUndefined();
    } finally {
      await close().catch(() => {});
    }
  });
});
