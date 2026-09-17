import { getWorkOS } from "@workos-inc/authkit-nextjs";

/**
 * WORKSPACE IDS, TURNED BACK INTO NAMES.
 *
 * The overview's tables were columns of `org_01M1VVM4M2W5D64MAVD9KH4KZ3`. Every
 * number on the page was correct and none of it was usable: you cannot tell
 * which customer is having trouble, which one has the most apps connected, or
 * whose account was just deleted, without copying an id into Look up and coming
 * back. That is a page you read twice and act on never.
 *
 * ═══ WHY IT SAID IDS, AND WHY THAT REASONING NO LONGER BINDS ═══
 *
 * The original note is worth quoting: "Resolving ten names means ten WorkOS
 * calls on every page load for a leaderboard". True, and the right instinct —
 * but it was defending against a cost the page explicitly accepts. The owner's
 * brief for this whole panel was "we want to be as cost efficient as absolutely
 * possible... even if it takes 10 seconds to load in doesn't matter". Ten
 * parallel API calls is well under a second, and it is the difference between a
 * leaderboard and a list of hex.
 *
 * What the old reasoning DOES still buy is the bound. This never resolves more
 * than `MAX` ids however many the page asks for, so a fleet of ten thousand
 * cannot turn one render into ten thousand requests. The tables it serves are
 * top-tens and last-tens; if one ever isn't, it truncates rather than obliging.
 *
 * ═══ A MISSING NAME IS NOT AN ERROR ═══
 *
 * Deleted workspaces stay in the audit log forever — that is the point of an
 * audit log — so `getOrganization` will 404 for some of these, routinely. Each
 * lookup fails alone and falls back to a short id, because a governance table
 * that renders nothing because one row's workspace is gone is worse than one
 * that says `01M2BGM6…`.
 */

/** Never more than this many lookups per render, whatever is asked for. */
const MAX = 24;

export type OrgNames = {
  /** id → display name. Missing when the lookup failed or was over the bound. */
  get: (orgId: string) => string | null;
  /** How the page should print an id it has no name for. */
  short: (orgId: string) => string;
};

/**
 * Resolve as many of these as the bound allows, in parallel, never throwing.
 *
 * Takes the whole set the page will render so the dedupe happens once: the same
 * workspace usually appears in the leaderboard AND the governance list, and
 * looking it up twice is a request nobody needed.
 */
export async function resolveOrgNames(ids: Array<string | null | undefined>): Promise<OrgNames> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, MAX);
  const workos = getWorkOS();

  const pairs = await Promise.all(
    unique.map(async (id) => {
      const org = await workos.organizations.getOrganization(id).catch(() => null);
      return [id, org?.name ?? null] as const;
    }),
  );

  const byId = new Map(pairs);
  return {
    get: (orgId) => byId.get(orgId) ?? null,
    /**
     * The tail, not the head. Every WorkOS id begins `org_01M…` — those
     * characters are a timestamp prefix shared by everything created in the
     * same period, so a leading truncation makes two different workspaces look
     * identical. The last eight are the part that distinguishes them.
     */
    short: (orgId) => (orgId.length > 12 ? `…${orgId.slice(-8)}` : orgId),
  };
}
