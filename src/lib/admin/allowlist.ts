/**
 * THE ADMIN AUTHORIZATION DECISION, AS A PURE FUNCTION.
 *
 * Split out from `access.ts` for one reason that turned out to matter: that
 * file imports `@workos-inc/authkit-nextjs`, which cannot be loaded in the test
 * runner, so the most security-critical logic in the product was reachable only
 * by reading it. A gate whose fail-closed behaviour cannot be EXECUTED in a
 * test is a gate held up by a code review.
 *
 * So the decision lives here with no framework in it, and `access.ts` is the
 * thin wiring that hands it a session. Everything below is total, synchronous
 * and covered by `tests/admin-access.test.ts`.
 */

/**
 * Parse `ADMIN_EMAILS` into a set of addresses.
 *
 * FAILS CLOSED IN EVERY DIRECTION. Unset, empty, whitespace, all-commas, or
 * full of things that are not addresses — each yields an empty set, and an
 * empty set admits nobody. The mistake this is shaped against is a deploy that
 * drops the variable: that must lock the door, not remove it.
 *
 * The `includes("@")` filter is not validation, it is a refusal to guess. A
 * hostname or a stray word in the list is a configuration error, and the safe
 * reading of a configuration error is "not a member".
 *
 * The empty-string case is the one worth naming: without the length filter,
 * `"a@b.com,"` would put `""` in the set, and any account whose email failed to
 * load would normalise to `""` and match it.
 */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0 && entry.includes("@")),
  );
}

/**
 * May this person see the fleet?
 *
 * THREE CONDITIONS, ALL REQUIRED:
 *
 *   - the allowlist is non-empty. An empty one is a misconfiguration, and the
 *     safe reading of a misconfigured gate is "closed".
 *   - the email is VERIFIED. Not merely present — without this the gate trusts
 *     a string the user may control, and registering as owner@yourdomain is
 *     the whole attack.
 *   - the address is on the list, compared after the same normalisation the
 *     list itself went through.
 */
export function isAllowedStaff(
  email: string | null | undefined,
  emailVerified: boolean,
  allowlist: Set<string>,
): boolean {
  if (allowlist.size === 0) return false;
  if (emailVerified !== true) return false;
  const normalised = (email ?? "").trim().toLowerCase();
  if (!normalised) return false;
  return allowlist.has(normalised);
}
