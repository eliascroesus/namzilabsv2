import { notFound } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isAllowedStaff, parseAllowlist } from "@/lib/admin/allowlist";

/**
 * WHO IS STAFF. The gate on the only surface in this product that deliberately
 * crosses the tenant wall.
 *
 * ═══ WHY THIS IS THE MOST DANGEROUS FILE IN THE CODEBASE ═══
 *
 * Everything else here is built on one rule: every request-facing query names
 * `org_id`, and `pnpm check:tenancy` fails the build if one does not. The admin
 * dashboard exists to break that rule on purpose — it reads across every
 * tenant at once. So the wall it puts in place of the org predicate is this
 * function, and there is nothing behind it.
 *
 * The DECISION itself lives in `allowlist.ts` as a pure function, because this
 * file imports authkit and therefore cannot be loaded by the test runner. A
 * gate whose fail-closed behaviour can only be verified by reading it is a gate
 * held up by a code review; the split makes it executable in a test.
 *
 * ═══ THE ALLOWLIST LIVES IN THE ENVIRONMENT, NOT THE DATABASE ═══
 *
 * `ADMIN_EMAILS="you@example.com,teammate@example.com"`.
 *
 * Deliberately not a `staff` table, and the reason is what this dashboard is
 * for: it EXPOSES the database. If staff membership were a row, anybody who
 * could write that row could grant themselves a view of every customer — which
 * turns a SQL-injection bug or a leaked connection string into a fleet-wide
 * escalation instead of a single-tenant one. An environment variable is not
 * reachable from a database compromise at all.
 *
 * The second reason is an audit trail for free: adding a colleague is a deploy,
 * so it lands in git history and the platform's env-change log, with a time and
 * an author. A dashboard toggle has neither.
 *
 * The cost is honest: granting access needs a deploy. At the size where that
 * becomes annoying — a dozen staff, people joining monthly — the right move is
 * a WorkOS organization whose membership means staff, not a table.
 *
 * ═══ TWO RULES ABOUT THE REFUSAL ═══
 *
 * NOT FOUND, NOT FORBIDDEN. A non-staff visitor gets a 404 byte-identical to
 * any other missing page. A 403 confirms the route exists, which tells an
 * attacker exactly where to point everything else. There is no admin login
 * page, no "you are not authorised" screen, nothing to find.
 *
 * CHECKED IN EVERY PAGE AND EVERY READ, not once in the layout. A layout is a
 * rendering convenience, not a security boundary — it does not wrap a route
 * handler, and relying on it means one new page is all it takes to bypass.
 * Every function in `src/lib/admin/` that touches the database calls this
 * first, and `tests/admin-access.test.ts` fails if one stops.
 */

/** Parsed once per process; the environment cannot change under an instance. */
let cached: Set<string> | null = null;

function allowlist(): Set<string> {
  if (!cached) cached = parseAllowlist(process.env.ADMIN_EMAILS);
  return cached;
}

export type StaffContext = { userId: string; email: string };

/**
 * Establish that the caller is staff, or render a 404.
 *
 * Returns the identity rather than a boolean so every caller has something to
 * attribute: an admin read is itself a governance act, and "who looked at the
 * fleet, and when" is the question `audit_log` was built to answer.
 */
export async function requireStaff(): Promise<StaffContext> {
  const auth = await withAuth();
  const user = auth.user;
  if (!user) notFound();
  if (!isAllowedStaff(user.email, user.emailVerified, allowlist())) notFound();
  return { userId: user.id, email: (user.email ?? "").trim().toLowerCase() };
}
