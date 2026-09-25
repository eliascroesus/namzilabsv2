import { createHash } from "node:crypto";
import { auditLog } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * THE GOVERNANCE AUDIT TRAIL — the writer, and the only writer.
 *
 * The Sep 2026 audit found every gate in this product holding and no record
 * anywhere of the acts those gates permit. Who became an admin, who was handed
 * the workspace, who destroyed it, whose credential was replaced, when the
 * assistant was let in — all of it a `console.info` at best, in a stream with no
 * retention, no query path and no tenant scoping. This is that record.
 *
 * ═══ WHAT GETS LOGGED, AND WHAT DELIBERATELY DOES NOT ═══
 *
 * Seventy-eight server actions exist. Eighteen acts are logged. The line is not
 * "important things" — it is the acts that change WHO CAN REACH THE DATA,
 * DESTROY SOME OF IT, MOVE A CREDENTIAL, or OPEN A PATH FOR IT TO LEAVE.
 *
 * Moving a tile, renaming a flow, adding a metric and publishing a board are
 * not here, and leaving them out is the point: an audit log that records
 * everything is a log nobody can read, and the signal that matters — a rank
 * changed at 3am — would be four hundred rows deep in somebody rearranging a
 * dashboard. A log with 23 action types can be read top to bottom by a human
 * during an incident, which is the only time it will ever be read.
 *
 * ═══ NO PERSONAL DATA AND NO USER CONTENT REACHES THIS TABLE ═══
 *
 * Because the rows OUTLIVE the workspace they describe (see the schema comment
 * for why that is necessary), the invariant that makes it defensible has to be
 * absolute rather than mostly true:
 *
 *   - NO EMAILS. An invite's subject is the one act whose target genuinely IS
 *     an email address, so it is stored as `pseudonym()` — a truncated SHA-256
 *     — with the DOMAIN kept in the clear. A domain is not personal data, and
 *     "an outsider at gmail.com was invited into this workspace" is exactly the
 *     signal an incident is looking for. Given a suspected address you can
 *     confirm it; you cannot enumerate addresses out of the table.
 *   - NO NAMES. `workspace.rename` records the actor and the fact, not the
 *     strings. Who renamed it and when is the security question; what it is
 *     called is visible in the product.
 *   - NO CREDENTIALS, no metric values, no customer records, no free text from
 *     anybody. `detail` is enum values, counts and flags.
 *
 * Which is also why the rows are kept with no cutoff: there is nothing in here
 * that a retention window would be protecting, and twenty-three human-gated action
 * types do not grow a table. See the schema comment on `audit_log`.
 *
 * ═══ IT NEVER THROWS, AND THAT IS A JUDGEMENT WITH A COST ═══
 *
 * The alternative is fail-closed: refuse the act if it cannot be recorded. That
 * reads stronger and is worse here, because it would mean a database hiccup
 * blocking a workspace deletion the owner has already confirmed by typing its
 * name — turning a logging fault into a customer unable to exercise erasure.
 *
 * What makes swallowing acceptable is that the audit row and the act itself go
 * to THE SAME DATABASE. There is no realistic failure that loses the log while
 * the act succeeds; an attacker cannot silence this without also breaking the
 * writes they are trying to hide. Failures go to stderr loudly.
 *
 * ═══ APPEND-ONLY, ENFORCED ELSEWHERE ═══
 *
 * There is no update path and no delete path in this module — the only DELETE
 * that may touch `audit_log` is the age-based prune in `storage-lifecycle.ts`,
 * and `tests/audit.test.ts` fails if any other statement in `src/` updates or
 * deletes it. An audit log the application can rewrite is an audit log anybody
 * with application access can rewrite.
 */

/**
 * The closed list. Adding a case here is a deliberate act that shows up in a
 * diff, which is the same reason `check-tenancy.ts` keeps its allowlist inline.
 *
 * Named `<subject>.<verb>` so a reader scanning the column sees the subject
 * first and so `like 'connection.%'` is a useful query.
 */
type AuditAction =
  // ── Who can reach this workspace ────────────────────────────────────────
  | "member.invite"
  | "member.invite_revoke"
  | "member.rank_assign"
  | "rank.create"
  | "rank.update"
  | "rank.delete"
  // ── Who owns it, and whether it exists ──────────────────────────────────
  | "workspace.create"
  | "workspace.rename"
  | "workspace.transfer"
  | "workspace.delete"
  | "account.delete"
  // ── Custody of third-party credentials ──────────────────────────────────
  | "connection.create"
  | "connection.reconnect"
  | "connection.signing_enable"
  | "connection.disconnect"
  | "connection.delete"
  // ── Paths for data to LEAVE, which is its own category ──────────────────
  | "ai.access_toggle"
  | "ai.assistant_disconnect"
  // ── A workspace's STRUCTURE leaving it, by link (see lib/templates) ──────
  | "template.create"
  | "template.update"
  | "template.link_toggle"
  | "template.delete"
  | "template.use";

/**
 * Enum values, counts and flags. Strings are permitted because provider slugs
 * and rank names are strings; the rule that they are not FREE TEXT is stated
 * above and checked at the call sites by `tests/audit.test.ts`.
 */
type AuditDetail = Record<string, string | number | boolean | null>;

/**
 * An email reduced to something that can be CONFIRMED but not ENUMERATED.
 *
 * Truncated to 16 hex characters — 64 bits. Long enough that two addresses
 * colliding is not a thing that happens, short enough to read in a terminal.
 * There is no salt on purpose: a salt kept next to the data protects nothing,
 * and a salt that is lost makes the value unconfirmable, which removes the only
 * reason the column exists.
 */
export function pseudonym(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex").slice(0, 16);
}

/** The domain half of an email, which is not personal data. `null` if absent. */
export function emailDomain(value: string): string | null {
  const at = value.lastIndexOf("@");
  return at === -1 || at === value.length - 1 ? null : value.slice(at + 1).trim().toLowerCase();
}

/**
 * Record one governance act.
 *
 * Takes `db` rather than reaching for `getDb()` so the most security-relevant
 * writer in the product is testable against a real database — the same split
 * `destroy.ts` uses, and for the same reason.
 */
export async function recordAudit(
  db: DB,
  entry: {
    action: AuditAction;
    orgId?: string | null;
    actorId?: string | null;
    target?: string | null;
    detail?: AuditDetail;
  },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: entry.action,
      orgId: entry.orgId ?? null,
      actorId: entry.actorId ?? null,
      target: entry.target ?? null,
      detail: entry.detail ?? {},
    });
  } catch (err) {
    // Loud, and never rethrown. See the note above: the act the caller is
    // performing must not fail because its record could not be written.
    console.error("[audit] write failed", entry.action, err);
  }
}
